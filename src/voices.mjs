// A voice is a plain JSON object. This file is the single source of truth for
// what the knobs are, what range they take, and what the workbench draws.

import { mulberry32, mixSeed } from './rng.mjs';

export const MODES = ['syllable', 'letter', 'blip'];
export const WAVES = ['glottal', 'saw', 'square', 'pulse', 'triangle', 'sine', 'whisper'];

// group is only for laying out the workbench
export const PARAMS = [
  { key: 'pitch', group: 'body', label: 'pitch', unit: 'Hz', min: 50, max: 700, step: 1, def: 140, log: true, hint: 'how high the voice sits' },
  { key: 'tract', group: 'body', label: 'size', unit: '×', min: 0.6, max: 1.7, step: 0.01, def: 1, hint: 'vocal tract scale: below 1 is a big creature, above 1 a small one' },
  { key: 'rate', group: 'body', label: 'speed', unit: '×', min: 0.4, max: 3, step: 0.05, def: 1, hint: 'talking speed' },
  { key: 'range', group: 'melody', label: 'melody', unit: 'st', min: 0, max: 14, step: 0.5, def: 6, hint: 'how far pitch moves for stress, questions, excitement. 0 is a monotone' },
  { key: 'lilt', group: 'melody', label: 'lilt', unit: '', min: 0, max: 1, step: 0.01, def: 0.15, hint: 'sing-song wander from syllable to syllable' },
  { key: 'emphasis', group: 'melody', label: 'emphasis', unit: '×', min: 0, max: 2, step: 0.05, def: 1, hint: 'how hard !, ? and CAPS land' },
  { key: 'tilt', group: 'timbre', label: 'brightness', unit: '', min: 0, max: 1, step: 0.01, def: 0.5, hint: 'spectral tilt: dark and muffled to bright and buzzy' },
  { key: 'oq', group: 'timbre', label: 'laxness', unit: '', min: 0.3, max: 0.85, step: 0.01, def: 0.6, hint: 'glottal open quotient: low is pressed and tense, high is soft' },
  { key: 'breath', group: 'timbre', label: 'breath', unit: '', min: 0, max: 1, step: 0.01, def: 0.08, hint: 'air noise mixed into the voice' },
  { key: 'rough', group: 'timbre', label: 'rough', unit: '', min: 0, max: 1, step: 0.01, def: 0, hint: 'cycle-to-cycle jitter and shimmer: hoarseness' },
  { key: 'growl', group: 'timbre', label: 'growl', unit: '', min: 0, max: 1, step: 0.01, def: 0, hint: 'a subharmonic under the voice: fry, snarl' },
  { key: 'nasal', group: 'timbre', label: 'nasal', unit: '', min: 0, max: 1, step: 0.01, def: 0, hint: 'talks through the nose' },
  { key: 'vibDepth', group: 'timbre', label: 'wobble', unit: 'st', min: 0, max: 2, step: 0.05, def: 0, hint: 'vibrato depth: a little is a tremor, a lot is an opera singer' },
  { key: 'vibRate', group: 'timbre', label: 'wobble rate', unit: 'Hz', min: 2, max: 10, step: 0.1, def: 5.5, hint: '' },
  { key: 'articulation', group: 'mouth', label: 'consonants', unit: '', min: 0, max: 1, step: 0.01, def: 1, hint: 'how much the consonants bite. 0 is a hum with the rhythm of the words' },
  { key: 'vowelSpace', group: 'mouth', label: 'vowels', unit: '', min: 0, max: 1, step: 0.01, def: 1, hint: 'how far vowels open. 0 collapses every vowel to "uh": a mumble' },
  { key: 'wordGap', group: 'mouth', label: 'word gap', unit: 's', min: 0, max: 0.2, step: 0.005, def: 0.02, hint: 'silence between words' },
  { key: 'pauses', group: 'mouth', label: 'pauses', unit: '×', min: 0, max: 2.5, step: 0.05, def: 1, hint: 'how long punctuation holds' },
  { key: 'tongue', group: 'language', label: 'tongue', unit: '#', min: 0, max: 9999, step: 1, def: 0, int: true, hint: '0 says the English it is given. Any other number is its own consistent invented language' },
  { key: 'seed', group: 'language', label: 'seed', unit: '#', min: 0, max: 9999, step: 1, def: 1, int: true, hint: 'the small human variation. Same seed, same take' },
];

