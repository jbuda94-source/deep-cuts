// Key + BPM detection from a track's 30-second preview MP3.
// Key: chroma vector (energy per pitch class) correlated against
// Krumhansl–Kessler major/minor key profiles. BPM: spectral-flux onset
// envelope, autocorrelated over 70–180 BPM. Both are estimates — roughly what
// DJ software does, but on 30 seconds of audio instead of the whole track.

import { MPEGDecoder } from "mpg123-decoder";
import FFT from "fft.js";

export type Analysis = {
  key: string; // e.g. "A minor"
  camelot: string; // e.g. "8A"
  bpm: number | null;
  confidence: number; // 0–1, how clearly one key beat the rest
};

const NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export function camelotFor(pc: number, minor: boolean) {
  const majorPc = minor ? (pc + 3) % 12 : pc; // minor keys share a number with their relative major
  const num = (((majorPc * 7) % 12) + 7) % 12 + 1;
  return `${num}${minor ? "A" : "B"}`;
}

function pearson(a: number[], b: number[]) {
  const n = a.length;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0,
    da = 0,
    db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * db || 1);
}

function hann(n: number) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

// Mono + downsample by an integer factor with a crude box filter (fine for analysis).
function toMono(ch: Float32Array[], factor: number) {
  const len = Math.floor(ch[0].length / factor);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    let s = 0;
    for (let k = 0; k < factor; k++) {
      const j = i * factor + k;
      for (const c of ch) s += c[j];
    }
    out[i] = s / (factor * ch.length);
  }
  return out;
}

function detectKey(x: Float32Array, sr: number) {
  const N = 8192;
  const hop = 4096;
  const fft = new FFT(N);
  const win = hann(N);
  const input = new Array(N).fill(0);
  const spec = fft.createComplexArray();
  const chroma = new Array(12).fill(0);
  // Precompute bin → pitch class for 55 Hz–2.1 kHz (A1–C7).
  const binPc: number[] = [];
  for (let b = 0; b < N / 2; b++) {
    const f = (b * sr) / N;
    binPc[b] = f < 55 || f > 2100 ? -1 : Math.round(12 * Math.log2(f / 440) + 69) % 12;
  }
  for (let start = 0; start + N <= x.length; start += hop) {
    for (let i = 0; i < N; i++) input[i] = x[start + i] * win[i];
    fft.realTransform(spec, input);
    const frame = new Array(12).fill(0);
    let tot = 0;
    for (let b = 1; b < N / 2; b++) {
      const pc = binPc[b];
      if (pc < 0) continue;
      const mag = Math.hypot(spec[2 * b], spec[2 * b + 1]);
      const e = Math.sqrt(mag); // compress so loud bass notes don't swamp everything
      frame[pc] += e;
      tot += e;
    }
    if (tot > 0) for (let p = 0; p < 12; p++) chroma[p] += frame[p] / tot;
  }

  const scores: { pc: number; minor: boolean; r: number }[] = [];
  for (let pc = 0; pc < 12; pc++) {
    const rot = (prof: number[]) => prof.map((_, i) => prof[(i - pc + 12) % 12]);
    scores.push({ pc, minor: false, r: pearson(chroma, rot(MAJOR)) });
    scores.push({ pc, minor: true, r: pearson(chroma, rot(MINOR)) });
  }
  scores.sort((a, b) => b.r - a.r);
  const best = scores[0];
  // Ignore the relative major/minor when measuring confidence — they're harmonically compatible anyway.
  const rel = (s: { pc: number; minor: boolean }) =>
    best.minor ? !s.minor && s.pc === (best.pc + 3) % 12 : s.minor && s.pc === (best.pc + 9) % 12;
  const runner = scores.slice(1).find((s) => !rel(s)) ?? scores[1];
  return {
    key: `${NAMES[best.pc]} ${best.minor ? "minor" : "major"}`,
    camelot: camelotFor(best.pc, best.minor),
    confidence: Math.max(0, Math.min(1, (best.r - runner.r) * 4)),
  };
}

