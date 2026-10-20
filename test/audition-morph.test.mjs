import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createMorphControl } from '../tools/audition-morph-control.mjs';
import { bundle } from '../tools/build-standalone.mjs';

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
function take(id = 'hen', amount = 0.5) {
  const recipe = { babbleMorph: 2, settings: { amount }, sliceLayer: { algorithm: 'rms-overlay-v1', level: 0.5 }, sources: [] };
  return { id, engine: 'morph', recipe, cueData: { morph: recipe, mouth: [{ t: 0.1, open: 1 }] },
    clip: `${id}.wav`, sceneClip: `${id}.scene.wav`, recipeFile: `${id}.morph.json`, cueFile: `${id}.cues.json` };
}
function setup() {
  const workers = [], updates = [];
  const control = createMorphControl({ delay: 0,
    createWorker() {
      const worker = { stopped: false, postMessage(job) { this.job = job; }, terminate() { this.stopped = true; } };
      workers.push(worker); return worker;
    },
    onUpdate(state) { updates.push({ id: state.take.id, status: state.status, amount: state.amount }); },
  });
  const finish = (worker) => worker.onmessage({ data: { result: {
    clip: new Uint8Array([1, 2]), sceneClip: new Uint8Array([3, 4]), rmsDbFS: -25, peakDbFS: -6,
  } } });
  return { control, workers, updates, finish };
}

test('slider cancels stale renders and exports only the completed percentage', async () => {
  const { control, workers, finish } = setup(), base = take();
  try {
    control.select(base);
    assert.equal(control.current.status, 'ready');
    assert.equal(workers.length, 0); // initial 50% is already rendered
    control.change(0.2);
    assert.equal(control.current.status, 'pending');
    assert.equal(control.current.take.recipe.settings.amount, 0.5);
    await settle();
    const old = workers[0];
    assert.equal(old.job.recipe.settings.amount, 0.2);
    control.change(0.83);
    assert.equal(old.stopped, true);
    await settle();
    finish(old); // a queued message from an obsolete worker cannot win
    assert.equal(control.current.status, 'pending');
    finish(workers[1]);
    assert.equal(workers[1].stopped, true);
    const current = control.current;
    assert.equal(current.status, 'ready');
    assert.equal(current.take.recipe.settings.amount, 0.83);
    assert.equal(current.take.cueData.morph.settings.amount, 0.83);
    assert.deepEqual(current.take.cueData.mouth, base.cueData.mouth);
    assert.equal(current.take.clip, 'hen-morph-83pct-slices-50pct.wav');
    assert.equal(current.take.recipeFile, 'hen-morph-83pct-slices-50pct.morph.json');
    assert.equal(current.take.cueFile, 'hen-morph-83pct-slices-50pct.cues.json');
    assert.equal(current.take.rmsDbFS, -25);
    assert.equal(base.recipe.settings.amount, 0.5);

    control.select({ id: 'original', engine: 'formant' });
    control.select(take('other-hen'));
    assert.equal(control.current.amount, 0.5);
    control.select(base);
    assert.equal(control.current.amount, 0.83);
    assert.equal(control.current.take, current.take);
    assert.equal(workers.length, 2); // revisiting a rendered take reuses it
    control.change(0.5);
    assert.equal(control.current.take, base);
    assert.equal(control.current.output, null);
    assert.equal(control.current.status, 'ready');
  } finally { control.dispose(); }
});

