// Instruments. The author of this engine cannot hear, so every claim the
// engine makes about its sound ("a question rises", "size scales the formants",
// "! is louder than .") is measured from the rendered samples with these.
// They are deliberately textbook: autocorrelation pitch, LPC formants, RMS.

export function rms(x, from = 0, to = x.length) {
  from = Math.max(0, from | 0);
  to = Math.min(x.length, to | 0);
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, to - from));
}

export const db = (ratio) => 20 * Math.log10(Math.max(ratio, 1e-12));

// in-place radix-2 FFT
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
        const a = i + k, b = i + k + len / 2;
        const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
      }
    }
  }
}

// Hann-windowed magnitude spectrum of `size` samples from `start`. -> Float64Array(size/2)
export function magnitude(x, start, size) {
  const re = new Float64Array(size), im = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    const s = x[start + i] ?? 0;
    re[i] = s * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)));
  }
  fft(re, im);
  const mag = new Float64Array(size / 2);
  for (let i = 0; i < size / 2; i++) mag[i] = Math.hypot(re[i], im[i]);
  return mag;
}

export function centroid(x, sr, t0, t1) {
  const size = 4096;
  const start = Math.max(0, Math.floor(((t0 + t1) / 2) * sr - size / 2));
  const mag = magnitude(x, start, size);
  let num = 0, den = 0;
  for (let i = 1; i < mag.length; i++) { const p = mag[i] * mag[i]; num += p * ((i * sr) / size); den += p; }
  return den > 0 ? num / den : 0;
}

// Energy in [f-lo, f+hi] around a frequency, relative to the energy around another. dB.
export function bandRatioDb(x, sr, t0, t1, fNum, fDen, halfWidth = 12) {
  const size = 16384;
  const start = Math.max(0, Math.floor(((t0 + t1) / 2) * sr - size / 2));
  const mag = magnitude(x, start, size);
  const band = (f) => { let s = 0; const a = Math.round(((f - halfWidth) * size) / sr), b = Math.round(((f + halfWidth) * size) / sr); for (let i = Math.max(1, a); i <= b; i++) s += mag[i] * mag[i]; return s; };
  return 10 * Math.log10(Math.max(band(fNum), 1e-30) / Math.max(band(fDen), 1e-30));
}

// Normalised autocorrelation pitch. -> { f0, clarity } where clarity in [0,1] is
// the height of the chosen peak (≈1 for a clean periodic sound, ≈0 for noise).
export function pitch(x, sr, t0, t1, lo = 40, hi = 1000) {
  const a = Math.max(0, Math.floor(t0 * sr));
  const b = Math.min(x.length, Math.floor(t1 * sr));
  const n = b - a;
  const maxLag = Math.min(Math.floor(sr / lo), n >> 1);
  const minLag = Math.max(2, Math.floor(sr / hi));
  if (maxLag <= minLag + 2) return { f0: 0, clarity: 0 };
  const w = n - maxLag;
  let e0 = 0;
  for (let i = 0; i < w; i++) e0 += x[a + i] * x[a + i];
  const r = new Float64Array(maxLag + 1);
  for (let lag = minLag - 1; lag <= maxLag; lag++) {
    let s = 0, e1 = 0;
    for (let i = 0; i < w; i++) { s += x[a + i] * x[a + i + lag]; e1 += x[a + i + lag] * x[a + i + lag]; }
    r[lag] = s / Math.sqrt(Math.max(e0 * e1, 1e-30));
  }
  let best = 0;
  for (let lag = minLag; lag < maxLag; lag++) if (r[lag] > best && r[lag] >= r[lag - 1] && r[lag] >= r[lag + 1]) best = r[lag];
  if (best <= 0) return { f0: 0, clarity: 0 };
  // first peak within 8% of the best one: refuses the octave-below error
  for (let lag = minLag; lag < maxLag; lag++) {
    if (r[lag] >= 0.92 * best && r[lag] >= r[lag - 1] && r[lag] >= r[lag + 1]) {
      const y0 = r[lag - 1], y1 = r[lag], y2 = r[lag + 1];
      const d = y0 - 2 * y1 + y2;
      const shift = Math.abs(d) > 1e-12 ? (0.5 * (y0 - y2)) / d : 0;
      return { f0: sr / (lag + shift), clarity: y1 };
    }
  }
  return { f0: 0, clarity: 0 };
}

