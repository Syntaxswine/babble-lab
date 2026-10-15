// The plan: text + voice -> a timed score the synth can play and a game can
// reveal text against. Pure data, no audio. Everything audible about HOW a line
// is said is decided here:
//
//   .   falls           ?   rises              !   wider, louder, high-fall
//   ,   small rise      …   trails off, slow   CAPS  higher, louder, longer
//   content words carry pitch accents; function words are swallowed
//   a phrase drifts downward as it goes (declination); its last syllable lengthens
//
// A plan is a pure function of (text, voice, opts). No clock, no Math.random.

import { analyze } from './text.mjs';
import { PHONEMES, isVowel, respell, F4, F5 } from './phonemes.mjs';
import { applyTongue } from './tongue.mjs';
import { resolveVoice } from './voices.mjs';
import { mulberry32, mixSeed, hashString } from './rng.mjs';
import { retimePlan } from './timing.mjs';

const SCHWA = [500, 1500, 2500];

// seconds at rate 1
const PAUSE = { comma: 0.16, period: 0.34, exclaim: 0.32, question: 0.36, interrobang: 0.36, ellipsis: 0.55, dash: 0.25, line: 0.45, hyphen: 0, silent: 0 };
const PHRASE_END = new Set(['comma', 'period', 'exclaim', 'question', 'interrobang', 'ellipsis', 'dash', 'line']);

const LETTER_STEP = 0.085; // seconds per letter at rate 1, letter and blip modes
// phonemes.mjs holds INHERENT durations — a stressed syllable said alone, before
// a pause. Running speech is shorter across the board (Klatt's own rules take
// ~0.6 off a non-final vowel). These bring rate 1 to a conversational ~4.7 syl/s.
const VOWEL_TEMPO = 0.78;
const CONS_TEMPO = 0.86;
const LEAD_IN = 0.012;
const TAIL = 0.03;

const LETTER_VOWEL = { a: 'AE', e: 'EH', i: 'IY', o: 'OW', u: 'UW', y: 'IY' };
const COLOUR = { a: 'AE', e: 'EH', i: 'IH', o: 'AA', u: 'AH', y: 'IH' };
const LETTER_ONSET = { b: ['B'], c: ['K'], d: ['D'], f: ['F'], g: ['G'], h: ['HH'], j: ['JH'], k: ['K'], l: ['L'], m: ['M'], n: ['N'], p: ['P'],
  q: ['K', 'W'], r: ['R'], s: ['S'], t: ['T'], v: ['V'], w: ['W'], x: ['K', 'S'], z: ['Z'] };
const LETTER_PAIR = { th: ['TH'], sh: ['SH'], ch: ['CH'], ph: ['F'], wh: ['W'], ck: ['K'], qu: ['K', 'W'] };
const DIGIT_SOUND = [['Z', 'IY'], ['W', 'AH'], ['T', 'UW'], ['TH', 'IY'], ['F', 'AO'], ['F', 'AY'], ['S', 'IH'], ['S', 'EH'], ['EY'], ['N', 'AY']];

const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