test('slice volume is independent, remembered and included in both exports', async () => {
  const { control, workers, finish } = setup(), base = take('hen', 0.7);
  try {
    control.select(base);
    control.changeSlices(0);
    await settle();
    assert.equal(workers[0].job.recipe.settings.amount, 0.7);
    assert.equal(workers[0].job.recipe.sliceLayer.level, 0);
    const cache = { key: 'cached-morph', samples: new Float32Array([0.1]), metrics: {} };
    workers[0].onmessage({ data: { result: { clip: new Uint8Array([1]), sceneClip: new Uint8Array([2]), morphCache: cache } } });
    assert.equal(control.current.take.recipe.sliceLayer.level, 0);
    assert.equal(control.current.take.cueData.morph.sliceLayer.level, 0);
    assert.equal(control.current.take.morphCache, undefined); // internal PCM is not part of a recipe
    control.changeSlices(0.81);
    await settle();
    const obsolete = workers[1];
    assert.equal(obsolete.job.morphCache, cache);
    control.change(0.33);
    await settle();
    assert.equal(obsolete.stopped, true);
    finish(obsolete);
    assert.equal(control.current.status, 'pending');
    assert.equal(workers[2].job.recipe.settings.amount, 0.33);
    assert.equal(workers[2].job.recipe.sliceLayer.level, 0.81);
    finish(workers[2]);
    control.select(take('robot'));
    assert.equal(control.current.sliceLevel, 0.5);
    control.select(base);
    assert.equal(control.current.sliceLevel, 0.81);
    assert.equal(control.current.amount, 0.33);
    assert.equal(control.current.take.clip, 'hen-morph-33pct-slices-81pct.wav');
    control.change(0.7); // resetting the morph must not reset the separate layer
    assert.equal(control.current.sliceLevel, 0.81);
    assert.equal(control.current.status, 'pending');
    control.changeSlices(0.5); // both defaults recover the pre-rendered take
    assert.equal(control.current.take, base);
    assert.equal(control.current.output, null);
    assert.equal(control.current.status, 'ready');
    for (const invalid of [NaN, -0.1, 1.1]) assert.throws(() => control.changeSlices(invalid), /0\.\.1/);
  } finally { control.dispose(); }
});

test('switching voices and closing the page stop work without losing the requested setting', async () => {
  const { control, workers, finish, updates } = setup(), base = take();
  try {
    control.select(base); control.change(1);
    await settle();
    const old = workers[0];
    control.select({ id: 'slices', engine: 'sampler' });
    assert.equal(old.stopped, true);
    finish(old);
    assert.equal(control.current.take.id, 'slices');
    control.select(base);
    assert.equal(control.current.amount, 1);
    assert.equal(control.current.status, 'pending');
    await settle();
    control.suspend();
    assert.equal(workers[1].stopped, true);
    control.select(base); // restores a page from the back/forward cache
    await settle();
    finish(workers[2]);
    assert.equal(control.current.take.recipe.settings.amount, 1);
    control.change(0);
    control.change(0.27); // debounce: no worker for intermediate 0%
    await settle();
    assert.equal(workers.length, 4);
    assert.equal(workers[3].job.recipe.settings.amount, 0.27);
    control.dispose();
    assert.equal(workers[3].stopped, true);
    const count = updates.length;
    finish(workers[3]);
    assert.equal(updates.length, count);
    assert.equal(control.current, undefined);
  } finally { control.dispose(); }
});

test('worker failures leave downloads unavailable until a valid take is selected', async () => {
  const { control, workers } = setup(), base = take();
  try {
    control.select(base); control.change(0.9);
    await settle();
    workers[0].onmessage({ data: { error: 'Bad source' } });
    assert.equal(control.current.status, 'error');
    assert.equal(control.current.error, 'Bad source');
    assert.equal(workers[0].stopped, true);
    control.change(0.5);
    assert.equal(control.current.status, 'ready');
    control.change(0.7);
    await settle();
    workers[1].onerror({ message: 'Worker unavailable' });
    assert.equal(control.current.status, 'error');
    assert.equal(workers[1].stopped, true);
    control.select({ id: 'original', engine: 'formant' });
    assert.equal(control.current.status, 'ready');
  } finally { control.dispose(); }
  const blocked = createMorphControl({ delay: 0, createWorker() { throw new Error('Worker construction blocked'); }, onUpdate() {} });
  try {
    blocked.select(base); blocked.change(0.6); await settle();
    assert.equal(blocked.current.status, 'error');
    blocked.change(0.5);
    assert.equal(blocked.current.status, 'ready');
  } finally { blocked.dispose(); }
});

