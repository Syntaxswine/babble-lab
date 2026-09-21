// A voice bank is made by LOOKING at a recording. To test the looking, this
// builds a "song" whose right answers are known: pieces that are pure held
// tones, pieces with one click at a known instant, pieces of steady noise, and
// pieces of near silence — shuffled, so the arranger has to find them. It is
// built at whatever piece length the test wants, because what holds for a
// second has to hold for a quarter of one.

import test from 'node:test';
import assert from 'node:assert/strict';
import { render, plan, makeBank, encodeBank, decodeBank, decodeWav, encodeWav, unarrange, recut, DEFAULT_PIECE } from '../src/index.mjs';
import { lookFor, brightnessOf, chooseSegment } from '../src/sampler.mjs';
import { mulberry32 } from '../src/rng.mjs';
import { rms, pitch } from '../tools/analyze.mjs';

const PER = 12;

// unit: seconds per piece. sr: real banks are 32 kHz; the one-second fixture uses 16 kHz to stay quick.
function fakeSong({ tonesArePure = false, unit = 1, sr = 16000 } = {}) {
  const n = Math.round(unit * sr);
  const r = mulberry32(7);
  const noise = () => r() * 2 - 1;
  const pieces = [];
  const hump = (i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n); // no edges: rises and falls across the whole piece
  for (let k = 0; k < PER; k++) {
    // held tone; its harmonics peak higher as k grows, so the ink climbs the picture
    const x = new Float32Array(n);
    const f0 = tonesArePure ? 200 + 20 * k : 110;
    const peak = 300 + 330 * k;
    for (let i = 0; i < n; i++) {
      let s = 0;
      if (tonesArePure) s = Math.sin((2 * Math.PI * f0 * i) / sr);
      else for (let h = 1; h * f0 < 7000; h++) s += Math.exp(-(((h * f0 - peak) / 700) ** 2)) * Math.sin((2 * Math.PI * h * f0 * i) / sr);
      x[i] = s * (tonesArePure ? 1 : hump(i));
    }
    let top = 0;
    for (const v of x) top = Math.max(top, Math.abs(v));
    for (let i = 0; i < n; i++) x[i] *= 0.4 / top; // stay well inside 16 bits
    pieces.push({ kind: 'tonal', k, x });
  }
  for (let k = 0; k < PER; k++) {
    // a soft bed and ONE click at a known instant
    const at = unit * (0.1 + 0.06 * k);
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / sr - at;
      x[i] = 0.03 * Math.sin((2 * Math.PI * 180 * i) / sr) * hump(i) + (t >= 0 ? 0.8 * noise() * Math.exp(-t / 0.012) : 0);
    }
    pieces.push({ kind: 'struck', k, at, x });
  }
  for (let k = 0; k < PER; k++) {
    // steady hiss, darker to brighter: a one-pole low-pass that opens as k grows
    const x = new Float32Array(n);
    const a = Math.exp((-2 * Math.PI * (500 + 550 * k)) / sr);
    let y = 0;
    for (let i = 0; i < n; i++) { y = (1 - a) * noise() + a * y; x[i] = y; }
    const level = rms(x);
    for (let i = 0; i < n; i++) x[i] *= (0.12 / level) * (0.6 + 0.4 * hump(i));
    pieces.push({ kind: 'wash', k, x });
  }
  for (let k = 0; k < 3; k++) { const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = 1e-4 * noise(); pieces.push({ kind: 'quiet', k, x }); }
  for (let i = pieces.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pieces[i], pieces[j]] = [pieces[j], pieces[i]]; }
  const all = new Float32Array(pieces.length * n);
  pieces.forEach((s, i) => all.set(s.x, i * n));
  return { samples: all, truth: pieces, sr, unit };
}

