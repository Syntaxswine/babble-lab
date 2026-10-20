import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeBank, encodeBank, decodeBank, encodeWav, decodeWav, render } from '../src/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const generate = (...args) => spawnSync(process.execPath, [path.join(root, 'tools/animal-factory.mjs'), ...args], { encoding: 'utf8', timeout: 30000 });
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
    assert.equal(report.variants.length, 18);
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
    const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
    new vm.Script(script); // generated data and the page script must parse together
    assert.match(html, /MUSIC SLICES/);
    assert.match(html, /FORMANT SPEECH/);

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

test('without a bank the audition keeps its twelve formant comparisons and labels them', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'babble-formant-audition-'));
  try {
    const built = generate('-o', dir);
    assert.equal(built.status, 0, built.stderr);
    const report = readJSON(path.join(dir, 'report.json'));
    assert.equal(report.bank, null);
    assert.equal(report.variants.length, 12);
    assert.ok(report.variants.every((v) => v.engine === 'formant' && !v.bank && !v.used));
    assert.equal(fs.existsSync(path.join(dir, 'voice.bank.wav')), false);
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
