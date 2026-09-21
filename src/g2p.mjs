// Letter-to-sound. A word in, phonemes out — each phoneme tagged with the span
// of letters that produced it, so the game can reveal text in step with sound.
//
// What this is graded on (test/text.test.mjs): SYLLABLE COUNT, because rhythm is
// what a player hears in babble. Vowel *quality* is best-effort — a wrong vowel
// is still the same wrong vowel every time, and consistency is what makes
// babble feel like a language. Rules, not a dictionary, so invented names
// ("Zarkoth", "Eldrin") work as well as real words.

import { LEXICON, LETTER_NAMES } from './lexicon.mjs';
import { PHONEMES, isVowel } from './phonemes.mjs';

const SIBILANT = new Set(['S', 'Z', 'SH', 'ZH', 'CH', 'JH']);
const VOICELESS = new Set(['P', 'T', 'K', 'F', 'TH', 'S', 'SH', 'CH', 'HH']);

// Inflection tails that leave a preceding chunk rule intact ("picture" -> "pictures").
const TAIL = /^(s|d|es|ed|r|rs|ing|ings|ly)?$/;
// Tails before which a consonant+e is silent ("lately", "basement", "safety").
const SILENT_E_TAIL = /^(ly|ment|ments|ful|fully|less|lessly|ness|ty|ties)$/;

// Compound heads ending in a silent e: "homework", "spaceship", "fireball".
// ("fore" is deliberately absent — it would eat "forever".)
const E_HEADS = ['some', 'home', 'life', 'time', 'fire', 'side', 'base', 'space', 'game', 'name', 'safe',
  'like', 'here', 'there', 'where', 'else', 'more', 'store', 'horse', 'house', 'whole', 'white', 'stone',
  'state', 'note', 'nine', 'five', 'bare', 'care', 'hope', 'use', 'face', 'place', 'grave', 'make', 'take',
  'snake', 'lake', 'shape', 'grape', 'line', 'mile', 'rule', 'peace', 'force', 'course', 'sense',
  'ware', 'wise', 'fare', 'blade', 'flame', 'bone', 'rose', 'cave', 'wave', 'gate', 'plate', 'slave', 'shade',
  'spike', 'pipe'];

const UNSTRESSED_PREFIX = /^(be|de|re|pre)(?=[bcdfghjklmnpqrstvwz][aeiouy])/;

function spread(phs, n) {
  // Align a lexicon pronunciation over n letters, proportionally.
  const m = phs.length;
  return phs.map((ph, k) => ({ ph, a: Math.floor((k * n) / m), b: Math.floor(((k + 1) * n) / m) }));
}

function shift(phones, by) {
  return phones.map((p) => ({ ph: p.ph, a: p.a + by, b: p.b + by }));
}

const last = (arr) => arr[arr.length - 1];
const hasVowelPhone = (phones) => phones.some((p) => isVowel(p.ph));

function pluralTail(stemPhones) {
  const l = last(stemPhones)?.ph;
  if (SIBILANT.has(l)) return ['AX', 'Z'];
  return [VOICELESS.has(l) ? 'S' : 'Z'];
}

function pastTail(stemPhones) {
  const l = last(stemPhones)?.ph;
  if (l === 'T' || l === 'D') return ['AX', 'D'];
  return [VOICELESS.has(l) ? 'T' : 'D'];
}

function lex(w) {
  const e = Object.hasOwn(LEXICON, w) ? LEXICON[w] : null;
  return e ? e.split(' ') : null;
}

// Lexicon lookup, including regular inflections and compounds of lexicon words.
function lookup(w) {
  const n = w.length;
  const direct = lex(w);
  if (direct) return spread(direct, n);

  const asPhones = (phs) => phs.map((ph) => ({ ph }));
  const withTail = (stem, len, tailPhones) => spread(stem, len).concat(tailPhones.map((ph) => ({ ph, a: len, b: n })));

  if (w.endsWith("'s")) {
    const bp = g2p(w.slice(0, -2));
    return bp.concat(pluralTail(bp).map((ph) => ({ ph, a: n - 2, b: n })));
  }
  if (w.endsWith("n't") && n > 3) {
    const bp = g2p(w.slice(0, -3));
    return bp.concat(['AX', 'N', 'T'].map((ph) => ({ ph, a: n - 3, b: n })));
  }
  if (w.includes("'")) return null; // other apostrophes: strip, then the rules

  let s;
  if (n > 3 && w.endsWith('s') && (s = lex(w.slice(0, -1)))) return withTail(s, n - 1, pluralTail(asPhones(s)));
  if (n > 4 && w.endsWith('ed') && (s = lex(w.slice(0, -2)))) return withTail(s, n - 2, pastTail(asPhones(s)));
  if (n > 4 && w.endsWith('d') && (s = lex(w.slice(0, -1)))) return withTail(s, n - 1, pastTail(asPhones(s)));
  if (n > 5 && w.endsWith('ing') && (s = lex(w.slice(0, -3)) || lex(w.slice(0, -3) + 'e'))) return withTail(s, n - 3, ['IH', 'NG']);
  if (n > 4 && w.endsWith('ly') && (s = lex(w.slice(0, -2)))) return withTail(s, n - 2, ['L', 'IY']);

  // compound whose head is a lexicon word: "therefore", "werewolf", "friendship"
  for (let cut = n - 2; cut >= 4; cut--) {
    const head = w.slice(0, cut);
    const rest = w.slice(cut);
    if (!lex(head) || !/[aeiouy]/.test(rest)) continue;
    if (rest.length < 3 && !/^(ly|er|ed|es)$/.test(rest)) continue;
    return spread(lex(head), cut).concat(shift(g2p(rest), cut));
  }
  return null;
}

