import { NextResponse } from "next/server";
import { resolveSeed } from "@/lib/seed";
import { searchSeed, getTrack, relatedArtists, findTrack, artistFans, norm, type DzTrack } from "@/lib/deezer";
import { getCandidates, llmProvider } from "@/lib/llm";
import { graphDig } from "@/lib/graph";
import { findRecordingMbid, similarRecordings } from "@/lib/listenbrainz";
import { analyzePreview, keyCompat, bpmCompat, type Analysis } from "@/lib/analyze";

export const runtime = "nodejs";
export const maxDuration = 60;

// Popularity ceilings per depth level. rank is Deezer's 0–1M track score;
// a current chart hit sits around 800k+, a typical album track by a mid act ~200–400k.
const LIMITS: Record<number, { rank: number; fans: number }> = {
  1: { rank: 450_000, fans: 400_000 },
  2: { rank: 320_000, fans: 150_000 },
  3: { rank: 200_000, fans: 40_000 },
};

type Source = "listeners" | "ai" | "graph";

export type Pick = {
  id?: number;
  artist: string;
  title: string;
  why: string;
  source: Source;
  verified: boolean;
  cover?: string;
  preview?: string;
  deezer?: string;
  rank?: number;
  fans?: number | null;
  key?: string;
  camelot?: string;
  bpm?: number | null;
  mix?: string; // e.g. "+1 energy up", "Key clash"
  inKey?: boolean;
  spotify: string;
  youtube: string;
};

type Cand = { artist: string; title: string; why: string; source: Source; base: number; track?: DzTrack; fans?: number | null };

function links(artist: string, title: string) {
  const q = encodeURIComponent(`${artist} ${title}`);
  return {
    spotify: `https://open.spotify.com/search/${q}`,
    youtube: `https://www.youtube.com/results?search_query=${q}`,
  };
}

async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    })
  );
  return out;
}

// GET /api/dig?seedId=...&depth=2 — same thing, handy for testing and sharing.
export async function GET(req: Request) {
  const u = new URL(req.url);
  return dig({
    input: u.searchParams.get("input"),
    seedId: u.searchParams.get("seedId"),
    depth: u.searchParams.get("depth"),
    keyLock: u.searchParams.get("keyLock") !== "0",
    note: u.searchParams.get("note") || "",
  });
}

