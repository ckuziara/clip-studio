# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
npm run electron:dev     # full app: builds main/preload, launches Vite + Electron with hot reload
npm run dev              # renderer only, in a plain browser tab at localhost:5173 (no Electron bridge — see below)
npm run build            # tsc -b (renderer project refs) + vite build
npm run build:electron   # compiles src/main and src/preload, renames preload.js -> preload.cjs
npm run electron:build   # full build + electron-builder packaging
```

There is no test suite and no lint script configured — `npm run build` (which runs `tsc -b`) is the only correctness check. Always run it after touching renderer code:

```bash
node_modules/.bin/tsc --noEmit -p tsconfig.json
```

## Architecture

Electron app with a hard split between three independently-compiled TypeScript projects (each with its own tsconfig and build step, per the scripts above — there is no umbrella project reference):

- `src/main/` (`tsconfig.electron.json`) — Electron main process. Owns the FFmpeg pipeline and file-system dialogs, exposed only via `ipcMain.handle`.
- `src/preload/` (`tsconfig.preload.json`) — `contextBridge` boundary, compiled to CommonJS `preload.cjs` (renamed from `.js` because `package.json` has `"type": "module"`).
- `src/renderer/` (`tsconfig.json`, Vite root) — the React app. `strict: true`, `noUnusedLocals/Parameters: false`.

**Renderer ↔ Electron boundary**: `src/renderer/bridge.ts` (`getBridge()`) reads `window.clipStudio`, which is only present when running under Electron (`npm run electron:dev`), not under plain `npm run dev`. Code that needs FFmpeg decode/export or the native output-directory picker must check for `null` and degrade gracefully — `npm run dev` in a browser tab has no audio decode/export capability. `SourceAudio.sourcePath` (in `types.ts`) is set only when a file was imported through the bridge; ffmpeg export requires it.

**State model (no store library)**: `App.tsx` is the single owner of all app state. Scenes/lines/takes (`types.ts`: `Scene` → `Line` → `Take`) are held in `scenesRef` (a `useRef`, **not** `useState`) and mutated in place; re-renders are forced with a `bump()`/tick counter. This is intentional and load-bearing — several past bugs in this codebase (e.g. the comp editor snapping back on drag) were caused by `useMemo`/`useState` re-deriving from a stale snapshot instead of reading the live mutated object. When adding features that touch `Scene`/`Line`/`Take`, mutate the ref's object graph directly and call the bump function, don't try to route it through `setState`.

The global keyboard-shortcut handler in `App.tsx` (`Cmd+Scroll` zoom, arrow-key take focus, `F`/`1-3`/`S`/`T`/`R`/`A`/`B`/`Cmd+E`) is a `window.addEventListener("keydown", ...)` inside a `useEffect` with **no dependency array**, so it re-subscribes every render — this is deliberate to avoid stale closures over frequently-changing state (`line`, `audio`, `focusedTakeIdx`); don't "fix" it by adding a dependency array without checking for stale-closure regressions.

**Audio pipeline**:
- Import: `utils/audioImport.ts` decodes via Web Audio directly in-browser, or via the Electron bridge (`ffmpeg` in `src/main/main.ts`, `audio:decode` IPC) for formats the browser can't handle, reading real sample rate/bit depth from ffmpeg's stderr banner.
- Waveforms: `utils/waveformData.ts` + `components/WaveformCanvas.tsx` render real min/max peaks to canvas (mipmap-cached in a `WeakMap`), not bar approximations. Zoom is anchored on the playhead and driven by a native (non-React) `wheel` listener with `{ passive: false }` — React's synthetic `onWheel` is passive by default and silently swallows `preventDefault()`, so don't convert this back to a JSX `onWheel` prop.
- Take detection: `utils/takeDetect.ts` does adaptive-RMS silence detection for Auto-detect and split-at-playhead; detected/split takes carry real `start`/`end` regions into the master recording (they don't have their own audio buffer).
- Comps: `components/CompEditor.tsx` renders/crossfades selected takes via `utils/compAudio.ts` (`OfflineAudioContext`, equal-power sin/cos fades). A rendered comp is **added as a new Take** (via `App.tsx`'s `handleSaveCompAsTake`) with its own `buffer`/`peaks`/`label` (e.g. `v01+02`) — comps are never exported directly; they become a take like any other and flow through the normal export path.
- Transcription: `utils/transcribe.ts` — local Whisper via `@huggingface/transformers` (unquantized fp32 weights; quantized `q8` models hit an onnxruntime-web `TransposeDQWeightsForMatMulNBits` bug — don't reintroduce quantization) or the OpenAI Whisper API using the key from `Prefs.apiKey`. Transcript segments are matched to script lines via token-Dice-coefficient similarity (`ScriptTranscriptModal.tsx`).
- Export: `handleExport` in `App.tsx` builds `ExportClipSpec[]` and calls the bridge's `exportClips`. Master-region takes are cut from the master file by ffmpeg (`-ss`/`-to`); buffer-based takes (rendered comps) are written to a temp WAV first (`utils/wavEncode.ts`) since they have no on-disk source — see the `clip.wav ? ... : ...` branch in `main.ts`'s `audio:export` handler. Loudnorm/sample-rate/bit-depth/downmix are all applied per `Prefs` in `main.ts`'s `prefsArgs()`.

**Projects** (`.clipstudio`, JSON): `utils/project.ts` serializes the session; audio is referenced, not embedded (except rendered comps). In the main process, `projectFiles.ts` writes atomically, adds each audio file's `relPath` (relative to the project) on save and resolves relative-then-absolute on open, flagging files it can't find; it also keeps the recent-projects list (`userData/recent-projects.json`). `App.tsx` tracks unsaved changes — `bump()` sets `dirty`, as do script/audio imports and pattern/prefs edits — remembers `projectPath` so ⌘S saves in place (⇧⌘S = Save As), and on open asks the user to locate missing audio, refusing a file whose duration/sample rate doesn't match the saved one (takes are master positions). `appShell.ts` owns the File menu (accelerators are display-only; the renderer keydown handler does ⌘S/⌘O), the Save / Don't Save / Cancel prompt on window close, and `.clipstudio` files opened from Finder.

**UI tests / native dialogs**: in dev builds, `CLIP_STUDIO_TEST_DIALOGS=<file>` points at a JSON queue of answers consumed by the save/open/locate/export-folder dialogs and the close prompt (a path, `null` for Cancel, or a button index) — see `nextTestAnswer()` in `appShell.ts`.

**Script import**: `utils/scriptParser.ts` (PDF via `pdfjs-dist`) and `utils/tabularParser.ts` (CSV/XLSX via `xlsx`) both parse into the same `Scene[]` shape — scene headers, `Lines:`/`Walla:` sections, trailing ` - direction` notes. `components/ImportHero.tsx` is the pre-session "Start a session" screen shown when no script is loaded (`!hasScript` in `App.tsx`); its import tiles support both click-to-browse and drag-and-drop, both funneling into the same `onFile` handlers.

**Styling**: no CSS framework — a hand-written design-token system in `styles/colors_and_type.css` (`var(--primary)`, `var(--bg-surface)`, `var(--radius-md)`, etc.) used via inline `style={{}}` objects throughout, matching the Moonbug `design_clip_studio_v1` prototype referenced in the README.
