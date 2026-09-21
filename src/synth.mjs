// The mouth. A small source-filter synthesizer in the Klatt (1980) family,
// written as plain arithmetic into a Float32Array so that Node and the browser
// produce the SAME samples — which is what lets the tests measure the audio
// the game will play, and lets a line rendered at build time match run time.
//
//   voiced source ─┐
//   breath noise ──┴─► tilt ─► F1 ► F2 ► F3 ► F4 ► F5 ──┐
//   frication noise ─────────► band 1 ‖ band 2 ─────────┼─► DC block ─► fx ─► limiter
//   chip source (blips) ────────────────────────────────┘
//
// Levels are calibrated per voice (see calibrate): the voiced path is scaled so
// that vowels AVERAGE VOICED_RMS whatever the pitch, tract or waveform, and the
// noise paths are absolute. That keeps the consonant/vowel balance the same for
// a pixie and a beast, and keeps "!" genuinely louder than ".".
//
// "Average" is load-bearing. One vowel at one fixed pitch is a lottery: its
// level swings ±6 dB on whether a harmonic happens to sit on F1 (at 220 Hz the
// 4th harmonic lands on a small creature's "ah" and rings). That is physics, not
// a bug — sopranos exploit it — so calibration averages over five mouth shapes
// and a pitch glide, and promises the average, not every vowel.

import { BANDWIDTHS } from './phonemes.mjs';
import { applyFx, softLimit } from './fx.mjs';

const H = 32; // control period, samples
export const VOICED_RMS = 0.14;
const RAW_RMS = 0.2;
const ASP_RMS = 0.035;
const FRIC_GAIN = 0.25; // measured: puts /s/ about 11 dB under its vowel (test/synth.test.mjs)
const RING_OUT = 0.04; // seconds of tail for the resonators to settle

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };

function polyBlep(t, dt) {
  if (t < dt) { const x = t / dt; return x + x - x * x - 1; }
  if (t > 1 - dt) { const x = (t - 1) / dt; return x * x + x + x + 1; }
  return 0;
}

// One cycle of the chosen waveform at phase p in [0,1). (Exported for the aliasing test.)
export function wave(kind, p, dt, oq) {
  switch (kind) {
    case 'glottal': {
      // derivative of the KLGLOTT88 flow pulse x² − x³ over the open phase; the
      // jump back to zero at closure is what excites the formants, so it gets a BLEP
      let v = 0;
      if (p < oq) { const x = p / oq; v = 2 * x - 3 * x * x; }
      let d = p - oq; if (d < 0) d += 1;
      return (v + 0.5 * polyBlep(d, dt)) * (0.6 / oq);
    }
    case 'saw': return 2 * p - 1 - polyBlep(p, dt);
    case 'square': { let q = p + 0.5; if (q >= 1) q -= 1; return (p < 0.5 ? 1 : -1) + polyBlep(p, dt) - polyBlep(q, dt); }
    case 'pulse': { let q = p + 0.75; if (q >= 1) q -= 1; return (p < 0.25 ? 1 : -1) + 0.5 + polyBlep(p, dt) - polyBlep(q, dt); }
    case 'triangle': return 1 - 4 * Math.abs(p - 0.5);
    case 'sine': return Math.sin(2 * Math.PI * p);
    default: return 0; // whisper: no voiced source at all
  }
}