export async function POST(req: Request) {
  return dig(await req.json().catch(() => ({})));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function dig(body: any) {
  const t0 = Date.now();
  try {
    const input = String(body.input || "").trim();
    const depth = [1, 2, 3].includes(Number(body.depth)) ? Number(body.depth) : 2;
    const exclude: string[] = Array.isArray(body.exclude) ? body.exclude.slice(0, 200) : [];
    const note = typeof body.note === "string" ? body.note.slice(0, 200) : "";
    const keyLock = body.keyLock !== false;
    const seedId = Number(body.seedId) || 0;
    if (!input && !seedId) return NextResponse.json({ error: "Give me a song." }, { status: 400 });

    // ---------- Seed ----------
    const confirmed = seedId ? await getTrack(seedId) : null;
    const seed = confirmed
      ? { query: `${confirmed.artist.name} - ${confirmed.title}`, source: "text" as const }
      : await resolveSeed(input);
    const dzSeed = confirmed ?? (await searchSeed(seed.query));
    if (!dzSeed) throw new Error("Couldn't find that song. Try 'Artist - Song' spelled out.");
    const seedLabel = `${dzSeed.artist.name} - ${dzSeed.title}`;
    const lim = LIMITS[depth];

    // Everything that only depends on the seed runs in parallel.
    const provider = llmProvider();
    const [hop1, seedAnalysis, listenerRecs, aiResult] = await Promise.all([
      relatedArtists(dzSeed.artist.id),
      analyzePreview(dzSeed.id, dzSeed.preview),
      findRecordingMbid(dzSeed.artist.name, dzSeed.title).then((m) => (m ? similarRecordings(m, depth) : [])),
      provider
        ? getCandidates({ seed: seedLabel, related: [], exclude, count: 20, depth, note }).catch(() => null)
        : Promise.resolve(null),
    ]);
    const seedBpm = (dzSeed as DzTrack & { bpm?: number }).bpm || seedAnalysis?.bpm || null;

    // ---------- Gather song-level candidates ----------
    const seedArtist = norm(dzSeed.artist.name);
    const excludedArtists = new Set(exclude.map((s) => norm(s.split(/\s[–-]\s/)[0])));
    const obvious = new Set(depth >= 2 ? hop1.slice(0, 8).map((a) => norm(a.name)) : []);
    const seenArtist = new Set<string>();
    const accept = (artist: string) => {
      const a = norm(artist);
      if (!a || a === seedArtist || excludedArtists.has(a) || obvious.has(a) || seenArtist.has(a)) return false;
      seenArtist.add(a);
      return true;
    };

    const cands: Cand[] = [];
    for (const r of listenerRecs) {
      if (!accept(r.artist)) continue;
      cands.push({
        artist: r.artist,
        title: r.title,
        source: "listeners",
        base: Math.min(1, r.score),
        why: r.hop === 1 ? "Listeners play this right alongside your track" : `Two plays out, via ${r.via}`,
      });
      if (cands.length >= 40) break;
    }
    for (const p of aiResult?.picks ?? []) {
      if (!accept(p.artist)) continue;
      cands.push({ artist: p.artist, title: p.title, why: p.why, source: "ai", base: 0.7 });
    }

    // ---------- Verify on Deezer + popularity filter ----------
    const checked = await pool(cands, 8, async (c) => ({ ...c, track: (await findTrack(c.artist, c.title)) ?? undefined }));
    const byRank = checked.filter((c) => c.track && c.track.rank <= lim.rank);
    const withFans = await pool(byRank, 8, async (c) => ({ ...c, fans: await artistFans(c.track!.artist.id) }));
    let pass: Cand[] = withFans.filter((c) => c.fans == null || c.fans <= lim.fans);

    // Artist-graph fill only when the listening data runs thin (rare songs).
    let usedGraph = false;
    if (pass.length < 14) {
      const g = await graphDig({
        seedArtistId: dzSeed.artist.id,
        seedArtistName: dzSeed.artist.name,
        hop1,
        exclude: [...exclude, ...pass.map((c) => `${c.artist} – ${c.title}`)],
        limits: lim,
        depth,
        want: 16 - pass.length,
      });
      for (const p of g) {
        if (!accept(p.artist)) continue;
        pass.push({ artist: p.artist, title: p.title, why: p.why, source: "graph", base: 0.35, track: p.track, fans: p.fans });
        usedGraph = true;
      }
    }
    pass = pass.slice(0, 26);

    // ---------- Key + BPM from the previews ----------
    const analyzed = await pool(pass, 5, async (c) => ({ c, a: await analyzePreview(c.track!.id, c.track!.preview) }));

    const scored = analyzed.map(({ c, a }) => {
      const kc = keyCompat(seedAnalysis?.camelot, a?.camelot);
      const bc = bpmCompat(seedBpm, a?.bpm);
      const score = c.base + (kc.score / 3) * 0.9 + bc * 0.5;
      return { c, a, kc, score };
    });

    const inKey = scored.filter((s) => s.kc.score >= 2.5).sort((x, y) => y.score - x.score);
    const rest = scored.filter((s) => s.kc.score < 2.5).sort((x, y) => y.score - x.score);
    const ordered = keyLock ? [...inKey, ...rest] : [...scored].sort((x, y) => y.score - x.score);

    const toPick = ({ c, a, kc }: (typeof scored)[number]): Pick => {
      const t = c.track!;
      return {
        id: t.id,
        artist: t.artist.name,
        title: t.title,
        why: c.why,
        source: c.source,
        verified: true,
        cover: t.album.cover_big || t.album.cover_medium,
        preview: t.preview || undefined,
        deezer: t.link,
        rank: t.rank,
        fans: c.fans ?? null,
        key: (a as Analysis | null)?.key,
        camelot: a?.camelot,
        bpm: a?.bpm ?? null,
        mix: kc.label,
        inKey: kc.score >= 2.5,
        ...links(t.artist.name, t.title),
      };
    };
    const tracks = ordered.slice(0, 10).map(toPick);
    const inKeyCount = tracks.filter((t) => t.inKey).length;

    const engine = tracks.some((t) => t.source === "listeners") ? "listeners" : tracks.some((t) => t.source === "ai") ? "ai" : "graph";
    const notes: string[] = [];
    if (keyLock && inKeyCount < tracks.length && seedAnalysis)
      notes.push(`Only ${inKeyCount} of 10 mix in key at this depth — the rest are the closest fits, marked.`);
    if (usedGraph && engine !== "graph") notes.push("Listening data ran thin, so some picks come from the artist graph.");

    return NextResponse.json({
      seed: {
        id: dzSeed.id,
        label: seedLabel,
        cover: dzSeed.album.cover_big || dzSeed.album.cover_medium,
        preview: dzSeed.preview || undefined,
        key: seedAnalysis?.key,
        camelot: seedAnalysis?.camelot,
        bpm: seedBpm,
      },
      seedRead:
        engine === "listeners"
          ? "Built from what real listeners play next to this exact song, minus anything popular."
          : aiResult?.seedRead ||
            `Skipping the usual suspects (${hop1
              .slice(0, 3)
              .map((a) => a.name)
              .join(", ")}…) and digging further out.`,
      depth,
      keyLock,
      engine,
      notice: notes.join(" "),
      tracks,
      ms: Date.now() - t0,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Something broke.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
