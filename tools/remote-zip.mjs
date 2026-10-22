// Read selected public ZIP members without downloading a multi-gigabyte bundle.
import { inflateRawSync } from 'node:zlib';

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export async function rangeBytes(url, range, limit = 64 * 1024 * 1024) {
  const response = await fetch(url, { headers: { Range: range }, signal: AbortSignal.timeout(30000) });
  if (response.status !== 206) { await response.body?.cancel(); throw new Error(`Expected partial content, got ${response.status}: ${url}`); }
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw new Error('Remote ZIP range exceeded its download limit');
    chunks.push(chunk);
  }
  return { bytes: Buffer.concat(chunks), contentRange: response.headers.get('content-range') };
}

export async function listRemoteZip(url) {
  const { bytes: tail } = await rangeBytes(url, 'bytes=-65558', 65558);
  let eocd = -1;
  for (let p = tail.length - 22; p >= 0; p--) if (tail.readUInt32LE(p) === 0x06054b50 && p + 22 + tail.readUInt16LE(p + 20) === tail.length) { eocd = p; break; }
  if (eocd < 0) throw new Error('ZIP end record not found');
  const size = tail.readUInt32LE(eocd + 12), offset = tail.readUInt32LE(eocd + 16);
  if (size === 0xffffffff || offset === 0xffffffff) throw new Error('ZIP64 index is not supported');
  const { bytes } = await rangeBytes(url, `bytes=${offset}-${offset + size - 1}`, 8 * 1024 * 1024);
  return directoryEntries(bytes);
}

function directoryEntries(bytes) {
  const entries = [];
  for (let p = 0; p < bytes.length;) {
    if (bytes.readUInt32LE(p) !== 0x02014b50) throw new Error('Invalid ZIP directory record');
    const nameSize = bytes.readUInt16LE(p + 28), extra = bytes.readUInt16LE(p + 30), comment = bytes.readUInt16LE(p + 32);
    entries.push({ name: bytes.subarray(p + 46, p + 46 + nameSize).toString('utf8'), method: bytes.readUInt16LE(p + 10),
      crc: bytes.readUInt32LE(p + 16), compressedSize: bytes.readUInt32LE(p + 20), size: bytes.readUInt32LE(p + 24), offset: bytes.readUInt32LE(p + 42) });
    p += 46 + nameSize + extra + comment;
  }
  return entries;
}

export function listZip(bytes) {
  let end = -1;
  for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65558); p--) {
    if (bytes.readUInt32LE(p) === 0x06054b50 && p + 22 + bytes.readUInt16LE(p + 20) === bytes.length) { end = p; break; }
  }
  if (end < 0) throw new Error('ZIP end record not found');
  const size = bytes.readUInt32LE(end + 12), offset = bytes.readUInt32LE(end + 16);
  if (offset + size > end) throw new Error('Invalid ZIP directory bounds');
  return directoryEntries(bytes.subarray(offset, offset + size));
}

function unpack(packed, entry) {
  const bytes = entry.method === 0 ? packed : entry.method === 8 ? inflateRawSync(packed, { maxOutputLength: entry.size }) : null;
  if (!bytes || bytes.length !== entry.size || crc32(bytes) !== entry.crc) throw new Error('ZIP member size or CRC mismatch');
  return bytes;
}

export function readZipEntry(bytes, entry) {
  const p = entry.offset;
  if (p + 30 > bytes.length || bytes.readUInt32LE(p) !== 0x04034b50 || bytes.readUInt16LE(p + 6) & 1) throw new Error('Invalid or encrypted ZIP member');
  const from = p + 30 + bytes.readUInt16LE(p + 26) + bytes.readUInt16LE(p + 28);
  if (from + entry.compressedSize > bytes.length) throw new Error('Truncated ZIP member');
  return unpack(bytes.subarray(from, from + entry.compressedSize), entry);
}

export async function readRemoteZipEntry(url, entry) {
  if (entry.compressedSize > 64 * 1024 * 1024 || entry.size > 128 * 1024 * 1024) throw new Error('Selected ZIP member is too large');
  const { bytes: header } = await rangeBytes(url, `bytes=${entry.offset}-${entry.offset + 29}`, 30);
  if (header.readUInt32LE(0) !== 0x04034b50 || header.readUInt16LE(6) & 1) throw new Error('Invalid or encrypted ZIP member');
  const from = entry.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
  const { bytes: packed } = await rangeBytes(url, `bytes=${from}-${from + entry.compressedSize - 1}`);
  return unpack(packed, entry);
}