test('page wires slider changes to playback and downloadable WAV, recipe and cues', async () => {
  // Test the page's actual event handlers without a browser or local server.
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.currentTime = 0; this.paused = true; this.checked = true; }
    append(child) { this.children.push(child); }
    querySelectorAll(tag) { return this.children.flatMap((c) => [...(c.tag === tag ? [c] : []), ...c.querySelectorAll(tag)]); }
    querySelector(tag) { return this.querySelectorAll(tag)[0]; }
    setAttribute(key, value) { this.attributes[key] = value; }
    removeAttribute(key) { delete this.attributes[key]; delete this[key]; }
    pause() { this.paused = true; }
    load() {}
    play() { this.paused = false; this.plays = (this.plays ?? 0) + 1; return Promise.resolve(); }
    scrollIntoView() {}
    getContext() { return { clearRect() {}, fillRect() {}, fillText() {}, drawImage() {} }; }
  }
  const html = fs.readFileSync(new URL('../tools/animal-factory.html', import.meta.url), 'utf8');
  const elements = Object.fromEntries([...html.matchAll(/<(\w+)[^>]*\bid="([^"]+)"/g)].map((m) => [m[2], new Element(m[1])]));
  const audio = elements.audio, events = new Map(), timers = new Map(), blobs = new Map(), workers = [];
  let serial = 0;
  const base = { ...take('hen', 0.7), label: 'Morph hen', group: 'MORPHS', note: '', audioSeconds: 0.2, peakDbFS: -6, rmsDbFS: -20, maxCueErrorMs: 0 };
  base.recipe.sources = [{ id: 'speech', label: 'Speech' }, { id: 'slices', label: 'Slices' }];
  const original = { ...base, id: 'original', engine: 'formant', label: 'Original', group: 'ORIGINALS', recipe: undefined, voice: {}, voiceFile: 'original.voice.json', clip: 'original.wav', sceneClip: 'original.scene.wav' };
  const data = { example: { text: 'Hello', shotFrom: 0, shotTo: 2, sceneStart: 1 }, sequence: null,
    results: [base, original], sources: { speech: 'speech-data', slices: 'slice-data' }, bank: null };
  class Worker {
    constructor() { workers.push(this); }
    postMessage(value) { this.request = value; }
    terminate() { this.stopped = true; }
    finish() { this.onmessage({ data: { result: { clip: new Uint8Array([1, 2, 3]), sceneClip: new Uint8Array([4, 5]), peakDbFS: -7, rmsDbFS: -24 } } }); }
  }
  const context = {
    document: { getElementById: (id) => elements[id], createElement: (tag) => new Element(tag), body: new Element('body') },
    window: {}, Blob, Worker,
    URL: { createObjectURL(blob) { const url = `blob:${++serial}`; blobs.set(url, blob); return url; }, revokeObjectURL(url) { blobs.delete(url); } },
    setTimeout(fn) { const id = ++serial; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame() {}, cancelAnimationFrame() {}, addEventListener(type, fn) { events.set(type, fn); },
  };
  const runTimers = () => { const pending = [...timers.values()]; timers.clear(); pending.forEach((fn) => fn()); };
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1].replace('/*AUDITION_DATA*/', () =>
    `const DATA=${JSON.stringify(data)};const MORPH_WORKER='embedded-worker';${bundle(['tools/audition-morph-control.mjs'])}`);
  vm.runInNewContext(script, context);
  try {
    assert.equal(elements.morphControls.hidden, false);
    assert.equal(elements.wav.href, base.clip);
    assert.equal(Number(elements.morphAmount.value), 70);
    assert.equal(Number(elements.sliceVolume.value), 50);
    assert.equal(elements.sliceValue.textContent, '50%');
    assert.equal(elements.resetMorph.textContent, 'Reset to 70%');
    assert.equal(elements.resetMorph.attributes['aria-label'], 'Reset voice morph to 70 percent');
    elements.morphAmount.value = '73'; elements.morphAmount.oninput(); elements.morphAmount.onchange();
    assert.equal(elements.replay.disabled, true);
    assert.equal(elements.wav.href, undefined);
    assert.equal(elements.voice.href, undefined);
    let prevented = false;
    elements.wav.onclick({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    runTimers();
    assert.equal(workers[0].request.recipe.settings.amount, 0.73);
    assert.equal(workers[0].request.sources.slices, 'slice-data');
    workers[0].finish();
    assert.equal(workers[0].stopped, true);
    assert.equal(elements.replay.disabled, false);
    assert.equal(elements.wav.download, 'hen-morph-73pct-slices-50pct.wav');
    assert.deepEqual(new Uint8Array(await blobs.get(elements.wav.href).arrayBuffer()), new Uint8Array([1, 2, 3]));
    const recipe = JSON.parse(await blobs.get(elements.voice.href).text());
    const cues = JSON.parse(await blobs.get(elements.cues.href).text());
    assert.equal(recipe.settings.amount, 0.73);
    assert.equal(cues.morph.settings.amount, 0.73);
    assert.equal(recipe.sliceLayer.level, 0.5);
    assert.equal(cues.morph.sliceLayer.level, 0.5);
    assert.equal(audio.plays, 1); // release replays the completed setting
    assert.equal(audio.volume, 1); // a quieter render cannot set volume above 1
    const oldWav = elements.wav.href;
    const buttons = elements.choices.querySelectorAll('button');
    buttons[1].onclick();
    assert.equal(elements.morphControls.hidden, true);
    assert.equal(elements.wav.href, 'original.wav');
    buttons[0].onclick();
    assert.equal(Number(elements.morphAmount.value), 73);
    assert.equal(elements.wav.href, oldWav);
    elements.resetMorph.onclick();
    assert.equal(elements.wav.href, base.clip);
    assert.equal(blobs.has(oldWav), false);
    assert.equal(Number(elements.morphAmount.value), 70);
    elements.sliceVolume.value = '85'; elements.sliceVolume.oninput(); elements.sliceVolume.onchange();
    assert.equal(elements.replay.disabled, true);
    assert.equal(elements.wav.href, undefined);
    runTimers();
    assert.equal(workers[1].request.recipe.settings.amount, 0.7);
    assert.equal(workers[1].request.recipe.sliceLayer.level, 0.85);
    workers[1].finish();
    assert.equal(elements.wav.download, 'hen-morph-70pct-slices-85pct.wav');
    assert.equal(JSON.parse(await blobs.get(elements.voice.href).text()).sliceLayer.level, 0.85);
    assert.equal(JSON.parse(await blobs.get(elements.cues.href).text()).morph.sliceLayer.level, 0.85);
    elements.resetMorph.onclick();
    assert.equal(Number(elements.sliceVolume.value), 85);
    assert.equal(workers.length, 2); // resetting an unchanged morph keeps the completed mix
    elements.muteSlices.onclick(); runTimers();
    assert.equal(workers[2].request.recipe.sliceLayer.level, 0);
    assert.equal(workers[2].request.recipe.settings.amount, 0.7);
    workers[2].finish();
    assert.equal(elements.sliceVolume.attributes['aria-valuetext'], 'Muted');
    assert.equal(elements.wav.download, 'hen-morph-70pct-slices-0pct.wav');
    elements.morphAmount.value = '25'; elements.morphAmount.oninput(); runTimers();
    buttons[1].onclick(); workers[3].finish();
    assert.equal(workers[3].stopped, true);
    assert.equal(elements.wav.href, 'original.wav');
    buttons[0].onclick(); runTimers();
    assert.equal(workers[4].request.recipe.settings.amount, 0.25);
    assert.equal(workers[4].request.recipe.sliceLayer.level, 0);
    assert.equal(Number(elements.sliceVolume.value), 0);
  } finally { events.get('pagehide')({ persisted: false }); }
  assert.equal(workers.at(-1).stopped, true);
  assert.equal(blobs.size, 0);
  assert.equal(timers.size, 0);
});
