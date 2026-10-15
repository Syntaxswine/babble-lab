import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { plan, render, makeTongue, applyTongue, MANNER_CLASSES, PHONEMES, decodeWav, encodeWav, decodeBank, parseScript, renderScript, randomVoice, compactVoice, resolveVoice } from '../src/index.mjs';
import { createSpeaker } from '../src/runtime.mjs';
import { buildAll } from '../tools/build-standalone.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = (...args) => spawnSync(process.execPath, [path.join(root, 'bin/babble.mjs'), ...args], { encoding: 'utf8', cwd: os.tmpdir() });

// ------------------------------------------------------------------ tongue
test('tongue: 0 is identity; any other is a bijection that never leaves its manner class', () => {
  const zero = makeTongue(0);
  for (const ph of Object.keys(PHONEMES)) assert.equal(zero[ph], ph);
  for (const seed of [1, 2, 42, 9999]) {
    const map = makeTongue(seed);
    assert.equal(new Set(Object.values(map)).size, Object.keys(PHONEMES).length, `tongue ${seed} is not one-to-one`);
    for (const [from, to] of Object.entries(map)) assert.equal(PHONEMES[to].manner, PHONEMES[from].manner, `tongue ${seed}: ${from} -> ${to} changes manner`);
    assert.equal(map.AX, 'AX', 'schwa moved: function-word reduction would not survive the cipher');
    assert.deepEqual(makeTongue(seed), map, 'same seed, different tongue');
  }
  const moved = Object.entries(makeTongue(42)).filter(([a, b]) => a !== b).length;
  assert.ok(moved >= 15, `tongue 42 only moves ${moved} phonemes — that is barely a language`);
  assert.notDeepEqual(makeTongue(42), makeTongue(43));
  assert.ok(Object.keys(MANNER_CLASSES).length >= 10);
});

test('tongue: changes the sounds, keeps the rhythm and the character spans', () => {
  const text = 'Have you seen my little brother anywhere?';
  const a = plan(text, { tongue: 0 });
  const b = plan(text, { tongue: 42 });
  const sounding = (p) => p.units.filter((u) => u.kind !== 'rest');
  assert.equal(sounding(a).length, sounding(b).length);
  assert.deepEqual(sounding(a).map((u) => [u.c0, u.c1, u.stress]), sounding(b).map((u) => [u.c0, u.c1, u.stress]));
  assert.notDeepEqual(sounding(a).map((u) => u.label), sounding(b).map((u) => u.label));
  // the same word says the same thing wherever it appears
  const twice = sounding(plan('dragon, dragon!', { tongue: 42 }));
  assert.deepEqual(twice.slice(0, 2).map((u) => u.phones), twice.slice(2, 4).map((u) => u.phones));
  assert.deepEqual(applyTongue(['D', 'R', 'AE', 'G'], 0), ['D', 'R', 'AE', 'G']);
});

test('a syllabary voice says only its own syllables, the same ones for the same word', () => {
  const p = plan('Welcome, stranger. Welcome!', 'wah');
  const said = p.units.filter((u) => u.kind === 'syl');
  const bank = new Set(resolveVoice('wah').syllabary.map((s) => s.join(' ')));
  for (const u of said) assert.ok(bank.has(u.phones.join(' ')), `"${u.label}" is not in the wah bank`);
  assert.deepEqual(said.slice(0, 2).map((u) => u.phones), said.slice(-2).map((u) => u.phones));
});

test('rolled voices are valid, reproducible, and survive the compact round trip', () => {
  for (const seed of [1, 7, 80445, 99999]) {
    const v = randomVoice(seed);
    assert.deepEqual(randomVoice(seed), v);
    assert.deepEqual(resolveVoice(compactVoice(v)), v, `seed ${seed}: compactVoice lost something`);
    const { samples } = render('Testing, one two three!', v);
    assert.ok(samples.every(Number.isFinite));
  }
});

// ------------------------------------------------------------------ script
test('script: parses "name: line", renders with a cast, refuses an unknown speaker', () => {
  const lines = parseScript('# scene 1\nMira: Did you hear that?\n\nGuard: Hear what: the wind?\n');
  assert.deepEqual(lines, [{ who: 'Mira', text: 'Did you hear that?' }, { who: 'Guard', text: 'Hear what: the wind?' }]);
  const out = renderScript(lines, { Mira: 'pixie', Guard: { preset: 'gruff', pitch: 78 } });
  assert.equal(out.length, 2);
  assert.equal(out[1].plan.voice.pitch, 78);
  assert.throws(() => renderScript(lines, { Mira: 'pixie' }), /"Guard", who is not in the cast/);
  assert.throws(() => parseScript('just some text'), /not "name: text"/);
});

