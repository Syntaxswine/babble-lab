import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createMorphControl } from '../tools/audition-morph-control.mjs';
import { mixMorphTake, morphKey } from '../tools/audition-morph-render.mjs';
import { bundle } from '../tools/build-standalone.mjs';
import { AudioContext } from './helpers/audio.mjs';

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
function take(id = 'hen', amount = 0.7, level = 0.18) {
  const recipe = { babbleMorph: 2, algorithm: 'cepstral-envelope-v1', sampleRate: 8000,
    settings: { amount }, sliceLayer: { algorithm: 'rms-overlay-v1', level },
    sources: [{ id: 'speech', label: 'Speech' }, { id: 'slices', label: 'Slices' }] };
  return { id, engine: 'morph', recipe, cueData: { sampleRate: 8000, morph: recipe, mouth: [{ t: 0.1, open: 1 }] },
    label: id, group: 'MORPHS', audioSeconds: 0.01, rmsDbFS: -20, peakDbFS: -6, maxCueErrorMs: 0,
    clip: `${id}.wav`, sceneClip: `${id}.scene.wav`, recipeFile: `${id}.morph.json`, cueFile: `${id}.cues.json` };
}
const request = (recipe) => ({ recipe, preRoll: 1, sceneSeconds: 2 });
function resultFor(recipe) {
  const samples = Float32Array.from({ length: 80 }, (_, i) => Math.sin(i * 0.5) * (0.1 + recipe.settings.amount * 0.1));
  const colour = Float32Array.from({ length: 80 }, (_, i) => Math.sin(i * 1.1) * 0.1);
  return mixMorphTake({ ...request(recipe), morphCache: { key: morphKey(recipe), samples, colour, metrics: {} } });
}
function setup(options = {}) {
  const workers = [], updates = [];
  const control = createMorphControl({ delay: 0, getRequest: request,
    createWorker() {
      const worker = { jobs: [], postMessage(job) { this.jobs.push(job); }, terminate() { this.stopped = true; },
        finish() { this.onmessage({ data: { result: resultFor(this.jobs.at(-1).recipe) } }); } };
      workers.push(worker); return worker;
    },
    onUpdate(state) { updates.push({ id: state.base.id, status: state.status, amount: state.amount, level: state.sliceLevel }); }, ...options,
  });
  const warm = async (base = take()) => { control.select(base); await settle(); workers.at(-1).finish(); };
  return { control, workers, updates, warm };
}

test('both slider settings carry across new voices, returning voices and original takes', async () => {
  const { control, workers, warm } = setup(), base = take();
  try {
    await warm(base);
    control.changeSlices(0.23); // immediate, no new worker or render
    assert.equal(control.current.status, 'ready');
    assert.equal(workers[0].jobs.length, 1);
    assert.equal(control.current.take.recipe.sliceLayer.level, 0.23);
    control.change(0.81); await settle(); workers[0].finish();
    const completed = control.current.take;
    assert.equal(completed.clip, 'hen-morph-81pct-slices-23pct.wav');
    assert.equal(completed.cueData.morph.settings.amount, 0.81);
    assert.equal(completed.cueData.morph.sliceLayer.level, 0.23);
    assert.deepEqual(completed.cueData.mouth, base.cueData.mouth);
    control.select(take('robot', 0.4, 0.6));
    assert.equal(workers[0].stopped, true);
    assert.equal(control.current.amount, 0.81);
    assert.equal(control.current.sliceLevel, 0.23);
    await settle(); workers[1].finish();
    control.changeSlices(0.12);
    control.select({ id: 'original', engine: 'formant' });
    control.select(base);
    assert.equal(control.current.amount, 0.81);
    assert.equal(control.current.sliceLevel, 0.12);
    assert.equal(control.current.status, 'ready'); // reuse hen spectrum, remix new shared balance
    assert.equal(workers.length, 2);
    assert.equal(control.current.take.morphCache, undefined);
    assert.equal(base.recipe.settings.amount, 0.7);
    assert.equal(base.recipe.sliceLayer.level, 0.18);
    for (const value of [-1, 1.1, NaN]) assert.throws(() => control.changeSlices(value), /0\.\.1/);
  } finally { control.dispose(); }
});

