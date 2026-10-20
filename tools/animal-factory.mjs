#!/usr/bin/env node
// Local audition of the handler line. Optional game assets stay in ignored
// audition/, never in the distributable or repository. No server is needed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, encodeWav, decodeBank, mouthCues, revealSchedule, compactVoice, PRESETS, resolveVoice } from '../src/index.mjs';
import { rms, db } from './analyze.mjs';
import { morphTimbre, padMorphSources } from './morph-audio.mjs';
import { mixSliceLayer } from './mix-slice-layer.mjs';
import { bundle } from './build-standalone.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const example = JSON.parse(fs.readFileSync(path.join(root, 'examples/animal-factory/handler.json'), 'utf8'));
const timing = JSON.parse(fs.readFileSync(path.join(root, 'examples/animal-factory/handler.timing.json'), 'utf8'));
const trials = JSON.parse(fs.readFileSync(path.join(root, 'examples/animal-factory/voices.json'), 'utf8'));
const characters = JSON.parse(fs.readFileSync(path.join(root, 'examples/animal-factory/character-voices.json'), 'utf8'));
const bankTrials = JSON.parse(fs.readFileSync(path.join(root, 'examples/animal-factory/bank-voices.json'), 'utf8'));
const layering = JSON.parse(fs.readFileSync(path.join(root, 'examples/animal-factory/layers.json'), 'utf8'));
const morphing = JSON.parse(fs.readFileSync(path.join(root, 'examples/animal-factory/morph.json'), 'utf8'));
const sliceLayer = JSON.parse(fs.readFileSync(path.join(root, 'examples/animal-factory/slice-layer.json'), 'utf8'));
const morphPairs = JSON.parse(fs.readFileSync(path.join(root, 'examples/animal-factory/morph-pairs.json'), 'utf8'));
let game, bankFile, out = path.join(root, 'audition/animal-factory');
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i], value = process.argv[++i];
  if (!value || !['--game', '--bank', '-o', '--out'].includes(key)) throw new Error('usage: node tools/animal-factory.mjs [--game /path/to/AnimalFactory3D/game] [--bank file.bank.wav] [-o directory]');
  if (key === '--game') game = path.resolve(value);
  else if (key === '--bank') bankFile = path.resolve(value);
  else out = path.resolve(value);
}
// Use the existing bank and sampler unchanged. A bad bank must fail rather
// than silently substituting a synthetic voice for the requested recording.
const bankBytes = bankFile ? fs.readFileSync(bankFile) : null;
const bank = bankBytes ? decodeBank(bankBytes) : null;
const bankInfo = bank ? { name: bank.name, source: bank.source, note: bank.note,
  file: 'voice.bank.wav', sampleRate: bank.sampleRate, segmentSeconds: bank.segmentSeconds,
  segments: bank.segments.length, looks: Object.fromEntries(Object.entries(bank.looks).map(([k, v]) => [k, v.length])) } : null;

let sequence = null, referenceDir;
if (game) {
  referenceDir = path.join(game, 'dist/tactics/intro-sprites/room-02');
  sequence = JSON.parse(fs.readFileSync(path.join(referenceDir, 'sequence.json'), 'utf8'));
  const speech = sequence.spec?.speech;
  if (speech?.start !== example.sceneStart || JSON.stringify(speech?.syllables) !== JSON.stringify(example.syllables)) {
    throw new Error('The game speech cues have changed. Update the example and timing fixture before comparing this shot.');
  }
}
fs.mkdirSync(out, { recursive: true });
if (bankBytes) fs.writeFileSync(path.join(out, bankInfo.file), bankBytes);
if (sequence) {
  fs.mkdirSync(path.join(out, 'reference'), { recursive: true });
  for (const name of [sequence.plate, ...sequence.sheets]) {
    if (name !== path.basename(name)) throw new Error('Expected a plain filename in the reference sequence');
    fs.copyFileSync(path.join(referenceDir, name), path.join(out, 'reference', name));
  }
}

