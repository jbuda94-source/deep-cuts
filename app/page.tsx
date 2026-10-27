"use client";

import { useEffect, useRef, useState } from "react";

type Pick = {
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

type Match = { id: number; artist: string; title: string; album: string; cover?: string; preview: string | null };
type Recent = { label: string; id: number };

type Result = {
  seed: { label: string; source: string; cover?: string; rank?: number; preview?: string; id?: number };
  seedRead: string;
  depth: number;
  engine: "ai" | "graph";
  notice?: string;
  tracks: Pick[];
};

const DEPTHS = [
  { v: 1, label: "Deep" },
  { v: 2, label: "Deeper" },
  { v: 3, label: "Deepest" },
];

const LOADING = [
  "Flipping through the dollar bin…",
  "Checking the B-sides…",
  "Asking the guy behind the counter…",
  "Weeding out anything on a playlist…",
  "Pulling sleeves…",
];

function fmtFans(n?: number | null) {
  if (n == null) return "";
  if (n >= 1000) return `${Math.round(n / 1000)}k fans`;
  return `${n} fans`;
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

const PLAY = (
  <svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5z" /></svg>
);
const PAUSE = (
  <svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" /><rect x="14" y="5" width="4" height="14" /></svg>
);

export default function Home() {
  const [input, setInput] = useState("");
  const [depth, setDepth] = useState(2);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(LOADING[0]);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [shown, setShown] = useState<string[]>([]);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [finding, setFinding] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const lastSeed = useRef(0);

  useEffect(() => {
    // Older versions stored plain strings; keep only confirmed seeds.
    setRecent(store<unknown[]>("dc_recent", []).filter((r): r is Recent => typeof r === "object" && r !== null && "id" in r));
    setDepth(store<number>("dc_depth", 2));
    const params = new URLSearchParams(window.location.search);
    const id = Number(params.get("id"));
    const q = params.get("q");
    if (id) dig(id, false);
    else if (q) {
      setInput(q);
      find(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loading) return;
    let i = 0;
    const id = setInterval(() => setMsg(LOADING[++i % LOADING.length]), 2400);
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

  // Step 1: show the likely matches so the user can confirm the seed by ear.
  async function find(q: string) {
    const text = q.trim();
    if (!text || finding || loading) return;
    stop();
    setFinding(true);
    setError("");
    setResult(null);
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

  // Step 2: dig from a confirmed track.
  async function dig(seedId: number, again: boolean) {
    if (!seedId || loading) return;
    stop();
    setMatches(null);
    setLoading(true);
    setError("");
    setMsg(LOADING[0]);
    const exclude = again ? shown : [];
    if (!again) setResult(null);
    try {
      const res = await fetch("/api/dig", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ seedId, depth, note, exclude }),
      });
      const j = await res.json();
      if (!res.ok || j.error) throw new Error(j.error || "Request failed");
      const r = j as Result;
      setResult(r);
      lastSeed.current = seedId;
      const names = r.tracks.map((t) => `${t.artist} – ${t.title}`);
      setShown(again ? [...shown, ...names] : names);
      if (!again) {
        const nextRecent = [{ label: r.seed.label, id: seedId }, ...recent.filter((x) => x.id !== seedId)].slice(0, 6);
        setRecent(nextRecent);
        save("dc_recent", nextRecent);
        const url = new URL(window.location.href);
        url.searchParams.delete("q");
        url.searchParams.set("id", String(seedId));
        window.history.replaceState(null, "", url);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something broke.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="wrap">
      <header className="mast">
        <h1>
          Deep<br />
          <span>Cuts</span>
        </h1>
        <p>Paste a Spotify or YouTube link, or type a song. Get ten that feel like it — none the algorithm would play you.</p>
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
          <input
            className="steer"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Steer it (optional): more 90s, no vocals, slower…"
            aria-label="Optional direction"
          />
        </div>
      </form>

      {!result && !matches && !loading && !finding && recent.length > 0 && (
        <div className="recent">
          {recent.map((r) => (
            <button key={r.id} onClick={() => dig(r.id, false)}>
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
                  <button className="pick" onClick={() => dig(m.id, false)}>
                    Dig
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="hint">Not here? Try typing it as &ldquo;Artist - Song&rdquo;.</p>
        </section>
      )}

      {error && <div className="err">{error}</div>}

      {result && (
        <>
          <section className="seed">
            <button
              className={`art${playing != null && playing === result.seed.preview ? " on" : ""}`}
              onClick={() => toggle(result.seed.preview)}
              disabled={!result.seed.preview}
              aria-label="Play seed preview"
            >
              {result.seed.cover ? <img src={result.seed.cover} alt="" /> : <span className="noimg">no art</span>}
              {result.seed.preview && (
                <span className="play">{playing != null && playing === result.seed.preview ? PAUSE : PLAY}</span>
              )}
            </button>
            <div>
              <div className="lbl">Digging from</div>
              <div className="name">{result.seed.label}</div>
              {result.seedRead && <div className="read">{result.seedRead}</div>}
              {result.notice && <div className="read">{result.notice}</div>}
              {result.engine === "graph" && note.trim() && (
                <div className="read">The steer box only works with the AI engine (add a free Gemini key).</div>
              )}
            </div>
          </section>

          <ol className="list">
            {result.tracks.map((t, i) => {
              const obscurity = t.rank != null ? Math.max(4, 100 - t.rank / 10000) : null;
              const on = playing != null && playing === t.preview;
              return (
                <li className="track" key={`${t.artist}-${t.title}`} style={{ animationDelay: `${i * 40}ms` }}>
                  <div className="num">{String(i + 1).padStart(2, "0")}</div>
                  <button
                    className={`art${on ? " on" : ""}`}
                    onClick={() => toggle(t.preview)}
                    disabled={!t.preview}
                    aria-label={t.preview ? (on ? "Stop preview" : "Play 30-second preview") : "No preview"}
                  >
                    {t.cover ? <img src={t.cover} alt="" loading="lazy" /> : <span className="noimg">no art</span>}
                    {t.preview && (
                      <span className="play">
                        {on ? PAUSE : PLAY}
                      </span>
                    )}
                  </button>
                  <div className="meta">
                    <div className="t">{t.title}</div>
                    <div className="a">{t.artist}</div>
                    {t.why && <div className="why">{t.why}</div>}
                    <div className="tags">
                      <a className="tag" href={t.spotify} target="_blank" rel="noreferrer">Spotify</a>
                      <a className="tag" href={t.youtube} target="_blank" rel="noreferrer">YouTube</a>
                      {obscurity != null && (
                        <span className="meter" title={`Deezer popularity ${t.rank?.toLocaleString()} / 1,000,000`}>
                          <i><b style={{ width: `${obscurity}%` }} /></i>
                          {t.fans != null ? fmtFans(t.fans) : "obscure"}
                        </span>
                      )}
                      {!t.verified && <span className="tag warn" title="Not on Deezer, so its popularity couldn't be checked">Unverified</span>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>

          <div className="more">
            <button className="btn" onClick={() => dig(lastSeed.current, true)} disabled={loading}>
              Dig again
            </button>
            <button
              className="btn ghost"
              onClick={() => {
                stop();
                setResult(null);
                setMatches(null);
                setShown([]);
                setInput("");
              }}
              disabled={loading}
            >
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
        {result?.engine === "ai" ? "AI picks" : "Artist-graph picks"} · existence &amp; popularity checked against Deezer · previews 30s
      </p>
    </main>
  );
}
