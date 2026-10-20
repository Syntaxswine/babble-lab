// Add the original sampler performance after the timbre morph. The slider is
// linear in amplitude: 0 is off; 1 matches the morphed track's average energy.
import { rms } from './analyze.mjs';

export function mixSliceLayer(voice, slices, level, peakLimit = 0.9) {
  if (!(voice instanceof Float32Array) || !(slices instanceof Float32Array) || !voice.length || voice.length !== slices.length) throw new Error('slice layer: two nonempty, equally long Float32Array tracks are required');
  if (!voice.every(Number.isFinite) || !slices.every(Number.isFinite)) throw new Error('slice layer: tracks must contain finite samples');
  if (!Number.isFinite(level) || level < 0 || level > 1) throw new Error('slice layer: level must be in 0..1');
  if (!Number.isFinite(peakLimit) || peakLimit <= 0 || peakLimit > 1) throw new Error('slice layer: invalid peak limit');
  const voiceRms = rms(voice), slicesRms = rms(slices);
  const gain = slicesRms > 0 ? level * voiceRms / slicesRms : 0;
  const sum = new Float64Array(voice.length);
  let peak = 0;
  for (let i = 0; i < sum.length; i++) { sum[i] = voice[i] + slices[i] * gain; peak = Math.max(peak, Math.abs(sum[i])); }
  // Common attenuation preserves the balance without clipping or compression.
  const masterGain = peak > peakLimit ? peakLimit / peak : 1;
  const samples = Float32Array.from(sum, (x) => x * masterGain);
  return { samples, metrics: { level, voiceRms, slicesRms, voiceGain: masterGain,
    slicesGain: gain * masterGain, peak: peak * masterGain, outputRms: rms(samples) } };
}
