import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { crc32, listZip, readZipEntry, rangeBytes } from '../tools/remote-zip.mjs';

function archive(method) {
  const name = Buffer.from('Audio/fixture.wav'), data = Buffer.concat([Buffer.from('a small binary audio fixture'), Buffer.from([0, 1, 2])]), packed = method ? deflateRawSync(data) : data;
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(method, 8); local.writeUInt32LE(crc32(data), 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
  const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(method, 10); directory.writeUInt32LE(crc32(data), 16); directory.writeUInt32LE(packed.length, 20); directory.writeUInt32LE(data.length, 24); directory.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(directory.length + name.length, 12); end.writeUInt32LE(local.length + name.length + packed.length, 16);
  return { bytes: Buffer.concat([local, name, packed, directory, name, end]), data };
}
test('selected ZIP members are checked for integrity before extraction', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  for (const method of [0, 8]) {
    const { bytes, data } = archive(method), entries = listZip(bytes);
    assert.equal(entries.length, 1); assert.equal(entries[0].name, 'Audio/fixture.wav');
    assert.deepEqual(readZipEntry(bytes, entries[0]), data);
    assert.throws(() => readZipEntry(bytes, { ...entries[0], crc: entries[0].crc + 1 }), /CRC/);
    assert.throws(() => readZipEntry(bytes.subarray(0, 35), entries[0]), /Truncated/);
  }
  assert.throws(() => listZip(Buffer.alloc(22)), /end record/);
});
test('range downloads refuse whole archives and enforce a bounded response', async () => {
  const original = globalThis.fetch; let cancelled = false;
  try {
    globalThis.fetch = async () => ({ status: 200, body: { cancel() { cancelled = true; } } });
    await assert.rejects(() => rangeBytes('https://example.test/file.zip', 'bytes=0-2'), /partial content/); assert.equal(cancelled, true);
    globalThis.fetch = async () => new Response(new Uint8Array([1, 2, 3]), { status: 206, headers: { 'content-range': 'bytes 0-2/3' } });
    await assert.rejects(() => rangeBytes('https://example.test/file.zip', 'bytes=0-2', 2), /download limit/);
    const result = await rangeBytes('https://example.test/file.zip', 'bytes=0-2', 3);
    assert.deepEqual(result.bytes, Buffer.from([1, 2, 3]));
  } finally { globalThis.fetch = original; }
});
