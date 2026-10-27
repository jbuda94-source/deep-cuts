// Keyless engine: walks Deezer's artist graph past the obvious neighbours.
// Hop 1 = the artists Spotify-style radio would play. We skip them and look at
// who THEY are related to (hop 2, and hop 3 at the deepest setting), keep the
// small artists that several paths agree on, and pull a non-hit track from each.

import { norm, type DzTrack } from "./deezer";

const API = "https://api.deezer.com";

type Artist = { id: number; name: string; nb_fan: number };

async function get<T>(path: string): Promise<T | null> {
  for (let i = 0; i < 2; i++) {
    try {
      const res = await fetch(API + path, { cache: "no-store" });
      if (!res.ok) return null;
      const j = await res.json();
      if (j?.error) {
        if (j.error.code === 4) {
          await new Promise((r) => setTimeout(r, 1200));
          continue;
        }
        return null;
      }
      return j as T;
    } catch {
      return null;
    }
  }
  return null;
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

const related = async (id: number, limit = 25) =>
  (await get<{ data: Artist[] }>(`/artist/${id}/related?limit=${limit}`))?.data ?? [];

export type GraphPick = {
  artist: string;
  title: string;
  why: string;
  track: DzTrack;
  fans: number;
};

export async function graphDig(opts: {
  seedArtistId: number;
  seedArtistName: string;
  hop1: Artist[];
  exclude: string[];
  limits: { rank: number; fans: number };
  depth: number;
  want: number;
}): Promise<GraphPick[]> {
  const { seedArtistId, hop1, limits, depth, want } = opts;
  const banned = new Set<number>([seedArtistId, ...hop1.map((a) => a.id)]);
  const excludedNames = new Set(opts.exclude.map((s) => norm(s.split(/\s[–-]\s/)[0])));

  type Node = { a: Artist; hits: number; via: Set<string> };
  const nodes = new Map<number, Node>();

  async function expand(from: { id: number; name: string }[], viaLabel: (f: { name: string }) => string) {
    const lists = await pool(from, 6, (f) => related(f.id));
    lists.forEach((list, i) => {
      for (const a of list) {
        if (banned.has(a.id) || excludedNames.has(norm(a.name))) continue;
        const n = nodes.get(a.id) ?? { a, hits: 0, via: new Set<string>() };
        n.hits++;
        n.via.add(viaLabel(from[i]));
        nodes.set(a.id, n);
      }
    });
  }

  // Hop 2 from the closest 10 neighbours.
  await expand(hop1.slice(0, 10), (f) => f.name);

  const small = () => [...nodes.values()].filter((n) => n.a.nb_fan <= limits.fans);

  // Deepest, or not enough small artists yet: go one more hop out from the
  // best-connected small hop-2 artists.
  if (depth === 3 || small().length < want + 6) {
    const seeds = small()
      .sort((x, y) => y.hits - x.hits)
      .slice(0, 6)
      .map((n) => n.a);
    await expand(seeds, (f) => f.name);
  }

  const ranked = small()
    .sort((x, y) => y.hits - x.hits || x.a.nb_fan - y.a.nb_fan)
    .slice(0, want + 8);

  // Pull each artist's top tracks and take one that isn't their biggest.
  const picks = await pool(ranked, 6, async (n) => {
    const tops = (await get<{ data: DzTrack[] }>(`/artist/${n.a.id}/top?limit=10`))?.data ?? [];
    const usable = tops.filter((t) => t.preview && t.rank <= limits.rank);
    const choice = usable.find((t) => t !== tops[0]) ?? usable[0];
    if (!choice) return null;
    const via = [...n.via].slice(0, 2);
    const why =
      n.hits > 1
        ? `Linked through ${via.join(" and ")}${n.hits > 2 ? ` (+${n.hits - 2} more paths)` : ""}`
        : `One step past ${via[0]}`;
    return { artist: n.a.name, title: choice.title, why, track: choice, fans: n.a.nb_fan } as GraphPick;
  });

  return picks.filter((p): p is GraphPick => p !== null).slice(0, want);
}