for (const [label, shape] of [['one-second pieces', { unit: 1, sr: 16000 }], ['quarter-second pieces', { unit: 0.25, sr: 32000 }]]) {
  test(`arranging by look, ${label}: tones, clicks, hiss and silence are told apart and ordered by where their ink sits`, () => {
    const { samples, truth, sr, unit } = fakeSong(shape);
    const bank = makeBank(samples, sr, { name: 'fake', segmentSeconds: unit });
    assert.equal(bank.segments.length, truth.length);
    const wrong = bank.segments.filter((s) => s.look !== truth[s.origin].kind).map((s) => `piece ${s.origin}: built as ${truth[s.origin].kind}, seen as ${s.look}`);
    assert.deepEqual(wrong, [], wrong.join('; '));
    for (const s of bank.segments) if (s.look === 'struck') assert.ok(Math.abs(s.cue - truth[s.origin].at) < 0.02, `click at ${truth[s.origin].at.toFixed(3)} s found at ${s.cue.toFixed(3)} s`);
    for (const look of ['tonal', 'wash']) {
      const order = bank.looks[look].map((i) => truth[bank.segments[i].origin].k);
      assert.deepEqual(order, [...order].sort((a, b) => a - b), `${look} pieces are not in dull-to-bright order: ${order.join(' ')}`);
    }
    for (const look of Object.keys(bank.looks)) { const h = bank.looks[look].map((i) => bank.segments[i].height); for (let k = 1; k < h.length; k++) assert.ok(h[k] >= h[k - 1]); }
  });
}

test('the default piece is a quarter of a second', () => {
  assert.equal(DEFAULT_PIECE, 0.25);
  const { samples, sr } = fakeSong({ unit: 0.25, sr: 32000 });
  assert.equal(makeBank(samples, sr).segmentSeconds, 0.25);
});

test('a bank is one WAV: playable as it is, and it carries its own index', () => {
  const { samples, sr } = fakeSong();
  const bank = makeBank(samples, sr, { name: 'fake', note: 'test tones, no rights reserved', segmentSeconds: 1 });
  const bytes = encodeBank(bank);
  const asWav = decodeWav(bytes); // any player can read it
  assert.equal(asWav.sampleRate, sr);
  assert.equal(asWav.samples.length, bank.segments.length * sr);
  assert.ok(asWav.chunks.bblb, 'the index chunk is missing');
  const back = decodeBank(bytes);
  assert.equal(back.name, 'fake');
  assert.equal(back.note, 'test tones, no rights reserved');
  assert.deepEqual(back.looks, bank.looks);
  back.segments.forEach((s, i) => {
    assert.equal(s.origin, bank.segments[i].origin);
    assert.equal(s.cue, bank.segments[i].cue);
    for (let k = 0; k < sr; k += 53) assert.ok(Math.abs(s.samples[k] - bank.segments[i].samples[k]) < 1 / 16000);
  });
  // the audio really is in arranged order: the first piece of the file is the first "tonal" one
  assert.equal(back.segments[0].look, 'tonal');

  // the first banks called a piece's origin `second`: they still load
  const index = JSON.parse(new TextDecoder().decode(asWav.chunks.bblb));
  index.segments = index.segments.map(({ origin, ...rest }) => ({ ...rest, second: origin }));
  const old = decodeBank(encodeWav(asWav.samples, sr, { chunks: { bblb: new TextEncoder().encode(JSON.stringify(index)) } }));
  assert.deepEqual(old.segments.map((s) => s.origin), bank.segments.map((s) => s.origin));
});

test('a bank can be un-arranged, and cut again at another length', () => {
  const { samples, sr } = fakeSong({ unit: 0.25, sr: 32000 });
  const bank = makeBank(samples, sr, { name: 'fake', segmentSeconds: 0.25 });
  const original = unarrange(bank);
  assert.equal(original.length, samples.length);
  assert.ok(original.every((v, i) => v === samples[i]), 'un-arranging did not give the recording back');
  // through the file as well: what was saved can be cut again
  const reloaded = decodeBank(encodeBank(bank));
  const halves = recut(reloaded, 0.5);
  assert.equal(halves.segmentSeconds, 0.5);
  assert.equal(halves.segments.length, Math.floor(samples.length / (0.5 * sr)));
  assert.deepEqual(halves.segments.map((s) => [s.origin, s.look]), makeBank(unarrange(reloaded), sr, { segmentSeconds: 0.5 }).segments.map((s) => [s.origin, s.look]));
});

