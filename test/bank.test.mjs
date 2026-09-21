// A voice bank is made by LOOKING at a recording. To test the looking, this
// builds a "song" whose right answers are known: seconds that are pure held
// tones, seconds with one click at a known instant, seconds of steady noise,
// and seconds of near silence — shuffled, so the arranger has to find them.

import test from 'node:test';
import assert from 'node:assert/strict';
import { render, plan, makeBank, encodeBank, decodeBank, decodeWav, encodeWav } from '../src/index.mjs';
import { lookFor, brightnessOf, chooseSegment } from '../src/sampler.mjs';
import { mulberry32 } from '../src/rng.mjs';
import { rms, pitch } from '../tools/analyze.mjs';

const SR = 16000;
const PER = 12;

function fakeSong({ tonesArePure = false } = {}) {
  const r = mulberry32(7);
  const noise = () => r() * 2 - 1;
  const seconds = [];
  const hump = (i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / SR); // no edges: rises and falls across the whole second
  for (let k = 0; k < PER; k++) {
    // held tone; its harmonics peak higher as k grows, so the ink climbs the picture
    const x = new Float32Array(SR);
    const f0 = tonesArePure ? 200 + 20 * k : 110;
    const peak = 300 + 330 * k;
    for (let i = 0; i < SR; i++) {
      let s = 0;
      if (tonesArePure) s = Math.sin((2 * Math.PI * f0 * i) / SR);
      else for (let h = 1; h * f0 < 7000; h++) s += Math.exp(-(((h * f0 - peak) / 700) ** 2)) * Math.sin((2 * Math.PI * h * f0 * i) / SR);
      x[i] = s * (tonesArePure ? 1 : hump(i));
    }
    let top = 0;
    for (const v of x) top = Math.max(top, Math.abs(v));
    for (let i = 0; i < SR; i++) x[i] *= 0.4 / top; // stay well inside 16 bits
    seconds.push({ kind: 'tonal', k, x });
  }
  for (let k = 0; k < PER; k++) {
    // a soft bed and ONE click at a known instant
    const at = 0.1 + 0.06 * k;
    const x = new Float32Array(SR);
    for (let i = 0; i < SR; i++) {
      const t = i / SR - at;
      x[i] = 0.03 * Math.sin((2 * Math.PI * 180 * i) / SR) * hump(i) + (t >= 0 ? 0.8 * noise() * Math.exp(-t / 0.012) : 0);
    }
    seconds.push({ kind: 'struck', k, at, x });
  }
  for (let k = 0; k < PER; k++) {
    // steady hiss, darker to brighter: a one-pole low-pass that opens as k grows
    const x = new Float32Array(SR);
    const a = Math.exp((-2 * Math.PI * (500 + 550 * k)) / SR);
    let y = 0;
    for (let i = 0; i < SR; i++) { y = (1 - a) * noise() + a * y; x[i] = y; }
    const level = rms(x);
    for (let i = 0; i < SR; i++) x[i] *= (0.12 / level) * (0.6 + 0.4 * hump(i));
    seconds.push({ kind: 'wash', k, x });
  }
  for (let k = 0; k < 3; k++) { const x = new Float32Array(SR); for (let i = 0; i < SR; i++) x[i] = 1e-4 * noise(); seconds.push({ kind: 'quiet', k, x }); }
  // shuffle
  for (let i = seconds.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [seconds[i], seconds[j]] = [seconds[j], seconds[i]]; }
  const all = new Float32Array(seconds.length * SR);
  seconds.forEach((s, i) => all.set(s.x, i * SR));
  return { samples: all, truth: seconds };
}

test('arranging by look: held tones, clicks, hiss and silence are told apart, and ordered by where their ink sits', () => {
  const { samples, truth } = fakeSong();
  const bank = makeBank(samples, SR, { name: 'fake' });
  assert.equal(bank.segments.length, truth.length);
  const wrong = bank.segments.filter((s) => s.look !== truth[s.second].kind).map((s) => `second ${s.second}: built as ${truth[s.second].kind}, seen as ${s.look}`);
  assert.deepEqual(wrong, [], wrong.join('; '));
  for (const s of bank.segments) if (s.look === 'struck') assert.ok(Math.abs(s.cue - truth[s.second].at) < 0.02, `click at ${truth[s.second].at.toFixed(3)} s found at ${s.cue.toFixed(3)} s`);
  for (const look of ['tonal', 'wash']) {
    const order = bank.looks[look].map((i) => truth[bank.segments[i].second].k);
    assert.deepEqual(order, [...order].sort((a, b) => a - b), `${look} seconds are not in dull-to-bright order: ${order.join(' ')}`);
  }
  for (const look of Object.keys(bank.looks)) { const h = bank.looks[look].map((i) => bank.segments[i].height); for (let k = 1; k < h.length; k++) assert.ok(h[k] >= h[k - 1]); }
});

test('a bank is one WAV: playable as it is, and it carries its own index', () => {
  const { samples } = fakeSong();
  const bank = makeBank(samples, SR, { name: 'fake', note: 'test tones, no rights reserved' });
  const bytes = encodeBank(bank);
  const asWav = decodeWav(bytes); // any player can read it
  assert.equal(asWav.sampleRate, SR);
  assert.equal(asWav.samples.length, bank.segments.length * SR);
  assert.ok(asWav.chunks.bblb, 'the index chunk is missing');
  const back = decodeBank(bytes);
  assert.equal(back.name, 'fake');
  assert.equal(back.note, 'test tones, no rights reserved');
  assert.deepEqual(back.looks, bank.looks);
  back.segments.forEach((s, i) => {
    assert.equal(s.second, bank.segments[i].second);
    assert.equal(s.cue, bank.segments[i].cue);
    for (let k = 0; k < SR; k += 53) assert.ok(Math.abs(s.samples[k] - bank.segments[i].samples[k]) < 1 / 16000);
  });
  // the audio really is in arranged order: segment 0 of the file is the first "tonal" second
  assert.equal(back.segments[0].look, 'tonal');
});

