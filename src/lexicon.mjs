// Hand-written pronunciations for the irregular head of English.
//
// tts-weights (../tts-weights/README.md, "Not done") measured why this file has
// to exist: English's most FREQUENT words are also its most IRREGULAR, so
// letter-to-sound rules fail hardest exactly where the traffic is. The rules in
// text.mjs carry the open tail (and every invented fantasy name); this carries
// the head.
//
// Format: word -> space-separated phoneme symbols from phonemes.mjs.
// test/text.test.mjs asserts every symbol here exists.

export const LEXICON = {
  // --- articles, pronouns, the closed class
  a: 'AX', i: 'AY', the: 'DH AX', of: 'AH V', to: 'T UW', do: 'D UW', who: 'HH UW', two: 'T UW',
  into: 'IH N T UW', onto: 'AA N T UW', you: 'Y UW', your: 'Y AO R', yours: 'Y AO R Z',
  "you're": 'Y AO R', "you'll": 'Y UW L', "you've": 'Y UW V', "you'd": 'Y UW D',
  are: 'AA R', "aren't": 'AA R N T', were: 'W ER', "weren't": 'W ER N T', was: 'W AH Z',
  is: 'IH Z', his: 'HH IH Z', has: 'HH AE Z', as: 'AE Z', does: 'D AH Z', goes: 'G OW Z',
  have: 'HH AE V', having: 'HH AE V IH NG', give: 'G IH V', given: 'G IH V AX N', gives: 'G IH V Z',
  live: 'L IH V', lives: 'L IH V Z', lived: 'L IH V D', living: 'L IH V IH NG',
  one: 'W AH N', once: 'W AH N S', ones: 'W AH N Z', none: 'N AH N', done: 'D AH N', gone: 'G AO N',
  come: 'K AH M', comes: 'K AH M Z', coming: 'K AH M IH NG', become: 'B IH K AH M',
  some: 'S AH M', someone: 'S AH M W AH N', anyone: 'EH N IY W AH N', everyone: 'EH V R IY W AH N',
  something: 'S AH M TH IH NG', somebody: 'S AH M B AH D IY', nobody: 'N OW B AH D IY',
  anybody: 'EH N IY B AH D IY', everybody: 'EH V R IY B AH D IY', welcome: 'W EH L K AX M',
  any: 'EH N IY', many: 'M EH N IY', anything: 'EH N IY TH IH NG', anywhere: 'EH N IY W EH R',
  anymore: 'EH N IY M AO R', every: 'EH V R IY', everything: 'EH V R IY TH IH NG',
  everywhere: 'EH V R IY W EH R', very: 'V EH R IY', only: 'OW N L IY', also: 'AO L S OW',
  said: 'S EH D', says: 'S EH Z', again: 'AX G EH N', against: 'AX G EH N S T',
  they: 'DH EY', them: 'DH EH M', their: 'DH EH R', theirs: 'DH EH R Z', there: 'DH EH R',
  "they're": 'DH EH R', "there's": 'DH EH R Z', "they'll": 'DH EY L', "they've": 'DH EY V',
  this: 'DH IH S', that: 'DH AE T', "that's": 'DH AE T S', these: 'DH IY Z', those: 'DH OW Z',
  then: 'DH EH N', than: 'DH AE N', thus: 'DH AH S', though: 'DH OW', although: 'AO L DH OW',
  with: 'W IH DH', without: 'W IH DH AW T', within: 'W IH DH IH N',
  what: 'W AH T', "what's": 'W AH T S', where: 'W EH R', "where's": 'W EH R Z', whom: 'HH UW M',
  whose: 'HH UW Z', whole: 'HH OW L', "who's": 'HH UW Z',
  "i'm": 'AY M', "i'll": 'AY L', "i've": 'AY V', "i'd": 'AY D', "it's": 'IH T S', "he's": 'HH IY Z',
  "she's": 'SH IY Z', "we're": 'W IH R', "we'll": 'W IY L', "we've": 'W IY V', "let's": 'L EH T S',
  "don't": 'D OW N T', "won't": 'W OW N T', "can't": 'K AE N T',
  could: 'K UH D', would: 'W UH D', should: 'SH UH D',
  our: 'AW ER', ours: 'AW ER Z', hour: 'AW ER', hours: 'AW ER Z',
  been: 'B IH N', from: 'F R AH M', put: 'P UH T', push: 'P UH SH', pull: 'P UH L', full: 'F UH L',
  both: 'B OW TH', most: 'M OW S T', almost: 'AO L M OW S T', post: 'P OW S T', host: 'HH OW S T',
  ghost: 'G OW S T', own: 'OW N', known: 'N OW N', shown: 'SH OW N', grown: 'G R OW N', bowl: 'B OW L',
  how: 'HH AW', now: 'N AW', cow: 'K AW', wow: 'W AW', allow: 'AX L AW', allowed: 'AX L AW D',
  somehow: 'S AH M HH AW', anyhow: 'EH N IY HH AW', vow: 'V AW', brow: 'B R AW', meow: 'M IY AW',
  lower: 'L OW ER', slower: 'S L OW ER',
  // --- o that says "uh", and its cousins
  love: 'L AH V', loved: 'L AH V D', loves: 'L AH V Z', lovely: 'L AH V L IY', above: 'AX B AH V',
  glove: 'G L AH V', move: 'M UW V', moved: 'M UW V D', movement: 'M UW V M AX N T',
  moving: 'M UW V IH NG', prove: 'P R UW V', remove: 'R IH M UW V', improve: 'IH M P R UW V',
  lose: 'L UW Z', shoe: 'SH UW', shoes: 'SH UW Z', canoe: 'K AX N UW',
  other: 'AH DH ER', others: 'AH DH ER Z', mother: 'M AH DH ER', brother: 'B R AH DH ER',
  another: 'AX N AH DH ER', nothing: 'N AH TH IH NG', money: 'M AH N IY', honey: 'HH AH N IY',
  monkey: 'M AH NG K IY', monday: 'M AH N D EY', month: 'M AH N TH', front: 'F R AH N T',
  son: 'S AH N', won: 'W AH N', among: 'AX M AH NG', tongue: 'T AH NG', color: 'K AH L ER',
  cover: 'K AH V ER', oven: 'AH V AX N', dozen: 'D AH Z AX N', stomach: 'S T AH M AX K',
  woman: 'W UH M AX N', women: 'W IH M AX N', wolf: 'W UH L F', wonder: 'W AH N D ER',
  wonderful: 'W AH N D ER F AX L', worn: 'W AO R N', sword: 'S AO R D', answer: 'AE N S ER',
  body: 'B AA D IY', copy: 'K AA P IY', model: 'M AA D AX L', modern: 'M AA D ER N',
  honest: 'AA N AX S T', honor: 'AA N ER', problem: 'P R AA B L AX M', probably: 'P R AA B AX B L IY',
  promise: 'P R AA M AX S', promised: 'P R AA M AX S T', project: 'P R AA JH EH K T',
  product: 'P R AA D AX K T', proper: 'P R AA P ER', property: 'P R AA P ER T IY',
  purpose: 'P ER P AX S', holiday: 'HH AA L AX D EY', policy: 'P AA L AX S IY', comic: 'K AA M IH K',
  topic: 'T AA P IH K', logic: 'L AA JH IH K', solid: 'S AA L AX D', novel: 'N AA V AX L',
  // --- ou / ough / augh
  young: 'Y AH NG', country: 'K AH N T R IY', couple: 'K AH P AX L', double: 'D AH B AX L',
  trouble: 'T R AH B AX L', touch: 'T AH CH', enough: 'IH N AH F', cousin: 'K AH Z AX N',
  rough: 'R AH F', tough: 'T AH F', cough: 'K AO F', laugh: 'L AE F', laughed: 'L AE F T',
  through: 'TH R UW', thought: 'TH AO T', bought: 'B AO T', brought: 'B R AO T', fought: 'F AO T',
  ought: 'AO T', youth: 'Y UW TH', group: 'G R UW P', soup: 'S UW P', route: 'R UW T',
  soul: 'S OW L', shoulder: 'SH OW L D ER', journey: 'JH ER N IY', courage: 'K ER IH JH',
  // --- ea / ei / ie
  great: 'G R EY T', break: 'B R EY K', steak: 'S T EY K', yeah: 'Y AE', ready: 'R EH D IY',
  already: 'AO L R EH D IY', instead: 'IH N S T EH D', breakfast: 'B R EH K F AX S T',
  weapon: 'W EH P AX N', sweat: 'S W EH T', threat: 'TH R EH T', pleasant: 'P L EH Z AX N T',
  ocean: 'OW SH AX N', bear: 'B EH R', wear: 'W EH R', pear: 'P EH R', swear: 'S W EH R',
  heart: 'HH AA R T', beard: 'B IH R D', idea: 'AY D IY AX', ideas: 'AY D IY AX Z', area: 'EH R IY AX',
  real: 'R IY L', really: 'R IH L IY', reality: 'R IY AE L AX T IY', realize: 'R IY AX L AY Z',
  create: 'K R IY EY T', created: 'K R IY EY T AX D', creating: 'K R IY EY T IH NG',
  creature: 'K R IY CH ER', creatures: 'K R IY CH ER Z', react: 'R IY AE K T',
  theater: 'TH IY AX T ER', theatre: 'TH IY AX T ER', cereal: 'S IH R IY AX L',
  nuclear: 'N UW K L IY ER', museum: 'M Y UW Z IY AX M', friend: 'F R EH N D', friends: 'F R EH N D Z',
  height: 'HH AY T', foreign: 'F AO R AX N', key: 'K IY', keys: 'K IY Z', obey: 'OW B EY',
  people: 'P IY P AX L', eye: 'AY', eyes: 'AY Z', science: 'S AY AX N S', society: 'S AX S AY AX T IY',
  quiet: 'K W AY AX T', poem: 'P OW AX M', poet: 'P OW AX T', poetry: 'P OW AX T R IY',
  being: 'B IY IH NG', seeing: 'S IY IH NG', doing: 'D UW IH NG', going: 'G OW IH NG',
  ruin: 'R UW IH N', ruins: 'R UW IH N Z', fluid: 'F L UW IH D', build: 'B IH L D', built: 'B IH L T',
  building: 'B IH L D IH NG', biscuit: 'B IH S K AX T', buy: 'B AY', guy: 'G AY', busy: 'B IH Z IY',
  business: 'B IH Z N AX S', bury: 'B EH R IY', minute: 'M IH N AX T', minutes: 'M IH N AX T S',
  beautiful: 'B Y UW T AX F AX L', beauty: 'B Y UW T IY', queue: 'K Y UW', argue: 'AA R G Y UW',
  blood: 'B L AH D', flood: 'F L AH D', food: 'F UW D', mood: 'M UW D', foot: 'F UH T', wool: 'W UH L',
  aunt: 'AE N T', because: 'B IH K AH Z', sure: 'SH UH R', sugar: 'SH UH G ER', iron: 'AY ER N',
  // --- consonant liars
  character: 'K EH R AX K T ER', chaos: 'K EY AA S', echo: 'EH K OW', anchor: 'AE NG K ER',
  mechanic: 'M AX K AE N IH K', psychology: 'S AY K AA L AX JH IY', ache: 'EY K',
  orchestra: 'AO R K AX S T R AX', architect: 'AA R K AX T EH K T', chemical: 'K EH M AX K AX L',
  chorus: 'K AO R AX S', machine: 'M AX SH IY N', machines: 'M AX SH IY N Z', chef: 'SH EH F',
  parachute: 'P EH R AX SH UW T', police: 'P AX L IY S', muscle: 'M AH S AX L', muscles: 'M AH S AX L Z',
  often: 'AO F AX N', half: 'HH AE F', folk: 'F OW K', honour: 'AA N ER',
  general: 'JH EH N R AX L', gentle: 'JH EH N T AX L', giant: 'JH AY AX N T', genius: 'JH IY N Y AX S',
  gem: 'JH EH M', germ: 'JH ER M', gym: 'JH IH M', gesture: 'JH EH S CH ER',
  begin: 'B IH G IH N', began: 'B IH G AE N', begun: 'B IH G AH N', beginning: 'B IH G IH N IH NG',
  together: 'T AX G EH DH ER', forget: 'F ER G EH T', forgot: 'F ER G AA T', target: 'T AA R G AX T',
  tiger: 'T AY G ER', eager: 'IY G ER', burger: 'B ER G ER', forgive: 'F ER G IH V',
  danger: 'D EY N JH ER', dangerous: 'D EY N JH ER AX S', stranger: 'S T R EY N JH ER',
  ranger: 'R EY N JH ER', passenger: 'P AE S AX N JH ER', messenger: 'M EH S AX N JH ER',
  singer: 'S IH NG ER', orange: 'AO R AX N JH', hundred: 'HH AH N D R AX D', naked: 'N EY K AX D',
  wicked: 'W IH K AX D', sacred: 'S EY K R AX D', canyon: 'K AE N Y AX N', guitar: 'G IH T AA R',
  element: 'EH L AX M AX N T', implement: 'IH M P L AX M AX N T', supplement: 'S AH P L AX M AX N T',
  apply: 'AX P L AY', reply: 'R IH P L AY', supply: 'S AX P L AY', deny: 'D IH N AY', rely: 'R IH L AY',
  july: 'JH UH L AY', hi: 'HH AY', hey: 'HH EY', oh: 'OW', ah: 'AA', uh: 'AH', um: 'AH M', ok: 'OW K EY',
  okay: 'OW K EY', hello: 'HH AX L OW', goodbye: 'G UH D B AY', bye: 'B AY',
  maybe: 'M EY B IY', anyway: 'EH N IY W EY', shall: 'SH AE L', early: 'ER L IY', earlier: 'ER L IY ER',
  animal: 'AE N AX M AX L', animals: 'AE N AX M AX L Z', average: 'AE V R AX JH', avenue: 'AE V AX N UW',
  tuesday: 'T UW Z D EY', wednesday: 'W EH N Z D EY', soldier: 'S OW L JH ER', soldiers: 'S OW L JH ER Z',
  // --- things with no vowel letters, and abbreviations
  hmm: 'HH AX M', hm: 'HH AX M', mm: 'AX M', mmm: 'AX M', mhm: 'AX M HH AX M', shh: 'SH', shhh: 'SH',
  psst: 'P S T', tsk: 'T S K', brr: 'B ER', grr: 'G ER', grrr: 'G ER', zzz: 'Z', pfft: 'P F T',
  mr: 'M IH S T ER', mrs: 'M IH S AX Z', ms: 'M IH Z', dr: 'D AA K T ER', vs: 'V ER S AX S',
  etc: 'EH T S EH T ER AX', tv: 'T IY V IY',
};