test('making a bank refuses what it cannot arrange', () => {
  const SR = 16000;
  assert.throws(() => makeBank(new Float32Array(SR * 5), SR, { segmentSeconds: 1 }), /need at least 12/);
  assert.throws(() => makeBank(new Float32Array(SR * 40), SR), /enough ink to speak with/);
  assert.throws(() => makeBank(new Float32Array(SR * 40), SR, { segmentSeconds: 0.01 }), /cannot be looked at/);
  assert.throws(() => decodeBank(encodeWav(new Float32Array(100), SR)), /no babble-lab index/);
  assert.throws(() => decodeBank(new Uint8Array(64)), /not a WAV/);
});

test('which piece a syllable takes: manner picks the look, the vowel picks how bright', () => {
  assert.equal(lookFor({ phones: ['T', 'UW'] }), 'struck');
  assert.equal(lookFor({ phones: ['CH', 'IY', 'Z'] }), 'struck');
  assert.equal(lookFor({ phones: ['S', 'IY'] }), 'wash');
  assert.equal(lookFor({ phones: ['HH', 'AA'] }), 'wash');
  assert.equal(lookFor({ phones: ['M', 'AY'] }), 'tonal');
  assert.equal(lookFor({ phones: ['AA'] }), 'tonal');
  assert.ok(brightnessOf({ phones: ['IY'] }) > brightnessOf({ phones: ['EH'] }));
  assert.ok(brightnessOf({ phones: ['EH'] }) > brightnessOf({ phones: ['AA'] }));
  assert.ok(brightnessOf({ phones: ['AA'] }) > brightnessOf({ phones: ['UW'] }));

  const { samples, sr } = fakeSong();
  const bank = makeBank(samples, sr, { name: 'fake', segmentSeconds: 1 });
  const bright = chooseSegment(bank, { phones: ['M', 'IY'] }, 'me', 0);
  const dull = chooseSegment(bank, { phones: ['M', 'UW'] }, 'moo', 0);
  assert.equal(bank.segments[bright].look, 'tonal');
  assert.ok(bank.segments[bright].height > bank.segments[dull].height, '"me" did not take a brighter piece than "moo"');
  assert.equal(chooseSegment(bank, { phones: ['M', 'IY'] }, 'me', 0), bright, 'the same word took a different piece');
  assert.deepEqual(render('To see me.', {}, { bank }).used.map((u) => u.look), ['struck', 'wash', 'tonal']);
});

test('speaking with a bank keeps the contract: finite, bounded, on the plan, repeatable', () => {
  for (const shape of [{ unit: 1, sr: 16000 }, { unit: 0.25, sr: 32000 }]) {
    const { samples, sr, unit } = fakeSong(shape);
    const bank = makeBank(samples, sr, { name: 'fake', segmentSeconds: unit });
    for (const voice of [{}, { pitch: 280 }, { mode: 'letter', pitch: 300, rate: 1.2 }, { mode: 'blip', pitch: 200 }, { pitch: 70, rate: 0.6, fx: { echo: 0.4 } }]) {
      const { samples: out, plan: p, sampleRate } = render('Wait. I found it, the key! Go now.', voice, { bank });
      let peak = 0;
      for (const s of out) { assert.ok(Number.isFinite(s)); peak = Math.max(peak, Math.abs(s)); }
      assert.ok(peak < 1 && peak > 0.02, `peak ${peak}`);
      if (!voice.fx) for (const u of p.units) if (u.kind === 'rest' && u.t1 - u.t0 >= 0.12) assert.ok(rms(out, (u.t0 + 0.04) * sampleRate, (u.t1 - 0.02) * sampleRate) < 0.004, `pause at ${u.t0.toFixed(2)} s is not silent`);
      const again = render('Wait. I found it, the key! Go now.', voice, { bank }).samples;
      assert.ok(out.every((s, i) => s === again[i]), 'two renders differ');
    }
  }
});

