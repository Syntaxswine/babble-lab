// A wideband spectrogram, computed in the page. 512-point windows on purpose:
// at that width individual harmonics blur together and what is left is the
// FORMANTS (dark horizontal bands) and the glottal pulses (vertical striations)
// — the textbook picture of speech, and the one that shows what the knobs do.

export function makeFft(size) {
  const rev = new Uint32Array(size);
  const bits = Math.log2(size);
  for (let i = 0; i < size; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); rev[i] = r; }
  const cos = new Float64Array(size / 2);
  const sin = new Float64Array(size / 2);
  for (let i = 0; i < size / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / size); sin[i] = -Math.sin((2 * Math.PI * i) / size); }
  const hann = new Float64Array(size);
  for (let i = 0; i < size; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  // magnitude spectrum of `size` samples of x starting at `start`, into out[size/2]
  return function magnitudeInto(x, start, out) {
    for (let i = 0; i < size; i++) { const k = start + i; re[rev[i]] = k >= 0 && k < x.length ? x[k] * hann[i] : 0; im[rev[i]] = 0; }
    for (let len = 2; len <= size; len <<= 1) {
      const step = size / len;
      for (let i = 0; i < size; i += len) {
        for (let k = 0, t = 0; k < len / 2; k++, t += step) {
          const a = i + k, b = a + len / 2;
          const xr = re[b] * cos[t] - im[b] * sin[t], xi = re[b] * sin[t] + im[b] * cos[t];
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        }
      }
    }
    for (let i = 0; i < size / 2; i++) out[i] = Math.hypot(re[i], im[i]);
  };
}

// -> { cols: Float32Array[width] of dB-normalised 0..1 columns (rows low->high), rows }
export function spectrogram(samples, sampleRate, width, rows, maxHz = 8000, size = 512) {
  const fft = makeFft(size);
  const mag = new Float64Array(size / 2);
  const grid = new Float32Array(width * rows);
  let top = 1e-9;
  for (let x = 0; x < width; x++) {
    const centre = Math.floor(((x + 0.5) / width) * samples.length);
    fft(samples, centre - size / 2, mag);
    for (let y = 0; y < rows; y++) {
      const hz = ((y + 0.5) / rows) * maxHz;
      const bin = Math.min(size / 2 - 1, (hz * size) / sampleRate);
      const lo = Math.floor(bin), f = bin - lo;
      const m = mag[lo] * (1 - f) + (mag[Math.min(size / 2 - 1, lo + 1)] ?? 0) * f;
      grid[x * rows + y] = m;
      if (m > top) top = m;
    }
  }
  for (let i = 0; i < grid.length; i++) grid[i] = Math.max(0, Math.min(1, (20 * Math.log10(grid[i] / top + 1e-9) + 62) / 62));
  return grid;
}