// ------------------------------------------------------------------ CLI
test('cli: writes a WAV that decodes, a plan, and a script manifest', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'babble-test-'));
  try {
    const wav = path.join(dir, 'who.wav');
    const planFile = path.join(dir, 'who.json');
    const r = cli('Who goes there?', '--voice', 'gruff', '--set', 'range=8', '--set', 'fx.echo=0.2', '-o', wav, '--plan', planFile, '--quiet');
    assert.equal(r.status, 0, r.stderr);
    const { samples, sampleRate } = decodeWav(fs.readFileSync(wav));
    assert.equal(sampleRate, 44100);
    assert.ok(samples.length > 20000);
    const saved = JSON.parse(fs.readFileSync(planFile, 'utf8'));
    assert.equal(saved.voice.range, 8);
    assert.equal(saved.voice.fx.echo, 0.2);
    assert.equal(saved.reveal[saved.reveal.length - 1].chars, 'Who goes there?'.length);

    fs.writeFileSync(path.join(dir, 'lines.txt'), 'Mira: Hello!\nGuard: Halt.\n');
    fs.writeFileSync(path.join(dir, 'cast.json'), JSON.stringify({ Mira: 'pixie', Guard: 'gruff' }));
    const s = cli('script', path.join(dir, 'lines.txt'), '--cast', path.join(dir, 'cast.json'), '-o', path.join(dir, 'out'), '--quiet');
    assert.equal(s.status, 0, s.stderr);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'out', 'manifest.json'), 'utf8'));
    assert.deepEqual(manifest.lines.map((l) => l.file), ['001-mira.wav', '002-guard.wav']);
    for (const l of manifest.lines) { assert.ok(fs.existsSync(path.join(dir, 'out', l.file))); assert.equal(l.reveal[l.reveal.length - 1][1], l.text.length); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('cli: refuses what it does not understand, and says why', () => {
  for (const [args, why] of [
    [['hi', '--voice', 'nobody'], /neither a preset/],
    [['hi', '--set', 'bogus=1'], /no knob called "bogus"/],
    [['hi', '--set', 'pitch=loud'], /not a number/],
    [['hi', '--frobnicate'], /unknown option/],
    [['hi', '-o'], /needs a value/],
    [['...'], /nothing to say/],
    [['script', 'nope.txt'], /needs --cast/],
  ]) {
    const r = cli(...args);
    assert.equal(r.status, 2, `${args.join(' ')} -> exit ${r.status}`);
    assert.match(r.stderr, why);
  }
  assert.match(cli('voices').stdout, /gruff +syllable/);
  assert.equal(JSON.parse(cli('roll', '7').stdout).name, 'rolled-7');
});

test('cli: animation timing and mouth cues survive WAV/plan export', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'babble-cues-'));
  try {
    const text = 'Your mission is to take out the central relay station.';
    const timingPath = path.join(root, 'examples/animal-factory/handler.timing.json');
    const wav = path.join(dir, 'handler.wav'), score = path.join(dir, 'handler.json');
    const r = cli(text, '--voice', 'hen-radio', '--timing', timingPath, '-o', wav, '--plan', score, '--quiet');
    assert.equal(r.status, 0, r.stderr);
    const saved = JSON.parse(fs.readFileSync(score));
    const audio = decodeWav(fs.readFileSync(wav));
    assert.deepEqual(saved.mouth.map((c) => [c.t0, c.t1]), JSON.parse(fs.readFileSync(timingPath)).cues);
    assert.equal(saved.audioDuration, audio.samples.length / audio.sampleRate);
    assert.equal(saved.reveal.at(-1).chars, text.length);
    const fitted = cli('Hello', '--voice', 'hen', '--duration', '1', '-o', wav, '--plan', score, '--quiet');
    assert.equal(fitted.status, 0, fitted.stderr);
    assert.equal(JSON.parse(fs.readFileSync(score)).duration, 1);
    assert.equal(cli('Hello', '--duration', 'NaN', '-o', wav).status, 2);
    assert.equal(cli('Hello', '--timing', timingPath, '-o', wav).status, 2);
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cli: cuts a recording into a bank, speaks with it, and refuses a file that is not one', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'babble-bank-'));
  try {
    // 15 plain seconds: a held tone, a click, a hiss, over and over
    const sr = 16000;
    const x = new Float32Array(sr * 15);
    let seed = 1;
    const noise = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2147483648 - 1; };
    for (let k = 0; k < 15; k++) for (let i = 0; i < sr; i++) {
      const hump = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / sr);
      x[k * sr + i] = k % 3 === 0 ? 0.3 * hump * Math.sin((2 * Math.PI * (200 + 40 * k) * i) / sr) : k % 3 === 1 ? (i >= 4000 ? 0.7 * noise() * Math.exp(-(i - 4000) / 200) : 0) : 0.1 * noise() * (0.6 + 0.4 * hump);
    }
    const song = path.join(dir, 'song.wav');
    fs.writeFileSync(song, encodeWav(x, sr));
    const bankFile = path.join(dir, 'song.bank.wav');
    // left to itself the CLI cuts quarter seconds
    const quarters = path.join(dir, 'quarters.bank.wav');
    assert.equal(cli('bank', song, '-o', quarters, '--quiet').status, 0);
    const q = decodeBank(fs.readFileSync(quarters));
    assert.equal(q.segmentSeconds, 0.25);
    assert.equal(q.segments.length, 60);

    const made = cli('bank', song, '-o', bankFile, '--segment', '1', '--note', 'test tones', '--quiet');
    assert.equal(made.status, 0, made.stderr);
    assert.ok(fs.existsSync(path.join(dir, 'song.sheet.png')), 'no contact sheet beside the bank');
    const bank = decodeBank(fs.readFileSync(bankFile));
    assert.equal(bank.segments.length, 15);
    assert.equal(bank.note, 'test tones');
    for (const look of ['tonal', 'struck', 'wash']) assert.ok(bank.looks[look].length >= 4, `only ${bank.looks[look].length} "${look}" pieces`);

    const spoken = path.join(dir, 'hi.wav');
    const said = cli('Take this, stranger!', '--bank', bankFile, '--set', 'pitch=280', '-o', spoken);
    assert.equal(said.status, 0, said.stderr);
    assert.match(said.stdout, /bank song, tape x2\.00/);
    assert.ok(decodeWav(fs.readFileSync(spoken)).samples.length > 20000);

    const refused = cli('hi', '--bank', song);
    assert.equal(refused.status, 2);
    assert.match(refused.stderr, /no babble-lab index/);
    // "bank" followed by something that is not a file is just a line to say
    assert.equal(cli('bank', 'robbery!', '-o', path.join(dir, 'line.wav'), '--quiet').status, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ------------------------------------------------------------------ build
test('build: dist/ is current, self-contained, and renders the same samples as src/', () => {
  const built = buildAll();
  for (const [file, text] of Object.entries(built)) {
    const onDisk = fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
    assert.ok(onDisk === text, `${file} is stale — run "npm run build" and commit it`);
  }
  const html = built['dist/babble-lab.html'];
  assert.ok(!/^\s*(import|export)\s/m.test(html.slice(html.indexOf('<script'))), 'a module statement survived into the inline script');
  assert.ok(!/<link[^>]+stylesheet|<script[^>]+src=/.test(html), 'the standalone page still fetches another file');
  assert.equal((html.match(/<\/script>/g) ?? []).length, 1, 'something closed the inline script early');

  const sandbox = { performance, console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(built['dist/babble.global.js'], sandbox);
  for (const [text, voice] of [['Who goes there?', 'gruff'], ['beep boop', 'blip'], ['Zarkoth!', { preset: 'pixie', tongue: 42 }]]) {
    const a = render(text, voice).samples;
    const b = sandbox.Babble.render(text, voice).samples;
    assert.equal(a.length, b.length);
    assert.ok(a.every((s, i) => s === b[i]), `global bundle renders "${text}" differently from the modules`);
  }
  assert.equal(typeof sandbox.Babble.createSpeaker, 'function');
});

// ------------------------------------------------------------------ runtime
// A fake WebAudio clock, and a requestAnimationFrame that NEVER fires — which is
// what this project's own preview pane does while reporting document.hidden ===
// false. The first runtime revealed text only from rAF: it sat at 0 characters
// for the whole line and jumped to the end on `ended`.
function fakeAudio() {
  const t0 = performance.now();
  return {
    sampleRate: 22050,
    get currentTime() { return (performance.now() - t0) / 1000; },
    destination: {},
    createBuffer: (ch, n, sr) => { const data = new Float32Array(n); return { length: n, sampleRate: sr, duration: n / sr, getChannelData: () => data }; },
    createGain: () => ({ gain: { value: 1 }, connect(x) { return x; } }),
    createBufferSource() {
      const src = { buffer: null, onended: null, connect(x) { return x; }, start() { src.timer = setTimeout(() => src.onended?.(), src.buffer.duration * 1000 + 25); }, stop() { clearTimeout(src.timer); } };
      return src;
    },
  };
}

test('runtime: text keeps pace with the voice even when requestAnimationFrame never fires', async () => {
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = () => {};
  try {
    const speaker = createSpeaker(fakeAudio());
    const text = 'Have you seen my little brother anywhere?';
    const seen = [];
    const line = speaker.say(text, { rate: 1.6 }, { onReveal: (chars, shown) => { seen.push(chars); assert.equal(shown, text.slice(0, chars)); } });
    assert.ok(speaker.speaking);
    assert.equal(await line.done, 'ended');
    assert.equal(seen[0], 0);
    assert.equal(seen[seen.length - 1], text.length);
    for (let k = 1; k < seen.length; k++) assert.ok(seen[k] > seen[k - 1], 'reveal went backwards');
    const between = seen.filter((c) => c > 0 && c < text.length).length;
    assert.ok(between >= 8, `text was revealed in ${between} intermediate steps: it is not following the voice`);
    assert.ok(!speaker.speaking);

    // stop() ends the line early and still shows all of it; a new line cuts the old one off
    const cut = [];
    const first = speaker.say(text, 'gruff', { onReveal: (c) => cut.push(c) });
    const second = speaker.say('Halt!', 'gruff');
    assert.equal(await first.done, 'stopped');
    assert.equal(cut[cut.length - 1], text.length);
    second.stop();
    assert.equal(await second.done, 'stopped');
    assert.throws(() => createSpeaker({}), /needs an AudioContext/);
  } finally { delete globalThis.requestAnimationFrame; delete globalThis.cancelAnimationFrame; }
});
