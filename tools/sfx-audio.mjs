// Recordings stay the carrier. The existing sampler supplies the colour and
// the optional extra layer; its amplitude follows the effect's own envelope.
import { synthesizeFromBank } from '../src/sampler.mjs';
import { rms } from './analyze.mjs';

export function prepareEffect(samples, sampleRate, trim) {
  if (!(samples instanceof Float32Array) || !samples.length || !samples.every(Number.isFinite)) throw new Error('Effect source must be finite audio');
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new Error('Invalid effect sample rate');
  if (!Number.isFinite(trim.from) || trim.from < 0 || !Number.isFinite(trim.seconds) || trim.seconds <= 0) throw new Error('Invalid effect trim');
  const first = Math.round(trim.from * sampleRate), end = Math.min(samples.length, first + Math.round(trim.seconds * sampleRate));
  if (end <= first) throw new Error('Effect trim is outside the recording');
  const clip = samples.slice(first, end), edge = Math.min(Math.round(.003 * sampleRate), Math.floor(clip.length / 2));
  const attack = Math.min(8, edge);
  for (let i = 0; i < clip.length; i++) clip[i] *= Math.min(1, i / Math.max(1, attack), (clip.length - 1 - i) / Math.max(1, edge));
  let peak = 0; for (const x of clip) peak = Math.max(peak, Math.abs(x));
  if (peak < 1e-8) throw new Error('Effect trim contains silence');
  const gain = .85 / peak, offset = Math.round(.01 * sampleRate);
  const output = new Float32Array(offset + clip.length + Math.round(.05 * sampleRate));
  for (let i = 0; i < clip.length; i++) output[offset + i] = clip[i] * gain;
  return { samples: output, trim: { from: first / sampleRate, seconds: clip.length / sampleRate }, gain, preSilence: offset / sampleRate };
}

export function sliceEffect(carrier, sampleRate, bank, { id, look = 'struck', pitch = 140 }) {
  if (!(carrier instanceof Float32Array) || !carrier.length || !carrier.every(Number.isFinite)) throw new Error('Slice envelope requires finite audio');
  if (!['struck', 'wash', 'tonal'].includes(look) || !Number.isFinite(pitch) || pitch < 40 || pitch > 1000) throw new Error('Invalid effect texture');
  const window = Math.max(1, Math.round(sampleRate * .01)), envelope = new Float32Array(carrier.length);
  let sum = 0, peak = 0;
  for (let i = 0; i < carrier.length; i++) {
    sum += carrier[i] ** 2;
    if (i >= window) sum -= carrier[i - window] ** 2;
    envelope[i] = Math.sqrt(Math.max(0, sum) / window); peak = Math.max(peak, envelope[i]);
  }
  if (peak < 1e-8) throw new Error('Cannot make slices for a silent effect');
  const starts = []; let active = false, previous = -Infinity;
  for (let i = 0; i < envelope.length; i += window) {
    if (!active && envelope[i] > peak * .22) {
      const t = Math.max(0, i / sampleRate - .01);
      if (t - previous >= .07) { starts.push(t); previous = t; }
      active = true;
    } else if (envelope[i] < peak * .11) active = false;
  }
  if (!starts.length) starts.push(0);
  const duration = carrier.length / sampleRate;
  const phones = look === 'struck' ? ['T', 'AE'] : look === 'wash' ? ['S', 'UW'] : ['M', 'IY'];
  const plan = { duration, voice: { pitch, vibRate: 0, vibDepth: 0 }, words: [{ index: 0, text: id }],
    units: starts.map((t0, i) => ({ kind: 'syllable', word: 0, phones, t0, t1: starts[i + 1] ?? duration, amp: 1, p0: 0, p1: 0 })) };
  const rendered = synthesizeFromBank(plan, bank, sampleRate), samples = rendered.samples.slice(0, carrier.length);
  let maximum = 0;
  for (let i = 0; i < samples.length; i++) { samples[i] *= envelope[i] / peak; maximum = Math.max(maximum, Math.abs(samples[i])); }
  const gain = maximum > .85 ? .85 / maximum : 1;
  for (let i = 0; i < samples.length; i++) samples[i] *= gain;
  return { samples, used: rendered.used, events: plan.units.map(({ t0, t1 }) => [t0, t1]), rms: rms(samples), gain };
}