const cache = new Map();

export function g2p(word) {
  const w = word.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/’/g, "'");
  if (cache.has(w)) return cache.get(w).map((p) => ({ ...p }));
  let out = lookup(w);
  if (!out) {
    const bare = w.replace(/[^a-z]/g, '');
    if (!bare) out = [];
    else if (bare.length === 1) out = spread(LETTER_NAMES[bare].split(' '), w.length);
    else {
      out = compound(bare) || rules(bare);
      if (bare.length !== w.length) {
        const k = w.length / bare.length;
        out = out.map((p) => ({ ph: p.ph, a: Math.round(p.a * k), b: Math.round(p.b * k) }));
      }
    }
  }
  out = tile(dedupe(out), w.length);
  cache.set(w, out);
  return out.map((p) => ({ ...p }));
}

// Spell a token out by letter names ("HP" -> aitch pee).
export function spellOut(word) {
  const out = [];
  [...word.toLowerCase()].forEach((c, k) => {
    if (!LETTER_NAMES[c]) return;
    for (const ph of LETTER_NAMES[c].split(' ')) out.push({ ph, a: k, b: k + 1 });
  });
  return tile(out, word.length);
}

function compound(w) {
  for (const head of E_HEADS) {
    if (!w.startsWith(head) || w.length < head.length + 3) continue;
    const rest = w.slice(head.length);
    if ('aeiouy'.includes(rest[0]) || !/[aeiouy]/.test(rest)) continue;
    if (SILENT_E_TAIL.test(rest) || TAIL.test(rest)) continue; // a plain suffix: the rules already know
    return g2p(head).concat(shift(g2p(rest), head.length));
  }
  return null;
}

// "error" scans as ER R ER, "excite" as K S S: fold a doubled consonant.
function dedupe(phones) {
  const out = [];
  for (const p of phones) {
    const q = last(out);
    if (q && q.ph === p.ph && !isVowel(p.ph)) q.b = Math.max(q.b, p.b);
    else out.push(p);
  }
  return out;
}

// Make spans tile [0, n): silent letters join the sound before them.
function tile(phones, n) {
  if (!phones.length) return phones;
  phones[0].a = 0;
  for (let k = 1; k < phones.length; k++) {
    if (phones[k].a < phones[k - 1].a) phones[k].a = phones[k - 1].a;
    if (phones[k].a > phones[k - 1].b) phones[k - 1].b = phones[k].a;
    if (phones[k].b < phones[k].a) phones[k].b = phones[k].a;
  }
  last(phones).b = n;
  return phones;
}