// ---------------------------------------------------------------------------
// control tracks: one value per H samples, glided between segment targets
// ---------------------------------------------------------------------------
function buildTracks(plan, sr, nFrames) {
  const segs = plan.segs;
  const n = segs.length;
  const T = {};
  for (const k of ['f1', 'f2', 'f3', 'av', 'ah', 'af', 'nasal', 'raw', 'b1f', 'b1w', 'b1g', 'b2f', 'b2w', 'b2g', 'f0']) T[k] = new Float32Array(nFrames);

  const glide = (i, t, startOf, endOf, trOf) => {
    const s = segs[i];
    const a = startOf(s);
    const b = endOf(s);
    let v = a;
    if (a !== b) v = a + (b - a) * smooth(((t - s.t0) / s.dur - 0.15) / 0.7);
    if (i > 0) {
      const tr = Math.min(trOf(s), s.dur, segs[i - 1].dur);
      if (tr > 0 && t < s.t0 + tr / 2) { const w = smooth((t - (s.t0 - tr / 2)) / tr); v = endOf(segs[i - 1]) * (1 - w) + v * w; }
    }
    if (i < n - 1) {
      const nx = segs[i + 1];
      const tr = Math.min(trOf(nx), s.dur, nx.dur);
      const t1 = s.t0 + s.dur;
      if (tr > 0 && t > t1 - tr / 2) { const w = smooth((t - (t1 - tr / 2)) / tr); v = v * (1 - w) + startOf(nx) * w; }
    }
    return v;
  };
  const Fk = (k) => [(s) => s.F[k], (s) => (s.Fe ? s.Fe[k] : s.F[k]), (s) => s.tr];
  const Ak = (key) => [(s) => s[key] ?? 0, (s) => (key === 'av' && s.decay ? (s.av ?? 0) * Math.exp(-s.dur / s.decay) : s[key] ?? 0), (s) => s.atr];

  let i = 0;
  let pi = 0;
  const pts = plan.pitch;
  const hz = plan.voice.pitch;
  for (let f = 0; f < nFrames; f++) {
    const t = (f * H) / sr;
    while (i < n - 1 && t >= segs[i].t0 + segs[i].dur) i++;
    const s = segs[i];
    T.f1[f] = glide(i, t, ...Fk(0));
    T.f2[f] = glide(i, t, ...Fk(1));
    T.f3[f] = glide(i, t, ...Fk(2));
    T.ah[f] = glide(i, t, ...Ak('ah'));
    T.af[f] = glide(i, t, ...Ak('af'));
    T.nasal[f] = glide(i, t, ...Ak('nasal'));
    T.raw[f] = s.raw ?? 0;
    // a plucked blip decays inside its segment; everything else holds its level
    let av = glide(i, t, ...Ak('av'));
    if (s.decay && t >= s.t0) av = Math.min(av, (s.av ?? 0) * Math.exp(-(t - s.t0) / s.decay)) * smooth((t - s.t0) / Math.max(s.atr, 1e-4));
    T.av[f] = av;
    // frication keeps the bands of whichever neighbour is still hissing through the glide
    const bands = s.bands ?? (t - s.t0 < s.dur / 2 ? segs[i - 1]?.bands : segs[i + 1]?.bands) ?? segs[i - 1]?.bands ?? segs[i + 1]?.bands;
    if (bands) {
      T.b1f[f] = bands[0].fc; T.b1w[f] = bands[0].bw; T.b1g[f] = bands[0].g;
      if (bands[1]) { T.b2f[f] = bands[1].fc; T.b2w[f] = bands[1].bw; T.b2g[f] = bands[1].g; }
    }
    // pitch: straight lines between the plan's points, in semitones
    let st = 0;
    if (pts.length) {
      while (pi < pts.length - 2 && t >= pts[pi + 1].t) pi++;
      const a = pts[pi];
      const b = pts[Math.min(pi + 1, pts.length - 1)];
      st = t <= a.t || a === b ? a.st : t >= b.t ? b.st : a.st + ((b.st - a.st) * (t - a.t)) / (b.t - a.t);
    }
    T.f0[f] = hz * Math.pow(2, st / 12);
  }
  return T;
}

