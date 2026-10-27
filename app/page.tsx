"use client";

import { useEffect, useRef, useState } from "react";

type Pick = {
  id?: number;
  artist: string;
  title: string;
  why: string;
  source: "listeners" | "ai" | "graph";
  verified: boolean;
  cover?: string;
  preview?: string;
  rank?: number;
  fans?: number | null;
  key?: string;
  camelot?: string;
  bpm?: number | null;
  mix?: string;
  inKey?: boolean;
  spotify: string;
  youtube: string;
};

type Seed = { id: number; label: string; cover?: string; preview?: string; key?: string; camelot?: string; bpm?: number | null };

type Result = {
  seed: Seed;
  seedRead: string;
  depth: number;
  keyLock: boolean;
  engine: "listeners" | "ai" | "graph";
  notice?: string;
  tracks: Pick[];
};

type Match = { id: number; artist: string; title: string; album: string; cover?: string; preview: string | null };
type Recent = { label: string; id: number };
// One step down the hole: the seed we dug from and what came back.
type Step = { result: Result };

const DEPTHS = [
  { v: 1, label: "Deep" },
  { v: 2, label: "Deeper" },
  { v: 3, label: "Deepest" },
];

const LOADING = [
  "Following the listeners…",
  "Reading keys off the previews…",
  "Counting beats…",
  "Throwing out anything on a playlist…",
  "Down we go…",
];

const PLAY = (
  <svg viewBox="0 0 24 24">
    <path d="M7 4.5v15l13-7.5z" />
  </svg>
);
const PAUSE = (
  <svg viewBox="0 0 24 24">
    <rect x="6" y="5" width="4" height="14" />
    <rect x="14" y="5" width="4" height="14" />
  </svg>
);

function fmtFans(n?: number | null) {
  if (n == null) return "";
  if (n >= 1000) return `${Math.round(n / 1000)}k fans`;
  return `${n} fans`;
}

// Camelot wheel colours, the way DJ software paints them: one hue per hour.
function camelotStyle(code?: string) {
  if (!code) return undefined;
  const n = parseInt(code);
  const hue = ((n - 1) * 30 + 90) % 360;
  const minor = code.endsWith("A");
  return { background: `hsl(${hue} 70% ${minor ? 42 : 52}%)`, color: "#0f0e0c", borderColor: "transparent" };
}

function store<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {}
}

