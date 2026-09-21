// How a second of sound LOOKS.
//
// Everything here is measured on the spectrogram image — the same picture a
// person (or an agent that cannot hear) would look at — not on the waveform:
//
//   ink      how dark the picture is overall                       (loudness)
//   inkMax   how dark its darkest PIXELS are                       (what "quiet" is judged by)
//   height   where the ink sits, bottom to top                     (dull ... bright)
//   edge     how far the sharpest THIN vertical line stands out    (a pluck, a hit)
//   cue        and where in the second it is
//   speckle  how grainy the ink is along each row                  (hiss, shaker, breath)
//   tonal    share of ink in horizontal stripes                    (reported, not used to sort)
//   change   how different the right half is from the left
//
// Three of these were first written the obvious way and were wrong; a synthetic
// recording with known contents (test/bank.test.mjs) caught each:
//   - "quiet" judged by mean ink called a lone click on a pale ground quiet, and
//     judged by the darkest COLUMNS it called a loud pure tone quiet (one black
//     line is a few pixels of a column). A picture with a black line in it, either
//     way up, is not blank: judge the darkest pixels.
//   - "edge" as any darkening called a tone FADING IN struck. A strike is a THIN
//     line: measure each column's darkening against its neighbours', not by itself.
//   - "speckle" as spectral flatness called dull, low-passed hiss tonal, because a
//     band of noise low in the picture is a dark horizontal band. What separates
//     hiss from a held note is not where the ink is but its GRAIN: along a row, a
//     note is a smooth line and noise flickers. So speckle is the flicker of each
//     row around its own running median.
//
// Stripe direction is the median-filter trick from harmonic/percussive
// separation (Fitzgerald 2010): a median taken ALONG time keeps horizontal
// lines and erases vertical ones; a median taken ALONG frequency does the reverse.

const N = 1024; // window
const HOP = 256;
const TOP_HZ = 8000;
const RANGE_DB = 70;

function makeFft(size) {
  const bits = Math.log2(size);
  const rev = new Uint32Array(size);
  for (let i = 0; i < size; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); rev[i] = r; }
  const cos = new Float64Array(size / 2), sin = new Float64Array(size / 2), hann = new Float64Array(size);
  for (let i = 0; i < size / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / size); sin[i] = -Math.sin((2 * Math.PI * i) / size); }
  for (let i = 0; i < size; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  const re = new Float64Array(size), im = new Float64Array(size);
  return (x, start, out, bins) => {
    for (let i = 0; i < size; i++) { const k = start + i; re[rev[i]] = k >= 0 && k < x.length ? x[k] * hann[i] : 0; im[rev[i]] = 0; }
    for (let len = 2; len <= size; len <<= 1) {
      const step = size / len;
      for (let i = 0; i < size; i += len) for (let k = 0, t = 0; k < len / 2; k++, t += step) {
        const a = i + k, b = a + len / 2;
        const xr = re[b] * cos[t] - im[b] * sin[t], xi = re[b] * sin[t] + im[b] * cos[t];
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
      }
    }
    for (let i = 0; i < bins; i++) out[i] = Math.hypot(re[i], im[i]);
  };
}

// magnitude picture of x[from, from+len): frames x bins, row-major by frame
export function picture(x, sampleRate, from = 0, len = x.length - from) {
  const bins = Math.min(N / 2, Math.floor((TOP_HZ * N) / sampleRate));
  const frames = Math.max(1, Math.floor((len - N) / HOP) + 1);
  const mag = new Float32Array(frames * bins);
  const fft = makeFft(N);
  const row = new Float64Array(bins);
  for (let t = 0; t < frames; t++) { fft(x, from + t * HOP, row, bins); mag.set(row, t * bins); }
  return { mag, frames, bins, hzPerBin: sampleRate / N, secondsPerFrame: HOP / sampleRate };
}

function median(buf, n) {
  // insertion sort: n is 9..17, this beats Array.sort by a wide margin
  for (let i = 1; i < n; i++) { const v = buf[i]; let j = i - 1; while (j >= 0 && buf[j] > v) { buf[j + 1] = buf[j]; j--; } buf[j + 1] = v; }
  return buf[n >> 1];
}