test('making a bank refuses what it cannot arrange', () => {
  assert.throws(() => makeBank(new Float32Array(SR * 5), SR), /need at least 12/);
  assert.throws(() => makeBank(new Float32Array(SR * 40), SR), /enough ink to speak with/);
  assert.throws(() => decodeBank(encodeWav(new Float32Array(100), SR)), /no babble-lab index/);
  assert.throws(() => decodeBank(new Uint8Array(64)), /not a WAV/);
});

test('which second a syllable takes: manner picks the look, the vowel picks how bright', () => {
  assert.equal(lookFor({ phones: ['T', 'UW'] }), 'struck');
  assert.equal(lookFor({ phones: ['CH', 'IY', 'Z'] }), 'struck');
  assert.equal(lookFor({ phones: ['S', 'IY'] }), 'wash');
  assert.equal(lookFor({ phones: ['HH', 'AA'] }), 'wash');
  assert.equal(lookFor({ phones: ['M', 'AY'] }), 'tonal');
  assert.equal(lookFor({ phones: ['AA'] }), 'tonal');
  assert.ok(brightnessOf({ phones: ['IY'] }) > brightnessOf({ phones: ['EH'] }));
  assert.ok(brightnessOf({ phones: ['EH'] }) > brightnessOf({ phones: ['AA'] }));
  assert.ok(brightnessOf({ phones: ['AA'] }) > brightnessOf({ phones: ['UW'] }));

  const bank = makeBank(fakeSong().samples, SR, { name: 'fake' });
  const bright = chooseSegment(bank, { phones: ['M', 'IY'] }, 'me', 0);
  const dull = chooseSegment(bank, { phones: ['M', 'UW'] }, 'moo', 0);
  assert.equal(bank.segments[bright].look, 'tonal');
  assert.ok(bank.segments[bright].height > bank.segments[dull].height, '"me" did not take a brighter second than "moo"');
  assert.equal(chooseSegment(bank, { phones: ['M', 'IY'] }, 'me', 0), bright, 'the same word took a different second');

  const r = render('To see me.', {}, { bank });
  const looks = r.used.map((u) => u.look);
  assert.deepEqual(looks, ['struck', 'wash', 'tonal']);
});

test('speaking with a bank keeps the contract: finite, bounded, on the plan, repeatable', () => {
  const bank = makeBank(fakeSong().samples, SR, { name: 'fake' });
  for (const voice of [{}, { pitch: 280 }, { mode: 'letter', pitch: 300, rate: 1.2 }, { mode: 'blip', pitch: 200 }, { pitch: 70, rate: 0.6, fx: { echo: 0.4 } }]) {
    const { samples, plan: p, sampleRate } = render('Wait. I found it, the key! Go now.', voice, { bank });
    let peak = 0;
    for (const s of samples) { assert.ok(Number.isFinite(s)); peak = Math.max(peak, Math.abs(s)); }
    assert.ok(peak < 1 && peak > 0.02, `peak ${peak}`);
    if (!voice.fx) for (const u of p.units) {
      if (u.kind === 'rest') { if (u.t1 - u.t0 >= 0.12) assert.ok(rms(samples, (u.t0 + 0.04) * sampleRate, (u.t1 - 0.02) * sampleRate) < 0.004, `pause at ${u.t0.toFixed(2)} s is not silent`); }
      else if (!u.silent) assert.ok(rms(samples, u.t0 * sampleRate, u.t1 * sampleRate) > 0.004, `"${u.label}" at ${u.t0.toFixed(2)} s is inaudible`);
    }
    const again = render('Wait. I found it, the key! Go now.', voice, { bank }).samples;
    assert.ok(samples.every((s, i) => s === again[i]), 'two renders differ');
  }
});

test('with a bank, pitch is tape speed and the melody of the line bends it', () => {
  // pure-tone seconds, so the output has a pitch a tracker can follow
  const bank = makeBank(fakeSong({ tonesArePure: true }).samples, SR, { name: 'tones' });
  const say = (text, voice) => {
    const r = render(text, { lilt: 0, vibDepth: 0, ...voice }, { bank, sampleRate: 44100 });
    const u = r.plan.units.filter((q) => q.kind === 'syl').pop();
    const seg = bank.segments[r.used[r.used.length - 1].segment];
    const w = Math.min(0.05, (u.t1 - u.t0) / 3);
    const early = pitch(r.samples, 44100, u.t0 + 0.02, u.t0 + 0.02 + w, 80, 2000).f0;
    const late = pitch(r.samples, 44100, u.t1 - 0.035 - w, u.t1 - 0.035, 80, 2000).f0;
    return { early, late, native: 200 + 20 * (seg.second !== undefined ? fakeTruthK(bank, seg) : 0) };
  };
  // "oh" is a bare vowel: it takes a tonal (pure tone) second
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
function fakeTruthK() { return 0; } // native pitch is not needed by the assertions above; kept for the debug print

test('a voice that names a bank refuses to speak without it', () => {
  assert.throws(() => render('Hello', { bank: 'glades' }), /bank "glades", which was not supplied/);
  assert.equal(plan('Hello', { bank: 'glades' }).voice.bank, 'glades');
  const bank = makeBank(fakeSong().samples, SR, { name: 'fake' });
  assert.ok(render('Hello', { bank: 'fake' }, { banks: { fake: bank } }).used.length > 0);
});
