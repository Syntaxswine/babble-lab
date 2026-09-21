// The other mouth: instead of synthesising each syllable, play a piece of a
// recording that LOOKS like it. The plan is untouched — timing, melody,
// emphasis, pauses and the text reveal all come from prosody.mjs exactly as for
// the synth — only the sound inside each unit's slot changes.
//
// Which piece? Two questions, both answered from the picture (look.mjs):
//
//   how does the syllable OPEN?    a stop           -> a "struck" piece (a vertical line)
//     (its manner)                 a hiss           -> a "wash" piece   (grain)
//                                  anything softer  -> a "tonal" piece  (horizontal stripes)
//   how BRIGHT is its vowel?       "ee" has ink high in the picture, "oo" low;
//     (its place)                  pieces within a look are ordered by ink height,
//                                  so the vowel's F2 picks how far along to reach
//
// Manner chooses the look, place chooses within it: the tongue's rule again.
// A small hash(word, syllable) nudge keeps one vowel from always being the same
// piece, while the same word still always comes out the same.
//
// The piece only says where to START. From there the read follows the ORIGINAL
// recording, straight through into whatever piece came next in it — so a
// syllable longer than a quarter-second piece does not fall silent or loop, and
// a pluck caught at the end of its piece keeps its own decay.
//
// Pitch is tape speed: voice.pitch 140 plays the recording as it is, 280 an
// octave up and twice as fast. The melody of the line (a question's rise) bends
// that speed, which is audible even in chords. A struck piece is read from
// just before its edge, so the hit lands on the syllable.

import { PHONEMES } from './phonemes.mjs';
import { hashString } from './rng.mjs';

const NATIVE_HZ = 140; // the voice.pitch at which a bank plays at its recorded speed
const F2_LOW = 800;
const F2_HIGH = 2300;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function lookFor(unit) {
  const first = PHONEMES[unit.phones?.[0]];
  if (!first) return 'tonal';
  if (first.type === 'stop' || first.type === 'affric') return 'struck';
  if (first.type === 'fric' || first.type === 'asp') return 'wash';
  return 'tonal';
}

export function brightnessOf(unit) {
  const nuc = unit.phones?.find((ph) => PHONEMES[ph]?.type === 'vowel');
  const d = PHONEMES[nuc];
  if (!d) return 0.5;
  const f2 = d.Fe ? (d.F[1] + d.Fe[1]) / 2 : d.F[1];
  return clamp((f2 - F2_LOW) / (F2_HIGH - F2_LOW), 0, 1);
}

// -> index into bank.segments
export function chooseSegment(bank, unit, wordText, k) {
  const pool = bank.looks[lookFor(unit)];
  const n = pool.length;
  const nudge = ((hashString(`${wordText.toLowerCase()}:${k}`) % 1000) / 1000 - 0.5) * 0.24 * n;
  return pool[clamp(Math.round(brightnessOf(unit) * (n - 1) + nudge), 0, n - 1)];
}

// Samples [a, b) of the recording AS IT WAS, gathered back from the arranged pieces.
export function originalSpan(bank, a, b) {
  const len = bank.pieceLength;
  const out = new Float32Array(Math.max(0, b - a));
  for (let j = Math.max(a, 0); j < b;) {
    const o = Math.floor(j / len);
    const si = o < bank.byOrigin.length ? bank.byOrigin[o] : -1;
    const off = j - o * len;
    const n = Math.min(len - off, b - j);
    if (si >= 0) out.set(bank.segments[si].samples.subarray(off, off + n), j - a);
    else if (o >= bank.byOrigin.length) break; // past the end of the recording: silence
    j += n;
  }
  return out;
}

