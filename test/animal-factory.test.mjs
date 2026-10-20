import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeBank, encodeBank, decodeBank, encodeWav, decodeWav, render } from '../src/index.mjs';
import { rms } from '../tools/analyze.mjs';
import { morphTimbre, padMorphSources } from '../tools/morph-audio.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const generate = (...args) => spawnSync(process.execPath, [path.join(root, 'tools/animal-factory.mjs'), ...args], { encoding: 'utf8', timeout: 60000 });
const readJSON = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

test('scene audition exports the existing sampler output, its recording and all slice choices', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'babble-sampled-audition-'));
  try {
    const sr = 16000;
    const samples = Float32Array.from({ length: sr * 4 }, (_, i) => 0.2 * Math.sin(2 * Math.PI * 180 * i / sr));
    const bytes = encodeBank(makeBank(samples, sr, { name: 'sample fixture', source: 'fixture.wav' }));
    const bankPath = path.join(dir, 'fixture.bank.wav');
    fs.writeFileSync(bankPath, bytes);
    const out = path.join(dir, 'out');
    const built = generate('--bank', bankPath, '-o', out);
    assert.equal(built.status, 0, built.stderr);
    const bank = decodeBank(bytes), report = readJSON(path.join(out, 'report.json'));
    assert.equal(report.variants.length, 58);
    assert.deepEqual(fs.readFileSync(path.join(out, report.bank.file)), Buffer.from(bytes));
    assert.equal(report.bank.source, 'fixture.wav');
    const sampled = report.variants.filter((v) => v.engine === 'sampler');
    assert.equal(sampled.length, 6);
    for (const v of sampled) {
      const voice = readJSON(path.join(out, v.voiceFile));
      const cues = readJSON(path.join(out, v.cueFile));
      assert.equal(voice.bank, bank.name);
      const expected = render(report.text, voice, { sampleRate: report.sampleRate, timing: cues.timing, bank });
      assert.deepEqual(fs.readFileSync(path.join(out, v.clip)), Buffer.from(encodeWav(expected.samples, expected.sampleRate)), `${v.id} diverged from the existing sampler`);
      assert.deepEqual(v.used, expected.used);
      assert.deepEqual(cues.used, expected.used);
      assert.equal(v.used.length, 14);
      assert.equal(v.maxCueErrorMs, 0);
      const scene = decodeWav(fs.readFileSync(path.join(out, v.sceneClip)));
      const clip = decodeWav(fs.readFileSync(path.join(out, v.clip)));
      const preRoll = scene.sampleRate; // the fixture starts the line one second into this shot
      assert.ok(scene.samples.subarray(0, preRoll).every((x) => x === 0));
      assert.deepEqual(scene.samples.subarray(preRoll, preRoll + clip.samples.length), clip.samples);
    }
    const speech = report.variants.find((v) => v.id === 'bright-hen');
    assert.equal(speech.engine, 'formant');
    assert.equal(speech.voice.bank, undefined);
    const expectedSpeech = render(report.text, speech.voice, { sampleRate: report.sampleRate, timing: speech.cueData.timing });
    assert.deepEqual(fs.readFileSync(path.join(out, speech.clip)), Buffer.from(encodeWav(expectedSpeech.samples, expectedSpeech.sampleRate)));
    const mixes = report.variants.filter((v) => v.engine === 'layered');
    assert.equal(mixes.length, 6);
    assert.equal(report.variants[0].engine, 'morph');
    const cast = readJSON(path.join(out, 'cast.json'));
    assert.equal(Object.keys(cast).length, 30);
    for (const v of mixes) {
      const recipe = readJSON(path.join(out, v.recipeFile));
      const cues = readJSON(path.join(out, v.cueFile));
      assert.equal(recipe.babbleMix, 1);
      assert.deepEqual(cues.mix, recipe);
      assert.equal(v.voiceFile, undefined);
      assert.equal(v.voice, undefined);
      assert.equal(cast[v.id], undefined);
      assert.equal(recipe.layers.length, 2);
      const sources = recipe.layers.map((l) => render(recipe.text, l.voice, {
        sampleRate: recipe.sampleRate, timing: recipe.timing, bank: l.engine === 'sampler' ? bank : undefined,
      }));
      const [speechLayer, sliceLayer] = recipe.layers;
      assert.ok(speechLayer.gain > 0 && sliceLayer.gain > 0);
      const relativeDb = 20 * Math.log10(rms(sources[1].samples) * sliceLayer.gain / (rms(sources[0].samples) * speechLayer.gain));
      assert.ok(Math.abs(relativeDb - recipe.slicesDb) < 1e-6);
      const mixed = decodeWav(fs.readFileSync(path.join(out, v.clip)));
      assert.equal(mixed.samples.length, sources[0].samples.length);
      let maximumError = 0;
      for (let i = 0; i < mixed.samples.length; i++) {
        const expected = sources[0].samples[i] * speechLayer.gain + sources[1].samples[i] * sliceLayer.gain;
        maximumError = Math.max(maximumError, Math.abs(mixed.samples[i] - expected));
      }
      assert.ok(maximumError < 2 / 32768, `${v.id}: exported recipe lost a layer or changed its gain`);
      assert.ok(mixed.samples.every((x) => Number.isFinite(x) && Math.abs(x) <= 0.9001));
      assert.equal(v.maxCueErrorMs, 0);
      assert.equal(v.used.length, 14);
      const scene = decodeWav(fs.readFileSync(path.join(out, v.sceneClip)));
      assert.ok(scene.samples.subarray(0, scene.sampleRate).every((x) => x === 0));
      assert.deepEqual(scene.samples.subarray(scene.sampleRate, scene.sampleRate + mixed.samples.length), mixed.samples);
    }
    const morphs = report.variants.filter((v) => v.engine === 'morph');
    assert.equal(morphs.length, 22);
    assert.equal(report.variants[0].group, 'CHARACTER MORPHS');
    assert.equal(morphs.filter((v) => v.group === 'CHARACTER MORPHS').length, 12);
    assert.equal(morphs.filter((v) => v.group === 'HEN MORPHS').length, 10);
    const carriers = new Set(morphs.map((v) => v.recipe.sources[0].id));
    for (const v of report.variants.filter((v) => v.engine === 'formant' && v.timing)) {
      assert.ok(carriers.has(v.id), `No morph for ${v.id}`);
    }
    const seenIds = report.variants.map((v) => v.id);
    assert.equal(new Set(seenIds).size, seenIds.length);
    for (const v of morphs) {
      const recipe = readJSON(path.join(out, v.recipeFile));
      assert.equal(recipe.babbleMorph, 1);
      assert.equal(recipe.settings.amount, 0.7);
      assert.equal(recipe.sourceAlignment, 'pad-end-with-silence');
      assert.deepEqual(readJSON(path.join(out, v.cueFile)).morph, recipe);
      assert.equal(v.voice, undefined);
      assert.equal(cast[v.id], undefined);
      const sources = recipe.sources.map((s) => render(recipe.text, s.voice, {
        sampleRate: recipe.sampleRate, timing: recipe.timing, bank: s.engine === 'sampler' ? bank : undefined,
      }));
      const [carrier, colour] = padMorphSources(sources[0].samples, sources[1].samples);
      const rebuilt = morphTimbre(carrier, colour, recipe.sampleRate, { ...recipe.settings, cues: recipe.timing.cues });
      assert.deepEqual(fs.readFileSync(path.join(out, v.clip)), Buffer.from(encodeWav(rebuilt.samples, recipe.sampleRate)));
      assert.equal(v.maxCueErrorMs, 0);
      assert.equal(v.used.length, 14);
      assert.ok(rebuilt.samples.every((x) => Number.isFinite(x) && Math.abs(x) <= 0.9001));
      assert.equal(rms(rebuilt.samples, Math.ceil(1.34 * recipe.sampleRate), Math.ceil(1.44 * recipe.sampleRate)), 0);
      for (const [from, to] of recipe.timing.cues) assert.ok(rms(rebuilt.samples, Math.ceil(from * recipe.sampleRate), Math.ceil(to * recipe.sampleRate)) > 1e-4, `${v.id}: silent syllable`);
    }
    const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
    new vm.Script(script); // generated data and the page script must parse together
    assert.match(html, /MUSIC SLICES/);
    assert.match(html, /FORMANT SPEECH/);
    assert.match(html, /id="morphAmount" type="range" min="0" max="100" step="1"/);
    const embedded = vm.runInNewContext(script.slice(0, script.indexOf('const $=')) + '\n({DATA,MORPH_WORKER})');
    assert.equal(Object.keys(embedded.DATA.sources).length, 28);
    // Exercise the actual bundled worker with the embedded full-precision
    // sources, including the endpoints and a non-preset slider position.
    let message;
    const worker = { postMessage(value) { message = value; } };
    new Function('self', embedded.MORPH_WORKER)(worker);
    const original = morphs.find((v) => v.id === 'morphed-ghost').recipe;
    const sourceTracks = original.sources.map((s) => render(original.text, s.voice, {
      sampleRate: original.sampleRate, timing: original.timing, bank: s.engine === 'sampler' ? bank : undefined,
    }));
    assert.ok(sourceTracks[0].samples.length > sourceTracks[1].samples.length, 'ghost must exercise effects-tail alignment');
    for (const amount of [0, 0.5, 0.73, 1]) {
      const recipe = { ...original, settings: { ...original.settings, amount } };
      worker.onmessage({ data: { recipe, sources: embedded.DATA.sources, preRoll: 1, sceneSeconds: 5.1 } });
      assert.equal(message.error, undefined);
      const [carrier, colour] = padMorphSources(sourceTracks[0].samples, sourceTracks[1].samples);
      const expected = morphTimbre(carrier, colour, recipe.sampleRate, { ...recipe.settings, cues: recipe.timing.cues });
      assert.deepEqual(Buffer.from(message.result.clip), Buffer.from(encodeWav(expected.samples, recipe.sampleRate)), `browser ${amount} diverged from the offline morph`);
      const clip = decodeWav(message.result.clip), scene = decodeWav(message.result.sceneClip);
      assert.ok(scene.samples.subarray(0, scene.sampleRate).every((x) => x === 0));
      assert.deepEqual(scene.samples.subarray(scene.sampleRate, scene.sampleRate + clip.samples.length), clip.samples);
      assert.ok(clip.samples.every((x) => Number.isFinite(x) && Math.abs(x) <= 0.9001));
      assert.equal(rms(clip.samples, Math.ceil(1.34 * recipe.sampleRate), Math.ceil(1.44 * recipe.sampleRate)), 0);
    }
    worker.onmessage({ data: { recipe: original, sources: {}, preRoll: 1, sceneSeconds: 5.1 } });
    assert.ok(message.error); // decode failures are reported to the slider

    // An explicitly requested bad bank cannot silently fall back to the synth
    // or overwrite a previously generated comparison.
    const bad = path.join(dir, 'plain.wav');
    fs.writeFileSync(bad, encodeWav(samples, sr));
    const refused = generate('--bank', bad, '-o', out);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /no babble-lab index/);
    assert.equal(fs.readFileSync(path.join(out, 'index.html'), 'utf8'), html);
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('without a bank the audition includes the hen and character speech comparisons', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'babble-formant-audition-'));
  try {
    const built = generate('-o', dir);
    assert.equal(built.status, 0, built.stderr);
    const report = readJSON(path.join(dir, 'report.json'));
    assert.equal(report.bank, null);
    assert.equal(report.variants.length, 24);
    assert.equal(report.variants.filter((v) => v.group === 'CHARACTER SPEECH').length, 12);
    assert.ok(report.variants.every((v) => v.engine === 'formant' && !v.bank && !v.used));
    assert.equal(fs.existsSync(path.join(dir, 'voice.bank.wav')), false);
    const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
    new vm.Script(script);
    const embedded = vm.runInNewContext(script.slice(0, script.indexOf('const $=')) + '\n({DATA,MORPH_WORKER})');
    assert.equal(embedded.MORPH_WORKER, '');
    assert.equal(Object.keys(embedded.DATA.sources).length, 0);
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
