import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { encodeWav, decodeWav } from '../src/wav.mjs';
import { makeBank, encodeBank } from '../src/bank.mjs';
import { prepareEffect, sliceEffect } from '../tools/sfx-audio.mjs';
import { renderMorphTake, decodeTrack } from '../tools/audition-morph-render.mjs';
import { AudioContext } from './helpers/audio.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sr = 16000;
const source = Float32Array.from({ length: sr / 2 }, (_, i) => i < 800 ? 0 : Math.sin(i * .53) * Math.exp(-(i - 800) / 900) * .4);
const bank = makeBank(Float32Array.from({ length: sr * 4 }, (_, i) => .2 * Math.sin(2 * Math.PI * 180 * i / sr)), sr);
const run = (...args) => spawnSync(process.execPath, [path.join(root, 'tools/animal-factory-sfx.mjs'), ...args], { encoding: 'utf8', timeout: 30000 });

test('effect preparation retains the transient clock, and real sampler slices follow its envelope', () => {
  const before = source.slice(), prepared = prepareEffect(source, sr, { from: .04, seconds: .32 });
  assert.deepEqual(source, before);
  assert.ok(prepared.samples.subarray(0, Math.round(sr * .01)).every(x => x === 0));
  assert.ok(prepared.samples.subarray(-Math.round(sr * .05)).every(x => x === 0));
  assert.ok(Math.abs(Math.max(...prepared.samples.map(Math.abs)) - .85) < 1e-6);
  for (const look of ['struck', 'wash', 'tonal']) {
    const slices = sliceEffect(prepared.samples, sr, bank, { id: 'fixture', look, pitch: 210 });
    assert.equal(slices.samples.length, prepared.samples.length);
    assert.ok(slices.used.length > 0);
    assert.ok(slices.used.every(s => s.look === look));
    assert.ok(slices.rms > 0);
    assert.ok(slices.samples.every(x => Number.isFinite(x) && Math.abs(x) <= .85001));
    assert.ok(slices.samples.subarray(-Math.round(sr * .02)).every(x => x === 0));
    assert.deepEqual(sliceEffect(prepared.samples, sr, bank, { id: 'fixture', look, pitch: 210 }).samples, slices.samples);
  }
  assert.throws(() => prepareEffect(source, sr, { from: 20, seconds: 1 }), /outside/);
  assert.throws(() => prepareEffect(source, sr, { from: 0, seconds: -.1 }), /trim/);
  assert.throws(() => sliceEffect(new Float32Array(100), sr, bank, { id: 'silent' }), /silent/);
});

