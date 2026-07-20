/**
 * Project save/open: the whole session (scenes → lines → takes, transcripts, call
 * analysis, prefs, naming) as a versioned JSON `.clipstudio` file.
 *
 * Audio handling: the master / session call are NOT embedded — the file stores their
 * on-disk paths (Electron imports) and the audio is re-decoded on open. Rendered
 * takes (saved comps) have no on-disk source, so their audio IS embedded as base64
 * 24-bit WAV. Take regions are just numbers and survive as plain JSON.
 */

import type { CallSegment, CompModel, Prefs, Scene, Take, TranscriptSegment } from "../types";
import { encodeWav } from "./wavEncode";
import { getAudioContext } from "./audioImport";

export const PROJECT_VERSION = 1;
export const PROJECT_EXT = "clipstudio";

interface SavedTake extends Omit<Take, "buffer"> {
  /** base64 24-bit WAV for takes that carry their own audio (saved comps) */
  wav64?: string;
}

interface SavedLine {
  text: string;
  note: string;
  takes: SavedTake[];
  comp?: CompModel;
  tc?: number;
  character?: string;
}

interface SavedScene {
  code: string;
  title: string;
  matchFilter?: number;
  lines: SavedLine[];
}

export interface ProjectFile {
  app: "clip-studio";
  version: number;
  sessionTitle: string;
  characterName: string;
  scriptName: string;
  pattern: string;
  prefs: Prefs;
  scenes: SavedScene[];
  transcript: TranscriptSegment[];
  callSegments: CallSegment[] | null;
  callAligned: boolean | null;
  sceneIndex: number;
  lineIndex: number;
  activeCharacter: string | null;
  /** re-import references; audio itself is re-decoded from disk on open */
  audio: { name: string; sourcePath?: string } | null;
  sessionCall: { name: string; sourcePath?: string } | null;
}

function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const CHUNK = 0x8000; // avoid call-stack limits on String.fromCharCode
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function base64ToBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export interface ProjectState {
  sessionTitle: string;
  characterName: string;
  scriptName: string;
  pattern: string;
  prefs: Prefs;
  scenes: Scene[];
  transcript: TranscriptSegment[];
  callSegments: CallSegment[] | null;
  callAligned: boolean | null;
  sceneIndex: number;
  lineIndex: number;
  activeCharacter: string | null;
  audio: { name: string; sourcePath?: string } | null;
  sessionCall: { name: string; sourcePath?: string } | null;
}

export function serializeProject(state: ProjectState): string {
  const scenes: SavedScene[] = state.scenes.map((sc) => ({
    code: sc.code,
    title: sc.title,
    matchFilter: sc.matchFilter,
    lines: sc.lines.map((ln) => ({
      text: ln.text,
      note: ln.note,
      comp: ln.comp,
      tc: ln.tc,
      character: ln.character,
      takes: ln.takes.map((t) => {
        const { buffer, ...rest } = t;
        return { ...rest, wav64: buffer ? bufferToBase64(encodeWav(buffer, 24)) : undefined };
      })
    }))
  }));

  const file: ProjectFile = {
    app: "clip-studio",
    version: PROJECT_VERSION,
    sessionTitle: state.sessionTitle,
    characterName: state.characterName,
    scriptName: state.scriptName,
    pattern: state.pattern,
    prefs: state.prefs,
    scenes,
    transcript: state.transcript,
    callSegments: state.callSegments,
    callAligned: state.callAligned,
    sceneIndex: state.sceneIndex,
    lineIndex: state.lineIndex,
    activeCharacter: state.activeCharacter,
    audio: state.audio,
    sessionCall: state.sessionCall
  };
  return JSON.stringify(file);
}

/** Parse + revive a project file; decodes embedded take audio back into AudioBuffers. */
export async function deserializeProject(json: string): Promise<{ file: ProjectFile; scenes: Scene[] }> {
  let file: ProjectFile;
  try {
    file = JSON.parse(json) as ProjectFile;
  } catch {
    throw new Error("Not a Clip Studio project — the file isn't valid JSON.");
  }
  if (file.app !== "clip-studio" || !Array.isArray(file.scenes)) {
    throw new Error("Not a Clip Studio project file.");
  }
  if (file.version > PROJECT_VERSION) {
    throw new Error(`This project was saved by a newer Clip Studio (v${file.version}) — update the app to open it.`);
  }

  const ctx = getAudioContext();
  const scenes: Scene[] = [];
  for (const sc of file.scenes) {
    const lines = [];
    for (const ln of sc.lines) {
      const takes: Take[] = [];
      for (const st of ln.takes) {
        const { wav64, ...rest } = st;
        const take: Take = { ...rest };
        if (wav64) take.buffer = await ctx.decodeAudioData(base64ToBuffer(wav64));
        takes.push(take);
      }
      lines.push({ text: ln.text, note: ln.note, comp: ln.comp, tc: ln.tc, character: ln.character, takes });
    }
    scenes.push({ code: sc.code, title: sc.title, matchFilter: sc.matchFilter, lines });
  }
  return { file, scenes };
}
