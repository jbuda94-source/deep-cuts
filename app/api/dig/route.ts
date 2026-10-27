import { NextResponse } from "next/server";
import { resolveSeed } from "@/lib/seed";
import { searchSeed, relatedArtists, findTrack, artistFans, norm, type DzTrack } from "@/lib/deezer";
import { getCandidates, llmProvider, type Candidate } from "@/lib/llm";
import { graphDig } from "@/lib/graph";

export const runtime = "nodejs";
export const maxDuration = 60;

// Popularity ceilings per depth level. rank is Deezer's 0–1M track score;
// a current chart hit sits around 800k+, a typical album track by a mid act ~200–400k.
const LIMITS: Record<number, { rank: number; fans: number }> = {
  1: { rank: 450_000, fans: 400_000 },
  2: { rank: 320_000, fans: 150_000 },
  3: { rank: 200_000, fans: 40_000 },
};

export type Pick = {
  artist: string;
  title: string;
  why: string;
  verified: boolean;
  cover?: string;
  preview?: string;
  deezer?: string;
  rank?: number;
  fans?: number | null;
  spotify: string;
  youtube: string;
};

function links(artist: string, title: string) {
  const q = encodeURIComponent(`${artist} ${title}`);
  return {
    spotify: `https://open.spotify.com/search/${q}`,
    youtube: `https://www.youtube.com/results?search_query=${q}`,
  };
}

function fromDeezer(t: DzTrack, why: string, fans: number | null): Pick {
  return {
    artist: t.artist.name,
    title: t.title,
    why,
    verified: true,
    cover: t.album.cover_big || t.album.cover_medium,
    preview: t.preview || undefined,
    deezer: t.link,
    rank: t.rank,
    fans,
    ...links(t.artist.name, t.title),
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

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const input = String(body.input || "").trim();
    const depth = [1, 2, 3].includes(Number(body.depth)) ? Number(body.depth) : 2;
    const exclude: string[] = Array.isArray(body.exclude) ? body.exclude.slice(0, 80) : [];
    const note = typeof body.note === "string" ? body.note.slice(0, 200) : "";
    if (!input) return NextResponse.json({ error: "Give me a song." }, { status: 400 });

    const seed = await resolveSeed(input);
    const dzSeed = await searchSeed(seed.query);
    const seedLabel = dzSeed ? `${dzSeed.artist.name} - ${dzSeed.title}` : seed.query;
    const hop1 = dzSeed ? await relatedArtists(dzSeed.artist.id) : [];
    const lim = LIMITS[depth];

    let tracks: Pick[] = [];
    let seedRead = "";
    let engine: "ai" | "graph" = "graph";
    let notice = "";

    // ---------- AI path (only if a key is configured) ----------
    const provider = llmProvider();
    if (provider) {
      try {
        const r = await getCandidates({
          seed: seedLabel,
          related: hop1.map((a) => a.name),
          exclude,
          count: 28,
          depth,
          note,
        });
        seedRead = r.seedRead;
        engine = "ai";

        const seedArtist = norm(dzSeed?.artist.name || seed.query.split(" - ")[0]);
        const relatedSet = new Set(hop1.slice(0, 8).map((a) => norm(a.name)));
        const seen = new Set<string>();
        const unique = r.picks.filter((p: Candidate) => {
          const a = norm(p.artist);
          if (!a || a === seedArtist || seen.has(a)) return false;
          seen.add(a);
          return true;
        });

        const checked = await pool(unique, 6, async (c) => ({ c, t: await findTrack(c.artist, c.title) }));
        const unverified: Pick[] = [];
        const passing = checked.filter(({ c, t }) => {
          if (!t) {
            unverified.push({ ...c, verified: false, ...links(c.artist, c.title) });
            return false;
          }
          return t.rank <= lim.rank && !relatedSet.has(norm(t.artist.name));
        });
        const withFans = await pool(passing, 6, async (x) => ({ ...x, fans: await artistFans(x.t!.artist.id) }));
        const verified = withFans
          .filter((x) => x.fans === null || x.fans <= lim.fans)
          .map((x) => fromDeezer(x.t!, x.c.why, x.fans));
        tracks = [...verified, ...unverified].slice(0, 10);
      } catch (e) {
        notice =
          e instanceof Error && /credit balance/i.test(e.message)
            ? "AI key has no credits, so this used the free graph engine."
            : "AI picks failed, so this used the free graph engine.";
      }
    }

    // ---------- Keyless graph path (default, or to top up) ----------
    if (tracks.filter((t) => t.verified).length < 6 && dzSeed) {
      const have = new Set(tracks.map((t) => norm(t.artist)));
      const g = await graphDig({
        seedArtistId: dzSeed.artist.id,
        seedArtistName: dzSeed.artist.name,
        hop1,
        exclude: [...exclude, ...tracks.map((t) => `${t.artist} – ${t.title}`)],
        limits: lim,
        depth,
        want: 10,
      });
      const extra = g.filter((p) => !have.has(norm(p.artist))).map((p) => fromDeezer(p.track, p.why, p.fans));
      const verifiedAi = tracks.filter((t) => t.verified);
      const unverifiedAi = tracks.filter((t) => !t.verified);
      tracks = [...verifiedAi, ...extra, ...unverifiedAi].slice(0, 10);
      if (!verifiedAi.length) engine = "graph";
    }

    if (!dzSeed && !tracks.length) {
      throw new Error("Couldn't find that song. Try 'Artist - Song' spelled out.");
    }

    return NextResponse.json({
      seed: {
        label: seedLabel,
        source: seed.source,
        cover: dzSeed?.album.cover_big || dzSeed?.album.cover_medium,
        rank: dzSeed?.rank,
      },
      seedRead:
        seedRead ||
        (hop1.length
          ? `Skipping the usual suspects (${hop1
              .slice(0, 3)
              .map((a) => a.name)
              .join(", ")}…) and digging two steps further out.`
          : ""),
      depth,
      engine,
      notice,
      tracks,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Something broke.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