test('continuous dragging keeps audible updates moving and does not undo immediate slice changes', async () => {
  const { control, workers, warm } = setup();
  try {
    await warm(); const worker = workers[0];
    control.change(0.2); await settle();
    control.change(0.4); control.change(0.83); control.changeSlices(0.31);
    assert.equal(worker.stopped, undefined);
    assert.equal(worker.jobs.length, 2); // one in flight; only the latest request is queued
    assert.equal(control.current.take.recipe.settings.amount, 0.7);
    assert.equal(control.current.take.recipe.sliceLayer.level, 0.31);
    assert.ok(control.current.playback);
    assert.equal(control.current.status, 'pending');
    worker.finish();
    assert.equal(control.current.take.recipe.settings.amount, 0.2);
    assert.equal(control.current.take.recipe.sliceLayer.level, 0.31); // no stale 18% result
    assert.equal(control.current.status, 'pending');
    await settle();
    assert.equal(worker.jobs.at(-1).recipe.settings.amount, 0.83);
    worker.finish();
    assert.equal(control.current.status, 'ready');
    assert.equal(control.current.take.recipe.settings.amount, 0.83);
    control.change(0.4); await settle();
    control.change(0.83); // recover the audible value before the obsolete render finishes
    const recovered = control.current.playback;
    worker.finish();
    assert.equal(control.current.playback, recovered);
    assert.equal(control.current.status, 'ready');
  } finally { control.dispose(); }
});

test('switching voices, hiding the page, idle expiry and disposal release workers', async () => {
  const { control, workers, updates, warm } = setup({ idleMs: 25 });
  try {
    await warm();
    control.change(0.9); await settle(); const old = workers[0];
    control.select(take('pixie')); old.finish();
    assert.equal(old.stopped, true);
    assert.equal(control.current.base.id, 'pixie');
    assert.equal(control.current.playback, undefined);
    await settle(); control.suspend(); assert.equal(workers[1].stopped, true);
    control.select(take('pixie')); await settle(); workers[2].finish();
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(workers[2].stopped, true);
    control.changeSlices(0); assert.equal(control.current.status, 'ready');
    control.change(0.3); await settle();
    control.dispose(); const count = updates.length;
    workers[3].finish(); assert.equal(updates.length, count);
    assert.equal(workers[3].stopped, true);
  } finally { control.dispose(); }
});

test('a failed tone update retains playback and can recover without resetting shared volume', async () => {
  const { control, workers, warm } = setup();
  try {
    await warm(); control.changeSlices(0.26);
    const previous = control.current.playback;
    control.change(0.9); await settle();
    workers[0].onmessage({ data: { error: 'Bad source' } });
    assert.equal(control.current.status, 'error');
    assert.equal(control.current.playback, previous);
    assert.equal(workers[0].stopped, true);
    control.change(0.7);
    assert.equal(control.current.status, 'ready');
    assert.equal(control.current.sliceLevel, 0.26);
  } finally { control.dispose(); }
});