export default function Home() {
  const [input, setInput] = useState("");
  const [depth, setDepth] = useState(2);
  const [keyLock, setKeyLock] = useState(true);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [finding, setFinding] = useState(false);
  const [msg, setMsg] = useState(LOADING[0]);
  const [error, setError] = useState("");
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [trail, setTrail] = useState<Step[]>([]);
  const [shown, setShown] = useState<string[]>([]);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const topRef = useRef<HTMLDivElement | null>(null);

  const current = trail.length ? trail[trail.length - 1].result : null;

  useEffect(() => {
    setRecent(
      store<unknown[]>("dc_recent", []).filter((r): r is Recent => typeof r === "object" && r !== null && "id" in r)
    );
    setDepth(store<number>("dc_depth", 2));
    setKeyLock(store<boolean>("dc_keylock", true));
    const params = new URLSearchParams(window.location.search);
    const id = Number(params.get("id"));
    const q = params.get("q");
    if (id) dig(id, "new");
    else if (q) {
      setInput(q);
      find(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loading) return;
    let i = 0;
    const id = setInterval(() => setMsg(LOADING[++i % LOADING.length]), 2200);
    return () => clearInterval(id);
  }, [loading]);

  function stop() {
    audio.current?.pause();
    setPlaying(null);
  }

  function toggle(preview?: string | null) {
    if (!preview) return;
    if (playing === preview) return stop();
    if (!audio.current) {
      audio.current = new Audio();
      audio.current.onended = () => setPlaying(null);
    }
    audio.current.src = preview;
    audio.current.play().catch(() => setPlaying(null));
    setPlaying(preview);
  }

  // Step 1: show the likely matches so the seed can be confirmed by ear.
  async function find(q: string) {
    const text = q.trim();
    if (!text || finding || loading) return;
    stop();
    setFinding(true);
    setError("");
    setMatches(null);
    try {
      const res = await fetch(`/api/match?input=${encodeURIComponent(text)}`);
      const j = await res.json();
      if (!res.ok || j.error) throw new Error(j.error || "Request failed");
      setMatches(j.matches as Match[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something broke.");
    } finally {
      setFinding(false);
    }
  }

  // Step 2: dig. "new" starts a fresh hole, "deeper" adds a step, "more" re-rolls this step.
  async function dig(seedId: number, mode: "new" | "deeper" | "more") {
    if (!seedId || loading) return;
    stop();
    setMatches(null);
    setLoading(true);
    setError("");
    setMsg(LOADING[0]);
    const baseShown = mode === "new" ? [] : shown;
    // Never recommend anything already on the trail or already shown in this hole.
    const trailSeeds = mode === "new" ? [] : trail.map((s) => s.result.seed.label.replace(" - ", " – "));
    try {
      const res = await fetch("/api/dig", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ seedId, depth, keyLock, note, exclude: [...trailSeeds, ...baseShown] }),
      });
      const j = await res.json();
      if (!res.ok || j.error) throw new Error(j.error || "Request failed");
      const r = j as Result;
      const names = r.tracks.map((t) => `${t.artist} – ${t.title}`);
      setShown([...baseShown, ...names]);
      if (mode === "new") setTrail([{ result: r }]);
      else if (mode === "deeper") setTrail([...trail, { result: r }]);
      else setTrail([...trail.slice(0, -1), { result: r }]);

      if (mode === "new") {
        const nextRecent = [{ label: r.seed.label, id: seedId }, ...recent.filter((x) => x.id !== seedId)].slice(0, 6);
        setRecent(nextRecent);
        save("dc_recent", nextRecent);
      }
      const url = new URL(window.location.href);
      url.searchParams.delete("q");
      url.searchParams.set("id", String(seedId));
      window.history.replaceState(null, "", url);
      topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something broke.");
    } finally {
      setLoading(false);
    }
  }

  function jumpTo(i: number) {
    stop();
    setTrail(trail.slice(0, i + 1));
    const id = trail[i].result.seed.id;
    const url = new URL(window.location.href);
    url.searchParams.set("id", String(id));
    window.history.replaceState(null, "", url);
  }

  function reset() {
    stop();
    setTrail([]);
    setMatches(null);
    setShown([]);
    setInput("");
    setError("");
    const url = new URL(window.location.href);
    url.searchParams.delete("id");
    url.searchParams.delete("q");
    window.history.replaceState(null, "", url);
  }

  return (
    <main className="wrap">
      <header className="mast">
        <h1 onClick={reset} style={{ cursor: "pointer" }}>
          Rabbit<br />
          <span>Hole</span>
        </h1>
        <p>Paste a Spotify or YouTube link, or type a song. Get ten deep cuts that sound like it and mix in key. Then keep going down.</p>
      </header>

      <form
        className="dig"
        onSubmit={(e) => {
          e.preventDefault();
          find(input);
        }}
      >
        <div className="field">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="open.spotify.com/track/…  or  Artist - Song"
            aria-label="Song link or name"
            autoComplete="off"
            enterKeyHint="search"
          />
          <button className="go" disabled={loading || finding || !input.trim()}>
            Find
          </button>
        </div>
        <div className="row">
          <div className="depth" role="group" aria-label="How deep">
            {DEPTHS.map((d) => (
              <button
                type="button"
                key={d.v}
                aria-pressed={depth === d.v}
                onClick={() => {
                  setDepth(d.v);
                  save("dc_depth", d.v);
                }}
              >
                {d.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={`lock${keyLock ? " on" : ""}`}
            aria-pressed={keyLock}
            onClick={() => {
              setKeyLock(!keyLock);
              save("dc_keylock", !keyLock);
            }}
            title="Put harmonically compatible tracks (same key, ±1 on the Camelot wheel, or relative major/minor) first"
          >
            <span className="dot" /> In key first
          </button>
          <input
            className="steer"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Steer (AI only): more 90s, no vocals…"
            aria-label="Optional direction"
          />
        </div>
      </form>

      {!current && !matches && !loading && !finding && recent.length > 0 && (
        <div className="recent">
          {recent.map((r) => (
            <button key={r.id} onClick={() => dig(r.id, "new")}>
              {r.label}
            </button>
          ))}
        </div>
      )}

      {finding && (
        <div className="status">
          <span className="spin" />
          Looking it up…
        </div>
      )}

      {error && <div className="err">{error}</div>}

      {matches && !loading && (
        <section className="confirm">
          <div className="lbl">Is this the one? Tap the cover to listen.</div>
          <ul className="list">
            {matches.map((m, i) => {
              const on = playing != null && playing === m.preview;
              return (
                <li className={`match${i === 0 ? " best" : ""}`} key={m.id}>
                  <button
                    className={`art${on ? " on" : ""}`}
                    onClick={() => toggle(m.preview)}
                    disabled={!m.preview}
                    aria-label={m.preview ? (on ? "Stop preview" : "Play 30-second preview") : "No preview"}
                  >
                    {m.cover ? <img src={m.cover} alt="" /> : <span className="noimg">no art</span>}
                    {m.preview && <span className="play">{on ? PAUSE : PLAY}</span>}
                  </button>
                  <div className="meta">
                    <div className="t">{m.title}</div>
                    <div className="a">{m.artist}</div>
                    <div className="alb">{m.album}</div>
                  </div>
                  <button className="pick" onClick={() => dig(m.id, "new")}>
                    Dig
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="hint">Not here? Try typing it as &ldquo;Artist - Song&rdquo;.</p>
        </section>
      )}

      <div ref={topRef} />

      {current && !matches && (
        <>
          {trail.length > 1 && (
            <nav className="trail" aria-label="Your path down the hole">
              {trail.map((s, i) => (
                <button key={`${s.result.seed.id}-${i}`} onClick={() => jumpTo(i)} aria-current={i === trail.length - 1} disabled={loading}>
                  <span className="lvl">{i === 0 ? "Start" : `↓${i}`}</span>
                  {s.result.seed.label.split(" - ").slice(1).join(" - ") || s.result.seed.label}
                </button>
              ))}
            </nav>
          )}

          <section className="seed">
            <button
              className={`art${playing != null && playing === current.seed.preview ? " on" : ""}`}
              onClick={() => toggle(current.seed.preview)}
              disabled={!current.seed.preview}
              aria-label="Play seed preview"
            >
              {current.seed.cover ? <img src={current.seed.cover} alt="" /> : <span className="noimg">no art</span>}
              {current.seed.preview && <span className="play">{playing === current.seed.preview ? PAUSE : PLAY}</span>}
            </button>
            <div>
              <div className="lbl">{trail.length > 1 ? `${trail.length - 1} level${trail.length > 2 ? "s" : ""} down · digging from` : "Digging from"}</div>
              <div className="name">{current.seed.label}</div>
              <div className="chips">
                {current.seed.camelot && (
                  <span className="cam" style={camelotStyle(current.seed.camelot)} title={current.seed.key}>
                    {current.seed.camelot}
                  </span>
                )}
                {current.seed.key && <span className="chip">{current.seed.key}</span>}
                {current.seed.bpm ? <span className="chip">{current.seed.bpm} BPM</span> : null}
              </div>
              {current.seedRead && <div className="read">{current.seedRead}</div>}
              {current.notice && <div className="read">{current.notice}</div>}
            </div>
          </section>

          <ol className="list">
            {current.tracks.map((t, i) => {
              const obscurity = t.rank != null ? Math.max(4, 100 - t.rank / 10000) : null;
              const on = playing != null && playing === t.preview;
              return (
                <li className={`track${t.inKey ? "" : " off"}`} key={`${t.artist}-${t.title}`} style={{ animationDelay: `${i * 40}ms` }}>
                  <div className="num">{String(i + 1).padStart(2, "0")}</div>
                  <button
                    className={`art${on ? " on" : ""}`}
                    onClick={() => toggle(t.preview)}
                    disabled={!t.preview}
                    aria-label={t.preview ? (on ? "Stop preview" : "Play 30-second preview") : "No preview"}
                  >
                    {t.cover ? <img src={t.cover} alt="" loading="lazy" /> : <span className="noimg">no art</span>}
                    {t.preview && <span className="play">{on ? PAUSE : PLAY}</span>}
                  </button>
                  <div className="meta">
                    <div className="t">{t.title}</div>
                    <div className="a">{t.artist}</div>
                    <div className="chips">
                      {t.camelot && (
                        <span className="cam" style={camelotStyle(t.camelot)} title={t.key}>
                          {t.camelot}
                        </span>
                      )}
                      {t.bpm ? <span className="chip">{t.bpm} BPM</span> : null}
                      {t.mix && <span className={`chip mix${t.inKey ? " good" : ""}`}>{t.mix}</span>}
                    </div>
                    {t.why && <div className="why">{t.why}</div>}
                    <div className="tags">
                      {t.id && (
                        <button className="deeper" onClick={() => dig(t.id!, "deeper")} disabled={loading}>
                          ↓ Go deeper
                        </button>
                      )}
                      <a className="tag" href={t.spotify} target="_blank" rel="noreferrer">
                        Spotify
                      </a>
                      <a className="tag" href={t.youtube} target="_blank" rel="noreferrer">
                        YouTube
                      </a>
                      {obscurity != null && (
                        <span className="meter" title={`Deezer popularity ${t.rank?.toLocaleString()} / 1,000,000`}>
                          <i>
                            <b style={{ width: `${obscurity}%` }} />
                          </i>
                          {t.fans != null ? fmtFans(t.fans) : "obscure"}
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>

          <div className="more">
            <button className="btn" onClick={() => dig(current.seed.id, "more")} disabled={loading}>
              More from here
            </button>
            {trail.length > 1 && (
              <button className="btn ghost" onClick={() => jumpTo(trail.length - 2)} disabled={loading}>
                ↑ Back up
              </button>
            )}
            <button className="btn ghost" onClick={reset} disabled={loading}>
              New seed
            </button>
          </div>
        </>
      )}

      {loading && (
        <div className="status">
          <span className="spin" />
          {msg}
        </div>
      )}

      <p className="foot">
        Song matches from ListenBrainz listening data · popularity and previews from Deezer · key and BPM detected from
        the 30-second previews, so treat them as close estimates
      </p>
    </main>
  );
}
