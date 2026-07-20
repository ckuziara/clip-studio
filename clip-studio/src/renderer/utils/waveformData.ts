/** Per-buffer min/max mipmap for waveform rendering, cached on the AudioBuffer. */

export interface MinMaxPeaks {
  mins: Float32Array;
  maxs: Float32Array;
}

const TARGET_BUCKETS = 32768;
const cache = new WeakMap<AudioBuffer, MinMaxPeaks>();

export function getMinMaxPeaks(buffer: AudioBuffer): MinMaxPeaks {
  const hit = cache.get(buffer);
  if (hit) return hit;

  const data = buffer.getChannelData(0);
  const bucket = Math.max(64, Math.ceil(data.length / TARGET_BUCKETS));
  const n = Math.ceil(data.length / bucket);
  const mins = new Float32Array(n);
  const maxs = new Float32Array(n);

  for (let b = 0; b < n; b++) {
    let min = Infinity;
    let max = -Infinity;
    const end = Math.min((b + 1) * bucket, data.length);
    for (let i = b * bucket; i < end; i++) {
      const s = data[i];
      if (s < min) min = s;
      if (s > max) max = s;
    }
    mins[b] = min === Infinity ? 0 : min;
    maxs[b] = max === -Infinity ? 0 : max;
  }

  const peaks = { mins, maxs };
  cache.set(buffer, peaks);
  return peaks;
}
