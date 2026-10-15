import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { plan, render, retimePlan, mouthCues, mouthAt, revealAt, revealSchedule, makeBank } from '../src/index.mjs';
import { pitch, rms } from '../tools/analyze.mjs';

const example = JSON.parse(fs.readFileSync(new URL('../examples/animal-factory/handler.json', import.meta.url)));
const timing = JSON.parse(fs.readFileSync(new URL('../examples/animal-factory/handler.timing.json', import.meta.url)));
const sounding = (p) => p.units.filter((u) => u.kind !== 'rest');
const near = (a, b, epsilon = 1e-9) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);

test('handler: all 14 syllables follow the source animation, including its deliberate pause', () => {
  let t = 0, i = 0;
  for (const [label, seconds] of example.syllables) {
    if (label) { near(timing.cues[i][0], t); near(timing.cues[i++][1], t + seconds); }
    t += seconds;
  }
  assert.equal(i, 14);
  for (const voice of ['narrator', 'hen', 'hen-radio']) {
    const natural = plan(example.text, voice);
    const before = JSON.stringify(natural);
    const p = retimePlan(natural, timing);
    assert.equal(JSON.stringify(natural), before, 'retiming mutated the original plan');
    assert.deepEqual(sounding(p).map((u) => [u.t0, u.t1]), timing.cues);
    near(p.duration, 2.89);
    assert.deepEqual(p.pitch.map((p) => p.st), natural.pitch.map((p) => p.st), 'retiming changed pitch targets');
    for (let j = 1; j < p.segs.length; j++) near(p.segs[j - 1].t0 + p.segs[j - 1].dur, p.segs[j].t0);
    for (const w of p.words) {
      const units = sounding(p).filter((u) => u.word === w.index);
      near(w.t0, units[0].t0); near(w.t1, units.at(-1).t1);
    }
    const schedule = revealSchedule(p);
    for (let j = 1; j < schedule.length; j++) assert.ok(schedule[j].t >= schedule[j - 1].t);
    assert.equal(revealAt(p, p.duration), example.text.length);
    assert.ok(sounding(natural).some((u, j) => Math.abs(u.t0 - timing.cues[j][0]) > 0.05), 'negative control is already aligned');
  }
});

test('cue-fitted audio is finite, non-clipping, deterministic and audible in every beak slot', () => {
  for (const voice of ['hen', 'hen-radio']) {
    const r = render(example.text, voice, { timing, sampleRate: 22050 });
    assert.deepEqual(r.samples, render(example.text, voice, { timing, sampleRate: 22050 }).samples);
    for (const x of r.samples) assert.ok(Number.isFinite(x) && Math.abs(x) < 1);
    for (const [a, b] of timing.cues) assert.ok(rms(r.samples, a * r.sampleRate, b * r.sampleRate) > 0.015, `silent cue ${a}-${b}`);
    assert.ok(rms(r.samples, 1.39 * r.sampleRate, 1.43 * r.sampleRate) < 0.005, 'pause is not quiet');
    near(r.samples[0], 0); near(r.samples.at(-1), 0);
  }
});

test('fitting score duration preserves measured pitch, instead of speeding up the recording', () => {
  const voice = { pitch: 180, range: 0, lilt: 0, breath: 0, rough: 0, syllabary: [['AA']] };
  for (const duration of [0.3, 0.8]) {
    const r = render('Ah', voice, { timing: { duration }, sampleRate: 22050 });
    near(r.plan.duration, duration);
    const f = pitch(r.samples, r.sampleRate, duration * 0.25, duration * 0.75, 120, 250);
    assert.ok(Math.abs(f.f0 / 180 - 1) < 0.02, `pitch moved to ${f.f0} Hz`);
    assert.equal(r.samples.length, Math.ceil((duration + 0.04) * r.sampleRate));
  }
});

test('retiming also drives voice banks and exported mouth motion closes between cues', () => {
  const sr = 16000;
  const samples = Float32Array.from({ length: sr * 4 }, (_, i) => 0.2 * Math.sin(2 * Math.PI * 180 * i / sr));
  const bank = makeBank(samples, sr, { name: 'test' });
  const opts = { timing: { cues: [[0.1, 0.3], [0.5, 0.75]] }, sampleRate: sr, bank };
  const r = render('Hello', { range: 0 }, opts);
  assert.deepEqual(sounding(r.plan).map((u) => [u.t0, u.t1]), opts.timing.cues);
  assert.ok(rms(r.samples, 0.12 * sr, 0.28 * sr) > 0.01);
  assert.equal(rms(r.samples, 0.35 * sr, 0.45 * sr), 0);
  const cues = mouthCues(r.plan);
  assert.equal(cues.length, 2);
  for (const t of [-1, 0, 0.1, 0.3, 0.4, 0.5, 0.75, 4]) assert.equal(mouthAt(r.plan, t), 0);
  for (const c of cues) near(mouthAt(r.plan, (c.t0 + c.t1) / 2), c.open);
  const blips = plan('Hello', { mode: 'blip', blip: { every: 2 } });
  assert.equal(mouthCues(blips).length, sounding(blips).filter((u) => !u.silent).length);
});

test('bad, missing, reversed and overlapping animation cues fail before synthesis', () => {
  for (const value of [0, '1', NaN, Infinity, -1, 601]) assert.throws(() => plan('Hello', 'hen', { timing: { duration: value } }), /timing duration/);
  for (const cues of [null, [], [[0, 1]], [[0, 1], [0.5, 2]], [[-1, 0], [1, 2]], [[0, 0.01], [1, 2]], [[0, 1], [2, Infinity]], [[0, 1], ['2', 3]]]) {
    assert.throws(() => plan('Hello', 'hen', { timing: { cues } }), /timing/);
  }
  assert.throws(() => plan('Hello', 'hen', { timing: { cues: [[0, 1], [1, 2]], duration: 1.5 } }), /before the last cue/);
  assert.throws(() => plan('...', 'hen', { timing: { cues: [] } }), /timing/);
  assert.deepEqual(render('Hello', 'hen').samples, render('Hello', 'hen', { timing: {} }).samples);
});

test('classic browser bundle renders cue-fitted hen voices byte-identically to modules', () => {
  const sandbox = { Float32Array, Float64Array, Uint8Array, Uint16Array, Uint32Array, ArrayBuffer, DataView, TextEncoder, TextDecoder };
  vm.runInNewContext(fs.readFileSync(new URL('../dist/babble.global.js', import.meta.url), 'utf8'), sandbox);
  const opts = { timing, sampleRate: 22050 };
  const expected = render(example.text, 'hen-radio', opts);
  const actual = sandbox.Babble.render(example.text, 'hen-radio', opts);
  assert.deepEqual(actual.samples, expected.samples);
  near(sandbox.Babble.mouthAt(actual.plan, 0.1), mouthAt(expected.plan, 0.1));
});
