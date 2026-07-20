import type { SourceAudio } from "../types";
import { getBridge } from "../bridge";

const PEAK_BUCKETS = 2048;

/** Read sample rate / bit depth from a WAV "fmt " chunk (decodeAudioData resamples, so the header is the source of truth). */
function readWavFormat(data: ArrayBuffer): { sampleRate: number; bitDepth: number; channels: number } | null {
  const view = new DataView(data);
  if (data.byteLength < 44) return null;
  const tag = (off: number) => String.fromCharCode(view.getUint8(off), view.getUint8(off + 1), view.getUint8(off + 2), view.getUint8(off + 3));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;

  let off = 12;
  while (off + 8 <= data.byteLength) {
    const id = tag(off);
    const size = view.getUint32(off + 4, true);
    if (id === "fmt ") {
      return {
        channels: view.getUint16(off + 10, true),
        sampleRate: view.getUint32(off + 12, true),
        bitDepth: view.getUint16(off + 22, true)
      };
    }
    off += 8 + size + (size % 2);
  }
  return null;
}

/** Max-amplitude peaks across all channels, for waveform rendering. */
function computePeaks(buffer: AudioBuffer, buckets = PEAK_BUCKETS): number[] {
  const peaks = new Array(buckets).fill(0);
  const len = buffer.length;
  const perBucket = Math.max(1, Math.floor(len / buckets));
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const chan = buffer.getChannelData(ch);
    for (let b = 0; b < buckets; b++) {
      const start = b * perBucket;
      const end = Math.min(len, start + perBucket);
      let max = 0;
      // sample within the bucket (stride keeps this fast on long files)
      const stride = Math.max(1, Math.floor((end - start) / 64));
      for (let i = start; i < end; i += stride) {
        const v = Math.abs(chan[i]);
        if (v > max) max = v;
      }
      if (max > peaks[b]) peaks[b] = max;
    }
  }
  return peaks;
}

let sharedCtx: AudioContext | null = null;
export function getAudioContext(): AudioContext {
  if (!sharedCtx) sharedCtx = new AudioContext();
  return sharedCtx;
}

/** Downsample to 16 kHz mono — a reference track doesn't need full-rate audio in memory. */
async function toCompactBuffer(buffer: AudioBuffer): Promise<AudioBuffer> {
  const rate = 16000;
  if (buffer.numberOfChannels === 1 && buffer.sampleRate <= rate) return buffer;
  const off = new OfflineAudioContext(1, Math.ceil(buffer.duration * rate), rate);
  const src = off.createBufferSource();
  src.buffer = buffer;
  src.connect(off.destination);
  src.start();
  return off.startRendering();
}

export interface ImportAudioOpts {
  /**
   * Decode to 16 kHz mono. Used for the session call: an hour-plus recording decoded at
   * full rate/channels is what used to OOM the renderer (exec maxBuffer → IPC ArrayBuffer
   * → Float32 expansion, ~6× more memory than needed for a reference track).
   */
  compact?: boolean;
}

/** Re-import audio from an on-disk path (project open, Electron only). */
export async function importAudioFromPath(sourcePath: string, name: string, opts: ImportAudioOpts = {}): Promise<SourceAudio> {
  const bridge = getBridge();
  if (!bridge) throw new Error("Reopening project audio needs the desktop app.");
  const ctx = getAudioContext();
  const { wav, sampleRate, bitDepth } = await bridge.decodeAudio(sourcePath, { compact: opts.compact });
  const buffer = await ctx.decodeAudioData(wav);
  return {
    name,
    duration: buffer.duration,
    sampleRate: sampleRate || buffer.sampleRate,
    bitDepth,
    channels: buffer.numberOfChannels,
    peaks: computePeaks(buffer),
    buffer,
    sourcePath
  };
}

export async function importAudioFile(file: File, opts: ImportAudioOpts = {}): Promise<SourceAudio> {
  const ctx = getAudioContext();

  // Electron path: ffmpeg decodes any format (MP3, M4A, AIFF, video containers…)
  // and we keep the on-disk path for the export pipeline.
  const bridge = getBridge();
  const sourcePath = bridge?.getFilePath(file) || undefined;
  if (bridge && sourcePath) {
    const { wav, sampleRate, bitDepth } = await bridge.decodeAudio(sourcePath, { compact: opts.compact });
    const buffer = await ctx.decodeAudioData(wav);
    return {
      name: file.name,
      duration: buffer.duration,
      sampleRate: sampleRate || buffer.sampleRate,
      bitDepth,
      channels: buffer.numberOfChannels,
      peaks: computePeaks(buffer),
      buffer,
      sourcePath
    };
  }

  // Browser fallback: Web Audio decode (WAV/MP3/whatever the browser supports).
  const data = await file.arrayBuffer();
  const wavFmt = readWavFormat(data.slice(0));

  let buffer: AudioBuffer;
  try {
    buffer = await ctx.decodeAudioData(data);
  } catch {
    throw new Error(`Couldn't decode "${file.name}" — is it a valid audio file?`);
  }
  if (opts.compact) buffer = await toCompactBuffer(buffer); // frees the full-rate buffer for GC

  return {
    name: file.name,
    duration: buffer.duration,
    sampleRate: wavFmt?.sampleRate ?? buffer.sampleRate,
    bitDepth: wavFmt?.bitDepth ?? 0,
    channels: wavFmt?.channels ?? buffer.numberOfChannels,
    peaks: computePeaks(buffer),
    buffer
  };
}