// LPC formants. Decimates to ~10 kHz, pre-emphasises, autocorrelation method +
// Levinson-Durbin, then reads the peaks of the all-pole envelope.
// Trustworthy for f0 below ~200 Hz; above that the harmonics are too sparse to
// outline a formant and the estimate follows harmonics instead. Tests use low pitch.
export function formants(x, sr, t0, t1, { order = 12, maxHz = 5000 } = {}) {
  const step = Math.max(1, Math.round(sr / (maxHz * 2)));
  const dsr = sr / step;
  const a0 = Math.floor(t0 * sr), b0 = Math.floor(t1 * sr);
  // crude anti-alias: boxcar over `step`, then pick
  const y = [];
  for (let i = a0; i + step <= b0; i += step) { let s = 0; for (let k = 0; k < step; k++) s += x[i + k] ?? 0; y.push(s / step); }
  const n = y.length;
  if (n < order * 4) return [];
  const z = new Float64Array(n);
  for (let i = n - 1; i > 0; i--) z[i] = (y[i] - 0.97 * y[i - 1]) * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1)));
  const R = new Float64Array(order + 1);
  for (let k = 0; k <= order; k++) { let s = 0; for (let i = k; i < n; i++) s += z[i] * z[i - k]; R[k] = s; }
  if (R[0] <= 0) return [];
  const a = new Float64Array(order + 1);
  a[0] = 1;
  let err = R[0];
  for (let i = 1; i <= order; i++) {
    let acc = R[i];
    for (let j = 1; j < i; j++) acc += a[j] * R[i - j];
    const k = -acc / err;
    const prev = a.slice();
    for (let j = 1; j < i; j++) a[j] = prev[j] + k * prev[i - j];
    a[i] = k;
    err *= 1 - k * k;
    if (err <= 0) break;
  }
  const grid = 5; // Hz
  const env = [];
  for (let f = 0; f <= dsr / 2; f += grid) {
    const w = (2 * Math.PI * f) / dsr;
    let re = 0, im = 0;
    for (let k = 0; k <= order; k++) { re += a[k] * Math.cos(w * k); im -= a[k] * Math.sin(w * k); }
    env.push(-10 * Math.log10(re * re + im * im + 1e-30));
  }
  const peaks = [];
  for (let i = 2; i < env.length - 2; i++) {
    if (env[i] > env[i - 1] && env[i] >= env[i + 1]) {
      // demand some prominence so a shoulder is not called a formant
      let left = env[i], right = env[i];
      for (let k = i; k >= 0 && env[k] <= env[i]; k--) left = Math.min(left, env[k]);
      for (let k = i; k < env.length && env[k] <= env[i]; k++) right = Math.min(right, env[k]);
      if (env[i] - Math.max(left, right) >= 1.5 && i * grid > 120) peaks.push(i * grid);
    }
  }
  return peaks;
}

// The measured formant closest to a target, as a ratio measured/target.
export function nearestRatio(peaks, target) {
  if (!peaks.length) return NaN;
  let best = peaks[0];
  for (const p of peaks) if (Math.abs(Math.log(p / target)) < Math.abs(Math.log(best / target))) best = p;
  return best / target;
}

// Short-time RMS envelope, one value per `hopMs`.
export function envelope(x, sr, hopMs = 5, winMs = 20) {
  const hop = Math.round((hopMs / 1000) * sr), win = Math.round((winMs / 1000) * sr);
  const out = [];
  for (let i = 0; i + win <= x.length; i += hop) out.push(rms(x, i, i + win));
  return { values: out, hopSeconds: hop / sr };
}
