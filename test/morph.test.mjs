import test from 'node:test';
import assert from 'node:assert/strict';
import { morphTimbre, padMorphSources } from '../tools/morph-audio.mjs';
import { rms, pitch, bandRatioDb } from '../tools/analyze.mjs';

const sr = 16000;
const options = { windowSize: 1024, hopSize: 128, envelopeMs: 1 };
const maxDifference = (a, b) => a.reduce((m, x, i) => Math.max(m, Math.abs(x - b[i])), 0);
const tone = (hz = 250) => Float32Array.from({ length: sr }, (_, i) => 0.2 * Math.sin(2 * Math.PI * hz * i / sr));

test('alignment pads only the shorter tail and preserves the sample clock and inputs', () => {
  const short = new Float32Array([0, 0.2, -0.3]), long = new Float32Array([0, 0.4, -0.2, 0.1, 0]);
  const before = short.slice();
  for (const tracks of [[short, long], [long, short]]) {
    const padded = padMorphSources(...tracks);
    for (let i = 0; i < tracks.length; i++) {
      assert.equal(padded[i].length, long.length);
      assert.deepEqual(padded[i].subarray(0, tracks[i].length), tracks[i]);
      assert.ok(padded[i].subarray(tracks[i].length).every((x) => x === 0));
    }
  }
  assert.deepEqual(short, before);
  assert.equal(padMorphSources(short, short)[0], short);
  assert.throws(() => padMorphSources(new Float32Array(), long), /nonempty/);
});

test('timbre morph preserves the carrier for zero amount, identical colour and inverted colour', () => {
  const a = tone(), b = tone(400), before = a.slice();
  for (const [colour, amount] of [[b, 0], [a, 0.5], [Float32Array.from(a, (x) => -x), 0.5]]) {
    const r = morphTimbre(a, colour, sr, { ...options, amount });
    assert.equal(r.samples.length, a.length);
    assert.ok(maxDifference(r.samples, a) < 1e-6, 'phase inversion must not cancel the carrier as a waveform average would');
  }
  assert.deepEqual(a, before, 'input was modified');
});

test('halfway colour shifts harmonic balance toward the donor while preserving carrier pitch', () => {
  const a = new Float32Array(sr), b = new Float32Array(sr);
  for (let i = 0; i < sr; i++) for (let h = 1; h <= 24; h++) {
    const phase = 2 * Math.PI * 125 * h * i / sr;
    const colour = Math.exp(-(((h * 125 - 2500) / 1000) ** 2));
    a[i] += 0.015 * Math.sin(phase);
    b[i] += 0.015 * (0.1 + 4 * colour) * Math.sin(phase + h * 0.3);
  }
  const sourceRatio = bandRatioDb(a, sr, 0.2, 0.8, 2500, 500, 30);
  const full = morphTimbre(a, b, sr, { ...options, amount: 1 }).samples;
  const half = morphTimbre(a, b, sr, options).samples;
  const fullRatio = bandRatioDb(full, sr, 0.2, 0.8, 2500, 500, 30);
  const halfRatio = bandRatioDb(half, sr, 0.2, 0.8, 2500, 500, 30);
  assert.ok(fullRatio > sourceRatio + 10, 'donor did not change the colour');
  assert.ok(Math.abs(halfRatio - (sourceRatio + fullRatio) / 2) < 1, 'not approximately halfway in dB');
  assert.ok(Math.abs(pitch(half, sr, 0.2, 0.8, 80, 180).f0 - 125) < 1);
  assert.deepEqual(half, morphTimbre(a, b, sr, options).samples);
});

test('silence is safe; cue gating keeps the original duration and empty pauses', () => {
  const a = tone(), silent = new Float32Array(a.length);
  assert.equal(rms(morphTimbre(silent, a, sr, options).samples), 0);
  assert.ok(maxDifference(morphTimbre(a, silent, sr, options).samples, a) < 1e-6);
  const r = morphTimbre(a, tone(400), sr, { ...options, cues: [[0.1, 0.3], [0.5, 0.8]] });
  assert.equal(r.samples.length, a.length);
  for (const [from, to] of [[0, 0.1], [0.3, 0.5], [0.8, 1]]) assert.equal(rms(r.samples, from * sr, to * sr), 0);
  assert.ok(rms(r.samples, 0.12 * sr, 0.28 * sr) > 0.01);
  assert.ok(r.samples.every(x => Number.isFinite(x) && Math.abs(x) <= 0.9001));
});

test('morph rejects incompatible tracks and settings before transforming them', () => {
  const a = tone();
  assert.throws(() => morphTimbre(a, new Float32Array(2), sr), /equally long/);
  assert.throws(() => morphTimbre(a, Float32Array.from(a, () => NaN), sr), /finite/);
  for (const bad of [{ amount: -1 }, { amount: NaN }, { windowSize: 500 }, { hopSize: 999 }, { envelopeMs: 0 }, { peakLimit: 2 }, { cues: [[0.2, 0.4], [0.3, 0.5]] }]) assert.throws(() => morphTimbre(a, a, sr, bad), /morph:/);
});