const sampleRate = 44100, preRoll = example.sceneStart - example.shotFrom;
const variants = [
  ...(bank ? bankTrials.map((v) => ({ ...v, voice: { ...v.voice, bank: bank.name }, timing, engine: 'sampler', group: 'MUSIC SLICES' })) : []),
  ...trials.map((v) => ({ ...v, timing, group: 'FORMANT SPEECH' })),
  { id: 'original-narrator', label: 'Original narrator', voice: 'narrator', note: 'Existing default voice and natural timing. A baseline, not a recording from the game.' },
  { id: 'hen-natural', label: 'Hen · natural timing', voice: 'hen', note: 'Species-specific cluck syllables; the engine chooses the rhythm.' },
  { id: 'hen-cued', label: 'Hen · matched to beak', voice: 'hen', timing, note: 'The same hen, with every syllable fitted to the animation.' },
  { id: 'hen-radio-cued', label: 'Hen · radio + matched beak', voice: 'hen-radio', timing, note: 'The matched performance through the radio band. No added bit crushing.' },
  ...characters.map((v) => {
    const voice = resolveVoice(v.voice);
    if (voice.mode !== 'syllable') throw new Error(`Character audition needs a syllable voice: ${v.id}`);
    return { ...v, timing, group: 'CHARACTER SPEECH', note: PRESETS[v.voice].note,
      tag: `${voice.wave === 'whisper' ? 'Unvoiced whisper' : voice.pitch + ' Hz'} · 14 animation cues` };
  }),
];
function saveTake(v, r) {
  const morphed = v.engine === 'morph', compound = v.engine === 'layered' || morphed;
  const sampled = v.engine === 'sampler' || compound;
  const said = r.plan.units.filter((u) => u.kind !== 'rest');
  const maxCueErrorMs = Math.max(...said.flatMap((u, i) => [Math.abs(u.t0 - timing.cues[i][0]), Math.abs(u.t1 - timing.cues[i][1])])) * 1000;
  const peak = r.samples.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
  const clip = `${v.id}.wav`, sceneClip = `${v.id}.scene.wav`, cueFile = `${v.id}.cues.json`;
  const voiceFile = compound ? undefined : `${v.id}.voice.json`, recipeFile = compound ? `${v.id}.${morphed ? 'morph' : 'mix'}.json` : undefined;
  const voice = compound ? undefined : compactVoice(r.plan.voice);
  fs.writeFileSync(path.join(out, recipeFile ?? voiceFile), JSON.stringify(v.recipe ?? voice, null, 2));
  fs.writeFileSync(path.join(out, clip), encodeWav(r.samples, sampleRate));
  const scene = new Float32Array(Math.max(Math.ceil((example.shotTo - example.shotFrom) * sampleRate), Math.round(preRoll * sampleRate) + r.samples.length));
  scene.set(r.samples, Math.round(preRoll * sampleRate));
  fs.writeFileSync(path.join(out, sceneClip), encodeWav(scene, sampleRate));
  const cueData = {
    text: example.text, ...(morphed ? { morph: v.recipe } : compound ? { mix: v.recipe } : { voice }), take: 0,
    timing: { duration: r.plan.duration, cues: said.map((u) => [u.t0, u.t1]) }, sampleRate,
    sceneStart: example.sceneStart, duration: r.plan.duration, audioDuration: r.samples.length / sampleRate,
    words: r.plan.words, mouth: mouthCues(r.plan), reveal: revealSchedule(r.plan),
    ...(sampled ? { bank: bankInfo, used: r.used } : {}),
  };
  fs.writeFileSync(path.join(out, cueFile), JSON.stringify(cueData, null, 2));
  return { ...v, engine: v.engine ?? 'formant', group: v.group ?? 'EARLIER FORMANT TAKES',
    ...(sampled ? { bank: bankInfo, used: r.used } : {}),
    voice, clip, sceneClip, cueFile, voiceFile, recipeFile, cueData, scoreSeconds: r.plan.duration, audioSeconds: r.samples.length / sampleRate,
    maxCueErrorMs, peakDbFS: db(peak), rmsDbFS: db(rms(r.samples)), finite: r.samples.every(Number.isFinite) };
}