// ---------------------------------------------------------------------------
// The rules. One left-to-right scan; at each position the first matching rule
// consumes some letters and emits zero or more phonemes.
// ---------------------------------------------------------------------------
function rules(w) {
  const n = w.length;
  const out = [];
  let i = 0;

  const V = (c) => c !== undefined && 'aeiou'.includes(c);
  const Vy = (c) => c !== undefined && 'aeiouy'.includes(c);
  const C = (c) => c !== undefined && !'aeiou'.includes(c);
  const soft = (c) => c !== undefined && 'eiy'.includes(c);
  const at = (s, k = i) => w.startsWith(s, k);
  const rest = () => w.slice(i);
  const isEnd = (s) => rest() === s;
  const endTail = (s) => at(s) && TAIL.test(w.slice(i + s.length)); // chunk + inflection
  const endTailE = (s) => at(s) && (TAIL.test(w.slice(i + s.length)) || SILENT_E_TAIL.test(w.slice(i + s.length)));
  const emit = (phs, len) => {
    for (const ph of phs) out.push({ ph, a: i, b: i + len });
    i += len;
  };
  const lastPh = () => last(out)?.ph;
  const vowelSoFar = () => hasVowelPhone(out);
  const vowelsBefore = () => out.filter((p) => isVowel(p.ph)).length;
  const prevVowelSound = () => out.length > 0 && isVowel(lastPh()) && last(out).b === i;
  // u after these is "oo", otherwise "yoo"
  const longU = () => (['R', 'L', 'JH', 'CH', 'SH', 'S', 'Z', 'Y'].includes(lastPh()) ? ['UW'] : ['Y', 'UW']);

  // vowel at k, then one consonant (or th / st), then a final or suffixed e
  const magicE = (k) => {
    let j = k + 1;
    if (!C(w[j]) || 'xwy'.includes(w[j])) return false;
    const pair = w.slice(j, j + 2);
    const cluster = pair === 'th' || (pair === 'st' && w[k] === 'a'); // bathe, waste
    j += cluster ? 2 : 1;
    if (w[j] !== 'e') return false;
    const tail = w.slice(j + 1);
    if (/^(r|rs)$/.test(tail) && (w[k] === 'e' || cluster)) return false; // never, father
    if (pair === 'st' && /^(d|st)$/.test(tail)) return false; // lasted, blasted
    return /^(|s|d|r|rs|st)$/.test(tail) || SILENT_E_TAIL.test(tail);
  };
  // vowel at k, one consonant, then "le": table, title, noble
  const beforeLe = (k) => C(w[k + 1]) && w[k + 2] === 'l' && w[k + 3] === 'e' && TAIL.test(w.slice(k + 4));
  // vowel at k, one consonant, then a sounded vowel: o-pen, mu-sic
  const open = (k) => C(w[k + 1]) && w[k + 1] !== 'x' && Vy(w[k + 2]) && !(w[k + 2] === 'e' && k + 3 === n);

  while (i < n) {
    const c = w[i];
    const p = w[i - 1];
    const nx = w[i + 1];

    // ======================= consonants =======================
    if (c === 'b') {
      if (p === 'm' && i === n - 1) { emit([], 1); continue; } // lamb
      if (nx === 't' && i === n - 2) { emit([], 1); continue; } // doubt
      emit(['B'], nx === 'b' ? 2 : 1); continue;
    }
    if (c === 'c') {
      if (at('cean') && vowelSoFar()) { emit(['SH', 'AX', 'N'], 4); continue; }
      if (at('ciation')) { emit(['S', 'IY', 'EY', 'SH', 'AX', 'N'], 7); continue; }
      if (at('ciate')) { emit(['SH', 'IY', 'EY', 'T'], 5); continue; }
      if (at('cious')) { emit(['SH', 'AX', 'S'], 5); continue; }
      if (at('ciency')) { emit(['SH', 'AX', 'N', 'S', 'IY'], 6); continue; }
      if (at('cient')) { emit(['SH', 'AX', 'N', 'T'], 5); continue; }
      if (at('cial') && vowelSoFar()) { emit(['SH', 'AX', 'L'], 4); continue; }
      if ((at('cian') || at('cion')) && vowelSoFar()) { emit(['SH', 'AX', 'N'], 4); continue; }
      if (at('ch')) { emit([w[i + 2] === 'r' || w[i + 2] === 'l' ? 'K' : 'CH'], 2); continue; } // chrome / chair
      if (at('ck') || at('cq')) { emit(['K'], 2); continue; }
      if (at('cc')) { emit(soft(w[i + 2]) ? ['K', 'S'] : ['K'], 2); continue; }
      emit([soft(nx) ? 'S' : 'K'], 1); continue;
    }
    if (c === 'd') {
      if (at('dgeon')) { emit(['JH', 'AX', 'N'], 5); continue; }
      if (at('dg') && soft(w[i + 2])) { emit(['JH'], 2); continue; }
      if (at('dj')) { emit(['JH'], 2); continue; }
      emit(['D'], nx === 'd' ? 2 : 1); continue;
    }
    if (c === 'f') { emit(['F'], nx === 'f' ? 2 : 1); continue; }
    if (c === 'g') {
      if (at('gh')) { emit(i === 0 || V(w[i + 2]) ? ['G'] : [], 2); continue; } // ghost / night
      if (at('gn') && (i === 0 || i === n - 2)) { emit(['N'], 2); continue; } // gnome, sign
      if (at('geous') || at('gious')) { emit(['JH', 'AX', 'S'], 5); continue; }
      if ((at('geon') || at('gion') || at('gian')) && vowelSoFar()) { emit(['JH', 'AX', 'N'], 4); continue; }
      if (isEnd('gia')) { emit(['JH', 'AX'], 3); continue; }
      if (isEnd('gue') && vowelSoFar()) { emit(['G'], 3); continue; } // league
      if (at('gu') && soft(w[i + 2])) { emit(['G'], 2); continue; } // guess, guide
      if (at('gua') && i === 0) { emit(['G'], 2); continue; } // guard
      if (at('gg')) { emit(['G'], 2); continue; }
      emit([soft(nx) && i > 0 ? 'JH' : 'G'], 1); continue; // magic, page / get, go
    }
    if (c === 'h') {
      if (V(p) && (nx === undefined || C(nx))) { emit([], 1); continue; } // oh, ah, john
      emit(['HH'], 1); continue;
    }
    if (c === 'j') { emit(['JH'], 1); continue; }
    if (c === 'k') {
      if (at('kn') && i === 0) { emit(['N'], 2); continue; }
      emit(['K'], nx === 'k' ? 2 : 1); continue;
    }
    if (c === 'l') {
      // consonant + le: the l is its own syllable (table, little, troubled).
      // Not before -r: "settler" is set-tler, the e belongs to the -er.
      const tail = w.slice(i + 2);
      if (nx === 'e' && C(p) && p !== 'l' && p !== 'r' && vowelSoFar() && /^(|s|d)$/.test(tail)) {
        emit(['AX', 'L'], 2);
        if (tail) emit(tail === 's' ? ['Z'] : ['D'], 1);
        continue;
      }
      // l / ll + i + vowel: the i is a glide, not a syllable (million, italian)
      const ll = nx === 'l' ? 2 : 1;
      if (w[i + ll] === 'i' && 'ao'.includes(w[i + ll + 1] ?? '-') && vowelSoFar()) { emit(['L', 'Y'], ll + 1); continue; }
      emit(['L'], ll); continue;
    }
    if (c === 'm') {
      if (at('mn') && i === n - 2) { emit(['M'], 2); continue; } // autumn
      emit(['M'], nx === 'm' ? 2 : 1); continue;
    }
    if (c === 'n') {
      if (at('ng')) {
        const a3 = w[i + 2];
        if (at('ngeon')) { emit(['N', 'JH', 'AX', 'N'], 5); continue; }
        if (a3 === undefined) { emit(['NG'], 2); continue; }
        if (isEnd('nge')) { emit(['N', 'JH'], 3); continue; } // change
        if (isEnd('nges')) { emit(['N', 'JH', 'AX', 'Z'], 4); continue; }
        if (isEnd('nged')) { emit(['N', 'JH', 'D'], 4); continue; }
        if (at('ngu') && V(w[i + 3])) { emit(['NG', 'G', 'W'], 3); continue; } // language, penguin
        if (at('nging') || (C(a3) && !'lry'.includes(a3))) { emit(['NG'], 2); continue; } // singing, kingdom
        emit(['NG', 'G'], 2); continue; // finger, angle, angry
      }
      if (nx === 'k' || nx === 'q' || nx === 'x') { emit(['NG'], 1); continue; }
      const nn = nx === 'n' ? 2 : 1;
      if (w[i + nn] === 'i' && 'ao'.includes(w[i + nn + 1] ?? '-') && vowelSoFar()) { emit(['N', 'Y'], nn + 1); continue; } // onion
      emit(['N'], nn); continue;
    }
    if (c === 'p') {
      if (at('ph')) { emit(['F'], 2); continue; }
      if (i === 0 && (nx === 's' || nx === 'n' || nx === 't')) { emit([], 1); continue; } // psychology
      emit(['P'], nx === 'p' ? 2 : 1); continue;
    }
    if (c === 'q') {
      if (isEnd('que')) { emit(['K'], 3); continue; } // unique
      emit(nx === 'u' ? ['K', 'W'] : ['K'], nx === 'u' ? 2 : 1); continue;
    }
    if (c === 'r') {
      if (at('rh')) { emit(['R'], 2); continue; }
      if (isEnd('re') && C(p) && vowelSoFar()) { emit(['ER'], 2); continue; } // centre, acre
      emit(['R'], nx === 'r' ? 2 : 1); continue;
    }
    if (c === 's') {
      if (at('sch')) { emit(['S', 'K'], 3); continue; }
      if (at('sh')) { emit(['SH'], 2); continue; }
      if (at('scious')) { emit(['SH', 'AX', 'S'], 6); continue; }
      if (at('sc') && soft(w[i + 2])) { emit(['S'], 2); continue; }
      if (at('ssion') || at('ssian')) { emit(['SH', 'AX', 'N'], 5); continue; }
      if (at('ssure')) { emit(['SH', 'ER'], 5); continue; }
      if (at('sion') || at('sian')) { emit([Vy(p) ? 'ZH' : 'SH', 'AX', 'N'], 4); continue; }
      if (endTail('sure') && Vy(p)) { emit(['ZH', 'ER'], 4); continue; } // measure
      if (at('sure') && (i === 0 || C(p))) { emit(['SH', 'UH', 'R'], 4); continue; } // sure, insure
      if (at('sual')) { emit(['ZH'], 1); continue; }
      if (isEnd('sia') && vowelSoFar()) { emit(['ZH', 'AX'], 3); continue; }
      if (isEnd('sm') && vowelSoFar()) { emit(['Z', 'AX', 'M'], 2); continue; } // prism
      if (at('ss')) { emit(['S'], 2); continue; }
      if (i === n - 1 && out.length) { emit(prevVowelSound() ? ['Z'] : pluralTail(out).slice(-1), 1); continue; }
      emit([Vy(p) && Vy(nx) ? 'Z' : 'S'], 1); continue; // music, rose / sun
    }
    if (c === 't') {
      if (at('tch')) { emit(['CH'], 3); continue; }
      if (isEnd('thm') && vowelSoFar()) { emit(['DH', 'AX', 'M'], 3); continue; } // rhythm
      if (at('th')) { emit([(Vy(p) || p === 'r') && w[i + 2] === 'e' ? 'DH' : 'TH'], 2); continue; }
      if (p === 's' && /^t(le|les|led|ling|ler|en|ens|ened|ening|ener)$/.test(rest())) { emit([], 1); continue; } // castle, listen
      if (at('tion') || at('tian')) { emit(p === 's' ? ['CH', 'AX', 'N'] : ['SH', 'AX', 'N'], 4); continue; }
      if (at('tious')) { emit(['SH', 'AX', 'S'], 5); continue; }
      if (at('tial')) { emit(['SH', 'AX', 'L'], 4); continue; }
      if (at('tience')) { emit(['SH', 'AX', 'N', 'S'], 6); continue; }
      if (at('tient')) { emit(['SH', 'AX', 'N', 'T'], 5); continue; }
      if (at('tiate')) { emit(['SH', 'IY', 'EY', 'T'], 5); continue; }
      if (isEnd('tia') && vowelSoFar()) { emit(['SH', 'AX'], 3); continue; }
      if ((isEnd('turer') || isEnd('turers')) && vowelSoFar()) { emit(['CH', 'ER', 'ER'], 5); continue; } // adventurer
      if (endTail('ture') && vowelSoFar()) { emit(['CH', 'ER'], 4); continue; }
      if (at('tural') && vowelSoFar()) { emit(['CH', 'ER', 'AX', 'L'], 5); continue; }
      if (at('tury')) { emit(['CH', 'ER', 'IY'], 4); continue; }
      emit(['T'], nx === 't' ? 2 : 1); continue;
    }
    if (c === 'v') { emit(['V'], nx === 'v' ? 2 : 1); continue; }
    if (c === 'w') {
      if (at('wh')) { emit(['W'], 2); continue; }
      if (at('wr')) { emit(['R'], 2); continue; }
      if (at('wor') && C(w[i + 3]) && i === 0) { emit(['W', 'ER'], 3); continue; } // word, work, world
      if (at('war') && !V(w[i + 3]) && w[i + 3] !== 'r') { emit(['W', 'AO', 'R'], 3); continue; } // war, warm, award
      if (at('wa') && C(w[i + 2]) && !magicE(i + 1) && !'yilrgxk'.includes(w[i + 2])) { emit(['W', 'AA'], 2); continue; } // want, watch
      emit(['W'], 1); continue;
    }
    if (c === 'x') {
      if (at('xious')) { emit(['K', 'SH', 'AX', 'S'], 5); continue; }
      if (at('xion')) { emit(['K', 'SH', 'AX', 'N'], 4); continue; }
      if (i === 0) { emit(['Z'], 1); continue; }
      emit(i === 1 && p === 'e' && V(nx) ? ['G', 'Z'] : ['K', 'S'], 1); continue; // exam / box
    }
    if (c === 'z') { emit(['Z'], nx === 'z' ? 2 : 1); continue; }

    // ======================= y =======================
    if (c === 'y') {
      if (i === 0) { emit([V(nx) ? 'Y' : 'IH'], 1); continue; }
      if (at('yard')) { emit(['Y', 'AA', 'R', 'D'], 4); continue; }
      if (isEnd('ying')) { emit([vowelSoFar() ? 'IY' : 'AY', 'IH', 'NG'], 4); continue; }
      if (isEnd('ye') && !vowelSoFar()) { emit(['AY'], 2); continue; } // dye, rye
      if (V(nx)) {
        if (prevVowelSound()) { emit(['Y'], 1); continue; } // lawyer
        emit([vowelSoFar() ? 'IY' : 'AY'], 1); continue; // embryo / dryer, hyena
      }
      if (i === n - 1) {
        if (!vowelSoFar()) { emit(['AY'], 1); continue; } // my, fly
        if (p === 'f' || (p === 'l' && w[i - 2] === 'p')) { emit(['AY'], 1); continue; } // satisfy, multiply
        emit(['IY'], 1); continue;
      }
      if (magicE(i) || beforeLe(i) || (!vowelSoFar() && open(i))) { emit(['AY'], 1); continue; } // type, cycle, python
      emit(['IH'], 1); continue; // system, crystal
    }

    // ======================= vowels =======================
    // --- long chunks
    if (at('eigh') || at('aigh')) { emit(['EY'], 4); continue; }
    if (at('ough') || at('augh')) { emit(['AO'], 4); continue; }
    if (at('eau')) { emit(['OW'], 3); continue; }
    if (at('ieu') || at('iew')) { emit(['Y', 'UW'], 3); continue; }
    if (at('igh')) { emit(['AY'], 3); continue; }
    if (at('eign') || at('aign')) { emit(['EY', 'N'], 4); continue; }
    if (endTail('ign') && C(p)) { emit(['AY', 'N'], 3); continue; } // sign, designed
    if (i === 1 && w[0] === 'c' && (at('ooper') || at('oord'))) { emit(['OW'], 1); continue; } // co-operate
    if (i === 1 && at('rew', 0) && V(w[3])) { emit(['IH'], 1); continue; } // re-ward, not r-ew-ard
    if (at('eation') || at('eative') || at('eator')) { emit(['IY'], 1); continue; } // cre-ation

    // --- r-coloured
    if (c === 'a') {
      if (at('air')) { emit(['EH', 'R'], 3); continue; }
      if (endTailE('are') && (!vowelSoFar() || C(p))) { emit(['EH', 'R'], 3); continue; } // care, aware, careful
      if (at('ar') && !V(w[i + 2]) && w[i + 2] !== 'r') {
        emit(i + 2 === n && vowelsBefore() >= 1 ? ['ER'] : ['AA', 'R'], 2); continue; // dollar / car, garden
      }
      if (at('arr') && !Vy(w[i + 3])) { emit(['AA', 'R'], 3); continue; }
    }
    if (c === 'e') {
      if (at('ear')) {
        const after = w.slice(i + 3);
        const clear = after === '' || /^(s|ly|ed|ing|er|est|ful|less)$/.test(after) || V(after[0]);
        emit(clear ? ['IH', 'R'] : ['ER'], 3); continue; // near, years / earth, learn
      }
      if (at('eer')) { emit(['IH', 'R'], 3); continue; }
      if (endTailE('ere') && !vowelSoFar()) { emit(['IH', 'R'], 3); continue; } // here
      if (isEnd('ere')) { emit(['IH', 'R'], 3); continue; } // severe
      if (at('er') && !V(w[i + 2])) { emit(['ER'], w[i + 2] === 'r' && !Vy(w[i + 3]) ? 3 : 2); continue; }
    }
    if (c === 'i') {
      if (endTailE('ire')) { emit(['AY', 'ER'], 3); continue; }
      if (at('ir') && !V(w[i + 2]) && w[i + 2] !== 'r') { emit(['ER'], 2); continue; }
    }
    if (c === 'o') {
      if (at('oor') || at('our')) { emit(['AO', 'R'], 3); continue; }
      if (endTailE('ore')) { emit(['AO', 'R'], 3); continue; }
      if (at('or') && !V(w[i + 2])) {
        if (i + 2 === n && vowelsBefore() >= 1) { emit(['ER'], 2); continue; } // doctor
        emit(['AO', 'R'], w[i + 2] === 'r' && !Vy(w[i + 3]) ? 3 : 2); continue;
      }
      if (at('or')) { emit(['AO'], 1); continue; } // story, forest — the r follows
    }
    if (c === 'u') {
      if (endTailE('ure')) { emit(vowelSoFar() ? ['Y', 'ER'] : [...longU().slice(0, -1), 'UH', 'R'], 3); continue; } // figure / pure
      if (at('ur') && !V(w[i + 2])) { emit(['ER'], w[i + 2] === 'r' && !Vy(w[i + 3]) ? 3 : 2); continue; }
    }

    // --- endings
    if (c === 'e') {
      if (isEnd('es') && vowelSoFar()) { emit(pluralTail(out), 2); continue; } // boxes: uh-z, makes: s
      if (isEnd('ed') && vowelSoFar()) { emit(pastTail(out), 2); continue; } // wanted: uh-d, walked: t
      if (i === n - 1 && vowelSoFar()) { emit([], 1); continue; } // final silent e
      if (C(p) && !prevVowelSound() && vowelSoFar() && SILENT_E_TAIL.test(w.slice(i + 1))) { emit([], 1); continue; } // late-ly
      if (i === n - 1) { emit(['IY'], 1); continue; } // me, he, be
    }
    if (c === 'i') {
      if (isEnd('ies')) { emit([vowelSoFar() ? 'IY' : 'AY', 'Z'], 3); continue; }
      if (isEnd('ied')) { emit([vowelSoFar() ? 'IY' : 'AY', 'D'], 3); continue; }
      if (isEnd('ie')) { emit([vowelSoFar() ? 'IY' : 'AY'], 2); continue; }
      if (isEnd('ier') || isEnd('iers')) { emit(vowelSoFar() ? ['IY', 'ER'] : ['IH', 'R'], 3); continue; }
      if (isEnd('iest')) { emit(['IY', 'AX', 'S', 'T'], 4); continue; }
      if (isEnd('iety')) { emit(['AY', 'AX', 'T', 'IY'], 4); continue; }
      if (endTail('ind') && !vowelSoFar()) { emit(['AY', 'N', 'D'], 3); continue; } // find, kind
      if (endTail('ild') && !vowelSoFar() && p !== 'u') { emit(['AY', 'L', 'D'], 3); continue; } // child, wild
      if ((isEnd('ive') || isEnd('ives')) && vowelsBefore() >= 1 && (p === 't' || p === 's')) { emit(['IH', 'V'], 3); continue; } // active
    }
    if (c === 'o') {
      if (isEnd('ous') || at('ously') || at('ousness')) { emit(['AX', 'S'], 3); continue; }
      if (isEnd('oing')) { emit(['OW', 'IH', 'NG'], 4); continue; }
      if (at('other')) { emit(['AH'], 1); continue; } // other, mother
      if (isEnd('on') && vowelsBefore() >= 1 && !prevVowelSound()) { emit(['AX', 'N'], 2); continue; } // dragon, lemon
      if (at('old') || at('olt') || isEnd('oll')) { emit(['OW'], 1); continue; }
    }
    if (c === 'u') {
      if (isEnd('us') && vowelsBefore() >= 1) { emit(['AX', 'S'], 2); continue; } // bonus
      if (isEnd('um') && vowelsBefore() >= 1) { emit(['AX', 'M'], 2); continue; } // album
      if (isEnd('uing')) { emit(['UW', 'IH', 'NG'], 4); continue; }
      if (at('uu')) { emit(['Y', 'UW'], 2); continue; }
      if ((at('ull') || at('ush')) && p !== undefined && 'pbf'.includes(p)) { emit(['UH'], 1); continue; } // pull, bush
    }
    if (c === 'a') {
      if ((isEnd('able') || isEnd('ables') || isEnd('ably')) && vowelsBefore() >= 1) { emit(['AX'], 1); continue; }
      if (isEnd('age') && vowelsBefore() >= 1) { emit(['IH', 'JH'], 3); continue; } // village
      if (isEnd('ages') && vowelsBefore() >= 1) { emit(['IH', 'JH', 'AX', 'Z'], 4); continue; }
      if (isEnd('ain') && vowelsBefore() >= 1 && p === 't' && !/^(con|main|ob|re|sus|enter|at|de|per|abs)/.test(w)) { emit(['AX', 'N'], 3); continue; } // captain
      if (endTail('alk')) { emit(['AO', 'K'], 3); continue; }
      if (at('alm')) { emit(['AA', 'M'], 3); continue; }
      if (endTail('all') || (at('al') && 'tkdsw'.includes(w[i + 2] ?? '-') && !vowelSoFar())) { emit(['AO'], 1); continue; } // all, salt
      if (at('ange')) { emit(['EY'], 1); continue; } // change, danger
      if (i === n - 1 && vowelSoFar()) { emit(['AX'], 1); continue; } // sofa
    }

    // --- vowel teams
    const two = w.slice(i, i + 2);
    if (two === 'ai' || two === 'ay') { emit(['EY'], 2); continue; }
    if (two === 'au' || two === 'aw') { emit(['AO'], 2); continue; }
    if (two === 'ee') { emit(['IY'], 2); continue; }
    if (two === 'ea') {
      const short = at('ead') || at('ealth') || (at('eath') && !at('eathe')) || at('eavy') || at('eaven') || at('easure') || at('eant');
      if (isEnd('ean') && vowelsBefore() >= 1) { emit(['IY', 'AX', 'N'], 3); continue; } // korean
      emit([short ? 'EH' : 'IY'], 2); continue;
    }
    if (two === 'ei') { emit([p === 'c' ? 'IY' : 'EY'], 2); continue; }
    if (two === 'ey') { emit([i + 2 === n && vowelSoFar() ? 'IY' : 'EY'], 2); continue; }
    if (two === 'eu' || two === 'ew') { emit(longU(), 2); continue; }
    if (two === 'ie') {
      if (at('ient') || at('ience')) { emit([vowelSoFar() ? 'IY' : 'AY'], 1); continue; } // client, audience: hiatus
      emit(['IY'], 2); continue;
    }
    if (two === 'oa' || two === 'oe') { emit(['OW'], 2); continue; }
    if (two === 'oi' || two === 'oy') { emit(['OY'], 2); continue; }
    if (two === 'oo') { emit([at('ook') || (at('ood') && !vowelSoFar()) ? 'UH' : 'UW'], 2); continue; }
    if (two === 'ou') { emit(['AW'], 2); continue; }
    if (two === 'ow') { emit([i + 2 === n || /^(s|ed|ing|ly)$/.test(w.slice(i + 2)) ? 'OW' : 'AW'], 2); continue; } // show / down
    if (two === 'ue') {
      if (i + 2 === n || /^(s|d)$/.test(w.slice(i + 2))) { emit(longU(), 2); continue; } // blue, values
      emit(longU(), 1); continue; // cruel: hiatus, the e speaks next
    }
    if (two === 'ui') { emit(longU(), w[i + 2] === 't' && 'iy'.includes(w[i + 3] ?? '-') ? 1 : 2); continue; } // intuition / fruit
    if (two === 'uy') { emit(['AY'], 2); continue; }
    if (two === 'aa') { emit(['AA'], 2); continue; }
    if (two === 'ae') { emit(['IY'], 2); continue; }

    // --- hiatus: two vowel letters that are NOT a team speak separately
    if (V(nx)) {
      if (c === 'i') { emit([vowelSoFar() ? 'IY' : 'AY'], 1); continue; } // radio / lion
      if (c === 'u') { emit(longU(), 1); continue; } // usual, duo
      if (c === 'e') { emit(['IY'], 1); continue; } // video, neon
      if (c === 'a') { emit(['EY'], 1); continue; } // chaos
      emit(['OW'], 1); continue;
    }
    // the second half of a hiatus is usually weak: id-e-a, per-i-od, li-on
    const afterHiatus = prevVowelSound() && V(p);

    // --- single vowels
    if (c === 'a') {
      if (afterHiatus && (i === n - 1 || C(nx)) && !at('ation')) { emit(['AX'], 1); continue; }
      if (magicE(i) || beforeLe(i) || at('ation') || at('atial')) { emit(['EY'], 1); continue; }
      if (i === 0 && open(i) && n > 3) { emit(['AX'], 1); continue; } // about, again, alone
      emit(['AE'], 1); continue;
    }
    if (c === 'e') {
      if (magicE(i)) { emit(['IY'], 1); continue; }
      const pre = w.match(UNSTRESSED_PREFIX);
      if (pre && pre[0].length === i + 1) { emit(['IH'], 1); continue; } // before, decide
      // the weak e of a last syllable: open, garden, moment, darkness
      if (vowelsBefore() >= 1 && /^e(n|l|t|m|nt|nts|nce|nces|ns|ls|ts|ss)$/.test(rest())) { emit(['AX'], 1); continue; }
      emit(['EH'], 1); continue;
    }
    if (c === 'i') {
      if (magicE(i) || beforeLe(i)) { emit(['AY'], 1); continue; }
      emit([i === n - 1 ? 'IY' : 'IH'], 1); continue; // ski / sit
    }
    if (c === 'o') {
      if (afterHiatus && C(nx) && i >= n - 3) { emit(['AX'], 1); continue; } // period, lion
      if (magicE(i) || beforeLe(i) || i === n - 1 || open(i) || isEnd('os')) { emit(['OW'], 1); continue; }
      emit(['AA'], 1); continue;
    }
    if (c === 'u') {
      if (magicE(i) || beforeLe(i) || open(i) || i === n - 1) { emit(longU(), 1); continue; }
      emit(['AH'], 1); continue;
    }

    emit([], 1); // anything unrecognised is silent
  }

  // A word with letters but no vowel sound still needs a nucleus to be sayable,
  // unless it is a pure hiss ("shh", "zzz") — that gets stretched instead.
  if (out.length && !hasVowelPhone(out) && !out.every((q) => PHONEMES[q.ph].type === 'fric')) {
    const at1 = Math.max(1, out.length - 1);
    out.splice(at1, 0, { ph: 'AX', a: out[at1 - 1].b, b: out[at1 - 1].b });
  }
  return out;
}
