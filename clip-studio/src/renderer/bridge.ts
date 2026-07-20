/** Typed accessor for the Electron preload bridge; null when running in a plain browser. */

export interface ExportClipSpec {
  start: number;
  end: number;
  filename: string;
  line: string;
  scene: string;
  take: number;
  /** Pre-rendered audio for takes that don't live in the master (saved comps). */
  wav?: ArrayBuffer;
}

export interface AafClipSpec {
  name: string;
  /** episode timecode in seconds */
  tc: number;
  wav: ArrayBuffer;
}
export interface AafEpisodeSpec {
  code: string;
  tracks: { name: string; clips: AafClipSpec[] }[];
}

export interface ClipStudioBridge {
  version: string;
  getFilePath(file: File): string;
  decodeAudio(filePath: string, opts?: { compact?: boolean }): Promise<{ wav: ArrayBuffer; sampleRate: number; bitDepth: number }>;
  exportClips(
    masterPath: string,
    clips: ExportClipSpec[],
    outDir: string,
    prefs: unknown
  ): Promise<{ written: number; dir: string }>;
  exportAaf(
    episodes: AafEpisodeSpec[],
    outDir: string,
    opts: { tcStartSec: number; fps: number }
  ): Promise<{ written: number; dir: string }>;
  saveProject(json: string, suggestedName: string): Promise<string | null>;
  openProject(): Promise<{ path: string; json: string } | null>;
  pickOutputDir(): Promise<string | null>;
}

export function getBridge(): ClipStudioBridge | null {
  const b = (window as { clipStudio?: ClipStudioBridge }).clipStudio;
  return b && typeof b.decodeAudio === "function" ? b : null;
}