const rendered = new Map();
const singles = variants.map((v) => {
  const r = render(example.text, v.voice, { sampleRate, timing: v.timing, bank: v.engine === 'sampler' ? bank : undefined });
  rendered.set(v.id, r);
  return saveTake(v, r);
});

// Add the two existing performances on one sample clock. Neither source is
// re-pitched, time-stretched or re-synthesized for layering.
const mixes = bank ? layering.pairs.map((pair) => {
  const speech = rendered.get(pair.speech), slices = rendered.get(pair.slices);
  const speechTake = singles.find((v) => v.id === pair.speech), slicesTake = singles.find((v) => v.id === pair.slices);
  const slots = (p) => p.units.filter((u) => u.kind !== 'rest').map((u) => [u.t0, u.t1]);
  if (!speech || !slices || speechTake.engine !== 'formant' || slicesTake.engine !== 'sampler') throw new Error(`Invalid layer pairing: ${pair.id}`);
  if (speech.samples.length !== slices.samples.length || JSON.stringify(slots(speech.plan)) !== JSON.stringify(slots(slices.plan))) throw new Error(`Layers must have matching speech cues and lengths: ${pair.id}`);
  if (!Number.isFinite(layering.slicesDb)) throw new Error('layers.json: slicesDb must be a finite number');
  const speechRms = rms(speech.samples), slicesRms = rms(slices.samples);
  if (!(speechRms > 0 && slicesRms > 0)) throw new Error(`Cannot layer a silent take: ${pair.id}`);
  const sliceGain = Math.pow(10, layering.slicesDb / 20) * speechRms / slicesRms;
  const samples = Float32Array.from(speech.samples, (x, i) => x + slices.samples[i] * sliceGain);
  const peak = samples.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
  // One common attenuation preserves the requested balance and leaves headroom.
  const masterGain = Math.min(1, 0.9 / peak);
  for (let i = 0; i < samples.length; i++) samples[i] *= masterGain;
  const recipe = { babbleMix: 1, name: pair.id, text: example.text, sampleRate, take: 0, timing,
    slicesDb: layering.slicesDb, bank: bankInfo,
    layers: [
      { id: pair.speech, label: speechTake.label, engine: 'formant', clip: speechTake.clip, voice: speechTake.voice, gain: masterGain },
      { id: pair.slices, label: slicesTake.label, engine: 'sampler', clip: slicesTake.clip, voice: slicesTake.voice, gain: sliceGain * masterGain },
    ] };
  rendered.set(pair.id, { ...speech, samples, used: slices.used });
  return saveTake({ id: pair.id, label: pair.label, engine: 'layered', group: 'LAYERED VOICES', timing, recipe,
    tag: `Speech + music slices · slices ${layering.slicesDb} dB`,
    note: `${speechTake.label} with ${slicesTake.label} overlaid. Both follow the same speech cues; the sliced layer is ${Math.abs(layering.slicesDb)} dB ${layering.slicesDb <= 0 ? 'below' : 'above'} the speech in average signal level.` },
  { ...speech, samples, used: slices.used });
}) : [];
const morphs = bank ? morphPairs.map((pair) => {
  const speech = rendered.get(pair.speech), slices = rendered.get(pair.slices);
  const speechTake = singles.find((v) => v.id === pair.speech), slicesTake = singles.find((v) => v.id === pair.slices);
  const slots = (p) => p.units.filter((u) => u.kind !== 'rest').map((u) => [u.t0, u.t1]);
  if (!speech || !slices || speechTake.engine !== 'formant' || slicesTake.engine !== 'sampler') throw new Error(`Invalid morph pairing: ${pair.id}`);
  if (JSON.stringify(slots(speech.plan)) !== JSON.stringify(timing.cues) || JSON.stringify(slots(slices.plan)) !== JSON.stringify(timing.cues)) throw new Error(`Morph sources must follow the animation cues: ${pair.id}`);
  const id = pair.id;
  const [carrier, colour] = padMorphSources(speech.samples, slices.samples);
  const morph = morphTimbre(carrier, colour, sampleRate, { ...morphing, cues: timing.cues });
  if (sliceLayer.algorithm !== 'rms-overlay-v1') throw new Error('Unsupported slice layer algorithm');
  const mix = mixSliceLayer(morph.samples, colour, sliceLayer.level, morphing.peakLimit);
  const recipe = { babbleMorph: 2, algorithm: 'cepstral-envelope-v1', name: id, text: example.text,
    sampleRate, take: 0, timing, settings: morphing, sliceLayer, bank: bankInfo, sourceAlignment: 'pad-end-with-silence',
    sources: [
      { role: 'carrier', id: pair.speech, label: speechTake.label, engine: 'formant', clip: speechTake.clip, voice: speechTake.voice },
      { role: 'colour', id: pair.slices, label: slicesTake.label, engine: 'sampler', clip: slicesTake.clip, voice: slicesTake.voice },
    ] };
  return saveTake({ id, label: pair.label, engine: 'morph', group: pair.group, timing, recipe,
    tag: `${Math.round(morphing.amount * 100)}% morph · slices ${Math.round(sliceLayer.level * 100)}%`, morphMetrics: morph.metrics, sliceLayerMetrics: mix.metrics,
    note: `${speechTake.label} morphed ${Math.round(morphing.amount * 100)}% toward ${slicesTake.label}, with the original sliced track added at ${Math.round(sliceLayer.level * 100)}% of the morphed voice's average level. Adjust tone and added slices independently.` },
  { ...speech, samples: mix.samples, used: slices.used });
}) : [];
const results = [...morphs, ...mixes, ...singles];
const report = { text: example.text, reference: sequence ? 'Local game room-02 sprite sequence; speech cues verified against the fixture' : 'No game assets supplied; timing fixture only',
  sceneStart: example.sceneStart, syllables: timing.cues.length, sampleRate, bank: bankInfo, variants: results };
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(out, 'cast.json'), JSON.stringify(Object.fromEntries(singles.map((v) => [v.id, v.voice])), null, 2));

