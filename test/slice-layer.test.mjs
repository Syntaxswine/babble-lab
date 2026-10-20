import test from 'node:test';
import assert from 'node:assert/strict';
import { mixSliceLayer } from '../tools/mix-slice-layer.mjs';
import { renderMorphTake } from '../tools/audition-morph-render.mjs';
import { encodeWav } from '../src/wav.mjs';
import { rms } from '../tools/analyze.mjs';

test('slice overlay preserves the actual waveform, timing and mute endpoint', () => {
  const voice = new Float32Array([0.25, -0.25, 0, 0]);
  const slices = new Float32Array([0, 0, 0.5, -0.5]);
  const savedVoice = voice.slice(), savedSlices = slices.slice();
  assert.deepEqual(mixSliceLayer(voice, slices, 0).samples, voice);
  // Disjoint pulses expose both waveforms and any unwanted time shift/gating.
  assert.deepEqual(mixSliceLayer(voice, slices, 0.5).samples, new Float32Array([0.25, -0.25, 0.125, -0.125]));
  const full = mixSliceLayer(voice, slices, 1);
  assert.deepEqual(full.samples, new Float32Array([0.25, -0.25, 0.25, -0.25]));
  assert.equal(rms(voice) * full.metrics.voiceGain, rms(slices) * full.metrics.slicesGain);
  assert.deepEqual(voice, savedVoice);
  assert.deepEqual(slices, savedSlices);
});

test('loud overlays retain their balance without clipping, and silent slices stay silent', () => {
  const voice = new Float32Array([0.8, -0.6, 0.1, -0.2]);
  const slices = new Float32Array([0.6, -0.8, 0.2, -0.1]);
  const { samples, metrics } = mixSliceLayer(voice, slices, 0.5);
  assert.ok(metrics.voiceGain < 1);
  assert.ok(Math.abs(rms(slices) * metrics.slicesGain / (rms(voice) * metrics.voiceGain) - 0.5) < 1e-12);
  assert.ok(samples.every((x) => Number.isFinite(x) && Math.abs(x) <= 0.900001));
  assert.deepEqual(mixSliceLayer(voice, new Float32Array(voice.length), 1).samples, voice);
  assert.ok(mixSliceLayer(new Float32Array(4), new Float32Array(4), 1).samples.every((x) => x === 0));
  for (const level of [-1, 1.1, NaN, Infinity]) assert.throws(() => mixSliceLayer(voice, slices, level), /level/);
  assert.throws(() => mixSliceLayer(voice, slices.subarray(0, 2), 0.5), /equally long/);
  assert.throws(() => mixSliceLayer(voice, new Float32Array([NaN, 0, 0, 0]), 0.5), /finite/);
});

test('volume changes reuse the morph and a muted v2 recipe reproduces legacy v1 audio', () => {
  const sampleRate = 8000, length = sampleRate / 2;
  const carrier = Float32Array.from({ length }, (_, i) => 0.2 * Math.sin(2 * Math.PI * 200 * i / sampleRate));
  const slices = Float32Array.from({ length }, (_, i) => 0.2 * Math.sin(2 * Math.PI * 430 * i / sampleRate));
  const encoded = (samples) => {
    const bytes = Buffer.alloc(samples.length * 4);
    samples.forEach((value, i) => bytes.writeFloatLE(value, i * 4));
    return bytes.toString('base64');
  };
  const sources = { speech: encoded(carrier), slices: encoded(slices) };
  const recipe = { babbleMorph: 2, algorithm: 'cepstral-envelope-v1', sampleRate,
    settings: { amount: 0.7, windowSize: 256, hopSize: 64, peakLimit: 0.9 },
    sliceLayer: { algorithm: 'rms-overlay-v1', level: 0.5 },
    timing: { cues: [[0, 0.5]] }, sourceAlignment: 'pad-end-with-silence', sources: [{ id: 'speech' }, { id: 'slices' }] };
  const request = { recipe, sources, preRoll: 1, sceneSeconds: 2 };
  const first = renderMorphTake(request);
  const mutedRecipe = { ...recipe, sliceLayer: { ...recipe.sliceLayer, level: 0 } };
  const muted = renderMorphTake({ ...request, recipe: mutedRecipe, morphCache: first.morphCache });
  assert.equal(muted.morphCache.samples, first.morphCache.samples);
  assert.deepEqual(muted.clip, encodeWav(first.morphCache.samples, sampleRate));
  assert.notDeepEqual(first.clip, muted.clip);
  const legacy = renderMorphTake({ ...request, recipe: { ...recipe, babbleMorph: 1, sliceLayer: undefined } });
  assert.deepEqual(muted.clip, legacy.clip);
  assert.deepEqual(muted.sceneClip, legacy.sceneClip);
  const changed = renderMorphTake({ ...request, recipe: { ...recipe, settings: { ...recipe.settings, amount: 0.4 } }, morphCache: first.morphCache });
  assert.notEqual(changed.morphCache.samples, first.morphCache.samples);
  assert.notEqual(changed.morphCache.key, first.morphCache.key);
  const movedSources = renderMorphTake({ ...request, recipe: { ...recipe, sources: [{ id: 'slices' }, { id: 'speech' }] }, morphCache: first.morphCache });
  assert.notEqual(movedSources.morphCache.samples, first.morphCache.samples);
  assert.throws(() => renderMorphTake({ ...request, recipe: { ...recipe, sliceLayer: { level: 0.5 } } }), /Unsupported slice layer/);
});
