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

export interface OpenedProject {
  path: string;
  json: string;
  /** referenced audio that wasn't found at its relative or absolute path */
  missing: { audio: boolean; sessionCall: boolean };
}

export interface RecentProject {
  path: string;
  name: string;
  openedAt: string;
  exists: boolean;
}

export type MenuCommand = { command: "open" | "save" | "saveAs" | "saveAndClose"; path?: string };

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
  saveProject(json: string, suggestedName: string, targetPath?: string, saveAs?: boolean): Promise<string | null>;
  openProject(filePath?: string): Promise<OpenedProject | null>;
  recentProjects(): Promise<RecentProject[]>;
  forgetRecent(filePath: string): Promise<void>;
  takePendingOpen(): Promise<string | null>;
  pickAudio(title: string): Promise<string | null>;
  setDocumentState(state: { dirty: boolean; name: string; path?: string }): void;
  closeWindow(): void;
  onMenu(cb: (cmd: MenuCommand) => void): () => void;
  pickOutputDir(): Promise<string | null>;
}

export function getBridge(): ClipStudioBridge | null {
  const b = (window as { clipStudio?: ClipStudioBridge }).clipStudio;
  return b && typeof b.decodeAudio === "function" ? b : null;
}