// `exposure` is the magnitude that prints as full black. Use ONE exposure for a
// whole song (see exposureOf) so that ink is comparable between its seconds —
// a quiet second must look pale, not get its own auto-levels.
export function lookAt(pic, exposure) {
  const { mag, frames, bins, hzPerBin, secondsPerFrame } = pic;
  const lo = Math.max(1, Math.round(150 / hzPerBin));

  // --- ink and its height, on the dB picture a viewer sees
  let ink = 0, moment = 0;
  const hist = new Uint32Array(101);
  for (let t = 0; t < frames; t++) for (let f = lo; f < bins; f++) {
    const d = Math.max(0, Math.min(1, (20 * Math.log10(mag[t * bins + f] / exposure + 1e-9) + RANGE_DB) / RANGE_DB));
    ink += d; moment += d * f; hist[Math.round(d * 100)]++;
  }
  const cells = frames * (bins - lo);
  const height = ink > 0 ? (moment / ink - lo) / (bins - 1 - lo) : 0;
  ink /= cells;
  let inkMax = 0;
  for (let b = 100, seen = 0; b >= 0; b--) { seen += hist[b]; if (seen >= cells * 0.01) { inkMax = b / 100; break; } }

  // --- stripe direction
  const K = 8; // half-width of both medians: 17 frames (~136 ms) and 17 bins
  const buf = new Float64Array(2 * K + 1);
  let hor = 0, ver = 0, grain = 0, grainWeight = 0;
  for (let t = 0; t < frames; t++) for (let f = lo; f < bins; f++) {
    let n = 0;
    for (let k = Math.max(0, t - K); k <= Math.min(frames - 1, t + K); k++) buf[n++] = mag[k * bins + f];
    const h = median(buf, n);
    n = 0;
    for (let k = Math.max(lo, f - K); k <= Math.min(bins - 1, f + K); k++) buf[n++] = mag[t * bins + k];
    const p = median(buf, n);
    hor += h * h; ver += p * p;
    // grain: how far this cell sits from its row's running median, weighted by that median (where
    // the ink is). Bounded at twice the median: steady noise rarely strays further, while the
    // cells of one loud click stray a hundredfold — and one event is not a texture.
    if (h > exposure * 1e-3) { grain += Math.min(Math.abs(mag[t * bins + f] - h), 2 * h); grainWeight += h; }
  }
  const tonal = hor + ver > 0 ? hor / (hor + ver) : 0;
  const speckle = grainWeight > 0 ? grain / grainWeight : 0;

  // --- the sharpest vertical line: positive change from one column to the next
  const flux = new Float64Array(frames);
  for (let t = 1; t < frames; t++) {
    let s = 0;
    for (let f = lo; f < bins; f++) { const d = Math.log1p(mag[t * bins + f] * 1000 / exposure) - Math.log1p(mag[(t - 1) * bins + f] * 1000 / exposure); if (d > 0) s += d; }
    flux[t] = s / (bins - lo);
  }
  // a THIN line: each column's darkening, less the median darkening of the columns around it
  const R = 6;
  const thin = new Float64Array(frames);
  const around = new Float64Array(2 * R);
  for (let t = 1; t < frames; t++) {
    let n = 0;
    for (let k = Math.max(1, t - R); k <= Math.min(frames - 1, t + R); k++) if (k !== t) around[n++] = flux[k];
    thin[t] = flux[t] - (n ? median(around, n) : 0);
  }
  let cueFrame = frames > 1 ? 1 : 0;
  for (let t = 1; t < frames; t++) if (thin[t] > thin[cueFrame]) cueFrame = t;
  const edge = Math.max(0, thin[cueFrame]); // log-ink units per cell: comparable between seconds
  let edges = 0;
  for (let t = 1; t < frames - 1; t++) if (edge > 0 && thin[t] > 0.5 * edge && thin[t] >= thin[t - 1] && thin[t] >= thin[t + 1]) edges++;

  // --- left half vs right half
  const half = frames >> 1;
  let dot = 0, na = 0, nb = 0;
  for (let f = lo; f < bins; f++) {
    let a = 0, b = 0;
    for (let t = 0; t < half; t++) a += mag[t * bins + f];
    for (let t = half; t < frames; t++) b += mag[t * bins + f];
    dot += a * b; na += a * a; nb += b * b;
  }
  const change = na > 0 && nb > 0 ? 1 - dot / Math.sqrt(na * nb) : 0;

  // the loudest 200 ms stretch: where a held note is best read from
  const win = Math.max(1, Math.round(0.2 / secondsPerFrame));
  const energy = new Float64Array(frames);
  for (let t = 0; t < frames; t++) { let s = 0; for (let f = lo; f < bins; f++) s += mag[t * bins + f] ** 2; energy[t] = s; }
  let best = 0, run = 0, bestAt = 0;
  for (let t = 0; t < frames; t++) { run += energy[t]; if (t >= win) run -= energy[t - win]; if (t >= win - 1 && run > best) { best = run; bestAt = t - win + 1; } }

  return { ink, inkMax, height, tonal, edge, edges, cue: cueFrame * secondsPerFrame, speckle, change, body: bestAt * secondsPerFrame };
}

// The picture says WHICH column the line is in, and a column is 1024 samples
// wide: the line shows up as soon as a click enters the window, ~50 ms before the
// click itself (measured on the synthetic recording: every click found 0.052 s
// early). So the instant is found in the waveform: the steepest rise of
// short-time energy inside the span that column covers.
export function refineCue(x, sampleRate, coarse) {
  const win = Math.max(8, Math.round(0.003 * sampleRate));
  const hop = Math.max(1, Math.round(0.001 * sampleRate));
  const from = Math.max(0, Math.floor((coarse - 0.01) * sampleRate));
  const to = Math.min(x.length - win, Math.ceil((coarse + N / sampleRate + 0.01) * sampleRate));
  let best = -Infinity, at = coarse, prev = null;
  for (let i = from; i <= to; i += hop) {
    let e = 1e-12;
    for (let k = 0; k < win; k++) e += x[i + k] * x[i + k];
    const level = Math.log(e);
    if (prev !== null && level - prev > best) { best = level - prev; at = (i + win / 2) / sampleRate; }
    prev = level;
  }
  return at;
}

