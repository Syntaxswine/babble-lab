// WAV in and out. encodeWav returns a Uint8Array, so the same function feeds
// fs.writeFileSync in Node and a Blob in the browser.
//
// Writing is always 16-bit mono PCM. Reading takes what people actually hand
// over: 8/16/24/32-bit integer or 32-bit float, any channel count (mixed down
// to mono), plain or WAVE_FORMAT_EXTENSIBLE — and hands back any chunks it did
// not understand, which is how a voice bank carries its index (see bank.mjs).

// opts.chunks: { 'abcd': Uint8Array } extra RIFF chunks, written BEFORE the audio
export function encodeWav(samples, sampleRate = 44100, opts = {}) {
  const n = samples.length;
  const extra = Object.entries(opts.chunks ?? {});
  for (const [id] of extra) if (id.length !== 4) throw new Error(`wav: chunk id must be 4 characters, got "${id}"`);
  const extraBytes = extra.reduce((s, [, data]) => s + 8 + data.length + (data.length & 1), 0);
  const bytes = new Uint8Array(44 + extraBytes + n * 2);
  const v = new DataView(bytes.buffer);
  const ascii = (off, s) => { for (let i = 0; i < s.length; i++) bytes[off + i] = s.charCodeAt(i); };
  ascii(0, 'RIFF'); v.setUint32(4, bytes.length - 8, true); ascii(8, 'WAVE');
  ascii(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  let off = 36;
  for (const [id, data] of extra) {
    ascii(off, id); v.setUint32(off + 4, data.length, true);
    bytes.set(data, off + 8);
    off += 8 + data.length + (data.length & 1);
  }
  ascii(off, 'data'); v.setUint32(off + 4, n * 2, true);
  off += 8;
  for (let i = 0; i < n; i++) {
    const s = samples[i] < -1 ? -1 : samples[i] > 1 ? 1 : samples[i];
    v.setInt16(off + i * 2, Math.round(s * 32767), true);
  }
  return bytes;
}

// -> { samples: Float32Array (mono), sampleRate, channels, bits, chunks: { id: Uint8Array } }
export function decodeWav(bytes) {
  if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (off) => String.fromCharCode(bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]);
  if (bytes.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV file');
  let off = 12, sampleRate = 0, channels = 0, bits = 0, format = 0, samples = null;
  const chunks = {};
  while (off + 8 <= bytes.length) {
    const id = tag(off);
    const size = Math.min(v.getUint32(off + 4, true), bytes.length - off - 8);
    const body = off + 8;
    if (id === 'fmt ') {
      format = v.getUint16(body, true); channels = v.getUint16(body + 2, true); sampleRate = v.getUint32(body + 4, true); bits = v.getUint16(body + 14, true);
      if (format === 0xfffe && size >= 26) format = v.getUint16(body + 24, true); // EXTENSIBLE: the real tag opens the sub-format GUID
    } else if (id === 'data') {
      if (!channels) throw new Error('WAV data chunk came before its fmt chunk');
      if (!((format === 1 && [8, 16, 24, 32].includes(bits)) || (format === 3 && bits === 32))) throw new Error(`WAV encoding not read here: format tag ${format}, ${bits}-bit (PCM 8/16/24/32 and float 32 are)`);
      const width = bits / 8;
      const n = Math.floor(size / width / channels);
      samples = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let c = 0; c < channels; c++) {
          const p = body + (i * channels + c) * width;
          if (format === 3) sum += v.getFloat32(p, true);
          else if (bits === 16) sum += v.getInt16(p, true) / 32768;
          else if (bits === 24) sum += ((bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16)) << 8 >> 8) / 8388608;
          else if (bits === 32) sum += v.getInt32(p, true) / 2147483648;
          else sum += (bytes[p] - 128) / 128;
        }
        samples[i] = sum / channels;
      }
    } else chunks[id] = bytes.subarray(body, body + size);
    off = body + size + (size & 1);
  }
  if (!samples) throw new Error('WAV has no data chunk');
  return { samples, sampleRate, channels, bits, chunks };
}
