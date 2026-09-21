// Text -> words -> syllables. Everything keeps its character span in the
// ORIGINAL string, because the game reveals the original string.

import { g2p, spellOut } from './g2p.mjs';
import { FUNCTION_WORDS } from './lexicon.mjs';
import { PHONEMES, isVowel } from './phonemes.mjs';
import { hashString } from './rng.mjs';

// word | number | space | sentence punctuation | clause punctuation | dash | anything else
const TOKEN = /([\p{L}][\p{L}\p{M}'’]*)|(\d+(?:[.,]\d+)*)|(\s+)|([.!?…]+)|([,;:])|([—–]+|-{2,}|-)|(.)/gu;

export function tokenize(text) {
  const out = [];
  for (const m of text.matchAll(TOKEN)) {
    const start = m.index;
    let t = m[0];
    let type = m[1] ? 'word' : m[2] ? 'number' : m[3] ? 'space' : m[4] ? 'stop' : m[5] ? 'clause' : m[6] ? 'dash' : 'symbol';
    if (type === 'word') t = t.replace(/['’]+$/, ''); // dogs' -> dogs; the quote falls through as a symbol next time
    if (type === 'word' && !t) type = 'symbol';
    out.push({ type, text: t, start, end: start + t.length });
    if (t.length < m[0].length) out.push({ type: 'symbol', text: m[0].slice(t.length), start: start + t.length, end: start + m[0].length });
  }
  return out;
}

// ---------------------------------------------------------------- numbers
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES = ['', 'thousand', 'million', 'billion', 'trillion'];

function below1000(n) {
  const w = [];
  if (n >= 100) { w.push(ONES[Math.floor(n / 100)], 'hundred'); n %= 100; }
  if (n >= 20) { w.push(TENS[Math.floor(n / 10)]); n %= 10; if (n) w.push(ONES[n]); } else if (n || !w.length) w.push(ONES[n]);
  return w;
}

export function numberToWords(str) {
  const digits = (s) => [...s].filter((c) => c >= '0' && c <= '9').map((c) => ONES[+c]);
  const [intPart, ...frac] = str.replace(/,(?=\d{3}\b)/g, '').split(/[.,]/);
  let words;
  if (intPart.length > 15 || (intPart.length > 1 && intPart[0] === '0')) words = digits(intPart);
  else {
    let n = Number(intPart);
    if (n === 0) words = ['zero'];
    else {
      const groups = [];
      for (let s = 0; n > 0; s++, n = Math.floor(n / 1000)) {
        const g = n % 1000;
        if (g) groups.unshift([...below1000(g), ...(SCALES[s] ? [SCALES[s]] : [])]);
      }
      words = groups.flat();
    }
  }
  if (frac.length) words.push('point', ...digits(frac.join('')));
  return words;
}

const SYMBOL_WORDS = { '&': ['and'], '%': ['percent'], '+': ['plus'], '=': ['equals'], '@': ['at'], '$': ['dollars'], '#': ['number'] };

// ---------------------------------------------------------------- syllables
const ONSET2 = new Set(['P L', 'P R', 'B L', 'B R', 'T R', 'D R', 'K L', 'K R', 'G L', 'G R', 'F L', 'F R', 'TH R', 'SH R',
  'S L', 'S W', 'S M', 'S N', 'S P', 'S T', 'S K', 'T W', 'D W', 'K W', 'G W']);
const ONSET3 = new Set(['S P R', 'S T R', 'S K R', 'S P L', 'S K W']);

// phones: [{ph,a,b}] -> [{phones, nucleus, a, b}]   (maximal-onset split)
export function syllabify(phones, nLetters) {
  if (!phones.length) return [];
  const nuclei = phones.map((p, k) => (isVowel(p.ph) ? k : -1)).filter((k) => k >= 0);
  if (!nuclei.length) return [{ phones: phones.map((p) => p.ph), nucleus: -1, a: 0, b: nLetters }];

  const cuts = [0]; // index of the first phone of each syllable
  for (let s = 1; s < nuclei.length; s++) {
    const lo = nuclei[s - 1] + 1;
    const hi = nuclei[s]; // consonant run is phones[lo..hi)
    const run = phones.slice(lo, hi).map((p) => p.ph);
    let onset = 0;
    const tail = (k) => run.slice(run.length - k).join(' ');
    if (run.length >= 3 && ONSET3.has(tail(3))) onset = 3;
    else if (run.length >= 2 && (ONSET2.has(tail(2)) || (run[run.length - 1] === 'Y' && run[run.length - 2] !== 'NG'))) onset = 2;
    else if (run.length >= 1 && run[run.length - 1] !== 'NG') onset = 1;
    cuts.push(hi - onset);
  }
  const out = [];
  for (let s = 0; s < cuts.length; s++) {
    const from = cuts[s];
    const to = s + 1 < cuts.length ? cuts[s + 1] : phones.length;
    const part = phones.slice(from, to);
    out.push({ phones: part.map((p) => p.ph), nucleus: nuclei[s] - from, a: part[0].a, b: part[part.length - 1].b });
  }
  // letter spans must tile the word, in order
  out[0].a = 0;
  for (let s = 1; s < out.length; s++) {
    out[s].a = Math.max(out[s].a, out[s - 1].a);
    out[s - 1].b = out[s].a;
  }
  out[out.length - 1].b = nLetters;
  return out;
}

// ---------------------------------------------------------------- stress
const SECOND_STRESS_PREFIX = /^(un|dis|mis|ex|en|em|in|im|con|com|per|sur|pro|be|de|re|pre|to|for|ad|ob|sub|trans)/;
const FIRST_STRESS_ANYWAY = new Set(`common comfort contact concert person perfect surface process progress insect instant
index income under uncle unit enter engine exit extra distance district mister problem product project promise proper
reason ready really record rescue desert detail decent demon benefit better berry being total forest forward fortune
comment content contest context conduct concept conflict contract convent enemy energy interest industry internet`.split(/\s+/));

function stressIndex(word, syls) {
  const n = syls.length;
  if (n <= 1) return 0;
  const w = word.toLowerCase();
  // suffixes that pull stress to the syllable before them
  if (/(tion|sion|cian|tial|cial|cious|tious|ic|ics|ical|ity|ian|ious|eous|ify|ogy|aphy)s?$/.test(w)) {
    const back = /(ical|ity|ify|ogy|aphy)s?$/.test(w) ? 3 : 2;
    return Math.max(0, n - back);
  }
  if (FIRST_STRESS_ANYWAY.has(w)) return 0;
  if (syls[0].phones[syls[0].nucleus] === 'AX') return 1; // about, again, alone
  if (n <= 3 && SECOND_STRESS_PREFIX.test(w)) return 1;
  return 0;
}

// ---------------------------------------------------------------- foreign scripts
// A character we have no rules for still gets a sound: one stable pseudo-syllable
// per character, so Japanese or Cyrillic dialogue babbles at the right rhythm.
const FOREIGN_C = ['K', 'S', 'T', 'N', 'HH', 'M', 'Y', 'R', 'W', 'G', 'D', 'B', 'P'];
const FOREIGN_V = ['AA', 'IY', 'UW', 'EH', 'OW'];

function foreignSyllables(word) {
  let pos = 0; // UTF-16 offset, not code-point index: spans index the original string
  return [...word].map((ch, k) => {
    const h = hashString(ch);
    const a = pos;
    pos += ch.length;
    return { phones: [FOREIGN_C[h % FOREIGN_C.length], FOREIGN_V[(h >>> 8) % FOREIGN_V.length]], nucleus: 1, a, b: pos, stress: k === 0 ? 1 : 0 };
  });
}

// "sooooo" -> { word: "so", stretch: 2.4 }
function collapseElongation(word) {
  let stretch = 1;
  const lower = word.toLowerCase();
  const collapsed = lower.replace(/([a-z])\1{2,}/g, (run, ch) => {
    stretch = Math.min(3, stretch + 0.35 * (run.length - 1));
    const single = lower.replace(run, ch);
    if ('eo'.includes(ch) && single.length > 3) return ch + ch; // cooool -> cool, but sooo -> so
    return ch;
  });
  return { word: stretch > 1 ? collapsed : word, stretch };
}

// One word token -> syllables with spans relative to the token.
export function wordToSyllables(text) {
  const latin = text.normalize('NFD').replace(/\p{M}/gu, '');
  if (/[^A-Za-z'’]/.test(latin)) return { syllables: foreignSyllables(text), stretch: 1 };

  const allCaps = text.length > 1 && text === text.toUpperCase();
  if (allCaps && text.length <= 5 && !/[AEIOUY]/.test(text)) {
    const syls = syllabify(spellOut(text), text.length); // "HP", "NPC": say the letters
    syls.forEach((s) => { s.stress = 1; });
    return { syllables: syls, stretch: 1 };
  }

  const { word, stretch } = collapseElongation(text);
  const phones = g2p(word);
  const k = text.length / word.length; // map spans back onto the uncollapsed token
  const syls = syllabify(phones, word.length).map((s) => ({ ...s, a: Math.round(s.a * k), b: Math.round(s.b * k) }));
  if (syls.length) { syls[0].a = 0; syls[syls.length - 1].b = text.length; }
  const si = stressIndex(word, syls);
  syls.forEach((s, idx) => { s.stress = idx === si ? 1 : 0; });
  return { syllables: syls, stretch };
}

// ---------------------------------------------------------------- the whole line
// -> items: words (with syllables) and breaks, in order, spans in the original text.
export function analyze(text) {
  const items = [];
  const tokens = tokenize(text);
  tokens.forEach((tok, ti) => {
    if (tok.type === 'word') {
      const { syllables, stretch } = wordToSyllables(tok.text);
      const lower = tok.text.toLowerCase().replace(/’/g, "'");
      items.push({
        kind: 'word', text: tok.text, start: tok.start, end: tok.end, syllables, stretch,
        isFunction: FUNCTION_WORDS.has(lower),
        caps: tok.text.length > 1 && tok.text === tok.text.toUpperCase() && /[A-Z]/.test(tok.text),
      });
    } else if (tok.type === 'number' || (tok.type === 'symbol' && SYMBOL_WORDS[tok.text])) {
      const words = tok.type === 'number' ? numberToWords(tok.text) : SYMBOL_WORDS[tok.text];
      const syllables = [];
      for (const w of words) for (const s of wordToSyllables(w).syllables) syllables.push(s);
      // no letter alignment for "42" -> "forty two": share the token's span out evenly
      const len = tok.end - tok.start;
      syllables.forEach((s, k) => { s.a = Math.floor((k * len) / syllables.length); s.b = Math.floor(((k + 1) * len) / syllables.length); });
      if (syllables.length) syllables[syllables.length - 1].b = len;
      items.push({ kind: 'word', text: tok.text, start: tok.start, end: tok.end, syllables, stretch: 1, isFunction: false, caps: false });
    } else if (tok.type === 'space') {
      items.push({ kind: 'break', mark: /\n/.test(tok.text) ? 'line' : 'space', text: tok.text, start: tok.start, end: tok.end });
    } else if (tok.type === 'stop') {
      const t = tok.text;
      const mark = /…|\.{2,}/.test(t) ? 'ellipsis' : t.includes('?') ? (t.includes('!') ? 'interrobang' : 'question') : t.includes('!') ? 'exclaim' : 'period';
      items.push({ kind: 'break', mark, text: t, start: tok.start, end: tok.end });
    } else if (tok.type === 'clause') {
      items.push({ kind: 'break', mark: 'comma', text: tok.text, start: tok.start, end: tok.end });
    } else if (tok.type === 'dash') {
      const prev = tokens[ti - 1];
      const next = tokens[ti + 1];
      const inWord = tok.text === '-' && prev?.type === 'word' && next?.type === 'word';
      items.push({ kind: 'break', mark: inWord ? 'hyphen' : 'dash', text: tok.text, start: tok.start, end: tok.end });
    } else {
      items.push({ kind: 'break', mark: 'silent', text: tok.text, start: tok.start, end: tok.end });
    }
  });
  return items;
}

export function countSyllables(word) {
  return wordToSyllables(word).syllables.filter((s) => s.nucleus >= 0).length || (word.trim() ? 1 : 0);
}

export { PHONEMES };