function detectBpm(x: Float32Array, sr: number): number | null {
  const N = 1024;
  const hop = 256;
  const fft = new FFT(N);
  const win = hann(N);
  const input = new Array(N).fill(0);
  const spec = fft.createComplexArray();
  let prev = new Float32Array(N / 2);
  const flux: number[] = [];
  const maxBin = Math.floor((4000 * N) / sr);
  for (let start = 0; start + N <= x.length; start += hop) {
    for (let i = 0; i < N; i++) input[i] = x[start + i] * win[i];
    fft.realTransform(spec, input);
    const cur = new Float32Array(N / 2);
    let f = 0;
    for (let b = 1; b < maxBin; b++) {
      cur[b] = Math.log1p(10 * Math.hypot(spec[2 * b], spec[2 * b + 1]));
      const d = cur[b] - prev[b];
      if (d > 0) f += d;
    }
    flux.push(f);
    prev = cur;
  }
  if (flux.length < 200) return null;
  // Remove the slow-moving average so autocorrelation sees beats, not loudness.
  const env = flux.map((v, i) => {
    let s = 0,
      c = 0;
    for (let k = Math.max(0, i - 16); k < Math.min(flux.length, i + 16); k++) {
      s += flux[k];
      c++;
    }
    return Math.max(0, v - s / c);
  });
  const fps = sr / hop;
  let bestLag = 0,
    bestVal = -Infinity;
  const ac = (lag: number) => {
    let s = 0;
    for (let i = 0; i + lag < env.length; i++) s += env[i] * env[i + lag];
    return s / (env.length - lag);
  };
  for (let bpm = 70; bpm <= 180; bpm += 0.5) {
    const lag = (60 * fps) / bpm;
    const lo = Math.floor(lag);
    const v0 = ac(lo) + (ac(lo + 1) - ac(lo)) * (lag - lo);
    // Reward lags whose double also lines up (bars of 2 beats) and mildly prefer ~124 BPM.
    const lag2 = lag * 2;
    const l2 = Math.floor(lag2);
    const v2 = ac(l2) + (ac(l2 + 1) - ac(l2)) * (lag2 - l2);
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 124) / 0.9) ** 2);
    const v = (v0 + 0.5 * v2) * (0.6 + 0.4 * prior);
    if (v > bestVal) {
      bestVal = v;
      bestLag = bpm;
    }
  }
  return bestLag ? Math.round(bestLag) : null;
}

export function analyzeSamples(ch: Float32Array[], sampleRate: number): Analysis {
  const factor = Math.max(1, Math.round(sampleRate / 11025));
  const mono = toMono(ch, factor);
  const sr = sampleRate / factor;
  const k = detectKey(mono, sr);
  return { ...k, bpm: detectBpm(mono, sr) };
}

let decoderReady: Promise<MPEGDecoder> | null = null;
function getDecoder() {
  if (!decoderReady) {
    const d = new MPEGDecoder();
    decoderReady = d.ready.then(() => d);
  }
  return decoderReady;
}

const cache = new Map<string, Analysis | null>();

// Previews are signed URLs that change, so cache by Deezer track id.
export async function analyzePreview(trackId: number | string, url: string | undefined | null): Promise<Analysis | null> {
  const k = String(trackId);
  if (cache.has(k)) return cache.get(k)!;
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const dec = await getDecoder();
    await dec.reset();
    const out = dec.decode(bytes);
    if (!out.samplesDecoded) return null;
    const a = analyzeSamples(out.channelData, out.sampleRate);
    cache.set(k, a);
    return a;
  } catch {
    return null;
  }
}

// ---------- Mixing compatibility ----------

export type Compat = { score: number; label: string };

export function keyCompat(seed?: string | null, other?: string | null): Compat {
  if (!seed || !other) return { score: 0, label: "" };
  const n1 = parseInt(seed),
    n2 = parseInt(other);
  const l1 = seed.slice(-1),
    l2 = other.slice(-1);
  const step = ((n2 - n1 + 12) % 12) as number; // 0..11 clockwise
  if (n1 === n2 && l1 === l2) return { score: 3, label: "Same key" };
  if (l1 === l2 && (step === 1 || step === 11)) return { score: 2.6, label: step === 1 ? "+1 energy up" : "−1 energy down" };
  if (n1 === n2) return { score: 2.5, label: l2 === "A" ? "Relative minor" : "Relative major" };
  if (l1 === l2 && (step === 2 || step === 10)) return { score: 1.2, label: "Two steps — mix carefully" };
  if (l1 === l2 && step === 7) return { score: 1.2, label: "+7 energy boost" };
  return { score: 0, label: "Key clash" };
}

// BPM closeness, allowing half/double time. 1 = same tempo, 0 = >8% apart.
export function bpmCompat(seed?: number | null, other?: number | null) {
  if (!seed || !other) return 0.5;
  const ratios = [other / seed, (other * 2) / seed, other / (seed * 2)];
  const off = Math.min(...ratios.map((r) => Math.abs(1 - r)));
  return Math.max(0, 1 - off / 0.08);
}
