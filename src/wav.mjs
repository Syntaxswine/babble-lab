// 16-bit mono PCM WAV. Returns a Uint8Array, so the same function feeds
// fs.writeFileSync in Node and a Blob in the browser.

export function encodeWav(samples, sampleRate = 44100) {
  const n = samples.length;
  const bytes = new Uint8Array(44 + n * 2);
  const v = new DataView(bytes.buffer);
  const ascii = (off, s) => { for (let i = 0; i < s.length; i++) bytes[off + i] = s.charCodeAt(i); };
  ascii(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); ascii(8, 'WAVE');
  ascii(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  ascii(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = samples[i] < -1 ? -1 : samples[i] > 1 ? 1 : samples[i];
    v.setInt16(44 + i * 2, Math.round(s * 32767), true);
  }
  return bytes;
}

export function decodeWav(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (off) => String.fromCharCode(bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV file');
  let off = 12, sampleRate = 0, channels = 0, bits = 0;
  while (off + 8 <= bytes.length) {
    const id = tag(off), size = v.getUint32(off + 4, true);
    if (id === 'fmt ') { channels = v.getUint16(off + 10, true); sampleRate = v.getUint32(off + 12, true); bits = v.getUint16(off + 22, true); }
    if (id === 'data') {
      if (bits !== 16) throw new Error(`only 16-bit PCM is read here, got ${bits}-bit`);
      const n = Math.floor(size / 2 / channels);
      const samples = new Float32Array(n);
      for (let i = 0; i < n; i++) samples[i] = v.getInt16(off + 8 + i * 2 * channels, true) / 32767;
      return { samples, sampleRate, channels };
    }
    off += 8 + size + (size & 1);
  }
  throw new Error('WAV has no data chunk');
}
