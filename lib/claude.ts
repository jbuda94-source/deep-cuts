export type Candidate = { artist: string; title: string; why: string };

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

const SYSTEM = `You are a record-store crate digger with encyclopedic knowledge of underground, independent and regional music across every genre and decade. Your job: given one seed song, recommend real songs that feel like it — same sonic palette, tempo/energy, mood, production era and scene — but that a streaming algorithm would never surface.

Hard rules:
- Every song must actually exist, with the exact artist name and track title as released. Never invent or guess titles. If unsure a title is real, leave it out.
- Deep cuts only. Exclude anything that charted, went viral, sits in big editorial playlists, or is an artist's best-known song. Prefer small labels, B-sides, album tracks, EP cuts, regional scenes, overlooked contemporaries, early or side projects, and artists with modest followings.
- Exclude the seed artist entirely.
- One song per artist. Spread across labels and years where it still fits the vibe.
- Match feel over genre tags: think BPM range, groove, instrumentation, texture, vocal style, and emotional temperature.
- "why" is one short sentence naming the specific sonic link to the seed (e.g. "same dusty 92-bpm swing and Rhodes chords"). No hype words.

Respond with JSON only, no prose: {"seed_read":"one line describing the seed's sound","picks":[{"artist":"","title":"","why":""}]}`;

export async function getCandidates(opts: {
  seed: string;
  related: string[];
  exclude: string[];
  count: number;
  depth: number;
  note?: string;
}): Promise<{ seedRead: string; picks: Candidate[] }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY isn't set in Vercel yet.");

  const depthWords = ["deep", "deeper (avoid anyone with a well-known hit)", "deepest (true obscurities, small runs, regional, forgotten)"][
    Math.max(0, Math.min(2, opts.depth - 1))
  ];

  const user = [
    `Seed song: ${opts.seed}`,
    opts.related.length
      ? `For orientation only, artists a streaming service considers related (these are the obvious picks — mostly AVOID them, go a layer or two further out): ${opts.related.join(", ")}`
      : "",
    opts.exclude.length ? `Already shown to the listener, do not repeat: ${opts.exclude.join("; ")}` : "",
    opts.note ? `Listener's extra direction: ${opts.note}` : "",
    `Depth: ${depthWords}.`,
    `Give ${opts.count} picks.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      system: SYSTEM,
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Claude API error ${res.status}: ${t.slice(0, 200)}`);
  }
  const j = await res.json();
  const text: string = (j.content || [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("");
  const jsonStr = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  const parsed = JSON.parse(jsonStr);
  return {
    seedRead: String(parsed.seed_read || ""),
    picks: (parsed.picks || []).filter((p: Candidate) => p?.artist && p?.title),
  };
}