test('with a bank, pitch is tape speed and the melody of the line bends it', () => {
  // pure-tone pieces, so the output has a pitch a tracker can follow
  const { samples, sr } = fakeSong({ tonesArePure: true });
  const bank = makeBank(samples, sr, { name: 'tones', segmentSeconds: 1 });
  const say = (text, voice) => {
    const r = render(text, { lilt: 0, vibDepth: 0, ...voice }, { bank, sampleRate: 44100 });
    const u = r.plan.units.filter((q) => q.kind === 'syl').pop();
    const w = Math.min(0.05, (u.t1 - u.t0) / 3);
    const early = pitch(r.samples, 44100, u.t0 + 0.02, u.t0 + 0.02 + w, 80, 2000).f0;
    const late = pitch(r.samples, 44100, u.t1 - 0.035 - w, u.t1 - 0.035, 80, 2000).f0;
    return { early, late };
  };
  // "oh" is a bare vowel: it takes a tonal (pure tone) piece
  const q = say('Oh?', { range: 8 });
  const s = say('Oh.', { range: 8 });
  assert.ok(q.late / q.early > 1.12, `question: ${q.early.toFixed(1)} -> ${q.late.toFixed(1)} Hz`);
  assert.ok(s.late / s.early < 0.93, `statement: ${s.early.toFixed(1)} -> ${s.late.toFixed(1)} Hz`);
  const flat = say('Oh?', { range: 0 });
  assert.ok(Math.abs(flat.late / flat.early - 1) < 0.02, `range 0 but the tape still bent: ${flat.early.toFixed(1)} -> ${flat.late.toFixed(1)}`);
  const slow = say('Oh.', { range: 0, pitch: 140 });
  const fast = say('Oh.', { range: 0, pitch: 280 });
  assert.ok(Math.abs(fast.early / slow.early - 2) < 0.06, `pitch 280 should be an octave over pitch 140: ${slow.early.toFixed(1)} -> ${fast.early.toFixed(1)} Hz`);
});

test('a syllable longer than its piece reads on into the piece that FOLLOWED it in the recording', () => {
  // A recording that climbs: quarter-second piece number o is a steady tone at 300 + 20*o Hz.
  // Wherever a read starts, a quarter-second later it must be 20 Hz higher — not silent, not
  // looping, and not whatever piece happens to sit next in the ARRANGED order.
  const sr = 32000, n = sr / 4, count = 48;
  const x = new Float32Array(count * n);
  let phase = 0;
  for (let o = 0; o < count; o++) for (let i = 0; i < n; i++) { phase += (2 * Math.PI * (300 + 20 * o)) / sr; x[o * n + i] = 0.4 * Math.sin(phase); }
  const bank = makeBank(x, sr, { name: 'stairs', segmentSeconds: 0.25 });
  // the arrangement really did move things: otherwise "next in the file" and "next in the recording" are the same test
  assert.ok(bank.segments.some((s, i) => i + 1 < bank.segments.length && bank.segments[i + 1].origin !== s.origin + 1), 'the fixture was not re-ordered by arranging');

  const r = render('Oh.', { rate: 0.4, range: 0, lilt: 0, vibDepth: 0, pitch: 140 }, { bank, sampleRate: 44100 });
  const u = r.plan.units.find((q) => q.kind === 'syl');
  const took = r.used[0];
  assert.ok(u.t1 - u.t0 > 0.45, `the test needs a long syllable; got ${(u.t1 - u.t0).toFixed(2)} s`);
  assert.ok(took.pieces >= 2, `the read stayed inside one piece (${took.pieces})`);
  const hzAt = (seconds) => 300 + 20 * Math.floor((took.time + seconds) / 0.25); // what the RECORDING holds there
  for (const into of [0.06, 0.2, 0.34]) {
    const got = pitch(r.samples, 44100, u.t0 + into - 0.02, u.t0 + into + 0.02, 150, 3000).f0;
    const near = [hzAt(into - 0.02), hzAt(into + 0.02)]; // a window may straddle a step
    assert.ok(near.some((hz) => Math.abs(got / hz - 1) < 0.03), `${into} s into the syllable: heard ${got.toFixed(1)} Hz, the recording holds ${near.join(' / ')} Hz there`);
  }
  assert.ok(rms(r.samples, (u.t0 + 0.3) * 44100, (u.t0 + 0.4) * 44100) > 0.03, 'the syllable fell silent when its first piece ran out');
});

test('a voice that names a bank refuses to speak without it', () => {
  assert.throws(() => render('Hello', { bank: 'glades' }), /bank "glades", which was not supplied/);
  assert.equal(plan('Hello', { bank: 'glades' }).voice.bank, 'glades');
  const { samples, sr } = fakeSong();
  const bank = makeBank(samples, sr, { name: 'fake', segmentSeconds: 1 });
  assert.ok(render('Hello', { bank: 'fake' }, { banks: { fake: bank } }).used.length > 0);
});
