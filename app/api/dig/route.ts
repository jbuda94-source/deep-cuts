import { NextResponse } from "next/server";
import { resolveSeed } from "@/lib/seed";
import { searchSeed, relatedArtists, findTrack, artistFans, norm, type DzTrack } from "@/lib/deezer";
import { getCandidates, type Candidate } from "@/lib/claude";

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

async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
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
    const related = dzSeed ? (await relatedArtists(dzSeed.artist.id)).map((a) => a.name) : [];

    const { seedRead, picks } = await getCandidates({
      seed: seedLabel,
      related,
      exclude,
      count: 28,
      depth,
      note,
    });

    const seedArtist = norm(dzSeed?.artist.name || seed.query.split(" - ")[0]);
    const relatedSet = new Set(related.slice(0, 8).map(norm)); // the most obvious neighbours
    const seen = new Set<string>();
    const unique = picks.filter((p) => {
      const a = norm(p.artist);
      if (!a || a === seedArtist || seen.has(a)) return false;
      seen.add(a);
      return true;
    });

    const lim = LIMITS[depth];
    type Checked = { c: Candidate; t: DzTrack | null };
    const checked: Checked[] = await pool(unique, 6, async (c) => ({ c, t: await findTrack(c.artist, c.title) }));

    const verified: Pick[] = [];
    const unverified: Pick[] = [];
    const tooBig: string[] = [];

    const passingRank = checked.filter(({ c, t }) => {
      if (!t) {
        unverified.push({ ...c, verified: false, ...links(c.artist, c.title) });
        return false;
      }
      if (t.rank > lim.rank || relatedSet.has(norm(t.artist.name))) {
        tooBig.push(`${t.artist.name} – ${t.title}`);
        return false;
      }
      return true;
    });

    const withFans = await pool(passingRank, 6, async (x) => ({ ...x, fans: await artistFans(x.t!.artist.id) }));
    for (const { c, t, fans } of withFans) {
      if (fans !== null && fans > lim.fans) {
        tooBig.push(`${t!.artist.name} – ${t!.title}`);
        continue;
      }
      verified.push({
        artist: t!.artist.name,
        title: t!.title,
        why: c.why,
        verified: true,
        cover: t!.album.cover_big || t!.album.cover_medium,
        preview: t!.preview || undefined,
        deezer: t!.link,
        rank: t!.rank,
        fans,
        ...links(t!.artist.name, t!.title),
      });
    }

    const tracks = [...verified, ...unverified].slice(0, 10);

    return NextResponse.json({
      seed: {
        label: seedLabel,
        source: seed.source,
        cover: dzSeed?.album.cover_big || dzSeed?.album.cover_medium,
        rank: dzSeed?.rank,
      },
      seedRead,
      depth,
      tracks,
      stats: { asked: unique.length, verified: verified.length, filteredAsTooPopular: tooBig.length },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Something broke.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