// two cascaded RBJ low-passes, in place: keeps a sped-up read from aliasing
function lowpass(y, fc, sr) {
  const w = (2 * Math.PI * fc) / sr, c = Math.cos(w), al = Math.sin(w) / (2 * 0.7071), a0 = 1 + al;
  const b0 = (1 - c) / 2 / a0, b1 = (1 - c) / a0, a1 = (-2 * c) / a0, a2 = (1 - al) / a0;
  for (let pass = 0; pass < 2; pass++) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < y.length; i++) { const v = b0 * y[i] + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = y[i]; y2 = y1; y1 = v; y[i] = v; }
  }
  return y;
}

export function synthesizeFromBank(plan, bank, sr) {
  const v = plan.voice;
  const out = new Float32Array(Math.ceil((plan.duration + 0.04) * sr));
  const base = v.pitch / NATIVE_HZ;
  const srcRate = bank.sampleRate;
  const len = bank.pieceLength;
  const recorded = bank.segments.length * len;
  const vibW = (2 * Math.PI * v.vibRate) / sr;
  const perWord = new Map();
  const used = [];

  for (const u of plan.units) {
    if (u.kind === 'rest' || u.silent || !(u.t1 > u.t0)) continue;
    const k = perWord.get(u.word) ?? 0;
    perWord.set(u.word, k + 1);
    const segIndex = chooseSegment(bank, u, plan.words.find((w) => w.index === u.word)?.text ?? '', k);
    const seg = bank.segments[segIndex];
    const look = seg.look;
    const dur = u.t1 - u.t0;
    const n = Math.floor(dur * sr);
    const topRate = base * Math.pow(2, (Math.max(u.p0, u.p1) + v.vibDepth) / 12);
    const meanRate = base * Math.pow(2, (u.p0 + u.p1) / 24);

    // where in the ORIGINAL recording this unit starts reading, and how much of it it may need
    const startIn = Math.max(0, look === 'struck' ? seg.cue - 0.004 : seg.body);
    const startAbs = seg.origin * len + Math.round(startIn * srcRate);
    const a = Math.max(0, startAbs - 2);
    const b = Math.min(recorded, startAbs + Math.ceil(topRate * dur * srcRate) + 8);
    const src = originalSpan(bank, a, b);
    const step0 = (meanRate * srcRate) / sr;
    if (step0 > 1.05) lowpass(src, (0.45 * srcRate) / step0, srcRate);

    const attack = Math.max(1, Math.floor((look === 'struck' ? 0.002 : 0.012) * sr));
    const release = Math.max(1, Math.floor(Math.min(0.03, dur * 0.35) * sr));
    const gain = u.amp * seg.gain;
    const o0 = Math.floor(u.t0 * sr);
    let pos = startAbs - a;
    for (let i = 0; i < n && o0 + i < out.length; i++) {
      const st = u.p0 + ((u.p1 - u.p0) * i) / n + (v.vibDepth > 0 ? v.vibDepth * Math.sin(vibW * (o0 + i)) : 0);
      const j = Math.floor(pos);
      if (j + 2 >= src.length) break; // the recording itself ran out: the unit ends early
      // 4-point Hermite
      const f = pos - j, xm = src[j > 0 ? j - 1 : 0], x0 = src[j], x1 = src[j + 1], x2 = src[j + 2];
      const c1 = 0.5 * (x1 - xm), c2 = xm - 2.5 * x0 + 2 * x1 - 0.5 * x2, c3 = 0.5 * (x2 - xm) + 1.5 * (x0 - x1);
      const s = ((c3 * f + c2) * f + c1) * f + x0;
      const left = (src.length - 2 - pos) / ((base * srcRate) / sr); // output samples until the recording runs out
      const env = Math.min(1, i / attack, (n - i) / release, Math.max(0, left) / release);
      out[o0 + i] += s * gain * env;
      pos += (base * Math.pow(2, st / 12) * srcRate) / sr;
    }
    used.push({ unit: plan.units.indexOf(u), segment: segIndex, look, origin: seg.origin, time: startAbs / srcRate, pieces: Math.floor((a + Math.min(pos, src.length)) / len) - seg.origin + 1 });
  }
  return { samples: out, used };
}
