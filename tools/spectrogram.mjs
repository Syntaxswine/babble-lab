#!/usr/bin/env node
// Draw what a line sounds like: spectrogram on top, the plan's syllables and
// pitch line underneath. PNG, no dependencies (zlib is in Node).
//
//   node tools/spectrogram.mjs "Have you seen my brother?" --voice gruff -o out.png
//
// Reading it: dark horizontal bands in a vowel are the formants; their vertical
// position is the mouth shape, and they should glide, not jump. Vertical
// striations are glottal pulses (closer together = higher pitch). Grey fuzz up
// high is a fricative. A blank column is a stop closure or a pause.

import fs from 'node:fs';
import zlib from 'node:zlib';
import { magnitude } from './analyze.mjs';

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

export function encodePng(width, height, rgb) {
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'ascii');
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(rgb.buffer, rgb.byteOffset + y * width * 3, width * 3).copy(raw, y * (width * 3 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// 3x5 pixel font, enough for labels
const GLYPHS = { a: '010101111101101', b: '110101110101110', c: '011100100100011', d: '110101101101110', e: '111100110100111', f: '111100110100100', g: '011100101101011', h: '101101111101101', i: '111010010010111', j: '001001001101010', k: '101101110101101', l: '100100100100111', m: '101111111101101', n: '110101101101101', o: '010101101101010', p: '110101110100100', q: '010101101110011', r: '110101110101101', s: '011100010001110', t: '111010010010010', u: '101101101101111', v: '101101101101010', w: '101101111111101', x: '101101010101101', y: '101101010010010', z: '111001010100111', 0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110', 4: '101101111001001', 5: '111100110001110', 6: '011100110101010', 7: '111001010010010', 8: '010101010101010', 9: '010101011001110', '.': '000000000000010', '?': '110001010000010', '!': '010010010000010', ',': '000000000010100', '-': '000000111000000', ':': '000010000010000', "'": '010010000000000', 'ə': '000110011101111' };

export function drawSpectrogram(samples, sampleRate, plan, { width = 1400, maxHz = 8000 } = {}) {
  const specH = 360, laneH = 120, H = specH + laneH;
  const img = new Uint8Array(width * H * 3).fill(250);
  const px = (x, y, r, g, b) => { if (x < 0 || y < 0 || x >= width || y >= H) return; const o = (y * width + x) * 3; img[o] = r; img[o + 1] = g; img[o + 2] = b; };
  const text = (s, x, y, c = [70, 70, 70]) => { for (const ch of String(s).toLowerCase()) { const g = GLYPHS[ch]; if (g) for (let k = 0; k < 15; k++) if (g[k] === '1') px(x + (k % 3), y + Math.floor(k / 3), ...c); x += 4; } };

  const size = 1024;
  const dur = samples.length / sampleRate;
  const cols = [];
  let top = 1e-9;
  for (let x = 0; x < width; x++) {
    const centre = Math.floor((x / width) * samples.length);
    const mag = magnitude(samples, Math.max(0, centre - size / 2), size);
    cols.push(mag);
    for (const m of mag) if (m > top) top = m;
  }
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < specH; y++) {
      const hz = (1 - y / specH) * maxHz;
      const bin = Math.min(size / 2 - 1, Math.round((hz * size) / sampleRate));
      const dB = 20 * Math.log10(cols[x][bin] / top + 1e-9);
      const v = Math.max(0, Math.min(1, (dB + 70) / 70)); // 70 dB of range
      const ink = Math.round(250 - 225 * Math.pow(v, 1.4));
      px(x, y, ink, ink, Math.min(255, ink + 6));
    }
  }
  for (let hz = 1000; hz < maxHz; hz += 1000) { const y = Math.round((1 - hz / maxHz) * specH); for (let x = 0; x < width; x += 6) px(x, y, 150, 120, 90); text(`${hz / 1000}k`, 2, y - 6, [150, 100, 60]); }

  if (plan) {
    const X = (t) => Math.round((t / dur) * width);
    const y0 = specH + 6;
    for (const u of plan.units) {
      if (u.kind === 'rest') continue;
      const a = X(u.t0), b = X(u.t1);
      for (let y = specH; y < H; y++) px(a, y, 205, 205, 200);
      for (let x = a + 1; x < b; x++) px(x, y0 + 8, ...(u.stress ? [90, 90, 90] : [185, 185, 185]));
      text(u.label ?? '', a + 2, y0, u.reduced ? [150, 150, 150] : [40, 40, 40]);
    }
    for (const w of plan.words) text(w.text, X(w.t0) + 2, y0 + 14, [110, 80, 50]);
    // pitch line: semitones, ±12 over the bottom of the lane
    const mid = specH + 78, scale = 2.4;
    for (let x = 0; x < width; x += 4) px(x, mid, 215, 215, 210);
    for (let k = 0; k + 1 < plan.pitch.length; k++) {
      const p = plan.pitch[k], q = plan.pitch[k + 1];
      const xa = X(p.t), xb = X(q.t);
      for (let x = xa; x <= xb; x++) { const f = xb === xa ? 0 : (x - xa) / (xb - xa); const st = p.st + (q.st - p.st) * f; px(x, Math.round(mid - st * scale), 170, 60, 40); px(x, Math.round(mid - st * scale) + 1, 170, 60, 40); }
    }
  }
  return encodePng(width, H, img);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const { render } = await import('../src/index.mjs');
  const args = process.argv.slice(2);
  const flag = (name, def) => { const i = args.indexOf(name); if (i < 0) return def; const v = args[i + 1]; args.splice(i, 2); return v; };
  const out = flag('-o', 'spectrogram.png');
  const voice = flag('--voice', 'narrator');
  const tongue = flag('--tongue', null);
  const line = args.join(' ') || 'Have you seen my little brother anywhere?';
  const { samples, sampleRate, plan } = render(line, tongue === null ? voice : { preset: voice, tongue: +tongue });
  fs.writeFileSync(out, drawSpectrogram(samples, sampleRate, plan));
  console.log(`${out}  ${plan.duration.toFixed(2)} s  "${line}"  [${voice}]`);
}