export const FX_PARAMS = [
  { key: 'crush', label: 'bit crush', unit: 'bit', min: 0, max: 12, step: 1, def: 0, int: true, hint: '0 is off; 4–8 is a game console' },
  { key: 'hold', label: 'sample hold', unit: '×', min: 1, max: 16, step: 1, def: 1, int: true, hint: 'crude downsampling: the other half of a retro sound' },
  { key: 'ring', label: 'ring mod', unit: 'Hz', min: 0, max: 600, step: 1, def: 0, hint: '0 is off; 30–90 is a robot' },
  { key: 'band', label: 'radio band', unit: '', min: 0, max: 1, step: 1, def: 0, int: true, hint: '300–3400 Hz: a phone, an intercom' },
  { key: 'tremolo', label: 'tremolo', unit: '', min: 0, max: 1, step: 0.01, def: 0, hint: 'loudness flutter' },
  { key: 'tremRate', label: 'tremolo rate', unit: 'Hz', min: 1, max: 30, step: 0.5, def: 7, hint: '' },
  { key: 'echo', label: 'echo', unit: '', min: 0, max: 0.8, step: 0.01, def: 0, hint: 'a cave, a ghost' },
  { key: 'echoTime', label: 'echo time', unit: 's', min: 0.03, max: 0.5, step: 0.005, def: 0.16, hint: '' },
];

const DEFAULTS = Object.fromEntries(PARAMS.map((p) => [p.key, p.def]));
const FX_DEFAULTS = Object.fromEntries(FX_PARAMS.map((p) => [p.key, p.def]));

export const DEFAULT_VOICE = {
  name: 'narrator',
  mode: 'syllable',
  wave: 'glottal',
  ...DEFAULTS,
  blip: { len: 0.05, every: 1 },
  syllabary: null, // e.g. [['W','AA'],['W','AO']] — say these instead of the text's own sounds
  bank: null, // the NAME of a voice bank to speak with instead of the synth; the caller supplies the bank itself
  fx: { ...FX_DEFAULTS },
};

