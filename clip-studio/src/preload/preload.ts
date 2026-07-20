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

  /** Save the project JSON via a native save dialog; returns the chosen path or null. */
  saveProject(json: string, suggestedName: string): Promise<string | null> {
    return ipcRenderer.invoke("project:save", json, suggestedName);
  },

  /** Pick + read a project file; null when cancelled. */
  openProject(): Promise<{ path: string; json: string } | null> {
    return ipcRenderer.invoke("project:open");
  },

  pickOutputDir(): Promise<string | null> {
    return ipcRenderer.invoke("dialog:pickOutputDir");
  }
});
