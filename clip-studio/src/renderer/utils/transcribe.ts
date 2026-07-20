import type { TranscriptSegment } from "../types";

const WHISPER_RATE = 16000;
// Xenova export — the onnx-community quantized decoder trips a QDQ bug in current onnxruntime-web
const LOCAL_MODEL = "Xenova/whisper-base";

/** Resample an AudioBuffer to 16 kHz mono for Whisper. */
async function toWhisperInput(buffer: AudioBuffer): Promise<Float32Array> {
  const frames = Math.ceil(buffer.duration * WHISPER_RATE);
  const off = new OfflineAudioContext(1, frames, WHISPER_RATE);
  const src = off.createBufferSource();
  src.buffer = buffer;
  src.connect(off.destination);
  src.start();
  const rendered = await off.startRendering();
  return rendered.getChannelData(0);
}

/** Encode mono float samples as a 16-bit WAV blob (for the cloud API). */
function encodeWav(samples: Float32Array, rate: number): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const wstr = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  wstr(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  wstr(8, "WAVE");
  wstr(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  wstr(36, "data");
  v.setUint32(40, samples.length * 2, true);
  const out = new Int16Array(buf, 44);
  for (let i = 0; i < samples.length; i++) {
    out[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767)));
  }
  return new Blob([buf], { type: "audio/wav" });
}

export type TranscribeProgress = (message: string, fraction: number | null) => void;

// The pipeline is cached module-wide: the model download (~75 MB, one-time,
// cached by the browser afterwards) is the slow part.
let localPipeline: Promise<unknown> | null = null;

async function transcribeLocal(buffer: AudioBuffer, onProgress: TranscribeProgress): Promise<TranscriptSegment[]> {
  onProgress("Loading Whisper model…", null);
  if (!localPipeline) {
    localPipeline = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      // run ONNX inference off the main thread
      const backends = (env as { backends?: { onnx?: { wasm?: { proxy?: boolean } } } }).backends;
      if (backends?.onnx?.wasm) backends.onnx.wasm.proxy = true;
      return pipeline("automatic-speech-recognition", LOCAL_MODEL, {
        // wasm + fp32: the q8-quantized decoders trip a QDQ bug ("MatMulNBits
        // missing scale") in the bundled onnxruntime, so use unquantized weights
        device: "wasm",
        dtype: "fp32",
        progress_callback: (p: { status?: string; progress?: number; file?: string }) => {
          if (p.status === "progress" && typeof p.progress === "number") {
            onProgress(`Downloading model (${p.file ?? ""})`, p.progress / 100);
          }
        }
      });
    })().catch((err) => {
      localPipeline = null; // allow retry after a failed download
      throw err;
    });
  }
  const asr = (await localPipeline) as (
    audio: Float32Array,
    opts: Record<string, unknown>
  ) => Promise<{ chunks?: { timestamp: [number, number | null]; text: string }[]; text?: string }>;

  onProgress("Transcribing…", null);
  const audio = await toWhisperInput(buffer);
  const result = await asr(audio, {
    chunk_length_s: 30,
    stride_length_s: 5,
    return_timestamps: true
  });

  const chunks = result.chunks ?? [];
  if (chunks.length === 0 && result.text) {
    return [{ start: 0, end: buffer.duration, text: result.text.trim() }];
  }
  return chunks
    .map((c) => ({
      start: c.timestamp[0] ?? 0,
      end: c.timestamp[1] ?? buffer.duration,
      text: c.text.trim()
    }))
    .filter((s) => s.text.length > 0);
}

async function transcribeCloud(
  buffer: AudioBuffer,
  apiKey: string,
  onProgress: TranscribeProgress
): Promise<TranscriptSegment[]> {
  if (!apiKey) throw new Error("Cloud transcription needs an API key — set one in Preferences.");
  onProgress("Uploading to OpenAI…", null);
  const samples = await toWhisperInput(buffer);
  const form = new FormData();
  form.append("file", encodeWav(samples, WHISPER_RATE), "audio.wav");
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "segment");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Transcription API error ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { segments?: { start: number; end: number; text: string }[]; text?: string };
  if (json.segments?.length) {
    return json.segments.map((s) => ({ start: s.start, end: s.end, text: s.text.trim() }));
  }
  return json.text ? [{ start: 0, end: buffer.duration, text: json.text.trim() }] : [];
}

export async function transcribeAudio(
  buffer: AudioBuffer,
  engine: "local" | "cloud",
  apiKey: string,
  onProgress: TranscribeProgress
): Promise<TranscriptSegment[]> {
  return engine === "cloud" ? transcribeCloud(buffer, apiKey, onProgress) : transcribeLocal(buffer, onProgress);
}
