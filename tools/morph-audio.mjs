// Offline timbre morph: interpolate smooth log-spectral envelopes while
// retaining one carrier's phase and harmonic structure. This is not a sum of
// waveforms, nor a midpoint of pitch or a promise of perceptual halfwayness.
// Cepstral envelope / cross-synthesis reference: Julius O. Smith III,
// https://www.dsprelated.com/freebooks/sasp/Applications_STFT.html
import { fft, rms } from './analyze.mjs';

// Sources already share their syllable clock. Only their trailing rests or
// effects tails may differ: append silence without stretching either track.
export function padMorphSources(carrier, colour) {
  if (!(carrier instanceof Float32Array) || !(colour instanceof Float32Array) || !carrier.length || !colour.length) throw new Error('morph: two nonempty Float32Array tracks are required');
  const length = Math.max(carrier.length, colour.length);
  return [carrier, colour].map((samples) => {
    if (samples.length === length) return samples;
    const padded = new Float32Array(length); padded.set(samples); return padded;
  });
}

function ifft(re, im) {
  for (let i = 0; i < im.length; i++) im[i] = -im[i];
  fft(re, im);
  for (let i = 0; i < re.length; i++) { re[i] /= re.length; im[i] = -im[i] / re.length; }
}

function logEnvelope(re, im, cutoff) {
  const n = re.length, env = new Float64Array(n), scratch = new Float64Array(n);
  let peak = 0;
  for (let k = 0; k < n; k++) { env[k] = Math.hypot(re[k], im[k]); peak = Math.max(peak, env[k]); }
  const floor = Math.max(1e-12, peak * 1e-6);
  for (let k = 0; k < n; k++) env[k] = Math.log(Math.max(floor, env[k]));
  ifft(env, scratch);
  // Keep only low quefrencies: remove the pitch-period detail from the envelope.
  for (let q = 0; q < n; q++) if (Math.min(q, n - q) > cutoff) env[q] = 0;
  scratch.fill(0);
  fft(env, scratch);
  return env;
}

// The source analysis is independent of the slider. A live worker can keep
// these spectra for its current voice and only repeat the inverse transform.
export function prepareTimbreMorph(carrier, colour, sampleRate, opts = {}) {
  if (!(carrier instanceof Float32Array) || !(colour instanceof Float32Array) || carrier.length !== colour.length || !carrier.length) throw new Error('morph: two nonempty, equally long Float32Array tracks are required');
  if (!carrier.every(Number.isFinite) || !colour.every(Number.isFinite)) throw new Error('morph: tracks must contain finite samples');
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new Error('morph: invalid sample rate');
  const settings = { amount: 0.5, windowSize: 2048, hopSize: 256, envelopeMs: 1, fadeMs: 2, peakLimit: 0.9, ...opts };
  const { amount, windowSize: n, hopSize: hop, envelopeMs, fadeMs, peakLimit, cues } = settings;
  if (!Number.isFinite(amount) || amount < 0 || amount > 1) throw new Error('morph: amount must be in 0..1');
  if (!Number.isInteger(n) || n < 256 || n > 16384 || (n & (n - 1))) throw new Error('morph: windowSize must be a power of two in 256..16384');
  if (!Number.isInteger(hop) || hop < 1 || hop > n / 4 || n % hop) throw new Error('morph: hopSize must divide the window and be at most a quarter of it');
  const cutoff = Math.round(sampleRate * envelopeMs / 1000);
  if (!Number.isFinite(envelopeMs) || cutoff < 1 || cutoff >= n / 2) throw new Error('morph: invalid envelope smoothing time');
  if (!Number.isFinite(fadeMs) || fadeMs < 0 || fadeMs > 20 || !(peakLimit > 0 && peakLimit <= 1)) throw new Error('morph: invalid fade or peak limit');
  if (cues !== undefined) {
    let end = 0;
    if (!Array.isArray(cues) || !cues.length) throw new Error('morph: cues must be nonempty');
    for (const cue of cues) {
      if (!Array.isArray(cue) || cue.length !== 2 || !cue.every(Number.isFinite) || cue[0] < end || cue[1] <= cue[0] || cue[1] * sampleRate > carrier.length + 1e-6) throw new Error('morph: invalid or overlapping cues');
      end = cue[1];
    }
  }

  const window = Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n));
  const weights = new Float64Array(carrier.length), frames = [];
  const a = new Float64Array(n), ai = new Float64Array(n), b = new Float64Array(n), bi = new Float64Array(n);
  let silentColourFrames = 0;
  // Centered windows and normalized overlap-add introduce no frame delay.
  for (let start = -n / 2; start < carrier.length; start += hop) {
    let energyA = 0, energyB = 0;
    ai.fill(0); bi.fill(0);
    for (let j = 0; j < n; j++) {
      a[j] = (carrier[start + j] ?? 0) * window[j];
      b[j] = (colour[start + j] ?? 0) * window[j];
      energyA += a[j] * a[j]; energyB += b[j] * b[j];
    }
    const frame = { start, energyA };
    if (energyA > 1e-20 && energyB > 1e-20) {
      fft(a, ai); fft(b, bi);
      const envA = logEnvelope(a, ai, cutoff), envB = logEnvelope(b, bi, cutoff);
      frame.re = a.slice(); frame.im = ai.slice();
      frame.delta = Float64Array.from(envB, (x, k) => x - envA[k]);
    } else if (energyA > 1e-20 && energyB <= 1e-20) silentColourFrames++;
    frames.push(frame);
    for (let j = Math.max(0, -start); j < n && start + j < weights.length; j++) weights[start + j] += window[j] * window[j];
  }
  return { carrier, sampleRate, settings, window, weights, frames, silentColourFrames };
}

