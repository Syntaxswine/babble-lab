// The sound inventory. Symbols are ARPAbet-ish. Every number here is for a
// reference adult-male vocal tract (voice.tract = 1); a voice scales the lot.
//
//   vowel formants ... Peterson & Barney 1952 means, rounded
//   consonant loci ... after Klatt 1980 (JASA 67:971) table II, rounded
//   durations ........ inherent ms at rate 1, Klatt-rule ballpark
//
// `manner` is the class the tongue cipher is allowed to permute WITHIN
// (see tongue.mjs): the sonority contour is what makes babble read as speech,
// so a cipher may move a sound's place but never its manner.

const vowel = (F, dur, extra = {}) => ({ type: 'vowel', manner: 'vowel', voiced: true, F, dur, ...extra });
const diph = (F, Fe, dur) => ({ type: 'vowel', manner: 'diph', voiced: true, F, Fe, dur });

export const PHONEMES = {
  // --- monophthongs
  IY: vowel([270, 2290, 3010], 150),
  IH: vowel([390, 1990, 2550], 115),
  EH: vowel([530, 1840, 2480], 125),
  AE: vowel([660, 1720, 2410], 170),
  AA: vowel([730, 1090, 2440], 180),
  AO: vowel([570, 840, 2410], 180),
  UH: vowel([440, 1020, 2240], 115),
  UW: vowel([300, 870, 2240], 160),
  AH: vowel([640, 1190, 2390], 125),
  ER: vowel([490, 1350, 1690], 150),
  AX: vowel([500, 1500, 2500], 65, { manner: 'schwa' }), // never permuted: reduction must survive a cipher

  // --- diphthongs (start target -> end target)
  EY: diph([480, 1900, 2500], [330, 2150, 2800], 180),
  AY: diph([730, 1200, 2500], [400, 1950, 2600], 210),
  OW: diph([540, 1000, 2400], [350, 850, 2300], 190),
  AW: diph([750, 1300, 2450], [420, 950, 2300], 220),
  OY: diph([550, 880, 2400], [380, 1950, 2600], 230),

  // --- glides and liquids
  W: { type: 'sonorant', manner: 'approx', voiced: true, F: [290, 610, 2150], dur: 60, amp: 0.55 },
  Y: { type: 'sonorant', manner: 'approx', voiced: true, F: [260, 2070, 3020], dur: 60, amp: 0.55 },
  R: { type: 'sonorant', manner: 'approx', voiced: true, F: [310, 1060, 1380], dur: 65, amp: 0.6 },
  L: { type: 'sonorant', manner: 'approx', voiced: true, F: [310, 1050, 2880], dur: 60, amp: 0.6 },

  // --- nasals: a low murmur; upper formants damped by `nasal` in the synth
  M: { type: 'nasal', manner: 'nasal', voiced: true, F: [280, 1100, 2300], dur: 65, amp: 0.45 },
  N: { type: 'nasal', manner: 'nasal', voiced: true, F: [280, 1600, 2600], dur: 55, amp: 0.45 },
  NG: { type: 'nasal', manner: 'nasal', voiced: true, F: [280, 2100, 2700], dur: 65, amp: 0.45 },

  // --- stops: closure, burst (noise band), aspiration. F = locus the
  //     neighbouring vowel's formants bend toward.
  P: { type: 'stop', manner: 'stop-', voiced: false, F: [300, 900, 2300], closure: 58, burst: 7, asp: 32, band: { fc: 1000, bw: 1800, g: 0.30 } },
  T: { type: 'stop', manner: 'stop-', voiced: false, F: [300, 1750, 2700], closure: 48, burst: 10, asp: 36, band: { fc: 4600, bw: 2600, g: 0.60 } },
  K: { type: 'stop', manner: 'stop-', voiced: false, F: [300, 2000, 2400], closure: 52, burst: 14, asp: 40, band: { fc: 2200, bw: 900, g: 0.55 } },
  B: { type: 'stop', manner: 'stop+', voiced: true, F: [250, 900, 2300], closure: 52, burst: 6, asp: 0, band: { fc: 1000, bw: 1800, g: 0.18 } },
  D: { type: 'stop', manner: 'stop+', voiced: true, F: [250, 1750, 2700], closure: 44, burst: 8, asp: 0, band: { fc: 4600, bw: 2600, g: 0.32 } },
  G: { type: 'stop', manner: 'stop+', voiced: true, F: [250, 2000, 2400], closure: 48, burst: 11, asp: 0, band: { fc: 2200, bw: 900, g: 0.30 } },

  // --- fricatives: noise through one or two parallel bands
  F: { type: 'fric', manner: 'fric-', voiced: false, F: [320, 1000, 2300], dur: 90, bands: [{ fc: 6500, bw: 5000, g: 0.10 }] },
  TH: { type: 'fric', manner: 'fric-', voiced: false, F: [320, 1500, 2600], dur: 85, bands: [{ fc: 6000, bw: 4500, g: 0.08 }] },
  S: { type: 'fric', manner: 'fric-', voiced: false, F: [320, 1750, 2700], dur: 100, bands: [{ fc: 6200, bw: 1900, g: 0.42 }, { fc: 8600, bw: 2400, g: 0.20 }] },
  SH: { type: 'fric', manner: 'fric-', voiced: false, F: [300, 1900, 2500], dur: 100, bands: [{ fc: 2900, bw: 1200, g: 0.42 }, { fc: 4800, bw: 1800, g: 0.22 }] },
  V: { type: 'fric', manner: 'fric+', voiced: true, F: [300, 1000, 2300], dur: 60, bands: [{ fc: 6500, bw: 5000, g: 0.05 }] },
  DH: { type: 'fric', manner: 'fric+', voiced: true, F: [300, 1500, 2600], dur: 45, bands: [{ fc: 6000, bw: 4500, g: 0.04 }] },
  Z: { type: 'fric', manner: 'fric+', voiced: true, F: [300, 1750, 2700], dur: 70, bands: [{ fc: 6200, bw: 1900, g: 0.22 }, { fc: 8600, bw: 2400, g: 0.10 }] },
  ZH: { type: 'fric', manner: 'fric+', voiced: true, F: [300, 1900, 2500], dur: 70, bands: [{ fc: 2900, bw: 1200, g: 0.22 }, { fc: 4800, bw: 1800, g: 0.11 }] },

  // --- HH: aspiration through the vowel's own formants (no place of its own)
  HH: { type: 'asp', manner: 'asp', voiced: false, F: null, dur: 55 },

  // --- affricates: a stop closure released into a fricative
  CH: { type: 'affric', manner: 'affric-', voiced: false, F: [300, 1850, 2600], closure: 45, fric: 60, bands: [{ fc: 2900, bw: 1200, g: 0.45 }, { fc: 4800, bw: 1800, g: 0.22 }] },
  JH: { type: 'affric', manner: 'affric+', voiced: true, F: [250, 1850, 2600], closure: 40, fric: 45, bands: [{ fc: 2900, bw: 1200, g: 0.24 }, { fc: 4800, bw: 1800, g: 0.12 }] },
};

// Fixed upper formants and the bandwidth set (Hz, tract = 1).
export const F4 = 3400;
export const F5 = 4200;
export const BANDWIDTHS = [70, 95, 150, 250, 300];

export const isVowel = (ph) => PHONEMES[ph]?.type === 'vowel';

// A readable spelling for the workbench's score line. Not IPA — a pocket
// respelling, because the point is that a person can sound it out.
export const RESPELL = {
  IY: 'ee', IH: 'i', EH: 'e', AE: 'a', AA: 'ah', AO: 'aw', UH: 'uu', UW: 'oo', AH: 'u', ER: 'er', AX: 'ə',
  EY: 'ay', AY: 'eye', OW: 'oh', AW: 'ow', OY: 'oy',
  W: 'w', Y: 'y', R: 'r', L: 'l', M: 'm', N: 'n', NG: 'ng',
  P: 'p', T: 't', K: 'k', B: 'b', D: 'd', G: 'g',
  F: 'f', TH: 'th', S: 's', SH: 'sh', V: 'v', DH: 'dh', Z: 'z', ZH: 'zh', HH: 'h', CH: 'ch', JH: 'j',
};

export function respell(phones) {
  return phones.map((p) => RESPELL[p] ?? '?').join('');
}
