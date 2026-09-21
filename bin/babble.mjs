#!/usr/bin/env node
// babble — text in, video-game voice out.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { render, renderScript, parseScript, resolveVoice, randomVoice, compactVoice, revealSchedule, encodeWav, makeBank, encodeBank, decodeBank, DEFAULT_PIECE, PRESETS, PARAMS, FX_PARAMS } from '../src/index.mjs';

const USAGE = `babble — text in, video-game voice out

  babble "Welcome, stranger!"                      -> welcome-stranger.narrator.wav
  babble "Who goes there?" --voice gruff -o who.wav --play
  babble "Hello" --voice pixie --tongue 7 --set range=11 --set fx.echo=0.3
  babble voices                                    list the presets
  babble roll [seed]                               print a randomly rolled voice as JSON
  babble script lines.txt --cast cast.json -o out  render a whole script (see below)
  babble bank song.mp3 -o banks/song.bank.wav      cut a recording into a voice bank (see below)
  babble "Hello there" --bank banks/song.bank.wav  speak with slices of it instead of the synth

options
  --voice <name|file.json>   a preset, or a voice saved from the workbench   [narrator]
  --set key=value            override any knob (repeatable); fx.* and blip.* reach inside
  --tongue <n>               0 = says the English it is given; n = invented language n
  --take <n>                 another take of the same line (varies the small stuff)
  --weights <table.json>     a tts-weights table: per-word duration and vowel reduction
  --bank <file.bank.wav>     speak with a voice bank; pitch is then tape speed (140 = as recorded)
  --segment <seconds>        bank: length of each piece                        [0.25]
  --note <text>              bank: credit / licence line to store inside it
  --sr <hz>                  sample rate                                      [44100]
  --plan <file.json>         also write the timed plan (units, pitch, reveal schedule)
  -o, --out <path>           output .wav (or output directory, for "script")
  --play                     play it when done
  --quiet

script
  lines.txt is "name: what they say", one per line; # comments and blanks are skipped.
  cast.json maps each name to a voice: { "Mira": "pixie", "Guard": { "preset": "gruff", "pitch": 78 } }
  Output: NNN-name.wav per line and manifest.json with each line's duration and reveal schedule.

bank
  Cuts the recording into equal pieces (a quarter second each unless --segment says otherwise),
  looks at each one's spectrogram and arranges them by
  how they look: "struck" (a vertical line), "wash" (speckle), "tonal" (horizontal stripes), each
  ordered by where the ink sits. The bank is a WAV you can also just play. Beside it goes
  <name>.sheet.png, every piece's picture in arranged order. A syllable that opens with a stop
  takes a struck piece, a hiss a wash piece, anything softer a tonal one; the brighter its vowel,
  the higher-inked the piece. A syllable longer than its piece reads on into whatever FOLLOWED
  that piece in the recording. mp3/ogg/etc. need ffmpeg (PATH, $BABBLE_FFMPEG, or the
  copy in ../audio-splicer).

knobs (for --set)
${[...PARAMS, ...FX_PARAMS.map((p) => ({ ...p, key: 'fx.' + p.key }))].map((p) => `  ${p.key.padEnd(15)} ${String(p.min).padStart(5)} .. ${String(p.max).padEnd(6)} ${p.hint}`).join('\n')}
  mode            syllable | letter | blip
  wave            glottal | saw | square | pulse | triangle | sine | whisper
`;

function fail(msg) { console.error(`babble: ${msg}`); process.exit(2); }

function parseArgs(argv) {
  const opts = { set: [], positional: [] };
  const takesValue = new Set(['--voice', '--set', '--tongue', '--take', '--weights', '--sr', '--plan', '-o', '--out', '--cast', '--bank', '--segment', '--note', '--rate']);
  const flags = new Set(['--play', '--quiet', '--help', '-h']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (takesValue.has(a)) {
      const v = argv[++i];
      if (v === undefined) fail(`${a} needs a value`);
      if (a === '--set') opts.set.push(v);
      else opts[a === '-o' ? 'out' : a.slice(2)] = v;
    } else if (flags.has(a)) opts[a.replace(/^-+/, '')] = true;
    else if (a.startsWith('-') && a.length > 1 && Number.isNaN(Number(a))) fail(`unknown option ${a} (try --help)`);
    else opts.positional.push(a);
  }
  return opts;
}