test('page sliders never pause, reload or rewind playing audio and preserve shared settings on voice changes', async () => {
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.currentTime = 0; this.paused = true; this.checked = true; this.volume = 1; this.playbackRate = 1; }
    append(child) { this.children.push(child); }
    querySelectorAll(tag) { return this.children.flatMap((c) => [...(c.tag === tag ? [c] : []), ...c.querySelectorAll(tag)]); }
    querySelector(tag) { return this.querySelectorAll(tag)[0]; }
    setAttribute(key, value) { this.attributes[key] = value; }
    removeAttribute(key) { delete this.attributes[key]; delete this[key]; }
    pause() { this.paused = true; this.onpause?.(); }
    load() { this.loads = (this.loads ?? 0) + 1; }
    play() { this.paused = false; this.plays = (this.plays ?? 0) + 1; this.onplay?.(); return Promise.resolve(); }
    scrollIntoView() {}
    getContext() { return { clearRect() {}, fillRect() {}, fillText() {}, drawImage() {} }; }
  }
  const html = fs.readFileSync(new URL('../tools/animal-factory.html', import.meta.url), 'utf8');
  const elements = Object.fromEntries([...html.matchAll(/<(\w+)[^>]*\bid="([^"]+)"/g)].map((m) => [m[2], new Element(m[1])]));
  const audio = elements.audio, events = new Map(), timers = new Map(), blobs = new Map(), workers = [], contexts = [];
  let serial = 0;
  const base = take(), robot = take('robot');
  const original = { ...base, id: 'original', engine: 'formant', recipe: undefined, voice: {}, voiceFile: 'original.voice.json', clip: 'original.wav' };
  const data = { example: { text: 'Hello', shotFrom: 0, shotTo: 2, sceneStart: 1 }, sequence: null,
    results: [base, robot, original], sources: { original: Buffer.alloc(80 * 4).toString('base64') }, bank: {} };
  class Worker {
    constructor() { this.jobs = []; workers.push(this); }
    postMessage(value) { this.jobs.push(value); }
    terminate() { this.stopped = true; }
    finish() { this.onmessage({ data: { result: resultFor(this.jobs.at(-1).recipe) } }); }
  }
  const context = {
    document: { getElementById: (id) => elements[id], createElement: (tag) => new Element(tag), body: new Element('body'), addEventListener(type, fn) { events.set(type, fn); } },
    window: {}, Blob, Worker, atob, Float32Array, Float64Array, Uint8Array, DataView,
    AudioContext: class extends AudioContext { constructor() { super(); contexts.push(this); } },
    URL: { createObjectURL(blob) { const url = `blob:${++serial}`; blobs.set(url, blob); return url; }, revokeObjectURL(url) { blobs.delete(url); } },
    setTimeout(fn, delay) { const id = ++serial; timers.set(id, { fn, delay }); return id; }, clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame() {}, cancelAnimationFrame() {}, addEventListener(type, fn) { events.set(type, fn); },
  };
  const runTimers = () => { for (const [id, { fn, delay }] of [...timers]) if (delay <= 25) { timers.delete(id); fn(); } };
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1].replace('/*AUDITION_DATA*/', () =>
    `const DATA=${JSON.stringify(data)};const MORPH_WORKER='embedded-worker';${bundle(['tools/audition-morph-control.mjs', 'tools/audition-player.mjs'])}`);
  vm.runInNewContext(script, context);
  try {
    assert.equal(Number(elements.morphAmount.value), 70);
    assert.equal(Number(elements.sliceVolume.value), 18);
    runTimers(); workers[0].finish();
    assert.equal(elements.wav.href, base.clip);
    await elements.replay.onclick(); await settle();
    assert.equal(audio.plays, 1);
    audio.currentTime = 1.003;
    contexts[0].currentTime += 1.003;
    const clockSource = audio.src, loads = audio.loads;
    elements.sliceVolume.value = '23'; elements.sliceVolume.oninput();
    assert.equal(audio.paused, false); assert.equal(audio.currentTime, 1.003);
    assert.equal(audio.src, clockSource); assert.equal(audio.loads, loads); assert.equal(audio.plays, 1);
    assert.equal(elements.wav.download, 'hen-morph-70pct-slices-23pct.wav');
    assert.equal(JSON.parse(await blobs.get(elements.voice.href).text()).sliceLayer.level, 0.23);
    elements.morphAmount.value = '81'; elements.morphAmount.oninput(); runTimers();
    assert.equal(audio.paused, false); assert.equal(elements.replay.disabled, false);
    assert.equal(elements.wav.href, undefined); // never export an obsolete setting
    workers[0].finish();
    assert.equal(audio.src, clockSource); assert.equal(audio.loads, loads); assert.equal(audio.plays, 1);
    assert.equal(audio.currentTime, 1.003);
    assert.equal(elements.wav.download, 'hen-morph-81pct-slices-23pct.wav');
    assert.equal(JSON.parse(await blobs.get(elements.cues.href).text()).morph.settings.amount, 0.81);
    const last = contexts[0].sources.at(-1);
    assert.ok(last.starts[0][1] >= 1.003); // replacement starts at the current word, never zero
    audio.pause();
    elements.muteSlices.onclick(); assert.equal(audio.paused, true); assert.equal(audio.plays, 1);
    const buttons = elements.choices.querySelectorAll('button');
    buttons[1].onclick(); runTimers();
    assert.equal(Number(elements.morphAmount.value), 81);
    assert.equal(Number(elements.sliceVolume.value), 0);
    assert.equal(workers[1].jobs[0].recipe.settings.amount, 0.81);
    assert.equal(workers[1].jobs[0].recipe.sliceLayer.level, 0);
    workers[1].finish(); await settle();
    elements.sliceVolume.value = '18'; elements.sliceVolume.oninput();
    buttons[2].onclick(); assert.equal(elements.morphControls.hidden, true);
    buttons[0].onclick();
    assert.equal(Number(elements.morphAmount.value), 81);
    assert.equal(Number(elements.sliceVolume.value), 18);
    assert.equal(elements.morphControls.hidden, false);
    elements.resetMorph.onclick(); runTimers();
    assert.equal(Number(elements.sliceVolume.value), 18);
    assert.equal(audio.paused, false);
    context.document.hidden = true; events.get('visibilitychange')(); await settle();
    assert.equal(audio.paused, true);
    assert.equal(contexts[0].state, 'suspended');
    assert.equal(workers.at(-1).stopped, true);
    context.document.hidden = false; events.get('visibilitychange')(); runTimers();
    assert.equal(Number(elements.morphAmount.value), 70);
    assert.equal(Number(elements.sliceVolume.value), 18);
  } finally { events.get('pagehide')({ persisted: false }); await settle(); }
  assert.ok(workers.every((worker) => worker.stopped));
  assert.equal(blobs.size, 0); assert.equal(timers.size, 0);
  assert.ok(contexts.every((ctx) => ctx.state === 'closed'));
});
