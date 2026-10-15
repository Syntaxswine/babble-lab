#!/usr/bin/env node
// Local audition of the handler line. Optional game assets stay in ignored
// audition/, never in the distributable or repository. No server is needed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, encodeWav, mouthCues, revealSchedule, compactVoice } from '../src/index.mjs';
import { rms, db } from './analyze.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const example = JSON.parse(fs.readFileSync(path.join(root, 'examples/animal-factory/handler.json'), 'utf8'));
const timing = JSON.parse(fs.readFileSync(path.join(root, 'examples/animal-factory/handler.timing.json'), 'utf8'));
let game, out = path.join(root, 'audition/animal-factory');
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i], value = process.argv[++i];
  if (!value || !['--game', '-o', '--out'].includes(key)) throw new Error('usage: node tools/animal-factory.mjs [--game /path/to/AnimalFactory3D/game] [-o directory]');
  if (key === '--game') game = path.resolve(value); else out = path.resolve(value);
}

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
if (sequence) {
  fs.mkdirSync(path.join(out, 'reference'), { recursive: true });
  for (const name of [sequence.plate, ...sequence.sheets]) {
    if (name !== path.basename(name)) throw new Error('Expected a plain filename in the reference sequence');
    fs.copyFileSync(path.join(referenceDir, name), path.join(out, 'reference', name));
  }
}

const sampleRate = 44100, preRoll = example.sceneStart - example.shotFrom;
const variants = [
  { id: 'original-narrator', label: 'Original narrator', voice: 'narrator', note: 'Existing default voice and natural timing. A baseline, not a recording from the game.' },
  { id: 'hen-natural', label: 'Hen · natural timing', voice: 'hen', note: 'Species-specific cluck syllables; the engine chooses the rhythm.' },
  { id: 'hen-cued', label: 'Hen · matched to beak', voice: 'hen', timing, note: 'The same hen, with every syllable fitted to the animation.' },
  { id: 'hen-radio-cued', label: 'Hen · radio + matched beak', voice: 'hen-radio', timing, note: 'The matched performance through the radio band. No added bit crushing.' },
];
const results = variants.map((v) => {
  const r = render(example.text, v.voice, { sampleRate, timing: v.timing });
  const said = r.plan.units.filter((u) => u.kind !== 'rest');
  const maxCueErrorMs = Math.max(...said.flatMap((u, i) => [Math.abs(u.t0 - timing.cues[i][0]), Math.abs(u.t1 - timing.cues[i][1])])) * 1000;
  const peak = r.samples.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
  const clip = `${v.id}.wav`, sceneClip = `${v.id}.scene.wav`, cueFile = `${v.id}.cues.json`;
  fs.writeFileSync(path.join(out, clip), encodeWav(r.samples, sampleRate));
  const scene = new Float32Array(Math.max(Math.ceil((example.shotTo - example.shotFrom) * sampleRate), Math.round(preRoll * sampleRate) + r.samples.length));
  scene.set(r.samples, Math.round(preRoll * sampleRate));
  fs.writeFileSync(path.join(out, sceneClip), encodeWav(scene, sampleRate));
  fs.writeFileSync(path.join(out, cueFile), JSON.stringify({
    text: example.text, voice: compactVoice(r.plan.voice), take: 0,
    timing: { duration: r.plan.duration, cues: said.map((u) => [u.t0, u.t1]) }, sampleRate,
    sceneStart: example.sceneStart, duration: r.plan.duration, audioDuration: r.samples.length / sampleRate,
    words: r.plan.words, mouth: mouthCues(r.plan), reveal: revealSchedule(r.plan),
  }, null, 2));
  return { ...v, clip, sceneClip, cueFile, scoreSeconds: r.plan.duration, audioSeconds: r.samples.length / sampleRate,
    maxCueErrorMs, peakDbFS: db(peak), rmsDbFS: db(rms(r.samples)), finite: r.samples.every(Number.isFinite) };
});
const report = { text: example.text, reference: sequence ? 'Local game room-02 sprite sequence; speech cues verified against the fixture' : 'No game assets supplied; timing fixture only',
  sceneStart: example.sceneStart, syllables: timing.cues.length, sampleRate, variants: results };
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));

const data = JSON.stringify({ example, sequence, results }).replace(/</g, '\\u003c');
const template = fs.readFileSync(path.join(root, 'tools/animal-factory.html'), 'utf8');
fs.writeFileSync(path.join(out, 'index.html'), template.replace('/*AUDITION_DATA*/', `const DATA = ${data};`));
console.log(path.join(out, 'index.html'));
console.log(JSON.stringify(results.map(({ id, maxCueErrorMs, peakDbFS }) => ({ id, maxCueErrorMs, peakDbFS })), null, 2));