// ---------------------------------------------------------------------------
// 1. text -> units (things that take time), in order, with character spans
// ---------------------------------------------------------------------------
function letterUnits(item) {
  const out = [];
  const word = item.text;
  const lower = word.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  if (lower.length !== word.length || /[^a-z0-9'’]/.test(lower)) {
    // not plain latin: the per-character pseudo-syllables from text.mjs already are letter units
    for (const s of item.syllables) out.push({ phones: s.phones, nucleus: s.nucleus, a: s.a, b: s.b, letter: word.slice(s.a, s.b) });
    return out;
  }
  for (let i = 0; i < lower.length; i++) {
    const ch = lower[i];
    if (ch >= '0' && ch <= '9') { const ph = DIGIT_SOUND[+ch]; out.push({ phones: ph, nucleus: ph.findIndex(isVowel), a: i, b: i + 1, letter: ch }); continue; }
    if (LETTER_VOWEL[ch] && !(ch === 'y' && LETTER_VOWEL[lower[i + 1]] && i === 0)) { out.push({ phones: [LETTER_VOWEL[ch]], nucleus: 0, a: i, b: i + 1, letter: ch }); continue; }
    const pair = LETTER_PAIR[lower.slice(i, i + 2)];
    const onset = pair ?? LETTER_ONSET[ch] ?? (ch === 'y' ? ['Y'] : null);
    if (!onset) { if (out.length) out[out.length - 1].b = i + 1; continue; } // apostrophe: joins the letter before
    const len = pair ? 2 : 1;
    // the little vowel after a consonant takes the colour of the word's next vowel letter
    const ahead = [...lower.slice(i + len)].find((c) => COLOUR[c]) ?? [...lower.slice(0, i)].reverse().find((c) => COLOUR[c]);
    out.push({ phones: [...onset, ahead ? COLOUR[ahead] : 'AX'], nucleus: onset.length, a: i, b: i + len, letter: lower.slice(i, i + len), wide: !!pair });
    i += len - 1;
  }
  if (out.length) { out[0].a = 0; out[out.length - 1].b = word.length; }
  return out;
}

function makeUnits(items, voice, weights) {
  const units = [];
  let wordIndex = -1;
  for (const item of items) {
    if (item.kind === 'break') {
      const mark = item.mark;
      const dur = mark === 'space' ? voice.wordGap : (PAUSE[mark] ?? 0) * voice.pauses;
      units.push({ kind: 'rest', mark, c0: item.start, c1: item.end, want: dur });
      continue;
    }
    wordIndex++;
    const lower = item.text.toLowerCase().replace(/’/g, "'");
    const w = weights?.get(lower);
    const wordDur = w?.dur ?? (item.isFunction ? 0.72 : 1);
    const centralize = w?.centralize ?? (item.isFunction ? 0.35 : 0);
    const reduced = weights ? wordDur < 0.8 : item.isFunction;
    const parts = voice.mode === 'syllable' ? item.syllables : letterUnits(item);
    const nParts = parts.length;
    const lastSounding = nParts - 1;
    const stressAt = Math.max(0, item.syllables.findIndex((s) => s.stress));
    parts.forEach((part, k) => {
      let phones = part.phones;
      let nucleus = part.nucleus;
      if (voice.mode === 'syllable' && voice.syllabary) {
        phones = voice.syllabary[hashString(`${lower}:${k}`) % voice.syllabary.length].filter((ph) => PHONEMES[ph]);
        nucleus = phones.findIndex(isVowel);
      } else phones = applyTongue(phones, voice.tongue);
      const stress = voice.mode === 'syllable' ? (part.stress ? 1 : 0) : (k === 0 ? 1 : 0);
      const stretchHere = item.stretch > 1 && k === (nParts > 1 && voice.mode === 'syllable' ? stressAt : lastSounding) ? item.stretch : 1;
      units.push({
        kind: voice.mode === 'blip' ? 'blip' : voice.mode === 'letter' ? 'letter' : 'syl',
        phones, nucleus, stress, wordIndex, word: item.text, firstOfWord: k === 0, lastOfWord: k === nParts - 1,
        c0: item.start + part.a, c1: item.start + part.b,
        reduced, caps: item.caps, wordDur, centralize, stretch: stretchHere, polysyllable: nParts > 1,
        letter: part.letter ?? null, wide: !!part.wide,
      });
    });
  }
  return units;
}

// ---------------------------------------------------------------------------
// 2. phrases: pitch, loudness, duration per unit
// ---------------------------------------------------------------------------
function shapePhrases(units, voice, rand) {
  const E = voice.emphasis;
  const tm = 0.5 + 0.5 * Math.min(E, 1.5); // terminal contours are grammar; emphasis only scales them partway
  let start = 0;
  while (start < units.length) {
    // a phrase runs up to and including its closing rest
    let end = start;
    let mark = 'none';
    while (end < units.length) {
      const u = units[end];
      if (u.kind === 'rest' && PHRASE_END.has(u.mark)) { mark = u.mark; end++; break; }
      end++;
    }
    const sounding = [];
    for (let k = start; k < end; k++) if (units[k].kind !== 'rest') sounding.push(units[k]);
    const n = sounding.length;
    if (n) {
      const excl = mark === 'exclaim' || mark === 'interrobang';
      const ques = mark === 'question' || mark === 'interrobang';
      const R = voice.range * (excl ? 1 + 0.4 * E : 1);
      const accents = sounding.filter((u) => u.stress && !u.reduced);
      let wander = 0;
      const wobble = Math.min(1, voice.range / 2); // a true monotone stays one
      sounding.forEach((u, k) => {
        const x = n > 1 ? k / (n - 1) : 0.5;
        let st = R * (0.30 - 0.55 * x) * (ques ? 0.35 : 1);
        const ai = accents.indexOf(u);
        // a syllable carries a real pitch accent; a letter only a nudge, or the closing
        // gesture (the rise of a question) drowns under one bump per word
        if (ai >= 0) st += R * (u.kind === 'syl' ? 0.38 : 0.1) * (ai === 0 ? 1 : ai === accents.length - 1 ? 0.9 : 0.65);
        if (u.reduced) st -= R * 0.06;
        if (u.caps) st += R * 0.45 * E;
        wander = 0.6 * wander + (rand() - 0.5) * 2 * R * (u.kind === 'syl' ? 0.45 : 0.2) * voice.lilt;
        st += wander + (rand() - 0.5) * 0.5 * wobble;
        if (u.letter && u.kind !== 'syl') st += ((hashString(u.letter) % 5) - 2) * R * 0.05 * (0.5 + voice.lilt);
        const fall = R * 0.06 * (ai >= 0 ? 1 : 0);
        u.p0 = st + fall;
        u.p1 = st - fall;

        u.amp = (ai >= 0 ? 1.12 : 1) * (u.reduced ? 0.82 : 1) * (u.caps ? 1 + 0.35 * E : 1) * (excl ? 1 + 0.22 * E : 1);
        // duration: only the syllable voice breathes; letters and blips keep their even patter
        u.lengthen = 1;
        if (u.kind === 'syl') {
          u.lengthen = u.wordDur * (u.reduced ? 1 : u.stress ? 1.18 : u.polysyllable ? 0.88 : 1) * (u.caps ? 1 + 0.2 * E : 1) * u.stretch;
          if (k === n - 1) u.lengthen *= mark === 'ellipsis' ? 1.75 : 1.35;
          else if (k === n - 2) u.lengthen *= 1.1;
        }
      });

      // the closing gesture spans the last syllable, or in letter modes the whole last word
      const lastWord = sounding[n - 1].wordIndex;
      const span = sounding[n - 1].kind === 'syl' ? [sounding[n - 1]] : sounding.filter((u) => u.wordIndex === lastWord);
      const gesture = {
        period: [-0.1, -0.6], line: [-0.1, -0.6], none: [-0.05, -0.4], question: [0.1, 0.95], interrobang: [0.15, 1.05],
        exclaim: [0.35, -0.4], comma: [0, 0.28], ellipsis: [-0.05, -0.3], dash: [0, 0],
      }[mark] ?? [0, 0];
      span.forEach((u, j) => {
        const a = lerp(gesture[0], gesture[1], j / span.length) * R * tm;
        const b = lerp(gesture[0], gesture[1], (j + 1) / span.length) * R * tm;
        u.p0 += a;
        u.p1 += b;
        if (mark === 'ellipsis') u.amp *= 0.75;
      });
      if (ques && n >= 2 && sounding[n - 2].kind === 'syl') { sounding[n - 2].p0 += R * 0.1; sounding[n - 2].p1 += R * 0.14; }
      sounding[n - 1].amp *= 0.94;
    }
    start = end;
  }
}

// ---------------------------------------------------------------------------
// 3. units -> synth segments
// ---------------------------------------------------------------------------
// A segment is a stretch of steady targets the synth glides between:
//   dur          seconds
//   F, Fe        formant targets at start / end (Hz, tract already applied)
//   av ah af     voicing, aspiration (noise through the mouth), frication (noise through `bands`)
//   raw          0..1 bypass the mouth entirely (chip blips)
//   tr, atr      glide time INTO this segment for formants / for amplitudes
//   decay        if set, av falls as exp(-t/decay) inside the segment (a plucked blip)
function phoneSegments(ph, role, u, voice, cScale, vScale) {
  const d = PHONEMES[ph];
  const a = voice.articulation;
  const hum = (1 - a) * 0.6; // with no articulation the voice hums straight through its consonants
  const amp = u.amp;
  const ms = (x, min) => Math.max(min, (x / 1000) * cScale);
  const coda = role === 'coda';
  const segs = [];
  if (d.type === 'vowel') {
    const space = voice.vowelSpace * (1 - u.centralize);
    const F = lerp3(SCHWA, d.F, space);
    const Fe = d.Fe ? lerp3(SCHWA, d.Fe, space) : null;
    segs.push({ dur: Math.max(0.035, (d.dur / 1000) * vScale), F, Fe, av: amp, ah: 0, af: 0, tr: 0.055, atr: 0.02, vowel: true });
  } else if (d.type === 'sonorant' || d.type === 'nasal') {
    segs.push({ dur: ms(d.dur, 0.025), F: d.F, av: amp * lerp(0.85, d.amp, a), ah: 0, af: 0, nasal: d.type === 'nasal' ? a : 0, tr: d.type === 'nasal' ? 0.03 : 0.06, atr: 0.02, cons: true });
  } else if (d.type === 'stop') {
    segs.push({ dur: ms(d.closure, 0.015), F: d.F, av: amp * ((d.voiced ? 0.12 : 0) * a + hum), ah: 0, af: 0, tr: 0.045, atr: 0.012, cons: true });
    segs.push({ dur: ms(d.burst, 0.004), F: d.F, av: amp * ((d.voiced ? 0.3 : 0) * a + hum), ah: 0, af: amp * a * (coda ? 0.55 : 1), bands: [d.band], tr: 0.01, atr: 0.002, cons: true });
    if (d.asp && !coda) segs.push({ dur: ms(d.asp, 0.008), F: d.F, av: amp * hum, ah: amp * 0.5 * a, af: 0, tr: 0.02, atr: 0.006, cons: true });
  } else if (d.type === 'fric') {
    segs.push({ dur: ms(d.dur, 0.025), F: d.F, av: amp * ((d.voiced ? 0.45 : 0) * a + hum), ah: 0, af: amp * a, bands: d.bands, tr: 0.045, atr: 0.02, cons: true });
  } else if (d.type === 'asp') {
    segs.push({ dur: ms(d.dur, 0.025), F: null, av: amp * hum, ah: amp * 0.6 * a, af: 0, tr: 0.03, atr: 0.02, cons: true });
  } else if (d.type === 'affric') {
    segs.push({ dur: ms(d.closure, 0.015), F: d.F, av: amp * ((d.voiced ? 0.12 : 0) * a + hum), ah: 0, af: 0, tr: 0.045, atr: 0.012, cons: true });
    segs.push({ dur: ms(d.fric, 0.02), F: d.F, av: amp * ((d.voiced ? 0.4 : 0) * a + hum), ah: 0, af: amp * a, bands: d.bands, tr: 0.01, atr: 0.004, cons: true });
  }
  return segs;
}

function unitSegments(u, voice) {
  const rate = voice.rate;
  if (u.kind === 'blip') {
    const step = (LETTER_STEP / rate) * (u.wide ? 1.4 : 1);
    if (u.silentBlip) return [{ dur: step, F: null, av: 0, ah: 0, af: 0, tr: 0.02, atr: 0.003, rest: true }];
    const len = Math.min(voice.blip.len, step * voice.blip.every * 0.95);
    const hold = Math.max(0, step - len);
    const segs = [{ dur: Math.min(len, step), F: null, av: u.amp, ah: 0, af: 0, raw: 1, decay: len / 2.6, tr: 0.02, atr: 0.002, nucleusSeg: true }];
    if (hold > 0) segs.push({ dur: hold, F: null, av: 0, ah: 0, af: 0, raw: 1, tr: 0.02, atr: 0.004, rest: true });
    return segs;
  }
  const cScale = CONS_TEMPO * Math.pow(1 / rate, 0.85) * Math.pow(u.lengthen, 0.4);
  const vScale = (VOWEL_TEMPO / rate) * u.lengthen;
  let segs = [];
  u.phones.forEach((ph, idx) => {
    const role = u.nucleus < 0 ? 'onset' : idx === u.nucleus ? 'nucleus' : idx < u.nucleus ? 'onset' : 'coda';
    const part = phoneSegments(ph, role, u, voice, cScale, vScale);
    if (role === 'nucleus') part.forEach((s) => { s.nucleusSeg = true; });
    // a syllable with no vowel at all ("shh", "psst"): let the hiss carry its length
    if (u.nucleus < 0) part.forEach((s) => { if (s.af > 0 && s.dur > 0.02) s.dur *= 2.2; });
    segs = segs.concat(part);
  });
  if (u.kind === 'letter') {
    // even patter: every letter takes exactly one step
    const step = (LETTER_STEP / rate) * (u.wide ? 1.4 : 1);
    const total = segs.reduce((s, x) => s + x.dur, 0) || step;
    const cons = segs.filter((s) => !s.vowel).reduce((s, x) => s + x.dur, 0);
    const consBudget = Math.min(cons, step * 0.5);
    const vowelBudget = step - consBudget;
    const vowels = total - cons;
    segs.forEach((s) => { s.dur = s.vowel ? (vowels > 0 ? (s.dur / vowels) * vowelBudget : 0) : (cons > 0 ? (s.dur / cons) * consBudget : 0); });
    if (vowels <= 0) segs.forEach((s) => { s.dur = (s.dur / (consBudget || 1)) * step; });
    segs.forEach((s) => { s.tr = Math.min(s.tr, 0.03); });
  }
  return segs;
}

// ---------------------------------------------------------------------------
// the plan
// ---------------------------------------------------------------------------
export function weightsMap(weights) {
  if (!weights) return null;
  if (weights instanceof Map) return weights;
  // a tts-weights table. It drops dur/centralize when Zipf's law of abbreviation
  // does not hold in its corpus — in which case there is nothing here to use.
  const rows = Array.isArray(weights) ? weights : weights.words;
  if (!Array.isArray(rows)) throw new Error('babble: weights must be a tts-weights table ({ words: [...] }), an array of rows, or a Map');
  const map = new Map();
  for (const r of rows) if (r && typeof r.word === 'string' && Number.isFinite(r.dur)) map.set(r.word.toLowerCase(), { dur: r.dur, centralize: Number.isFinite(r.centralize) ? r.centralize * 0.9 : 0 });
  return map.size ? map : null;
}

export function makePlan(text, voiceIn, opts = {}) {
  const voice = resolveVoice(voiceIn);
  text = String(text ?? '');
  const weights = weightsMap(opts.weights);
  const seed = mixSeed('take', voice.seed, opts.seed ?? 0, text);
  const rand = mulberry32(seed);
  const items = analyze(text);
  const units = makeUnits(items, voice, weights);

  if (voice.mode === 'blip') {
    let idx = 0;
    for (const u of units) if (u.kind === 'blip') { u.silentBlip = idx % voice.blip.every !== 0; idx++; }
  }
  shapePhrases(units, voice, rand);

  // --- lay everything on the clock
  const segs = [];
  const pitch = [];
  let t = LEAD_IN;
  const pushRest = (dur) => { if (dur > 0) { segs.push({ t0: t, dur, F: null, av: 0, ah: 0, af: 0, tr: 0.04, atr: 0.015, rest: true, unit: -1 }); t += dur; } };
  if (LEAD_IN > 0) segs.push({ t0: 0, dur: LEAD_IN, F: null, av: 0, ah: 0, af: 0, tr: 0.04, atr: 0.01, rest: true, unit: -1 });

  const pauseScale = Math.pow(1 / voice.rate, 0.5); // pauses shrink less than speech does
  const letterGap = voice.mode === 'syllable' ? 0 : LETTER_STEP / voice.rate; // a space is one silent letter
  for (let k = 0; k < units.length; k++) {
    const u = units[k];
    u.t0 = t;
    if (u.kind === 'rest') {
      // adjacent breaks (", " or "?! ") share one pause: the longest, not the sum
      let want = u.want;
      let j = k;
      while (j + 1 < units.length && units[j + 1].kind === 'rest') { j++; want = Math.max(want, units[j].want); units[j].t0 = t; }
      const spaceOnly = units.slice(k, j + 1).every((r) => r.mark === 'space');
      let dur = spaceOnly ? Math.max(want * pauseScale, letterGap) : want * pauseScale;
      // Leading whitespace is not a pause, and NOTHING after the last sound is: the
      // line's audio ends when the voice does. How long to wait before the next
      // line is the game's decision, not something to bake into every clip.
      if ((k === 0 && spaceOnly) || j === units.length - 1) dur = 0;
      pushRest(dur);
      for (let m = k; m <= j; m++) { units[m].t0 = u.t0; units[m].t1 = t; }
      k = j;
      continue;
    }
    const us = unitSegments(u, voice);
    let n0 = null;
    let n1 = null;
    for (const s of us) {
      s.t0 = t;
      s.unit = k;
      if (s.nucleusSeg) { if (n0 === null) n0 = t; n1 = t + s.dur; }
      segs.push(s);
      t += s.dur;
    }
    u.t1 = t;
    if (n0 === null) { n0 = u.t0; n1 = u.t1; }
    if (!u.silentBlip) {
      pitch.push({ t: n0 + 0.15 * (n1 - n0), st: u.p0 });
      pitch.push({ t: n1 - 0.1 * (n1 - n0), st: u.p1 });
    }
    u.label = u.kind === 'blip' ? (u.letter ?? '') : respell(u.phones);
  }
  segs.push({ t0: t, dur: TAIL, F: null, av: 0, ah: 0, af: 0, tr: 0.04, atr: 0.02, rest: true, unit: -1 });
  t += TAIL;

  // --- formants: scale to this vocal tract, then give every segment a target.
  // Consonants bend toward their locus only as far as `articulation` allows;
  // rests and /h/ borrow their neighbour's mouth shape so nothing jumps.
  const tract = voice.tract;
  for (const s of segs) {
    if (s.F) s.F = s.F.map((f) => f * tract);
    if (s.Fe) s.Fe = s.Fe.map((f) => f * tract);
    if (s.bands) s.bands = s.bands.map((b) => ({ fc: b.fc * tract, bw: b.bw * tract, g: b.g }));
  }
  const nearestVowel = (i) => {
    for (let d = 1; d < segs.length; d++) {
      const fwd = segs[i + d];
      if (fwd?.vowel) return fwd.F;
      const back = segs[i - d];
      if (back?.vowel) return back.Fe ?? back.F;
    }
    return SCHWA.map((f) => f * tract);
  };
  const pull = 0.35 + 0.65 * voice.articulation;
  segs.forEach((s, i) => { if (s.cons && s.F) s.F = lerp3(nearestVowel(i), s.F, pull); });
  segs.forEach((s, i) => { if (!s.F) s.F = nearestVowel(i); });
  const gNasal = voice.nasal * 0.8;
  for (const s of segs) { s.nasal = Math.max(s.nasal ?? 0, gNasal); s.raw = s.raw ?? (voice.mode === 'blip' ? 1 : 0); s.ah = s.ah ?? 0; }

  pitch.sort((a, b) => a.t - b.t);
  const words = [];
  for (const u of units) {
    if (u.kind === 'rest') continue;
    const w = words[words.length - 1];
    if (w && w.index === u.wordIndex) { w.t1 = u.t1; w.c1 = u.c1; } else words.push({ index: u.wordIndex, text: u.word, t0: u.t0, t1: u.t1, c0: u.c0, c1: u.c1 });
  }

  return retimePlan({
    text, voice, seed, duration: t,
    units: units.map((u) => ({
      kind: u.kind, t0: u.t0, t1: u.t1, c0: u.c0, c1: u.c1,
      ...(u.kind === 'rest' ? { mark: u.mark } : { label: u.label, phones: u.phones, stress: u.stress, word: u.wordIndex, p0: u.p0, p1: u.p1, amp: u.amp, reduced: u.reduced, silent: !!u.silentBlip }),
    })),
    words, segs, pitch,
    upper: [F4 * tract, F5 * tract],
  }, opts.timing);
}

// How many characters of plan.text a typewriter should be showing at time t.
// Punctuation appears the moment its pause begins; a syllable's letters spill
// out across the time it takes to say it.
export function revealAt(plan, t) {
  let shown = 0;
  for (const u of plan.units) {
    if (t < u.t0) break;
    if (u.kind === 'rest' || t >= u.t1 || u.t1 <= u.t0) { shown = Math.max(shown, u.c1); continue; }
    const frac = (t - u.t0) / (u.t1 - u.t0);
    shown = Math.max(shown, u.c0 + Math.ceil((u.c1 - u.c0) * frac));
  }
  return t >= plan.duration ? plan.text.length : shown;
}

// The same thing as a list of (time, characters-shown) steps, for engines that
// would rather schedule than poll.
export function revealSchedule(plan) {
  const out = [];
  let shown = 0;
  const push = (t, c) => { if (c > shown) { shown = c; out.push({ t, chars: c }); } };
  for (const u of plan.units) {
    if (u.kind === 'rest' || u.t1 <= u.t0) { push(u.t0, u.c1); continue; }
    const n = u.c1 - u.c0;
    for (let k = 1; k <= n; k++) push(u.t0 + ((k - 1) / n) * (u.t1 - u.t0), u.c0 + k);
  }
  push(plan.duration, plan.text.length);
  return out;
}