function loadVoice(opts) {
  let voice = opts.voice ?? 'narrator';
  if (typeof voice === 'string' && !Object.hasOwn(PRESETS, voice)) {
    if (!fs.existsSync(voice)) fail(`"${voice}" is neither a preset (${Object.keys(PRESETS).join(', ')}) nor a file`);
    try { voice = JSON.parse(fs.readFileSync(voice, 'utf8')); } catch (e) { fail(`${opts.voice}: ${e.message}`); }
  }
  if (typeof voice === 'string') voice = { preset: voice };
  voice = { ...voice, fx: { ...voice.fx }, blip: { ...voice.blip } };
  const known = new Set([...PARAMS.map((p) => p.key), ...FX_PARAMS.map((p) => 'fx.' + p.key), 'mode', 'wave', 'name', 'blip.len', 'blip.every']);
  for (const kv of opts.set) {
    const eq = kv.indexOf('=');
    if (eq < 1) fail(`--set wants key=value, got "${kv}"`);
    const key = kv.slice(0, eq);
    const raw = kv.slice(eq + 1);
    if (!known.has(key)) fail(`no knob called "${key}" (try --help for the list)`);
    const value = key === 'mode' || key === 'wave' || key === 'name' ? raw : Number(raw);
    if (typeof value === 'number' && !Number.isFinite(value)) fail(`--set ${key}: "${raw}" is not a number`);
    const [group, leaf] = key.split('.');
    if (leaf) voice[group][leaf] = value; else voice[key] = value;
  }
  if (opts.tongue !== undefined) voice.tongue = Number(opts.tongue);
  try { return resolveVoice(voice); } catch (e) { fail(e.message.replace(/^babble: /, '')); }
}

function loadBank(opts) {
  if (!opts.bank) return undefined;
  try { return decodeBank(fs.readFileSync(opts.bank)); } catch (e) { fail(`--bank ${opts.bank}: ${e.message.replace(/^bank: /, '')}`); }
}

function loadWeights(opts) {
  if (!opts.weights) return undefined;
  try { return JSON.parse(fs.readFileSync(opts.weights, 'utf8')); } catch (e) { fail(`--weights ${opts.weights}: ${e.message}`); }
}