// One exposure for a whole recording: the 99.9th percentile magnitude, so a
// single loud click does not wash every other second out to white.
export function exposureOf(pics) {
  const sample = [];
  for (const p of pics) for (let i = 0; i < p.mag.length; i += 37) sample.push(p.mag[i]);
  sample.sort((a, b) => a - b);
  return Math.max(sample[Math.floor(sample.length * 0.999)] ?? 1, 1e-9);
}

// The picture as a small grey image (0 = paper, 1 = ink), for contact sheets.
export function thumbnail(pic, exposure, width, height) {
  const out = new Float32Array(width * height);
  for (let x = 0; x < width; x++) for (let y = 0; y < height; y++) {
    const t = Math.min(pic.frames - 1, Math.floor((x / width) * pic.frames));
    const f = Math.min(pic.bins - 1, Math.floor((1 - (y + 0.5) / height) * pic.bins));
    out[y * width + x] = Math.max(0, Math.min(1, (20 * Math.log10(pic.mag[t * pic.bins + f] / exposure + 1e-9) + RANGE_DB) / RANGE_DB));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Arranging. Three looks a voice can use, plus the seconds too pale to speak with:
//
//   struck   a vertical line stands out          -> syllables that open with a stop
//   wash     speckle, no stripes                 -> syllables that open with a hiss
//   tonal    horizontal stripes                  -> everything that opens softly
//   quiet    hardly any ink                      -> not used
//
// Scores are relative to the recording itself, because "a sharp edge" in a harp
// piece and in a drum track are different numbers: each measure is taken as
// how many TIMES its typical value it is (a log-ratio to the recording's median),
// scaled by how far that measure ranges in this recording (its 10th..90th
// percentile, in logs). Median-and-spread z-scores were tried first and broke on
// a recording made of distinct populations, where "the spread around the
// median" describes none of them.
// Within a look, seconds are ordered by HEIGHT: ink low in the picture first.
// ---------------------------------------------------------------------------
export const LOOKS = ['tonal', 'struck', 'wash'];

export function arrange(looks, { minPerLook = 4 } = {}) {
  const n = looks.length;
  if (!n) throw new Error('look: nothing to arrange');
  const FLOOR = 1e-4;
  const stat = (key, pool) => {
    const v = pool.map((l) => Math.log(Math.max(l[key], FLOOR))).sort((a, b) => a - b);
    const at = (q) => v[Math.min(v.length - 1, Math.floor(q * v.length))];
    return { med: at(0.5), range: Math.max(at(0.9) - at(0.1), 0.05) };
  };
  // the picture's black point is already this recording's own (exposureOf), so an
  // absolute bar is a relative one: nothing darker than ~50 dB below the loudest moments
  const QUIET_BAR = 0.3;
  const speaking = looks.filter((l) => l.inkMax >= QUIET_BAR);
  if (speaking.length < LOOKS.length * minPerLook) throw new Error(`look: only ${speaking.length} of ${n} seconds have enough ink to speak with; need at least ${LOOKS.length * minPerLook}`);

  const S = { edge: stat('edge', speaking), speckle: stat('speckle', speaking) };
  const z = (l, key) => (Math.log(Math.max(l[key], FLOOR)) - S[key].med) / S[key].range;
  const out = looks.map((l, index) => {
    if (l.inkMax < QUIET_BAR) return { ...l, index, look: 'quiet' };
    // grainy -> wash, smooth -> tonal, and either way a thin line that stands out further than that -> struck
    const score = { struck: z(l, 'edge'), wash: z(l, 'speckle'), tonal: -z(l, 'speckle') };
    const look = LOOKS.reduce((a, b) => (score[b] > score[a] ? b : a));
    return { ...l, index, look, score };
  });
  // a look nobody won outright still needs members: take the best-scoring from the largest look
  for (const want of LOOKS) {
    while (out.filter((l) => l.look === want).length < minPerLook) {
      const sizes = Object.fromEntries(LOOKS.map((k) => [k, out.filter((l) => l.look === k).length]));
      const donor = LOOKS.filter((k) => k !== want).sort((a, b) => sizes[b] - sizes[a])[0];
      const pick = out.filter((l) => l.look === donor).sort((a, b) => b.score[want] - a.score[want])[0];
      if (!pick) break;
      pick.look = want;
    }
  }
  const order = [...LOOKS, 'quiet'];
  out.sort((a, b) => order.indexOf(a.look) - order.indexOf(b.look) || a.height - b.height || a.index - b.index);
  return out;
}
