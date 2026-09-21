// A "tongue" is a seeded cipher over the phoneme inventory: the way to make
// babble that is *not English* and yet still behaves like a language.
//
// The rule it encodes: KEEP MANNER, PERMUTE PLACE. A stop stays a stop, a nasal
// stays a nasal, a vowel stays a vowel — so the sonority contour (the rise and
// fall of openness that makes a stream of sound read as syllables, as speech)
// survives untouched. Only *which* stop, *which* vowel changes, and that is the
// part that carries the words. Same text in -> same sounds out, every time, so
// a player starts to recognise a character's "hello" without ever parsing it.
//
//   tongue 0   identity: the engine says (roughly) the English it was given
//   tongue n   a bijection within each manner class, drawn from seed n
//
// Two characters of one species can share a tongue and differ in voice.

import { PHONEMES } from './phonemes.mjs';
import { mulberry32, mixSeed, shuffled } from './rng.mjs';

export const MANNER_CLASSES = {};
for (const [ph, d] of Object.entries(PHONEMES)) (MANNER_CLASSES[d.manner] ??= []).push(ph);

const cache = new Map();

export function makeTongue(seed) {
  const key = (seed | 0) >>> 0;
  if (cache.has(key)) return cache.get(key);
  const map = {};
  const rand = mulberry32(mixSeed('tongue', key));
  for (const [manner, list] of Object.entries(MANNER_CLASSES)) {
    // schwa is never moved: reduction (the swallowed "the", "of", "a") must survive a cipher
    const perm = key === 0 || manner === 'schwa' ? list : shuffled(list, rand);
    list.forEach((ph, k) => { map[ph] = perm[k]; });
  }
  cache.set(key, map);
  return map;
}

export function applyTongue(phones, seed) {
  if (!seed) return phones;
  const map = makeTongue(seed);
  return phones.map((ph) => map[ph] ?? ph);
}