// Letter names, for spelling out vowel-less ALL-CAPS tokens ("HP", "NPC").
export const LETTER_NAMES = {
  a: 'EY', b: 'B IY', c: 'S IY', d: 'D IY', e: 'IY', f: 'EH F', g: 'JH IY', h: 'EY CH', i: 'AY',
  j: 'JH EY', k: 'K EY', l: 'EH L', m: 'EH M', n: 'EH N', o: 'OW', p: 'P IY', q: 'K Y UW', r: 'AA R',
  s: 'EH S', t: 'T IY', u: 'Y UW', v: 'V IY', w: 'D AH B AX L Y UW', x: 'EH K S', y: 'W AY', z: 'Z IY',
};

// The closed class: words a real speaker swallows. prosody.mjs shortens these
// and pulls their vowels toward schwa. The 0.60 floor is the same DUR_FLOOR
// tts-weights anchored on the phonetics literature; if a tts-weights table is
// supplied (plan(text, voice, { weights })), its measured per-word `dur`
// replaces this list.
export const FUNCTION_WORDS = new Set(`a an the of to in on at by for from with as and or but nor so if than then that this
these those is am are was were be been being do does did have has had will would shall should can could may might
must i you he she it we they me him her us them my your his its our their mine yours who whom whose which what
there here not no yes it's i'm i'll i've i'd you're you'll you've we're we'll we've they're they'll they've he's
she's that's there's let's don't won't can't isn't aren't wasn't weren't didn't doesn't into onto up out about
over under just very too also some any all each both such`.split(/\s+/));