function play(file) {
  const abs = path.resolve(file);
  const tries = process.platform === 'win32'
    ? [['powershell', ['-NoProfile', '-Command', `(New-Object Media.SoundPlayer '${abs.replace(/'/g, "''")}').PlaySync()`]]]
    : process.platform === 'darwin' ? [['afplay', [abs]]] : [['paplay', [abs]], ['aplay', ['-q', abs]]];
  for (const [cmd, args] of tries) { const r = spawnSync(cmd, args, { stdio: 'ignore' }); if (!r.error && r.status === 0) return; }
  console.error('babble: could not find a way to play audio on this machine; the file is written.');
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'line';

const opts = parseArgs(process.argv.slice(2));
const [cmd, ...rest] = opts.positional;
if (opts.help || opts.h || !cmd) { console.log(USAGE); process.exit(cmd || opts.help || opts.h ? 0 : 2); }

if (cmd === 'voices' && rest.length === 0) {
  for (const [name, p] of Object.entries(PRESETS)) { const v = resolveVoice(name); console.log(`${name.padEnd(9)} ${v.mode.padEnd(8)} ${String(v.pitch).padStart(3)} Hz  ${p.note}`); }
} else if (cmd === 'roll' && (rest.length === 0 || (rest.length === 1 && /^[0-9]+$/.test(rest[0])))) {
  // "roll" followed by anything that is not a bare number is a line to be spoken
  const seed = rest[0] === undefined ? (Date.now() % 100000) : Number(rest[0]);
  console.log(JSON.stringify(compactVoice(randomVoice(seed)), null, 2));
} else if (cmd === 'bank' && rest.length === 1 && fs.existsSync(rest[0])) {
  // "bank" followed by an existing file makes a bank; anything else is a line to be spoken
  const { readAudio, contactSheet, sheetPathFor } = await import('../tools/make-bank.mjs');
  const name = path.parse(rest[0]).name;
  const target = opts.out ?? path.join('banks', `${name}.bank.wav`);
  try {
    const { samples, sampleRate } = readAudio(rest[0], Number(opts.rate ?? 32000));
    const bank = makeBank(samples, sampleRate, { name, segmentSeconds: Number(opts.segment ?? DEFAULT_PIECE), source: path.basename(rest[0]), note: opts.note ?? null });
    fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
    fs.writeFileSync(target, encodeBank(bank));
    const sheet = sheetPathFor(target);
    fs.writeFileSync(sheet, contactSheet(bank));
    if (!opts.quiet) { console.log(`${target}  ${bank.segments.length} pieces of ${bank.segmentSeconds} s: ${Object.entries(bank.looks).map(([k, v]) => `${k} ${v.length}`).join(', ')}`); console.log(sheet); }
  } catch (e) { fail(e.message.replace(/^(bank|look): /, '')); }
} else if (cmd === 'script') {
  if (rest.length !== 1) fail('script wants exactly one lines file');
  if (!opts.cast) fail('script needs --cast cast.json');
  let lines, cast;
  try { lines = parseScript(fs.readFileSync(rest[0], 'utf8')); } catch (e) { fail(e.message.replace(/^babble: /, '')); }
  try { cast = JSON.parse(fs.readFileSync(opts.cast, 'utf8')); } catch (e) { fail(`--cast ${opts.cast}: ${e.message}`); }
  const dir = opts.out ?? 'out';
  fs.mkdirSync(dir, { recursive: true });
  const sampleRate = Number(opts.sr ?? 44100);
  let rendered;
  try { rendered = renderScript(lines, cast, { sampleRate, weights: loadWeights(opts), seed: Number(opts.take ?? 0) }); } catch (e) { fail(e.message.replace(/^babble: /, '')); }
  const manifest = rendered.map((r) => {
    const file = `${String(r.index + 1).padStart(3, '0')}-${slug(r.who)}.wav`;
    fs.writeFileSync(path.join(dir, file), encodeWav(r.samples, r.sampleRate));
    if (!opts.quiet) console.log(`${file}  ${r.plan.duration.toFixed(2)} s  ${r.who}: ${r.text}`);
    return { file, who: r.who, text: r.text, voice: r.plan.voice.name, duration: +(r.samples.length / r.sampleRate).toFixed(4), reveal: revealSchedule(r.plan).map((s) => [+s.t.toFixed(4), s.chars]) };
  });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ sampleRate, lines: manifest }, null, 1));
  if (!opts.quiet) console.log(`${manifest.length} lines -> ${dir}${path.sep}manifest.json`);
} else {
  const text = opts.positional.join(' ');
  const voice = loadVoice(opts);
  const sampleRate = Number(opts.sr ?? 44100);
  let result;
  const bank = loadBank(opts);
  try { result = render(text, voice, { sampleRate, weights: loadWeights(opts), seed: Number(opts.take ?? 0), bank }); } catch (e) { fail(e.message.replace(/^babble: /, '')); }
  const sounding = result.plan.units.filter((u) => u.kind !== 'rest').length;
  if (!sounding) fail(`nothing to say in ${JSON.stringify(text)}`);
  const out = opts.out ?? `${slug(text)}.${slug(bank ? bank.name : voice.name)}.wav`;
  if (path.dirname(out) !== '.') fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, encodeWav(result.samples, sampleRate));
  if (opts.plan) fs.writeFileSync(opts.plan, JSON.stringify({ ...result.plan, segs: undefined, reveal: revealSchedule(result.plan) }, null, 1));
  if (!opts.quiet) {
    console.log(`${out}  ${(result.samples.length / sampleRate).toFixed(2)} s  ${voice.name} (${voice.mode}, tongue ${voice.tongue})${bank ? `  bank ${bank.name}, tape x${(voice.pitch / 140).toFixed(2)}` : ''}`);
    console.log(`  ${result.plan.units.filter((u) => u.kind !== 'rest').map((u) => u.label).join(' ')}`);
  }
  if (opts.play) play(out);
}
