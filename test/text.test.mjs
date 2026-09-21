import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, analyze, countSyllables, numberToWords, wordToSyllables } from '../src/text.mjs';
import { g2p } from '../src/g2p.mjs';
import { LEXICON, LETTER_NAMES } from '../src/lexicon.mjs';
import { PHONEMES } from '../src/phonemes.mjs';
import { RUNNING, HARD } from './fixtures/syllables.mjs';
import { HELDOUT, FIRST_RUN } from './fixtures/heldout.mjs';

const ok = (want, got) => (Array.isArray(want) ? got >= want[0] && got <= want[1] : got === want);

// Thresholds were pre-registered before the rules were first run against the
// fixture: running text >= 95 % of tokens, hard list >= 75 % of words.
test('syllable count: running dialogue, token-weighted', () => {
  let total = 0;
  const misses = [];
  for (const [line, counts] of RUNNING) {
    const words = tokenize(line).filter((t) => t.type === 'word');
    assert.equal(words.length, counts.length, `fixture/tokenizer disagree on word count: "${line}"`);
    words.forEach((w, k) => {
      total++;
      const got = countSyllables(w.text);
      if (!ok(counts[k], got)) misses.push(`${w.text}: want ${counts[k]} got ${got}`);
    });
  }
  const acc = 1 - misses.length / total;
  console.log(`  running: ${total - misses.length}/${total} = ${(100 * acc).toFixed(1)}%${misses.length ? '\n    ' + misses.join('\n    ') : ''}`);
  assert.ok(acc >= 0.95, `running-text syllable accuracy ${(100 * acc).toFixed(1)}% < 95%`);
});

test('syllable count: the hard list', () => {
  const misses = [];
  const words = Object.entries(HARD);
  for (const [word, want] of words) {
    const got = countSyllables(word);
    if (!ok(want, got)) misses.push(`${word}: want ${want} got ${got} [${g2p(word).map((p) => p.ph).join(' ')}]`);
  }
  const acc = 1 - misses.length / words.length;
  console.log(`  hard: ${words.length - misses.length}/${words.length} = ${(100 * acc).toFixed(1)}%${misses.length ? '\n    ' + misses.join('\n    ') : ''}`);
  assert.ok(acc >= 0.75, `hard-list syllable accuracy ${(100 * acc).toFixed(1)}% < 75%`);
});

test('syllable count: held-out game vocabulary and invented names', () => {
  const words = Object.entries(HELDOUT);
  const misses = words.filter(([w, want]) => !ok(want, countSyllables(w))).map(([w]) => w);
  const acc = 1 - misses.length / words.length;
  console.log(`  held-out: ${words.length - misses.length}/${words.length} = ${(100 * acc).toFixed(1)}%  (first, untuned run: ${FIRST_RUN.correct}/${FIRST_RUN.total})  misses: ${misses.join(', ') || 'none'}`);
  assert.ok(acc >= 0.95, `held-out syllable accuracy ${(100 * acc).toFixed(1)}% < 95%`);
});

test('every lexicon and letter-name symbol is a real phoneme', () => {
  for (const [word, pron] of [...Object.entries(LEXICON), ...Object.entries(LETTER_NAMES)]) {
    for (const ph of pron.split(' ')) assert.ok(PHONEMES[ph], `${word}: unknown phoneme "${ph}"`);
  }
});

test('phoneme letter-spans tile the word, in order', () => {
  const words = [...Object.keys(HARD), 'Zarkoth', 'Eldrin', "o'clock", 'naïve', 'rhythm', 'queueing', 'a', 'I', 'x'];
  for (const w of words) {
    const ph = g2p(w);
    assert.ok(ph.length > 0, `${w}: no phonemes`);
    assert.equal(ph[0].a, 0, `${w}: first span starts at ${ph[0].a}`);
    assert.equal(ph[ph.length - 1].b, w.length, `${w}: last span ends at ${ph[ph.length - 1].b}`);
    for (let k = 0; k < ph.length; k++) {
      assert.ok(ph[k].a <= ph[k].b, `${w}: span ${k} inverted`);
      if (k) assert.ok(ph[k].a >= ph[k - 1].a && ph[k].a <= ph[k - 1].b, `${w}: span ${k} leaves a gap or runs backwards`);
    }
  }
});

test('syllable spans tile the token exactly', () => {
  for (const w of ['adventurer', 'immediately', 'sooooo', 'HP', 'STOP', 'Zarkoth', '東京', 'привет', "don't"]) {
    const { syllables } = wordToSyllables(w);
    assert.ok(syllables.length > 0, `${w}: no syllables`);
    assert.equal(syllables[0].a, 0);
    assert.equal(syllables[syllables.length - 1].b, [...w].length === w.length ? w.length : syllables[syllables.length - 1].b);
    for (let k = 1; k < syllables.length; k++) assert.equal(syllables[k].a, syllables[k - 1].b, `${w}: syllable ${k} does not start where ${k - 1} ends`);
  }
});

test('the same word always gets the same sounds', () => {
  assert.deepEqual(g2p('dragon'), g2p('Dragon'));
  assert.deepEqual(g2p('dragon'), g2p('DRAGON'));
});

test('numbers and symbols are spoken, and keep their character span', () => {
  assert.deepEqual(numberToWords('42'), ['forty', 'two']);
  assert.deepEqual(numberToWords('300'), ['three', 'hundred']);
  assert.deepEqual(numberToWords('1,250'), ['one', 'thousand', 'two', 'hundred', 'fifty']);
  assert.deepEqual(numberToWords('3.5'), ['three', 'point', 'five']);
  assert.deepEqual(numberToWords('007'), ['zero', 'zero', 'seven']);
  const items = analyze('Pay 42 gold & go.');
  const num = items.find((i) => i.text === '42');
  assert.equal(num.syllables.length, 3); // for-ty-two
  assert.equal(num.start, 4);
  assert.equal(num.end, 6);
  assert.equal(num.syllables[num.syllables.length - 1].b, 2);
  assert.equal(items.find((i) => i.text === '&').syllables.length, 1);
});

test('analyze covers every character of the input exactly once', () => {
  for (const text of ['Hello, world!', "Wait... what?! I don't—", 'Line one.\nLine two.', '  spaced   out  ', 'well-known HP: 300/500 (max)']) {
    const items = analyze(text);
    let pos = 0;
    for (const it of items) {
      assert.equal(it.start, pos, `"${text}": gap or overlap at ${pos}`);
      pos = it.end;
    }
    assert.equal(pos, text.length, `"${text}": did not reach the end`);
  }
});

test('punctuation is classified', () => {
  const marks = (t) => analyze(t).filter((i) => i.kind === 'break' && i.mark !== 'space').map((i) => i.mark);
  assert.deepEqual(marks('Hi. Hi! Hi? Hi?! Hi... Hi, hi; well-known — yes'), ['period', 'exclaim', 'question', 'interrobang', 'ellipsis', 'comma', 'comma', 'hyphen', 'dash']);
});

test('elongated words collapse and report a stretch', () => {
  const a = wordToSyllables('sooooo');
  assert.equal(a.syllables.length, 1);
  assert.ok(a.stretch > 1.5);
  assert.equal(wordToSyllables('so').stretch, 1);
  assert.equal(wordToSyllables('cooool').syllables.length, 1);
});

test('vowel-less caps are spelled out; shouted words are not', () => {
  assert.equal(wordToSyllables('HP').syllables.length, 2); // aitch pee
  assert.equal(wordToSyllables('NPC').syllables.length, 3);
  assert.equal(wordToSyllables('STOP').syllables.length, 1);
});
