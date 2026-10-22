#!/usr/bin/env node
// Downloads only the selected licensed assets. No recording enters Git.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readRemoteZipEntry, listZip, readZipEntry } from './remote-zip.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'examples/animal-factory/sfx-assets.json')));
let out = path.join(root, 'out/sfx-assets'), ffmpeg = process.env.BABBLE_FFMPEG ?? 'ffmpeg';
for (let i = 2; i < process.argv.length; i += 2) {
  const [key, value] = process.argv.slice(i, i + 2);
  if (!value || !['--out', '--ffmpeg'].includes(key)) throw new Error('usage: node tools/fetch-animal-factory-sfx.mjs [--out directory] [--ffmpeg executable]');
  if (key === '--out') out = path.resolve(value); else ffmpeg = value;
}
function local(name) {
  const file = path.resolve(out, name), relative = path.relative(out, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Asset path leaves the output directory');
  return file;
}
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const archives = new Map();
async function smallArchive(url) {
  if (archives.has(url)) return archives.get(url);
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${url}`);
  let length = 0; const parts = [];
  for await (const part of response.body) { length += part.length; if (length > 16 * 1048576) throw new Error('Small archive exceeded 16 MB'); parts.push(part); }
  const bytes = Buffer.concat(parts); archives.set(url, bytes); return bytes;
}
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(local('converted'), { recursive: true });
const records = [];
for (const effect of manifest.effects) {
  const file = local(effect.file), target = local(effect.preparedFile);
  let bytes = fs.existsSync(file) ? fs.readFileSync(file) : null;
  if (!bytes || hash(bytes) !== effect.source.sha256) {
    if (effect.source.zip) bytes = await readRemoteZipEntry(effect.source.archiveUrl, effect.source.zip);
    else {
      const archive = await smallArchive(effect.source.archiveUrl), entries = listZip(archive);
      const entry = entries.find((e) => e.name === effect.source.archiveEntry);
      if (!entry) throw new Error(`Missing archive member: ${effect.source.archiveEntry}`);
      bytes = readZipEntry(archive, entry);
      const licence = entries.find((e) => e.name === 'License.txt');
      if (licence) fs.writeFileSync(local('kenney-license.txt'), readZipEntry(archive, licence));
    }
    if (hash(bytes) !== effect.source.sha256) throw new Error(`Source checksum changed: ${effect.id}`);
    fs.writeFileSync(file, bytes);
  }
  const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-ac', '1', '-ar', String(manifest.sampleRate), '-c:a', 'pcm_s16le', target], { encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`FFmpeg could not convert ${effect.id}: ${result.error?.message ?? result.stderr}`);
  records.push({ id: effect.id, source: effect.source, license: effect.license, preparedSha256: hash(fs.readFileSync(target)) });
  console.log(effect.id);
}
fs.writeFileSync(local('sources.json'), JSON.stringify({ downloadedAt: new Date().toISOString(), records }, null, 2));