// Preserve the exact pre-WAV Float32 sources so the browser and offline morphs
// are identical. Embedded samples also work when this page is opened locally.
const sources = Object.fromEntries([...rendered].map(([id, { samples }]) => {
  const bytes = Buffer.alloc(samples.length * 4);
  for (let i = 0; i < samples.length; i++) bytes.writeFloatLE(samples[i], i * 4);
  return [id, bytes.toString('base64')];
}));
const data = JSON.stringify({ example, sequence, results, bank: bankInfo, sources }).replace(/</g, '\\u003c');
const workerSource = bank ? bundle(['tools/audition-morph-render.mjs']) +
  "const analysisCache = {}; self.onmessage = ({data}) => __m['tools/audition-morph-render.mjs'].handleMorphMessage(data, (value, transfer) => self.postMessage(value, transfer), analysisCache);\n" : '';
const controlSource = bundle(['tools/audition-morph-control.mjs', 'tools/audition-player.mjs']);
const template = fs.readFileSync(path.join(root, 'tools/animal-factory.html'), 'utf8');
fs.writeFileSync(path.join(out, 'index.html'), template.replace('/*AUDITION_DATA*/', () =>
  `const DATA = ${data};\nconst MORPH_WORKER = ${JSON.stringify(workerSource).replace(/</g, '\\u003c')};\n${controlSource}`));
console.log(path.join(out, 'index.html'));
console.log(JSON.stringify(results.map(({ id, maxCueErrorMs, peakDbFS }) => ({ id, maxCueErrorMs, peakDbFS })), null, 2));