// Archetypes, named for what they are and not for any game.
export const PRESETS = {
  narrator: { note: 'the plain voice everything else is a departure from' },
  villager: { mode: 'letter', pitch: 310, tract: 1.27, rate: 1.2, range: 6, lilt: 0.5, tilt: 0.6, breath: 0.05, note: 'letter-by-letter patter, sped up and pitched up' },
  blip: { mode: 'blip', wave: 'square', pitch: 440, range: 3, lilt: 0.35, rate: 1.15, blip: { len: 0.045, every: 1 }, note: 'one chip tone per letter: the classic text-box voice' },
  bigblip: { mode: 'blip', wave: 'triangle', pitch: 98, range: 2, lilt: 0.2, rate: 0.75, blip: { len: 0.1, every: 1 }, note: 'a slow low text blip for someone large' },
  gruff: { pitch: 86, tract: 0.84, rate: 0.86, range: 4, tilt: 0.36, oq: 0.45, rough: 0.45, growl: 0.35, note: 'low, pressed and hoarse' },
  pixie: { pitch: 420, tract: 1.45, rate: 1.35, range: 9, lilt: 0.45, tilt: 0.66, breath: 0.2, oq: 0.7, note: 'tiny, quick, airy' },
  elder: { pitch: 104, tract: 0.97, rate: 0.72, range: 5, breath: 0.3, rough: 0.25, vibDepth: 0.5, vibRate: 4.2, pauses: 1.4, oq: 0.7, note: 'slow, breathy, with a tremor' },
  robot: { wave: 'pulse', pitch: 128, range: 0, lilt: 0, emphasis: 0.2, rate: 0.95, tilt: 0.8, breath: 0, fx: { ring: 55, crush: 7, hold: 3 }, note: 'a monotone pulse wave through a mouth' },
  mumble: { pitch: 132, range: 5, lilt: 0.3, articulation: 0.2, vowelSpace: 0.22, nasal: 0.7, tilt: 0.22, note: 'all rhythm, no words: someone talking behind a wall' },
  ghost: { wave: 'whisper', rate: 0.7, tract: 1.04, breath: 1, pauses: 1.5, range: 4, fx: { tremolo: 0.45, tremRate: 5, echo: 0.45, echoTime: 0.21 }, note: 'no voice at all, only breath shaped by the mouth' },
  imp: { wave: 'square', pitch: 300, tract: 1.3, rate: 1.25, range: 7, lilt: 0.4, tilt: 0.7, fx: { crush: 8, hold: 2 }, note: 'a square wave with a mouth: squeaky chip creature' },
  beast: { pitch: 60, tract: 0.68, rate: 0.7, range: 3, tilt: 0.3, oq: 0.42, rough: 0.6, growl: 0.7, articulation: 0.5, vowelSpace: 0.6, note: 'very large, mostly growl' },
  radio: { pitch: 118, rate: 1.05, range: 5, fx: { band: 1, crush: 10 }, note: 'the narrator through an intercom' },
  hen: { pitch: 285, tract: 1.22, rate: 1.15, range: 6, lilt: 0.22, tilt: 0.43, oq: 0.48, rough: 0.12, nasal: 0.22, breath: 0.04, articulation: 0.8, wordGap: 0.012,
    syllabary: [['K', 'UH'], ['K', 'AH', 'K'], ['B', 'UH', 'K'], ['K', 'AO'], ['G', 'UH'], ['K', 'IH']], note: 'a hen: short clucks following the syllables and expression of the line' },
  'hen-radio': { pitch: 285, tract: 1.22, rate: 1.15, range: 6, lilt: 0.22, tilt: 0.43, oq: 0.48, rough: 0.12, nasal: 0.22, breath: 0.04, articulation: 0.8, wordGap: 0.012,
    syllabary: [['K', 'UH'], ['K', 'AH', 'K'], ['B', 'UH', 'K'], ['K', 'AO'], ['G', 'UH'], ['K', 'IH']], fx: { band: 1 }, note: 'the same hen through a radio; compare with hen to judge the microphone colour' },
  wah: { wave: 'saw', pitch: 175, range: 8, lilt: 0.5, tilt: 0.3, nasal: 0.45, rate: 0.9, syllabary: [['W', 'AA'], ['W', 'AO'], ['W', 'AH'], ['M', 'W', 'AA']], note: 'muted-trombone grown-up: every syllable is "wah"' },
  grunt: { pitch: 92, tract: 0.8, rate: 0.85, range: 5, lilt: 0.4, rough: 0.35, growl: 0.3, nasal: 0.3, tilt: 0.35, syllabary: [['HH', 'AH'], ['G', 'ER'], ['AH', 'N'], ['HH', 'UH', 'M'], ['B', 'AH']], note: 'a small bank of grunts, chosen by the words' },
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Accepts a preset name, a partial voice, or both ({ preset: 'gruff', pitch: 70 }).
export function resolveVoice(voice) {
  if (typeof voice === 'string') voice = { preset: voice };
  voice = voice ?? {};
  const base = voice.preset ?? (voice.name && PRESETS[voice.name] && Object.keys(voice).length === 1 ? voice.name : null);
  if (base && !PRESETS[base]) throw new Error(`babble: unknown preset "${base}" (have: ${Object.keys(PRESETS).join(', ')})`);
  const preset = base ? PRESETS[base] : {};
  const out = {
    ...DEFAULT_VOICE, ...preset, ...voice,
    blip: { ...DEFAULT_VOICE.blip, ...preset.blip, ...voice.blip },
    fx: { ...DEFAULT_VOICE.fx, ...preset.fx, ...voice.fx },
  };
  out.name = voice.name ?? base ?? DEFAULT_VOICE.name;
  delete out.preset;
  delete out.note;
  if (!MODES.includes(out.mode)) throw new Error(`babble: unknown mode "${out.mode}" (have: ${MODES.join(', ')})`);
  if (!WAVES.includes(out.wave)) throw new Error(`babble: unknown wave "${out.wave}" (have: ${WAVES.join(', ')})`);
  for (const p of PARAMS) {
    const v = Number(out[p.key]);
    out[p.key] = clamp(Number.isFinite(v) ? v : p.def, p.min, p.max);
    if (p.int) out[p.key] = Math.round(out[p.key]);
  }
  for (const p of FX_PARAMS) {
    const v = Number(out.fx[p.key]);
    out.fx[p.key] = clamp(Number.isFinite(v) ? v : p.def, p.min, p.max);
    if (p.int) out.fx[p.key] = Math.round(out.fx[p.key]);
  }
  out.blip.len = clamp(Number(out.blip.len) || 0.05, 0.01, 0.4);
  out.blip.every = clamp(Math.round(Number(out.blip.every) || 1), 1, 8);
  if (out.syllabary && !(Array.isArray(out.syllabary) && out.syllabary.length && out.syllabary.every(Array.isArray))) out.syllabary = null;
  out.bank = typeof out.bank === 'string' && out.bank ? out.bank : null;
  return out;
}

// Roll a whole character from one number. Plausible by construction: big
// things are low and slow, small things high and quick, with exceptions.
export function randomVoice(seed) {
  const r = mulberry32(mixSeed('voice', seed >>> 0));
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const size = r(); // 0 huge .. 1 tiny
  const odd = r() < 0.2; // break the size/pitch link sometimes
  const pitchPos = odd ? r() : clamp(size + (r() - 0.5) * 0.35, 0, 1);
  const voice = {
    name: `rolled-${seed}`,
    mode: pick(['syllable', 'syllable', 'syllable', 'letter', 'blip']),
    wave: pick(['glottal', 'glottal', 'glottal', 'glottal', 'saw', 'square', 'pulse', 'triangle']),
    pitch: Math.round(60 * Math.pow(8, pitchPos)),
    tract: +(0.68 + size * 0.85).toFixed(2),
    rate: +(0.7 + size * 0.6 + (r() - 0.5) * 0.3).toFixed(2),
    range: +(2 + r() * 9).toFixed(1),
    lilt: +(r() * 0.6).toFixed(2),
    tilt: +(0.25 + r() * 0.5).toFixed(2),
    oq: +(0.42 + r() * 0.35).toFixed(2),
    breath: +(r() < 0.6 ? r() * 0.15 : r() * 0.5).toFixed(2),
    rough: +(r() < 0.65 ? 0 : r() * 0.6).toFixed(2),
    growl: +(r() < 0.75 ? 0 : r() * 0.7).toFixed(2),
    nasal: +(r() < 0.7 ? 0 : r() * 0.7).toFixed(2),
    tongue: 1 + Math.floor(r() * 9998),
    seed: 1 + Math.floor(r() * 9998),
  };
  if (voice.mode === 'blip') { voice.wave = pick(['square', 'pulse', 'triangle', 'saw']); voice.pitch = Math.max(voice.pitch, 90); }
  return resolveVoice(voice);
}

// Only what differs from the defaults: the form worth pasting into a game.
export function compactVoice(voice) {
  const v = resolveVoice(voice);
  const out = { name: v.name };
  if (v.mode !== DEFAULT_VOICE.mode) out.mode = v.mode;
  if (v.wave !== DEFAULT_VOICE.wave) out.wave = v.wave;
  for (const p of PARAMS) if (v[p.key] !== p.def) out[p.key] = v[p.key];
  const fx = {};
  for (const p of FX_PARAMS) if (v.fx[p.key] !== p.def) fx[p.key] = v.fx[p.key];
  if (Object.keys(fx).length) out.fx = fx;
  if (v.mode === 'blip') out.blip = v.blip;
  if (v.syllabary) out.syllabary = v.syllabary;
  if (v.bank) out.bank = v.bank;
  return out;
}
