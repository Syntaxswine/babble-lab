// Seeded randomness. Everything audible in babble-lab is a pure function of
// (text, voice, seed) — there is no Math.random anywhere in the engine, so a
// line rendered at build time and the same line rendered in the game at run
// time are the same samples.

export function hashString(s) {
  // FNV-1a, 32 bit
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Mix several integers/strings into one 32-bit seed.
export function mixSeed(...parts) {
  let h = 0x9e3779b9;
  for (const p of parts) {
    const v = typeof p === 'string' ? hashString(p) : (p >>> 0);
    h ^= v + 0x9e3779b9 + ((h << 6) >>> 0) + (h >>> 2);
    h >>>= 0;
  }
  return h >>> 0;
}

// Fisher-Yates on a copy.
export function shuffled(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}
