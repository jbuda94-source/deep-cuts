// Deezer's public API needs no key. We use it to (1) identify the seed track,
// (2) confirm Claude's picks actually exist, and (3) measure how popular they are.
// rank: 0–1,000,000 track popularity. nb_fan: artist follower count.

const API = "https://api.deezer.com";

export type DzTrack = {
  id: number;
  title: string;
  link: string;
  rank: number;
  preview: string;
  duration: number;
  artist: { id: number; name: string };
  album: { title: string; cover_medium: string; cover_big?: string };
};

async function get<T>(path: string): Promise<T | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(API + path, { cache: "no-store" });
      if (!res.ok) return null;
      const j = await res.json();
      // Deezer returns 200 with {error:{code:4}} when you hit the quota.
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

export function norm(s: string) {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\(.*?\)|\[.*?\]/g, " ")
    .replace(/\b(feat|ft|featuring)\b.*$/g, " ")
    .replace(/\s-\s.*(remix|mix|edit|version|remaster).*$/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function close(a: string, b: string) {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

export async function searchSeed(q: string): Promise<DzTrack | null> {
  return (await searchSeedMatches(q))[0] ?? null;
}

export async function getTrack(id: number): Promise<DzTrack | null> {
  return get<DzTrack>(`/track/${id}`);
}

// Best-guess ordering of possible matches, so the user can confirm by ear.
export async function searchSeedMatches(q: string, limit = 6): Promise<DzTrack[]> {
  const [qa, ...rest] = q.split(/\s[-–—]\s/);
  const qt = rest.join(" - ");
  // With "Artist - Title", also run Deezer's strict field search so the
  // original recording is in the pool even if covers/versions crowd the loose search.
  const [loose, strict] = await Promise.all([
    get<{ data: DzTrack[] }>(`/search?q=${encodeURIComponent(q)}&limit=15`),
    qt
      ? get<{ data: DzTrack[] }>(`/search?q=${encodeURIComponent(`artist:"${qa}" track:"${qt}"`)}&limit=15`)
      : Promise.resolve(null),
  ]);
  const byId = new Map<number, DzTrack>();
  for (const t of [...(strict?.data ?? []), ...(loose?.data ?? [])]) byId.set(t.id, t);
  const hits = [...byId.values()];
  const VERSION = /\(|\[|mix|edit|remix|version|live|instrumental|acoustic|karaoke|cover|piano|remaster/i;
  const wantsVersion = VERSION.test(qt || q);
  const score = (t: DzTrack) =>
    (qt && close(t.artist.name, qa) ? 4 : 0) +
    (qt && close(t.title, qt) ? 2 : 0) +
    (qt && norm(t.title) === norm(qt) && t.title.length <= qt.length + 2 ? 2 : 0) +
    (!wantsVersion && VERSION.test(t.title) ? -3 : 0) +
    // Among equals, the most-played recording is almost always the original.
    (t.rank / 1_000_000) * 1.5;
  const seen = new Set<string>();
  return [...hits]
    .sort((a, b) => score(b) - score(a))
    .filter((t) => {
      const k = `${norm(t.artist.name)}|${t.title.toLowerCase()}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, limit);
}

export async function relatedArtists(artistId: number): Promise<{ id: number; name: string; nb_fan: number }[]> {
  const r = await get<{ data: { id: number; name: string; nb_fan: number }[] }>(
    `/artist/${artistId}/related?limit=20`
  );
  return r?.data ?? [];
}

export async function findTrack(artist: string, title: string): Promise<DzTrack | null> {
  const strict = await get<{ data: DzTrack[] }>(
    `/search?q=${encodeURIComponent(`artist:"${artist}" track:"${title}"`)}&limit=5`
  );
  let hits = strict?.data ?? [];
  if (!hits.length) {
    const loose = await get<{ data: DzTrack[] }>(
      `/search?q=${encodeURIComponent(`${artist} ${title}`)}&limit=8`
    );
    hits = loose?.data ?? [];
  }
  return hits.find((t) => close(t.artist.name, artist) && close(t.title, title)) ?? null;
}

export async function artistFans(id: number): Promise<number | null> {
  const r = await get<{ nb_fan: number }>(`/artist/${id}`);
  return r?.nb_fan ?? null;
}