export function renderPreparedMorph(prepared, amount = prepared.settings.amount) {
  if (!Number.isFinite(amount) || amount < 0 || amount > 1) throw new Error('morph: amount must be in 0..1');
  const { carrier, sampleRate, window, weights, frames, silentColourFrames } = prepared;
  const settings = { ...prepared.settings, amount };
  const { windowSize: n, fadeMs, peakLimit, cues } = settings;
  const out = new Float64Array(carrier.length), a = new Float64Array(n), ai = new Float64Array(n);
  for (const frame of frames) {
    const { start, energyA } = frame;
    if (amount > 0 && frame.delta) {
      for (let k = 0; k < n; k++) {
        const gain = Math.exp(amount * frame.delta[k]);
        a[k] = frame.re[k] * gain; ai[k] = frame.im[k] * gain;
      }
      ifft(a, ai);
      let energyOut = 0;
      for (const x of a) energyOut += x * x;
      // Preserve the carrier's loudness contour: this morph changes colour.
      const level = energyOut > 1e-30 ? Math.sqrt(energyA / energyOut) : 0;
      for (let j = 0; j < n; j++) a[j] *= level;
    } else {
      for (let j = 0; j < n; j++) a[j] = (carrier[start + j] ?? 0) * window[j];
    }
    for (let j = Math.max(0, -start); j < n && start + j < out.length; j++) {
      out[start + j] += a[j] * window[j];
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = weights[i] > 1e-12 ? out[i] / weights[i] : 0;

  if (cues) {
    // Filtering can ring just outside a syllable. Keep the requested pauses
    // exactly empty and fade each slot over 2 ms by default to prevent clicks.
    const gate = new Float64Array(out.length);
    for (const [from, to] of cues) {
      const first = Math.ceil(from * sampleRate), end = Math.min(out.length, Math.ceil(to * sampleRate));
      const fade = Math.min(Math.round(fadeMs * sampleRate / 1000), Math.floor((end - first) / 2));
      for (let i = first; i < end; i++) gate[i] = fade ? Math.min(1, (i - first) / fade, (end - 1 - i) / fade) : 1;
    }
    for (let i = 0; i < out.length; i++) out[i] *= gate[i];
  }
  let peak = 0;
  for (const x of out) { if (!Number.isFinite(x)) throw new Error('morph: non-finite output'); peak = Math.max(peak, Math.abs(x)); }
  const masterGain = peak > peakLimit ? peakLimit / peak : 1;
  const samples = Float32Array.from(out, (x) => x * masterGain);
  return { samples, settings, metrics: { frames: frames.length, silentColourFrames, masterGain, carrierRms: rms(carrier), outputRms: rms(samples), peak: peak * masterGain } };
}

export function morphTimbre(carrier, colour, sampleRate, opts = {}) {
  return renderPreparedMorph(prepareTimbreMorph(carrier, colour, sampleRate, opts));
}
