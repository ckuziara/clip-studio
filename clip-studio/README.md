# Clip Studio

Script-to-clips desktop tool for audio/localisation teams. Electron + React + TypeScript, styled from the Moonbug design system (`design_clip_studio_v1`).

## What's here (dashboard pass 2 — real imports)

The main 3-column dashboard is built and pixel-matched to the design prototype:

- Title bar + app header (source chips, preferences, export button)
- Left: assets list
- Centre: scene header, waveform card (talent + session-call lanes, transport, zoom), line detail with direction notes, takes list, comp editor (Logic-style, drag to slide cuts/crossfades)
- Right: line queue, naming pattern + export panel
- Preferences modal (normalisation, sample rate, bit depth, mono downmix)

The app starts empty and works from imported session material:

- **Script PDF import** (`utils/scriptParser.ts`, pdf.js) — parses the session script into assets/lines: scene headers (`EMWW0109: Pink Mermaid`, `Outro 2:`), `Lines:` / `Walla:` sections, wrapped bullet lines, and trailing ` - direction` notes. Session title and character name come from the document title.
- **Audio import** (`utils/audioImport.ts`, Web Audio) — decodes the master WAV (and optional session-call/director track), reads true sample rate / bit depth from the WAV header, and renders the real waveform with working play/pause, click-to-seek, and zoom.

Local interactions still work as before: selecting assets/lines, star ratings, select/flag takes, the comp editor, and preferences. Take splitting/auto-detection from the master recording is the next phase.

## Getting started

```bash
npm install
npm run electron:dev   # launches the Electron app with hot reload
```

Other scripts:
- `npm run dev` — Vite dev server only (renderer in a browser tab)
- `npm run build` — type-check + build the renderer
- `npm run electron:build` — build + package the desktop app (electron-builder)

## Project layout

```
src/
  main/         Electron main process (window creation)
  preload/      contextBridge — will expose file/audio/export APIs later
  renderer/     React UI
    components/ Dashboard components (header, panels, waveform, comp editor, etc.)
    data/       Deterministic waveform RNG (placeholder take waveforms)
    styles/     colors_and_type.css (design tokens) + app.css
    types.ts    Shared domain types (Scene, Line, Take, Prefs, ...)
    utils/      Script PDF parser, audio import/decode, filename + time helpers
```

## Audio engine (desktop)

- **FFmpeg** (`ffmpeg-static`, main process, IPC via `preload.cjs`): decode any audio format on import; export pipeline cuts selected takes from the master with loudnorm, sample-rate/bit-depth conversion, and mono downmix per Preferences, plus a `manifest.csv`. Export requires the Electron build (`npm run electron:dev`).
- **Take detection** (`utils/takeDetect.ts`): silence-based region detection (adaptive RMS threshold) via Auto-detect; split-at-playhead; takes carry real start/end regions, play their slice of the master, and render real waveforms.
- **Transcription** (`utils/transcribe.ts`): local Whisper by default (transformers.js, fp32 — quantized decoders hit an onnxruntime QDQ bug; ~300 MB one-time model download, cached) or the OpenAI API with a key set in Preferences. Transcript segments label takes and auto-match them to script lines (token-Dice similarity).
- **Review** (`⇄ Review` in the transport): side-by-side imported script ↔ transcript with per-segment match confidence; click a segment to play from there, click a line to open it.

## Next up (inner workings)

- Session-call sync and direction/pick/redundant tagging from the director track
- Sample-accurate comp rendering + equal-power crossfades
