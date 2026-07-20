export type TakeStatus = "good" | "alt" | "review";

export interface Take {
  take: number;
  dur: number;
  status: TakeStatus;
  seed: number;
  stars: number;
  picked?: boolean;
  redundant?: boolean;
  dirQuote?: string;
  /** Region in the master recording (seconds); set for auto-detected / split takes. */
  start?: number;
  end?: number;
  /** Transcript text for this region, when transcription has run. */
  text?: string;
  /** Similarity (0–1) of the take's transcript to its line's script text; drives the match filter. */
  match?: number;
  /** Rendered audio for takes that don't live in the master (saved comps). */
  buffer?: AudioBuffer;
  /** Display peaks for rendered takes. */
  peaks?: number[];
  /** Filename take-token override, e.g. "v01+02" for a comp of takes 1 and 2. */
  label?: string;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

/** Session-call transcript segment, on the MASTER timeline (shifted through the offset map). */
export interface CallSegment extends TranscriptSegment {
  /** instruction = director coaching; response = the talent's take bleeding into the call */
  kind: "instruction" | "response";
}

export interface CompBound {
  pos: number;
  fade: number;
}

export interface CompModel {
  bounds: CompBound[];
  srcs: number[];
}

export interface Line {
  text: string;
  note: string;
  takes: Take[];
  comp?: CompModel;
  /** Episode timecode of the line in seconds (parsed from a TC column at 25 fps), when the script has one. */
  tc?: number;
  /** Per-line character from the script's Character column (AAF track routing); falls back to the session character. */
  character?: string;
}

export interface Scene {
  code: string;
  title: string;
  lines: Line[];
  /** Per-asset script-match threshold (0–1); takes matching below it are hidden/deselected. */
  matchFilter?: number;
}

export interface DirectorNote {
  t: string;
  quote: string;
  tag: string;
}

export interface DirectorData {
  notes: DirectorNote[];
  picks: number[];
  pickQuote?: string;
  redundant: number[];
}

export interface SourceAudio {
  name: string;
  duration: number;
  sampleRate: number;
  /** 0 when unknown (non-WAV input) */
  bitDepth: number;
  channels: number;
  peaks: number[];
  buffer: AudioBuffer;
  /** On-disk path when imported via the Electron bridge; required for ffmpeg export. */
  sourcePath?: string;
}

export interface Prefs {
  norm: boolean;
  lufs: number;
  conv: boolean;
  rate: number;
  bitConv: boolean;
  keep32: boolean;
  mono: boolean;
  /** Transcription engine: local Whisper (default) or a cloud API key. */
  transcribe: "local" | "cloud";
  apiKey: string;
  /** AAF session start timecode (HH:MM:SS:FF @ 25fps); timelines begin here. */
  tcStart: string;
  /** Gap (seconds) between strung-out clips in chronological AAF export. */
  chronoGap: number;
  /** Bit depth of the audio essence embedded in AAFs. */
  aafBits: 16 | 24;
}
