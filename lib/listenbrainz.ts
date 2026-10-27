// ListenBrainz / MusicBrainz (public, no key): "people who played THIS recording
// also played..." — built from real listening sessions, so results depend on
// the specific song, not just the artist.

import { norm } from "./deezer";

const LABS = "https://labs.api.listenbrainz.org";
const UA = "RabbitHole/1.0 ( github.com/jbuda94-source/deep-cuts )";

// Session-based similarity over a long window, weighted toward heavy listeners
// (who tend to play deeper catalog). Fallbacks are other published variants.
const ALGOS = [
  "session_based_days_7500_session_300_contribution_5_threshold_15_limit_50_skip_30_top_n_listeners_1000",
  "session_based_days_9000_session_300_contribution_5_threshold_15_limit_50_skip_30",
  "session_based_days_7500_session_300_contribution_5_threshold_15_limit_50_skip_30",
];

export type SimilarRec = { mbid: string; artist: string; title: string; score: number; hop: number; via?: string };

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function clean(s: string) {
  return s.replace(/\s*[([].*?[)\]]/g, "").replace(/\s+-\s+.*(remaster|version|edit|mix).*$/i, "").trim();
}

export async function findRecordingMbid(artist: string, title: string): Promise<string | null> {
  type Hit = { recording_mbid: string; recording_name: string; artist_credit_name: string };
  const q = `${clean(artist)} ${clean(title)}`;
  const hits = await getJson<Hit[]>(`${LABS}/recording-search/json?query=${encodeURIComponent(q)}`);
  if (!hits?.length) return null;
  const a = norm(artist);
  const t = norm(clean(title));
  const good =
    hits.find((h) => norm(h.artist_credit_name).includes(a.split(" ")[0]) && norm(h.recording_name) === t) ??
    hits.find((h) => norm(h.artist_credit_name).includes(a.split(" ")[0]));
  return good?.recording_mbid ?? null;
}

async function similarTo(mbid: string): Promise<SimilarRec[]> {
  type Row = { recording_mbid: string; recording_name: string; artist_credit_name: string; score: number };
  for (const algo of ALGOS) {
    const rows = await getJson<Row[]>(
      `${LABS}/similar-recordings/json?recording_mbids=${mbid}&algorithm=${encodeURIComponent(algo)}`
    );
    const list = (rows ?? []).filter((r) => r.recording_mbid && r.recording_name && r.artist_credit_name);
    if (list.length) {
      const top = Math.max(...list.map((r) => r.score || 1));
      return list.map((r) => ({
        mbid: r.recording_mbid,
        artist: r.artist_credit_name.split(/\s+(feat\.?|ft\.?|&|x)\s+/i)[0],
        title: r.recording_name,
        score: (r.score || 0) / top,
        hop: 1,
      }));
    }
  }
  return [];
}

// Hop 1 = similar to the seed. Hop 2 (deeper settings) = similar to the best
// hop-1 tracks, which is where the less-played records start showing up.
export async function similarRecordings(seedMbid: string, depth: number): Promise<SimilarRec[]> {
  const hop1 = await similarTo(seedMbid);
  let all = [...hop1];
  // Always take a second hop: hop 1 is mostly the well-known neighbours that the
  // popularity filter throws out, so the usable deep cuts live one step further.
  // Thin hop-1 lists get a wider fan-out so rare songs still get song-level picks.
  if (hop1.length) {
    const fanout = Math.min(hop1.length, hop1.length < 20 ? 10 : depth === 3 ? 8 : depth === 2 ? 6 : 4);
    const from = hop1.slice(0, fanout);
    const lists = await Promise.all(from.map((r) => similarTo(r.mbid)));
    lists.forEach((list, i) => {
      for (const r of list) {
        if (r.mbid === seedMbid) continue;
        all.push({ ...r, score: r.score * (depth === 3 ? 0.85 : depth === 2 ? 0.6 : 0.4), hop: 2, via: `${from[i].artist} – ${from[i].title}` });
      }
    });
  }
  // Merge duplicates (found via several paths = stronger signal).
  const byId = new Map<string, SimilarRec>();
  for (const r of all) {
    const prev = byId.get(r.mbid);
    if (prev) prev.score += r.score * 0.5;
    else byId.set(r.mbid, { ...r });
  }
  all = [...byId.values()].sort((a, b) => b.score - a.score);
  return all;
}