test('SFX audition exports the exact two-stage treatment, preserves A/B transport, and refuses bad inputs without overwriting it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'babble-sfx-'));
  try {
    const assets = path.join(dir, 'assets'), out = path.join(dir, 'out'), manifestFile = path.join(dir, 'assets.json'), bankFile = path.join(dir, 'bank.wav');
    fs.mkdirSync(assets); fs.writeFileSync(path.join(assets, 'fixture.wav'), encodeWav(source, sr)); fs.writeFileSync(bankFile, encodeBank(bank));
    const effect = { id: 'one', label: 'Fixture impact', group: 'IMPACTS', preparedFile: 'fixture.wav', trim: { from: .04, seconds: .32 }, texture: { look: 'struck', pitch: 210 },
      source: { publisher: 'Fixture', library: 'Test source', archiveEntry: 'fixture.wav' }, license: { id: 'CC0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' } };
    const manifest = { babbleSfxAssets: 1, sampleRate: sr, defaults: { amount: .7, sliceLevel: .2 }, effects: [effect, { ...effect, id: 'two', label: 'Second impact', texture: { look: 'wash', pitch: 140 } }] };
    fs.writeFileSync(manifestFile, JSON.stringify(manifest));
    const args = ['--assets', assets, '--bank', bankFile, '--out', out, '--manifest', manifestFile];
    const built = run(...args); assert.equal(built.status, 0, built.stderr);
    const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8'), script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
    new vm.Script(script);
    const { DATA, MORPH_WORKER } = vm.runInNewContext(script.slice(0, script.indexOf('const $=')) + '\n({DATA,MORPH_WORKER})');
    assert.equal(DATA.results.length, 2); assert.equal(Object.keys(DATA.sources).length, 4);
    let reply; const worker = { postMessage(value) { reply = value; } }; new Function('self', MORPH_WORKER)(worker);
    for (const v of DATA.results) {
      assert.equal(v.recipe.settings.amount, .7); assert.equal(v.recipe.sliceLayer.level, .2);
      assert.ok(v.recipe.preparation.preparedSha256);
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, v.recipeFile))), JSON.parse(JSON.stringify(v.recipe)));
      const rebuilt = renderMorphTake({ recipe: v.recipe, sources: DATA.sources, preRoll: 0, sceneSeconds: v.audioSeconds });
      assert.deepEqual(fs.readFileSync(path.join(out, v.clip)), Buffer.from(rebuilt.clip));
      for (const [amount, level] of [[0, 0], [1, 1], [.73, .17]]) {
        const recipe = { ...v.recipe, settings: { ...v.recipe.settings, amount }, sliceLayer: { ...v.recipe.sliceLayer, level } };
        worker.onmessage({ data: { recipe, sources: DATA.sources, preRoll: 0, sceneSeconds: v.audioSeconds } });
        assert.equal(reply.error, undefined);
        const { samples } = decodeWav(reply.result.clip);
        assert.equal(samples.length, rebuilt.playback.samples.length);
        assert.ok(samples.every(x => Number.isFinite(x) && Math.abs(x) <= .90001));
        if (amount === 0 && level === 0) assert.deepEqual(Buffer.from(reply.result.clip), fs.readFileSync(path.join(out, v.originalClip)));
      }
    }
    const reel = decodeWav(fs.readFileSync(path.join(out, 'showcase.wav')));
    const reelEvents = JSON.parse(fs.readFileSync(path.join(out, 'showcase.json'))).events;
    assert.equal(reelEvents.length, DATA.results.length);
    for (const event of reelEvents) {
      const v = DATA.results.find(v => v.id === event.id), clip = decodeWav(fs.readFileSync(path.join(out, v.clip))).samples;
      assert.deepEqual(reel.samples.subarray(Math.round(event.from * sr), Math.round(event.from * sr) + clip.length), clip);
    }
    await exercisePage(script, DATA);
    for (const effects of [[{ ...effect, id: '../outside' }], [effect, effect], [{ ...effect, preparedFile: 'missing.wav' }]]) {
      fs.writeFileSync(manifestFile, JSON.stringify({ ...manifest, effects }));
      assert.notEqual(run(...args).status, 0);
      assert.equal(fs.readFileSync(path.join(out, 'index.html'), 'utf8'), html);
    }
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir())); fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function exercisePage(script, DATA) {
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.currentTime = 0; this.paused = true; this.checked = true; this.volume = 1; this.playbackRate = 1; }
    append(child) { this.children.push(child); }
    querySelectorAll(tag) { return this.children.flatMap(c => [...(c.tag === tag ? [c] : []), ...c.querySelectorAll(tag)]); }
    setAttribute(key, value) { this.attributes[key] = value; }
    removeAttribute(key) { delete this.attributes[key]; delete this[key]; }
    pause() { if (!this.paused) { this.paused = true; this.onpause?.(); } }
    load() { this.loads = (this.loads ?? 0) + 1; }
    play() { this.paused = false; this.plays = (this.plays ?? 0) + 1; this.onplay?.(); return Promise.resolve(); }
    getContext() { return { clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} }; }
  }
  const template = fs.readFileSync(path.join(root, 'tools/animal-factory-sfx.html'), 'utf8');
  const elements = Object.fromEntries([...template.matchAll(/<(\w+)[^>]*\bid="([^"]+)"/g)].map(m => [m[2], new Element(m[1])]));
  const events = new Map(), timers = new Map(), blobs = new Map(), workers = [], contexts = []; let serial = 0;
  class Worker {
    constructor() { workers.push(this); }
    postMessage(job) { this.job = job; }
    terminate() { this.stopped = true; }
    finish() { this.onmessage({ data: { result: renderMorphTake(this.job) } }); }
  }
  const context = { document: { getElementById: id => elements[id], createElement: tag => new Element(tag), addEventListener(type, fn) { events.set(type, fn); } },
    Blob, Worker, atob, Float32Array, Float64Array, Uint8Array, DataView, ArrayBuffer,
    AudioContext: class extends AudioContext { constructor() { super(); contexts.push(this); } },
    URL: { createObjectURL(blob) { const url = `blob:${++serial}`; blobs.set(url, blob); return url; }, revokeObjectURL(url) { blobs.delete(url); } },
    setTimeout(fn, delay) { const id = ++serial; timers.set(id, { fn, delay }); return id; }, clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame() {}, cancelAnimationFrame() {}, addEventListener(type, fn) { events.set(type, fn); } };
  const flush = () => { for (const [id, { fn, delay }] of [...timers]) if (delay <= 25) { timers.delete(id); fn(); } };
  const settle = () => new Promise(resolve => setTimeout(resolve, 5));
  vm.runInNewContext(script, context);
  const audio = elements.audio;
  try {
    assert.equal(Number(elements.amount.value), 70); assert.equal(Number(elements.slices.value), 20);
    flush(); workers[0].finish(); await elements.replay.onclick(); await settle();
    audio.currentTime = .12; contexts[0].currentTime += .12;
    const transport = audio.src, loads = audio.loads, plays = audio.plays;
    elements.original.onclick();
    assert.equal(elements.wav.href, DATA.results[0].originalClip);
    assert.equal(audio.src, transport); assert.equal(audio.currentTime, .12); assert.equal(audio.plays, plays);
    elements.treated.onclick(); elements.amount.value = '73'; elements.amount.oninput(); flush();
    elements.slices.value = '17'; elements.slices.oninput();
    assert.equal(elements.wav.href, undefined); assert.equal(audio.paused, false);
    workers[0].finish();
    assert.equal(audio.src, transport); assert.equal(audio.currentTime, .12); assert.equal(audio.loads, loads); assert.equal(audio.plays, plays);
    const recipe = JSON.parse(await blobs.get(elements.recipe.href).text());
    assert.equal(recipe.settings.amount, .73); assert.equal(recipe.sliceLayer.level, .17);
    const wanted = renderMorphTake({ recipe, sources: DATA.sources, preRoll: 0, sceneSeconds: recipe.timing.duration });
    assert.deepEqual(Buffer.from(await blobs.get(elements.wav.href).arrayBuffer()), Buffer.from(wanted.clip));
    elements.choices.querySelectorAll('button')[1].onclick(); flush();
    assert.equal(Number(elements.amount.value), 73); assert.equal(Number(elements.slices.value), 17);
    workers[1].finish(); await settle();
    elements.reset.onclick(); flush(); workers[1].finish();
    assert.equal(Number(elements.amount.value), 70); assert.equal(Number(elements.slices.value), 20);
  } finally { events.get('pagehide')({ persisted: false }); await settle(); }
  assert.ok(workers.every(w => w.stopped)); assert.equal(blobs.size, 0); assert.equal(timers.size, 0);
  assert.ok(contexts.every(c => c.state === 'closed'));
}
