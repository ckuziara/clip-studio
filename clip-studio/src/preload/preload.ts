// Sandboxed preload — must be CommonJS (compiled via tsconfig.preload.json to preload.cjs).
import { contextBridge, ipcRenderer, webUtils } from "electron";

contextBridge.exposeInMainWorld("clipStudio", {
  version: "0.2.0",

  /** Resolve the on-disk path of a File picked in the renderer (Electron 32+ removed File.path). */
  getFilePath(file: File): string {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return "";
    }
  },

  /** Decode any audio file via ffmpeg → { wav: ArrayBuffer, sampleRate, bitDepth }. compact = 16 kHz mono (session call). */
  decodeAudio(filePath: string, opts?: { compact?: boolean }): Promise<{ wav: ArrayBuffer; sampleRate: number; bitDepth: number }> {
    return ipcRenderer.invoke("audio:decode", filePath, opts);
  },

  /** Cut + process selected takes out of the master file and write WAVs + manifest.csv. */
  exportClips(
    masterPath: string,
    clips: { start: number; end: number; filename: string; line: string; scene: string; take: number }[],
    outDir: string,
    prefs: unknown
  ): Promise<{ written: number; dir: string }> {
    return ipcRenderer.invoke("audio:export", masterPath, clips, outDir, prefs);
  },

  /** Write one AAF per episode (pyaaf2 in the main process); clips carry their audio as WAV ArrayBuffers. */
  exportAaf(
    episodes: { code: string; tracks: { name: string; clips: { name: string; tc: number; wav: ArrayBuffer }[] }[] }[],
    outDir: string,
    opts: { tcStartSec: number; fps: number }
  ): Promise<{ written: number; dir: string }> {
    return ipcRenderer.invoke("aaf:export", episodes, outDir, opts);
  },

  /** Save the project JSON — straight to targetPath, or via a save dialog (none given, or saveAs). Returns the path or null. */
  saveProject(json: string, suggestedName: string, targetPath?: string, saveAs?: boolean): Promise<string | null> {
    return ipcRenderer.invoke("project:save", json, suggestedName, targetPath, saveAs);
  },

  /** Read a project (picking one when no path is given); null when cancelled. Media paths come back resolved. */
  openProject(filePath?: string): Promise<{ path: string; json: string; missing: { audio: boolean; sessionCall: boolean } } | null> {
    return ipcRenderer.invoke("project:open", filePath);
  },

  recentProjects(): Promise<{ path: string; name: string; openedAt: string; exists: boolean }[]> {
    return ipcRenderer.invoke("project:recents");
  },

  forgetRecent(filePath: string): Promise<void> {
    return ipcRenderer.invoke("project:forgetRecent", filePath);
  },

  /** A project opened from Finder/Dock before the renderer was ready. */
  takePendingOpen(): Promise<string | null> {
    return ipcRenderer.invoke("project:takePendingOpen");
  },

  /** Native file picker for relinking moved audio. */
  pickAudio(title: string): Promise<string | null> {
    return ipcRenderer.invoke("dialog:pickAudio", title);
  },

  /** Unsaved-changes state for the close prompt and the macOS edited dot. */
  setDocumentState(state: { dirty: boolean; name: string; path?: string }): void {
    ipcRenderer.send("window:documentState", state);
  },

  /** Close the window without the unsaved-changes prompt (after saving). */
  closeWindow(): void {
    ipcRenderer.send("window:close");
  },

  /** File menu commands: open / save / saveAs / saveAndClose. Returns an unsubscribe function. */
  onMenu(cb: (cmd: { command: "open" | "save" | "saveAs" | "saveAndClose"; path?: string }) => void): () => void {
    const listener = (_e: unknown, cmd: { command: "open" | "save" | "saveAs" | "saveAndClose"; path?: string }) => cb(cmd);
    ipcRenderer.on("menu", listener);
    return () => {
      ipcRenderer.removeListener("menu", listener);
    };
  },

  pickOutputDir(): Promise<string | null> {
    return ipcRenderer.invoke("dialog:pickOutputDir");
  }
});
