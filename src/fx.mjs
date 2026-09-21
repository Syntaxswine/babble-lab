// After the mouth: the cheap, characterful effects games actually use on
// voices. All deterministic, all in place on a Float32Array (echo may grow it).

// Transparent below 0.7, then bends toward a ceiling of 0.98. The ceiling is
// below 1.0 on purpose: tanh saturates to exactly 1 in floating point, so a
// curve "approaching 1.0" does reach it, and 1.0 is a clipped 16-bit sample.
// No look-ahead, no pumping — it only exists so no combination of knobs can clip.
export function softLimit(x) {
  const a = x < 0 ? -x : x;
  if (a <= 0.7) return x;
  const y = 0.7 + 0.28 * Math.tanh((a - 0.7) / 0.28);
  return x < 0 ? -y : y;
}

function biquad(samples, b0, b1, b2, a1, a2) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    samples[i] = y;
  }
}

// RBJ cookbook, Q = 0.707
function highpass(samples, fc, sr) {
  const w = (2 * Math.PI * fc) / sr, c = Math.cos(w), al = Math.sin(w) / (2 * 0.7071), a0 = 1 + al;
  biquad(samples, (1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0, (-2 * c) / a0, (1 - al) / a0);
}
function lowpass(samples, fc, sr) {
  const w = (2 * Math.PI * fc) / sr, c = Math.cos(w), al = Math.sin(w) / (2 * 0.7071), a0 = 1 + al;
  biquad(samples, (1 - c) / 2 / a0, (1 - c) / a0, (1 - c) / 2 / a0, (-2 * c) / a0, (1 - al) / a0);
}

export function applyFx(samples, fx, sr) {
  if (!fx) return samples;
  let x = samples;

  if (fx.ring > 0) {
    const w = (2 * Math.PI * fx.ring) / sr;
    for (let i = 0; i < x.length; i++) x[i] *= Math.sin(w * i);
  }
  if (fx.band) {
    highpass(x, 300, sr); highpass(x, 300, sr);
    lowpass(x, 3400, sr); lowpass(x, 3400, sr);
    for (let i = 0; i < x.length; i++) x[i] *= 1.6; // make up what the band took
  }
  if (fx.tremolo > 0) {
    const w = (2 * Math.PI * fx.tremRate) / sr;
    for (let i = 0; i < x.length; i++) x[i] *= 1 - fx.tremolo * (0.5 + 0.5 * Math.sin(w * i));
  }
  if (fx.echo > 0) {
    const d = Math.max(1, Math.round(fx.echoTime * sr));
    const repeats = Math.min(12, Math.ceil(Math.log(0.01) / Math.log(Math.min(0.95, fx.echo))));
    const grown = new Float32Array(x.length + d * repeats);
    grown.set(x);
    for (let i = d; i < grown.length; i++) grown[i] += grown[i - d] * fx.echo; // feedback comb
    x = grown;
  }
  if (fx.hold > 1) {
    let held = 0;
    for (let i = 0; i < x.length; i++) { if (i % fx.hold === 0) held = x[i]; x[i] = held; }
  }
  if (fx.crush > 0) {
    const q = Math.pow(2, fx.crush - 1);
    for (let i = 0; i < x.length; i++) x[i] = Math.round(x[i] * q) / q;
  }
  return x;
}