// ---------------------------------------------------------------------------
// the sample loop
// ---------------------------------------------------------------------------
function synthesize(plan, sr, gains) {
  const v = plan.voice;
  const N = Math.ceil((plan.duration + RING_OUT) * sr);
  const nFrames = Math.ceil(N / H) + 2;
  const T = buildTracks(plan, sr, nFrames);
  const out = new Float32Array(N);
  const nyq = sr * 0.45;
  const whisper = v.wave === 'whisper';
  const allRaw = plan.segs.every((s) => (s.raw ?? 0) >= 1);

  // resonator state: y1, y2 for F1..F5; band-pass state for the two noise bands
  const y1 = new Float64Array(5);
  const y2 = new Float64Array(5);
  const A = new Float64Array(5);
  const B = new Float64Array(5);
  const C = new Float64Array(5);
  let n1x1 = 0, n1x2 = 0, n1y1 = 0, n1y2 = 0, n2x1 = 0, n2x2 = 0, n2y1 = 0, n2y2 = 0;
  const upper = plan.upper;

  const tiltHz = 500 * Math.pow(2, v.tilt * 5) * (allRaw ? 3 : 1);
  const tiltK = 1 - Math.exp((-2 * Math.PI * Math.min(tiltHz, nyq)) / sr);
  let lp = 0;

  let phase = 0;
  let jit = 1;
  let shim = 1;
  let alt = 1;
  let lcg = (plan.seed ^ 0x51f15e) >>> 0;
  const noise = () => { lcg = (Math.imul(lcg, 1664525) + 1013904223) >>> 0; return lcg / 2147483648 - 1; };
  const vibW = (2 * Math.PI * v.vibRate) / sr;
  let dcx = 0;
  let dcy = 0;

  for (let f = 0; f * H < N; f++) {
    const base = f * H;
    // resonator coefficients for this control period
    const nas = T.nasal[f];
    const wide = 1 + v.breath * 0.5;
    const F = [T.f1[f], T.f2[f], T.f3[f], upper[0], upper[1]];
    const W = [BANDWIDTHS[0] * (1 + 0.8 * nas), BANDWIDTHS[1] * (1 + 2.5 * nas), BANDWIDTHS[2] * (1 + 2 * nas), BANDWIDTHS[3], BANDWIDTHS[4]];
    for (let k = 0; k < 5; k++) {
      const fc = clamp(F[k], 60, nyq);
      const r = Math.exp((-Math.PI * W[k] * wide) / sr);
      C[k] = -r * r;
      B[k] = 2 * r * Math.cos((2 * Math.PI * fc) / sr);
      A[k] = 1 - B[k] - C[k];
    }
    const bp = (fc, bw) => { const r = Math.exp((-Math.PI * bw) / sr); return [(1 - r * r) / 2, 2 * r * Math.cos((2 * Math.PI * clamp(fc, 200, nyq)) / sr), -r * r]; };
    const [g1a, g1b, g1c] = T.b1g[f] ? bp(T.b1f[f], T.b1w[f]) : [0, 0, 0];
    const [g2a, g2b, g2c] = T.b2g[f] ? bp(T.b2f[f], T.b2w[f]) : [0, 0, 0];
    const b1g = T.b1g[f];
    const b2g = T.b2g[f];

    const end = Math.min(H, N - base);
    const nf = Math.min(f + 1, nFrames - 1);
    for (let k = 0; k < end; k++) {
      const u = k / H;
      const i = base + k;
      const av = T.av[f] + (T.av[nf] - T.av[f]) * u;
      const ah = T.ah[f] + (T.ah[nf] - T.ah[f]) * u;
      const af = T.af[f] + (T.af[nf] - T.af[f]) * u;
      let f0 = T.f0[f] + (T.f0[nf] - T.f0[f]) * u;
      if (v.vibDepth > 0) f0 *= Math.pow(2, (v.vibDepth * Math.sin(vibW * i)) / 12);
      const dt = Math.min(0.45, (f0 * jit) / sr);

      phase += dt;
      if (phase >= 1) {
        phase -= 1;
        alt = -alt;
        jit = 1 + v.rough * 0.035 * noise() + v.growl * 0.07 * alt;
        shim = (1 + v.rough * 0.3 * noise()) * (1 - v.growl * 0.4 * (alt > 0 ? 1 : 0));
      }
      const src = whisper ? 0 : wave(v.wave, phase, dt, v.oq) * shim;
      const raw = T.raw[f];

      let y = 0;
      if (raw < 1) {
        const open = phase < v.oq ? 1 : 0.25;
        const air = noise() * gains.asp * (ah + (whisper ? av * 3 : v.breath * av * 1.5 * open));
        lp += tiltK * (src * av * gains.voiced - lp);
        let x = lp + air;
        for (let r = 0; r < 5; r++) { const o = A[r] * x + B[r] * y1[r] + C[r] * y2[r]; y2[r] = y1[r]; y1[r] = o; x = o; }
        y = x * (1 - raw);
      }
      if (raw > 0) {
        if (raw >= 1) lp += tiltK * (src * av * gains.raw - lp);
        y += (raw >= 1 ? lp : src * av * gains.raw) * raw;
      }
      if (af > 0 || n1y1 !== 0 || n2y1 !== 0) {
        const nz = noise() * af;
        const o1 = g1a * (nz - n1x2) + g1b * n1y1 + g1c * n1y2; n1x2 = n1x1; n1x1 = nz; n1y2 = n1y1; n1y1 = Math.abs(o1) < 1e-12 ? 0 : o1;
        const o2 = g2a * (nz - n2x2) + g2b * n2y1 + g2c * n2y2; n2x2 = n2x1; n2x1 = nz; n2y2 = n2y1; n2y1 = Math.abs(o2) < 1e-12 ? 0 : o2;
        y += (o1 * b1g + o2 * b2g) * FRIC_GAIN;
      }
      // DC block
      const o = y - dcx + 0.995 * dcy;
      dcx = y;
      dcy = o;
      out[i] = o;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// calibration: how loud is this voice's raw machinery? measured, then cached.
// ---------------------------------------------------------------------------
const gainCache = new Map();

function rms(x, from, to) {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, to - from));
}

function calibrate(voice, sr) {
  const key = [sr, voice.wave, voice.pitch, voice.tract, voice.tilt, voice.oq, voice.breath, voice.nasal, voice.mode === 'blip'].join('|');
  if (gainCache.has(key)) return gainCache.get(key);
  const v = { ...voice, rough: 0, growl: 0, vibDepth: 0, breath: 0 };
  // five corners of the vowel space, 0.2 s each, under a ±3 semitone glide
  const SHAPES = [[640, 1190, 2390], [270, 2290, 3010], [730, 1090, 2440], [300, 870, 2240], [530, 1840, 2480]];
  const each = 0.2;
  const total = each * SHAPES.length;
  const upper = [3400 * voice.tract, 4200 * voice.tract];
  const ref = (seg) => ({
    voice: v, seed: 1, duration: total, upper,
    pitch: [{ t: 0, st: -3 }, { t: total, st: 3 }],
    segs: SHAPES.map((F, k) => ({ t0: k * each, dur: each, F: F.map((f) => f * voice.tract), tr: 0.04, atr: 0.005, nasal: voice.nasal * 0.8, av: 0, ah: 0, af: 0, raw: 0, ...seg })),
  });
  const lo = Math.floor(0.05 * sr);
  const hi = Math.floor(total * sr);
  const unit = { voiced: 1, raw: 1, asp: 1 };
  const voicedRms = voice.wave === 'whisper' ? 0 : rms(synthesize(ref({ av: 1 }), sr, unit), lo, hi);
  const rawRms = voice.wave === 'whisper' ? 0 : rms(synthesize(ref({ av: 1, raw: 1 }), sr, unit), lo, hi);
  const aspRms = rms(synthesize(ref({ ah: 1 }), sr, unit), lo, hi);
  const gains = {
    voiced: voicedRms > 1e-9 ? VOICED_RMS / voicedRms : 0,
    raw: rawRms > 1e-9 ? RAW_RMS / rawRms : 0,
    asp: aspRms > 1e-9 ? ASP_RMS / aspRms : 0,
  };
  gainCache.set(key, gains);
  return gains;
}

// ---------------------------------------------------------------------------
export function renderPlan(plan, opts = {}) {
  const sr = opts.sampleRate ?? 44100;
  if (!(sr >= 8000 && sr <= 192000)) throw new Error(`babble: sampleRate ${sr} out of range`);
  const gains = calibrate(plan.voice, sr);
  let samples = synthesize(plan, sr, gains);
  if (opts.fx !== false) samples = applyFx(samples, plan.voice.fx, sr);
  const g = opts.gain ?? 1;
  const fade = Math.min(Math.floor(0.003 * sr), samples.length >> 1);
  for (let i = 0; i < samples.length; i++) samples[i] = softLimit(samples[i] * g);
  for (let i = 0; i < fade; i++) { const w = i / fade; samples[i] *= w; samples[samples.length - 1 - i] *= w; }
  return samples;
}
