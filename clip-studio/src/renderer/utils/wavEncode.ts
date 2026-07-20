/** Encode an AudioBuffer as a WAV file (interleaved 16/24-bit PCM or 32-bit float). */
export function encodeWav(buffer: AudioBuffer, bitDepth: 16 | 24 | 32): ArrayBuffer {
  const nCh = buffer.numberOfChannels;
  const frames = buffer.length;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = nCh * bytesPerSample;
  const dataLen = frames * blockAlign;
  const isFloat = bitDepth === 32;

  const buf = new ArrayBuffer(44 + dataLen);
  const v = new DataView(buf);
  const wstr = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));

  wstr(0, "RIFF");
  v.setUint32(4, 36 + dataLen, true);
  wstr(8, "WAVE");
  wstr(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, isFloat ? 3 : 1, true); // 3 = IEEE float
  v.setUint16(22, nCh, true);
  v.setUint32(24, buffer.sampleRate, true);
  v.setUint32(28, buffer.sampleRate * blockAlign, true);
  v.setUint16(32, blockAlign, true);
  v.setUint16(34, bitDepth, true);
  wstr(36, "data");
  v.setUint32(40, dataLen, true);

  const chans = Array.from({ length: nCh }, (_, c) => buffer.getChannelData(c));
  let off = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < nCh; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      if (isFloat) {
        v.setFloat32(off, s, true);
      } else if (bitDepth === 24) {
        const x = Math.round(s * 8388607);
        v.setUint8(off, x & 0xff);
        v.setUint8(off + 1, (x >> 8) & 0xff);
        v.setUint8(off + 2, (x >> 16) & 0xff);
      } else {
        v.setInt16(off, Math.round(s * 32767), true);
      }
      off += bytesPerSample;
    }
  }
  return buf;
}
