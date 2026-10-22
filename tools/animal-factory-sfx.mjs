#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { decodeWav, encodeWav } from '../src/wav.mjs';
import { decodeBank } from '../src/bank.mjs';
import { prepareEffect, sliceEffect } from './sfx-audio.mjs';
import { renderMorphTake } from './audition-morph-render.mjs';
import { rms, db } from './analyze.mjs';
import { bundle } from './build-standalone.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let assets = path.join(root, 'out/sfx-assets'), bankFile = path.join(root, 'banks/glades-of-arcadia.bank.wav'), out = path.join(root, 'audition/animal-factory/sfx');
let manifestFile = path.join(root, 'examples/animal-factory/sfx-assets.json');
for (let i = 2; i < process.argv.length; i += 2) {
  const [key, value] = process.argv.slice(i, i + 2);
  if (!value || !['--assets', '--bank', '--out', '--manifest'].includes(key)) throw new Error('usage: node tools/animal-factory-sfx.mjs [--assets directory] [--bank file] [--out directory] [--manifest file]');
  if (key === '--assets') assets = path.resolve(value); else if (key === '--bank') bankFile = path.resolve(value);
  else if (key === '--out') out = path.resolve(value); else manifestFile = path.resolve(value);
}
const manifest = JSON.parse(fs.readFileSync(manifestFile)), bankBytes = fs.readFileSync(bankFile), bank = decodeBank(bankBytes);
if (manifest.babbleSfxAssets !== 1 || !Array.isArray(manifest.effects) || !manifest.effects.length) throw new Error('Invalid sound-effect manifest');
const ids = manifest.effects.map(e => e.id);
if (new Set(ids).size !== ids.length || ids.some(id => !/^[a-z0-9][a-z0-9-]*$/.test(id))) throw new Error('Effect IDs must be unique plain names');
if (![manifest.defaults?.amount, manifest.defaults?.sliceLevel].every(n => Number.isFinite(n) && n >= 0 && n <= 1)) throw new Error('Effect defaults must be in 0..1');
const { sampleRate } = manifest;
const morphSettings = { ...JSON.parse(fs.readFileSync(path.join(root, 'examples/animal-factory/morph.json'))), amount: manifest.defaults.amount };
const bankInfo = { name: bank.name, source: bank.source, note: bank.note, sha256: createHash('sha256').update(bankBytes).digest('hex') };
const encoded = (samples) => {
  const bytes = Buffer.alloc(samples.length * 4); for (let i = 0; i < samples.length; i++) bytes.writeFloatLE(samples[i], i * 4);
  return bytes.toString('base64');
};
const sources = {}, results = [];
// Validate and prepare everything before replacing a previous audition.
const prepared = manifest.effects.map((effect) => {
  const file = path.resolve(assets, effect.preparedFile), relative = path.relative(assets, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Source file leaves the asset directory');
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}. Run tools/fetch-animal-factory-sfx.mjs first.`);
  const bytes = fs.readFileSync(file), wav = decodeWav(bytes);
  if (wav.sampleRate !== sampleRate) throw new Error(`Expected ${sampleRate} Hz: ${effect.id}`);
  const original = prepareEffect(wav.samples, sampleRate, effect.trim);
  const sliced = sliceEffect(original.samples, sampleRate, bank, { id: effect.id, ...effect.texture });
  return { effect, original, sliced, preparedSha256: createHash('sha256').update(bytes).digest('hex') };
});
for (const { effect, original, sliced, preparedSha256 } of prepared) {
  const id = effect.id, originalId = `${id}.original`, sliceId = `${id}.slices`, duration = original.samples.length / sampleRate;
  sources[originalId] = encoded(original.samples); sources[sliceId] = encoded(sliced.samples);
  const timing = { duration, cues: [[0, duration]] };
  const recipe = { babbleMorph: 2, algorithm: 'cepstral-envelope-v1', name: id, sampleRate, settings: morphSettings,
    timing, sourceAlignment: 'pad-end-with-silence', sliceLayer: { algorithm: 'rms-overlay-v1', level: manifest.defaults.sliceLevel },
    bank: bankInfo, sourceAsset: effect.source, license: effect.license, preparation: { ...original, samples: undefined, preparedSha256 },
    slicePerformance: { texture: effect.texture, events: sliced.events, used: sliced.used, envelope: 'effect-rms-10ms-v1' },
    sources: [{ id: originalId, label: effect.label, role: 'carrier', engine: 'recording' }, { id: sliceId, label: 'Glades music slices', role: 'colour', engine: 'sampler' }] };
  const result = renderMorphTake({ recipe, sources, preRoll: 0, sceneSeconds: duration });
  const cueData = { sampleRate, duration, events: sliced.events, morph: recipe };
  results.push({ id, label: effect.label, group: effect.group, engine: 'morph', recipe, cueData,
    clip: `${id}.wav`, sceneClip: `${id}.wav`, recipeFile: `${id}.morph.json`, cueFile: `${id}.events.json`,
    originalClip: `${id}.original.wav`, slicesClip: `${id}.slices.wav`, audioSeconds: duration,
    originalRmsDbFS: db(rms(original.samples)), rmsDbFS: result.rmsDbFS, peakDbFS: result.peakDbFS,
    morphMetrics: result.morphMetrics, sliceLayerMetrics: result.sliceLayerMetrics,
    original: original.samples, slices: sliced.samples, rendered: result.playback.samples, output: result.clip });
}
fs.mkdirSync(out, { recursive: true });
const reelParts = [], reelEvents = []; let reelLength = 0;
for (const r of results) {
  fs.writeFileSync(path.join(out, r.originalClip), encodeWav(r.original, sampleRate));
  fs.writeFileSync(path.join(out, r.slicesClip), encodeWav(r.slices, sampleRate));
  fs.writeFileSync(path.join(out, r.clip), r.output);
  fs.writeFileSync(path.join(out, r.recipeFile), JSON.stringify(r.recipe, null, 2));
  fs.writeFileSync(path.join(out, r.cueFile), JSON.stringify(r.cueData, null, 2));
  const clip = r.rendered;
  reelEvents.push({ id: r.id, label: r.label, from: reelLength / sampleRate, to: (reelLength + clip.length) / sampleRate });
  reelParts.push(clip, new Float32Array(Math.round(.4 * sampleRate))); reelLength += clip.length + Math.round(.4 * sampleRate);
  delete r.original; delete r.slices; delete r.rendered; delete r.output;
}
const reel = new Float32Array(reelLength); let offset = 0;
for (const part of reelParts) { reel.set(part, offset); offset += part.length; }
fs.writeFileSync(path.join(out, 'showcase.wav'), encodeWav(reel, sampleRate));
fs.writeFileSync(path.join(out, 'showcase.json'), JSON.stringify({ sampleRate, settings: manifest.defaults, events: reelEvents }, null, 2));
const DATA = { results, sources, bank: bankInfo, defaults: manifest.defaults, sampleRate };
const worker = bundle(['tools/audition-morph-render.mjs']) + "const cache={};self.onmessage=({data})=>__m['tools/audition-morph-render.mjs'].handleMorphMessage(data,(value,transfer)=>self.postMessage(value,transfer),cache);";
const script = `const DATA=${JSON.stringify(DATA).replace(/</g, '\\u003c')};\nconst MORPH_WORKER=${JSON.stringify(worker).replace(/</g, '\\u003c')};\n${bundle(['tools/audition-morph-control.mjs', 'tools/audition-player.mjs'])}`;
const template = fs.readFileSync(path.join(root, 'tools/animal-factory-sfx.html'), 'utf8');
fs.writeFileSync(path.join(out, 'index.html'), template.replace('/*SFX_DATA*/', () => script));
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ ...DATA, sources: undefined }, null, 2));
console.log(JSON.stringify({ page: path.join(out, 'index.html'), effects: results.length, defaults: manifest.defaults }));
