// A voice bank: a recording cut into equal segments and arranged by how each
// one LOOKS (look.mjs). It is one file, and that file is an ordinary WAV —
//
//   play it      and you hear the arrangement: the recording re-ordered look by
//                look, dull to bright within each
//   load it      and the 'bblb' chunk inside says which second is which, so a
//                voice can speak with it (sampler.mjs)
//
// PCM, not mp3/ogg, on purpose: compressed decoders differ between platforms,
// and "same text, same voice -> same samples" has to hold for bank voices too.

import { encodeWav, decodeWav } from './wav.mjs';
import { picture, lookAt, exposureOf, arrange, refineCue, LOOKS } from './look.mjs';

export const BANK_RMS = 0.14; // what every segment is levelled toward: the synth's own vowel level
const CHUNK = 'bblb';

const rmsOf = (x) => { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, x.length)); };

// samples (mono Float32Array) -> a bank object, segments in arranged order
export function makeBank(samples, sampleRate, { name = 'bank', segmentSeconds = 1, source = null, note = null } = {}) {
  const len = Math.round(segmentSeconds * sampleRate);
  const count = Math.floor(samples.length / len);
  if (count < 12) throw new Error(`bank: ${(samples.length / sampleRate).toFixed(1)} s of audio makes ${count} segments of ${segmentSeconds} s; need at least 12`);
  const pics = [];
  for (let k = 0; k < count; k++) pics.push(picture(samples, sampleRate, k * len, len));
  const exposure = exposureOf(pics);
  const arranged = arrange(pics.map((p) => lookAt(p, exposure)));
  const round = (v, d = 4) => +v.toFixed(d);
  const segments = arranged.map((l) => {
    const pcm = samples.subarray(l.index * len, (l.index + 1) * len);
    const level = rmsOf(pcm);
    return {
      samples: pcm, look: l.look, second: l.index, // `second`: where it sat in the original recording
      ink: round(l.ink), inkMax: round(l.inkMax), height: round(l.height), tonal: round(l.tonal), edge: round(l.edge), edges: l.edges,
      speckle: round(l.speckle), change: round(l.change), cue: round(refineCue(pcm, sampleRate, l.cue), 3), body: round(l.body, 3),
      gain: round(level > 1e-5 ? Math.min(4, Math.max(0.25, BANK_RMS / level)) : 0, 3),
    };
  });
  return finishBank({ name, source, note, sampleRate, segmentSeconds, exposure, segments });
}

function finishBank(bank) {
  bank.looks = Object.fromEntries([...LOOKS, 'quiet'].map((k) => [k, []]));
  bank.segments.forEach((s, i) => bank.looks[s.look]?.push(i));
  for (const k of LOOKS) if (!bank.looks[k].length) throw new Error(`bank "${bank.name}": no "${k}" segments — it cannot speak`);
  return bank;
}

export function encodeBank(bank) {
  const len = bank.segments[0].samples.length;
  const all = new Float32Array(len * bank.segments.length);
  bank.segments.forEach((s, i) => all.set(s.samples, i * len));
  const index = {
    babbleBank: 1, name: bank.name, source: bank.source, note: bank.note, segmentSeconds: bank.segmentSeconds, exposure: bank.exposure,
    segments: bank.segments.map(({ samples, ...rest }) => rest),
  };
  return encodeWav(all, bank.sampleRate, { chunks: { [CHUNK]: new TextEncoder().encode(JSON.stringify(index)) } });
}

export function decodeBank(bytes) {
  const wav = decodeWav(bytes);
  const raw = wav.chunks[CHUNK];
  if (!raw) throw new Error('bank: this WAV has no babble-lab index in it — make one with "babble bank <audio>"');
  let index;
  try { index = JSON.parse(new TextDecoder().decode(raw)); } catch { throw new Error('bank: the index inside this WAV is not readable'); }
  if (index.babbleBank !== 1 || !Array.isArray(index.segments)) throw new Error('bank: unknown bank format');
  const len = Math.round(index.segmentSeconds * wav.sampleRate);
  if (index.segments.length * len > wav.samples.length) throw new Error(`bank: index lists ${index.segments.length} segments but the audio holds ${Math.floor(wav.samples.length / len)}`);
  return finishBank({
    name: index.name, source: index.source, note: index.note, sampleRate: wav.sampleRate, segmentSeconds: index.segmentSeconds, exposure: index.exposure,
    segments: index.segments.map((s, i) => ({ ...s, samples: wav.samples.subarray(i * len, (i + 1) * len) })),
  });
}
