#!/usr/bin/env node
// Audio in, voice bank out: cut a recording into equal segments, look at each
// one's spectrogram, arrange them by how they look.
//
//   node tools/make-bank.mjs song.mp3 -o banks/song.bank.wav
//
// Writes the bank (a WAV you can also simply play: it is the recording
// re-arranged) and, beside it, <name>.sheet.png — every segment's picture in
// arranged order, which is how to check the arrangement with your eyes.
//
// WAV is read directly. Anything else goes through ffmpeg: $BABBLE_FFMPEG, then
// ffmpeg on the PATH, then the copy bundled with ../audio-splicer.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decodeWav } from '../src/wav.mjs';
import { makeBank, encodeBank, DEFAULT_PIECE } from '../src/bank.mjs';
import { picture, thumbnail, LOOKS } from '../src/look.mjs';
import { encodePng, pixelText } from './spectrogram.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

function findFfmpeg() {
  const tries = [process.env.BABBLE_FFMPEG, 'ffmpeg', path.resolve(here, '../../audio-splicer/node_modules/ffmpeg-static/ffmpeg.exe'), path.resolve(here, '../../audio-splicer/node_modules/ffmpeg-static/ffmpeg')].filter(Boolean);
  for (const exe of tries) { const r = spawnSync(exe, ['-version'], { stdio: 'ignore' }); if (!r.error && r.status === 0) return exe; }
  return null;
}

function resample(x, from, to) {
  if (from === to) return x;
  // decimating: average over the span each output sample covers (a box low-pass); otherwise linear
  const n = Math.floor((x.length * to) / from);
  const out = new Float32Array(n);
  const ratio = from / to;
  for (let i = 0; i < n; i++) {
    const a = i * ratio, b = Math.min(x.length, a + Math.max(1, ratio));
    let s = 0, c = 0;
    for (let k = Math.floor(a); k < b; k++) { s += x[k]; c++; }
    out[i] = c ? s / c : 0;
  }
  return out;
}

export function readAudio(file, rate) {
  if (!fs.existsSync(file)) throw new Error(`no such file: ${file}`);
  if (/\.wav$/i.test(file)) { const w = decodeWav(fs.readFileSync(file)); return { samples: resample(w.samples, w.sampleRate, rate), sampleRate: rate }; }
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) throw new Error(`"${path.basename(file)}" is not a WAV and no ffmpeg was found to convert it (set BABBLE_FFMPEG, put ffmpeg on the PATH, or convert it to WAV yourself)`);
  const tmp = path.join(os.tmpdir(), `babble-bank-${process.pid}.wav`);
  try {
    const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-ac', '1', '-ar', String(rate), '-c:a', 'pcm_s16le', tmp], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`ffmpeg could not read ${path.basename(file)}: ${(r.stderr || '').trim().split('\n').pop()}`);
    const w = decodeWav(fs.readFileSync(tmp));
    return { samples: w.samples, sampleRate: w.sampleRate };
  } finally { fs.rmSync(tmp, { force: true }); }
}

// banks/song.bank.wav -> banks/song.sheet.png
export function sheetPathFor(target) {
  const p = path.parse(target);
  const stem = p.name.toLowerCase().endsWith('.bank') ? p.name.slice(0, -5) : p.name;
  return path.join(p.dir, `${stem}.sheet.png`);
}

export function contactSheet(bank) {
  // a shorter piece gets a narrower thumbnail: the sheet keeps roughly one time scale
  const TW = bank.segmentSeconds >= 0.75 ? 58 : bank.segmentSeconds >= 0.4 ? 40 : 27;
  const TH = 46, GAP = 4, LABEL = 8, HEAD = 14;
  const PER_ROW = Math.floor(1240 / (TW + GAP));
  const stamp = (origin) => { const t = origin * bank.segmentSeconds; return bank.segmentSeconds >= 1 ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}` : t.toFixed(2); };
  const groups = [...LOOKS, 'quiet'].map((look) => ({ look, items: bank.looks[look] })).filter((g) => g.items.length);
  const rowsOf = (g) => Math.ceil(g.items.length / PER_ROW);
  const W = GAP + PER_ROW * (TW + GAP);
  const H = groups.reduce((h, g) => h + HEAD + rowsOf(g) * (TH + LABEL + GAP), GAP);
  const img = new Uint8Array(W * H * 3).fill(246);
  const px = (x, y, r, g, b) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const o = (y * W + x) * 3; img[o] = r; img[o + 1] = g; img[o + 2] = b; };
  let y0 = GAP;
  for (const g of groups) {
    pixelText(px, `${g.look}  ${g.items.length}  -  ink low in the picture first`, GAP, y0 + 3, [90, 60, 40]);
    y0 += HEAD;
    g.items.forEach((si, k) => {
      const seg = bank.segments[si];
      const x0 = GAP + (k % PER_ROW) * (TW + GAP), yy = y0 + Math.floor(k / PER_ROW) * (TH + LABEL + GAP);
      const th = thumbnail(picture(seg.samples, bank.sampleRate), bank.exposure, TW, TH);
      for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) { const v = Math.round(246 - 222 * Math.pow(th[y * TW + x], 1.3)); px(x0 + x, yy + y, v, v, Math.min(255, v + 5)); }
      if (seg.look === 'struck') { const cx = x0 + Math.round((seg.cue / bank.segmentSeconds) * TW); for (let y = 0; y < 4; y++) px(cx, yy + TH - 1 - y, 190, 60, 40); } // where the edge was found
      pixelText(px, stamp(seg.origin), x0, yy + TH + 2, [120, 120, 120]); // where it sat in the recording (m:ss, or seconds)
    });
    y0 += rowsOf(g) * (TH + LABEL + GAP);
  }
  return encodePng(W, H, img);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (name, def) => { const i = args.indexOf(name); if (i < 0) return def; const v = args[i + 1]; args.splice(i, 2); return v; };
  const out = flag('-o', null);
  const rate = Number(flag('--rate', 32000));
  const seconds = Number(flag('--segment', DEFAULT_PIECE));
  const note = flag('--note', null);
  if (args.length !== 1) { console.error(`usage: node tools/make-bank.mjs <audio file> [-o out.bank.wav] [--segment ${DEFAULT_PIECE}] [--rate 32000] [--note "licence / credit"]`); process.exit(2); }
  try {
    const name = path.parse(args[0]).name;
    const target = out ?? path.join('banks', `${name}.bank.wav`);
    const t0 = performance.now();
    const { samples, sampleRate } = readAudio(args[0], rate);
    const bank = makeBank(samples, sampleRate, { name, segmentSeconds: seconds, source: path.basename(args[0]), note });
    fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
    fs.writeFileSync(target, encodeBank(bank));
    const sheet = sheetPathFor(target);
    fs.writeFileSync(sheet, contactSheet(bank));
    console.log(`${target}  ${bank.segments.length} pieces of ${seconds} s at ${sampleRate} Hz, arranged in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    for (const look of [...LOOKS, 'quiet']) console.log(`  ${look.padEnd(7)} ${String(bank.looks[look].length).padStart(4)}`);
    console.log(sheet);
  } catch (e) { console.error(`make-bank: ${e.message}`); process.exit(2); }
}
