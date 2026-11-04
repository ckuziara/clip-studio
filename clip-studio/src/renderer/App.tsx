import { useEffect, useRef, useState } from "react";
import TitleBar from "./components/TitleBar";
import AppHeader from "./components/AppHeader";
import AssetsList from "./components/AssetsList";
import WaveformCard from "./components/WaveformCard";
import LineDetail from "./components/LineDetail";
import TakesPanel from "./components/TakesPanel";
import LineQueuePanel from "./components/LineQueuePanel";
import NamingExportPanel from "./components/NamingExportPanel";
import PreferencesModal from "./components/PreferencesModal";
import ImportHero from "./components/ImportHero";
import ScriptTranscriptModal from "./components/ScriptTranscriptModal";
import type { CallSegment, CompModel, Prefs, Scene, SourceAudio, TranscriptSegment } from "./types";
import { filenameFor } from "./utils/format";
import { parseScriptFile } from "./utils/scriptParser";
import { parseTimecode } from "./utils/tabularParser";
import { renderComp } from "./utils/compAudio";
import { encodeWav } from "./utils/wavEncode";
import { getAudioContext, importAudioFile, importAudioFromPath } from "./utils/audioImport";
import { deserializeProject, serializeProject, type ProjectAudioRef } from "./utils/project";
import { detectRegions, matchLine, textSimilarity, transcriptForRegion } from "./utils/takeDetect";
import { transcribeAudio } from "./utils/transcribe";
import { computeOffsetMap, speechMask } from "./utils/align";
import { applyInstructionMapping, classifyCallSegments } from "./utils/callMap";
import { getBridge, type MenuCommand } from "./bridge";

const DEFAULT_PREFS: Prefs = {
  norm: true,
  lufs: -23,
  conv: true,
  rate: 48,
  bitConv: true,
  keep32: true,
  mono: false,
  transcribe: "local",
  apiKey: "",
  tcStart: "01:00:00:00",
  chronoGap: 0.5,
  aafBits: 24
};

export default function App() {
  // Scenes are mutated in place (mirrors the design prototype's model) and
  // a "tick" counter forces re-renders after edits — this keeps the take /
  // comp editing logic simple while the real audio engine isn't wired up yet.
  const scenesRef = useRef<Scene[]>([]);
  const [, setTick] = useState(0);
  /** Unsaved changes. Every scene/line/take edit goes through bump(), so it marks the project dirty. */
  const [dirty, setDirty] = useState(false);
  /** The .clipstudio file this session was opened from / last saved to (Electron only). */
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const bump = () => {
    setTick((n) => n + 1);
    setDirty(true);
  };

  const [sessionTitle, setSessionTitle] = useState("");
  const [characterName, setCharacterName] = useState("Character");
  const [scriptName, setScriptName] = useState("");
  const [audio, setAudio] = useState<SourceAudio | null>(null);
  const [sessionCall, setSessionCall] = useState<SourceAudio | null>(null);
  const [importError, setImportError] = useState("");
  const [importBusy, setImportBusy] = useState("");
  const [statusToast, setStatusToast] = useState("");
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  /** Session-call transcript, classified + shifted onto the master timeline; null until analyzed. */
  const [callSegments, setCallSegments] = useState<CallSegment[] | null>(null);
  /** false = correlation failed, call shown unaligned (lag 0). null until analyzed. */
  const [callAligned, setCallAligned] = useState<boolean | null>(null);
  const [transcribeState, setTranscribeState] = useState<{ busy: boolean; label: string; fraction: number | null }>({
    busy: false,
    label: "",
    fraction: null
  });

  const [sceneIndex, setSceneIndex] = useState(0);
  const [lineIndex, setLineIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pattern, setPattern] = useState("{code}_{char}_{line}_{take}");
  const [compOpen, setCompOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [focusedTakeIdx, setFocusedTakeIdx] = useState<number | null>(null);
  /** What the space bar plays: the focused take, or the main timeline (last one interacted with wins). */
  const [playTarget, setPlayTarget] = useState<"timeline" | "take">("timeline");
  /** Multi-character scripts: only this character's lines are shown/edited (null = all). */
  const [activeCharacter, setActiveCharacter] = useState<string | null>(null);

  const scenes = scenesRef.current;
  const scene = scenes[sceneIndex] as Scene | undefined;
  const line = scene?.lines[lineIndex];

  // --- multi-character scripts: edit one character at a time -------------
  // Line numbers are always the line's position in the full script, so filtering
  // never renumbers — Ayo's line 3 stays L03 even when Kai's lines are hidden.
  const characters: string[] = [];
  scenes.forEach((sc) =>
    sc.lines.forEach((ln) => {
      if (ln.character && !characters.includes(ln.character)) characters.push(ln.character);
    })
  );

  /** Visible under the active character filter. Unassigned lines always show. */
  const lineVisible = (ln: { character?: string }) =>
    !activeCharacter || !ln.character || ln.character === activeCharacter;

  function selectCharacter(ch: string | null) {
    setActiveCharacter(ch);
    const visible = (ln: { character?: string }) => !ch || !ln.character || ln.character === ch;
    // keep the selection on a line that character actually has
    if (scene && line && !visible(line)) {
      const li = scene.lines.findIndex(visible);
      if (li >= 0) {
        setLineIndex(li);
      } else {
        // whole scene hidden — jump to the first scene with a visible line
        const si = scenes.findIndex((sc) => sc.lines.some(visible));
        if (si >= 0) {
          setSceneIndex(si);
          setLineIndex(scenes[si].lines.findIndex(visible));
        }
      }
      setCompOpen(false);
      setFocusedTakeIdx(null);
    }
  }

  /** Script-match threshold of the ACTIVE asset — each scene keeps its own (stored on the Scene). */
  const matchFilter = scene?.matchFilter ?? 0;

  /** A take survives the match filter when unscored (no transcript) or scoring at/above it. */
  const isTakeVisible = (t: { match?: number }, threshold = matchFilter) =>
    t.match === undefined || t.match >= threshold;

  /** Filtered-out takes can't stay selected — deselect them (each scene judged by its own filter). */
  function unselectHiddenTakes() {
    let changed = false;
    scenesRef.current.forEach((sc) =>
      sc.lines.forEach((ln) =>
        ln.takes.forEach((t) => {
          if (!isTakeVisible(t, sc.matchFilter ?? 0) && t.status === "good") {
            t.status = "alt";
            changed = true;
          }
        })
      )
    );
    if (changed) bump();
  }

  function applyMatchFilter(v: number) {
    if (!scene) return;
    scene.matchFilter = v;
    unselectHiddenTakes();
    bump();
  }

  // --- playback (master audio) ---
  const srcNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const playStartRef = useRef(0); // ctx.currentTime when playback started
  const playOffsetRef = useRef(0); // seconds into the buffer at start
  const rafRef = useRef(0);

  function stopPlayback(): number {
    const ctx = getAudioContext();
    const pos = playing ? Math.min(playOffsetRef.current + ctx.currentTime - playStartRef.current, audio?.duration ?? 0) : currentTime;
    if (srcNodeRef.current) {
      srcNodeRef.current.onended = null;
      try {
        srcNodeRef.current.stop();
      } catch {
        /* already stopped */
      }
      srcNodeRef.current = null;
    }
    cancelAnimationFrame(rafRef.current);
    return pos;
  }

  function togglePlay() {
    if (!audio) return;
    setPlayTarget("timeline"); // the transport controls the main timeline
    const ctx = getAudioContext();
    if (playing) {
      setCurrentTime(stopPlayback());
      setPlaying(false);
      return;
    }
    void ctx.resume();
    const src = ctx.createBufferSource();
    src.buffer = audio.buffer;
    src.connect(ctx.destination);
    const offset = currentTime >= audio.duration - 0.05 ? 0 : currentTime;
    src.start(0, offset);
    src.onended = () => {
      srcNodeRef.current = null;
      cancelAnimationFrame(rafRef.current);
      setCurrentTime(audio.duration);
      setPlaying(false);
    };
    srcNodeRef.current = src;
    playStartRef.current = ctx.currentTime;
    playOffsetRef.current = offset;
    setPlaying(true);
    const tickTime = () => {
      setCurrentTime(Math.min(playOffsetRef.current + ctx.currentTime - playStartRef.current, audio.duration));
      rafRef.current = requestAnimationFrame(tickTime);
    };
    rafRef.current = requestAnimationFrame(tickTime);
  }

  function seekTo(t: number) {
    setPlayTarget("timeline"); // clicking the main timeline points the space bar at it
    const wasPlaying = playing;
    const clamped = Math.max(0, Math.min(t, audio?.duration ?? 0));
    stopPlayback();
    setPlaying(false);
    setCurrentTime(clamped);
    if (wasPlaying) {
      // restart from the new position on the next frame
      requestAnimationFrame(() => togglePlayFrom(clamped));
    }
  }

  function togglePlayFrom(t: number) {
    setCurrentTime(t);
    if (!playing) togglePlay();
  }

  useEffect(
    () => () => {
      stopPlayback();
    },
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // --- imports ---
  async function handleImportScript(file: File) {
    setImportError("");
    setImportBusy("script");
    try {
      const parsed = await parseScriptFile(file);
      scenesRef.current = parsed.scenes;
      setSessionTitle(parsed.sessionTitle);
      setCharacterName(parsed.characterName);
      setScriptName(file.name);
      setSceneIndex(0);
      setLineIndex(0);
      setActiveCharacter(null); // new script — back to showing every character
      setCompOpen(false);
      setDirty(true);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImportBusy("");
    }
  }

  async function handleImportAudio(file: File, kind: "master" | "sessioncall") {
    setImportError("");
    setImportBusy(kind);
    try {
      const imported = await importAudioFile(file, { compact: kind === "sessioncall" });
      // a new file on either lane invalidates the alignment + call analysis
      setCallSegments(null);
      setCallAligned(null);
      if (kind === "master") {
        stopPlayback();
        setPlaying(false);
        setCurrentTime(0);
        setTranscript([]);
        setAudio(imported);
      } else {
        setSessionCall(imported);
      }
      setDirty(true);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImportBusy("");
    }
  }

  const fileFor = (li: number, take: number | string) => (scene ? filenameFor(pattern, characterName, scene, li, take) : "");

  // computed on every render — scenes/takes are mutated in place, so memoizing
  // on the (stable) scenes reference would show stale counts after edits
  let totalLines = 0;
  let totalTakes = 0;
  let readyCount = 0;
  let reviewCount = 0;
  scenes.forEach((sc) =>
    sc.lines.forEach((ln) => {
      totalLines++;
      ln.takes.forEach((t) => {
        totalTakes++;
        if (t.status === "good") readyCount++;
        if (t.status === "review") reviewCount++;
      });
    })
  );

  function selectScene(i: number) {
    setSceneIndex(i);
    // land on the first line the active character actually has
    setLineIndex(Math.max(0, scenes[i]?.lines.findIndex(lineVisible) ?? 0));
    setCompOpen(false);
    setFocusedTakeIdx(null);
  }

  function selectLine(i: number) {
    setLineIndex(i);
    setCompOpen(false);
    setFocusedTakeIdx(null);
  }

  /** Move take keyboard focus by delta, over the takes the match filter leaves visible. */
  function moveTakeFocus(delta: number) {
    if (!line || line.takes.length === 0) return;
    const visible = line.takes
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => t.match === undefined || t.match >= matchFilter)
      .map(({ i }) => i);
    if (visible.length === 0) return;
    setPlayTarget("take");
    setFocusedTakeIdx((prev) => {
      const pos = prev === null ? -1 : visible.indexOf(prev);
      return visible[Math.max(0, Math.min(visible.length - 1, pos + delta))];
    });
  }

  /** Focus a take and point the space bar at it. */
  function focusTake(takeIdx: number) {
    setFocusedTakeIdx(takeIdx);
    setPlayTarget("take");
  }

  function handleAddTake() {
    if (!line) return;
    line.takes.push({
      take: line.takes.length + 1,
      dur: 1.5 + Math.random() * 3,
      status: "review",
      seed: Date.now() % 9999,
      stars: 0
    });
    bump();
  }

  function pushRegionTake(target: Scene["lines"][0], start: number, end: number, text?: string) {
    target.takes.push({
      take: target.takes.length + 1,
      dur: end - start,
      status: "alt",
      seed: Math.floor(start * 997) % 9999,
      stars: 0,
      start,
      end,
      text,
      match: text ? textSimilarity(target.text, text) : undefined
    });
  }

  /** Silence-detect takes in the master; label + route them via the transcript when available. */
  function handleAutoDetect() {
    if (!audio || scenes.length === 0) return;
    const regions = detectRegions(audio.buffer);
    if (regions.length === 0) {
      setImportError("No takes detected — the recording looks silent.");
      return;
    }
    // don't duplicate regions already assigned to takes
    const taken = scenes.flatMap((sc) => sc.lines.flatMap((ln) => ln.takes.filter((t) => t.start !== undefined)));
    const fresh = regions.filter(
      (r) => !taken.some((t) => t.start! < r.end && (t.end ?? 0) > r.start)
    );

    // lines still needing takes, in script order (fallback routing when no transcript match);
    // with a character selected, only their lines receive takes
    const needy = scenes.flatMap((sc, si) =>
      sc.lines
        .map((_, li) => ({ sceneIndex: si, lineIndex: li }))
        .filter(
          ({ sceneIndex, lineIndex }) =>
            lineVisible(scenes[sceneIndex].lines[lineIndex]) && scenes[sceneIndex].lines[lineIndex].takes.length === 0
        )
    );
    let needyIdx = 0;
    let matched = 0;

    for (const region of fresh) {
      const text = transcriptForRegion(transcript, region) || undefined;
      let ref = text ? matchLine(scenes, text) : null;
      // don't route takes onto a hidden character's line
      if (ref && !lineVisible(scenes[ref.sceneIndex].lines[ref.lineIndex])) ref = null;
      if (ref) matched++;
      const target = ref
        ? scenes[ref.sceneIndex].lines[ref.lineIndex]
        : needy.length > 0
        ? scenes[needy[needyIdx % needy.length].sceneIndex].lines[needy[needyIdx++ % needy.length].lineIndex]
        : line;
      if (target) pushRegionTake(target, region.start, region.end, text);
    }
    if (callSegments) applyInstructionMapping(scenesRef.current, callSegments);
    bump();
    setStatusToast(
      `Detected ${fresh.length} take${fresh.length === 1 ? "" : "s"}` +
        (transcript.length > 0 ? ` · ${matched} matched to script lines` : " — transcribe for automatic line matching")
    );
  }

  async function handleTranscribe() {
    if (!audio || transcribeState.busy) return;
    setImportError("");
    setTranscribeState({ busy: true, label: "Starting…", fraction: null });
    try {
      const segments = await transcribeAudio(audio.buffer, prefs.transcribe, prefs.apiKey, (label, fraction) =>
        setTranscribeState({ busy: true, label, fraction })
      );
      setTranscript(segments);
      // label any existing region takes with their transcript text
      scenes.forEach((sc) =>
        sc.lines.forEach((ln) =>
          ln.takes.forEach((t) => {
            if (t.start !== undefined && !t.text) {
              t.text = transcriptForRegion(segments, { start: t.start, end: t.end ?? t.start }) || undefined;
            }
            if (t.text && t.match === undefined) t.match = textSimilarity(ln.text, t.text);
          })
        )
      );
      unselectHiddenTakes(); // fresh scores may drop selected takes below their asset's filter
      let toast = `Transcribed ${segments.length} segment${segments.length === 1 ? "" : "s"}`;

      // session-call pipeline: align → transcribe the call → classify → map direction onto takes
      if (sessionCall) {
        setTranscribeState({ busy: true, label: "Aligning session call…", fraction: null });
        // let the label paint before the synchronous FFT work
        await new Promise((r) => setTimeout(r, 20));
        const map = computeOffsetMap(audio.buffer, sessionCall.buffer);
        setCallAligned(map.aligned);

        const rawCall = await transcribeAudio(sessionCall.buffer, prefs.transcribe, prefs.apiKey, (label, fraction) =>
          setTranscribeState({ busy: true, label: `Session call: ${label}`, fraction })
        );
        const shifted = rawCall
          .map((s) => ({ ...s, start: map.toMaster(s.start), end: map.toMaster(s.end) }))
          .filter((s) => s.end > 0 && s.start < audio.duration); // outside the master timeline = unmappable
        const classified = classifyCallSegments(shifted, speechMask(audio.buffer), segments);
        setCallSegments(classified);
        const tagged = applyInstructionMapping(scenesRef.current, classified);
        bump();

        const nInstr = classified.filter((s) => s.kind === "instruction").length;
        toast += ` · call: ${nInstr} direction${nInstr === 1 ? "" : "s"}${tagged > 0 ? `, ${tagged} takes tagged` : ""}${map.aligned ? "" : " (unaligned)"}`;
      }
      setStatusToast(toast);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setTranscribeState({ busy: false, label: "", fraction: null });
    }
  }

  /** Split: cut the take under the playhead in two, or start a new take ending at the playhead. */
  function handleSplit() {
    if (!audio || !line) return;
    const t = currentTime;
    const hit = line.takes.find((tk) => tk.start !== undefined && tk.start! < t && (tk.end ?? 0) > t);
    if (hit) {
      const oldEnd = hit.end!;
      hit.end = t;
      hit.dur = t - hit.start!;
      pushRegionTake(line, t, oldEnd, undefined);
    } else {
      const prevEnd = Math.max(0, ...line.takes.filter((tk) => (tk.end ?? Infinity) <= t).map((tk) => tk.end!));
      if (t - prevEnd < 0.1) return;
      pushRegionTake(line, prevEnd, t, transcriptForRegion(transcript, { start: prevEnd, end: t }) || undefined);
    }
    if (callSegments) applyInstructionMapping(scenesRef.current, callSegments);
    bump();
  }

  /** Play a take's region of the master recording. */
  function handlePlayTake(start: number, end: number) {
    if (!audio) return;
    stopPlayback();
    setPlaying(false);
    setCurrentTime(start);
    const ctx = getAudioContext();
    void ctx.resume();
    const src = ctx.createBufferSource();
    src.buffer = audio.buffer;
    src.connect(ctx.destination);
    src.start(0, start, end - start);
    srcNodeRef.current = src;
    playStartRef.current = ctx.currentTime;
    playOffsetRef.current = start;
    setPlaying(true);
    src.onended = () => {
      srcNodeRef.current = null;
      cancelAnimationFrame(rafRef.current);
      setCurrentTime(end);
      setPlaying(false);
    };
    const tickTime = () => {
      setCurrentTime(Math.min(playOffsetRef.current + ctx.currentTime - playStartRef.current, end));
      rafRef.current = requestAnimationFrame(tickTime);
    };
    rafRef.current = requestAnimationFrame(tickTime);
  }

  /** Render Comp A and add it to the line as a new take labelled with its source takes (e.g. v01+02). */
  function handleSaveCompAsTake() {
    if (!audio || !line?.comp) {
      setImportError("Open the comp editor first — there's no comp to save yet.");
      return;
    }
    const selected = line.takes.filter((t) => t.status === "good");
    const durSec = Math.max(...selected.map((t) => t.dur), 0.001);
    const buffer = renderComp(audio.buffer, line.takes, line.comp, durSec);
    if (!buffer) {
      setImportError("Saving a comp needs takes with regions in the master — auto-detect or split first.");
      return;
    }
    // label from the distinct source takes, in comp order: v01+02
    const srcNums = [...new Set(line.comp.srcs.map((s) => line.takes[s]?.take).filter((n): n is number => n !== undefined))];
    const label = "v" + srcNums.map((n) => String(n).padStart(2, "0")).join("+");

    // display peaks from the rendered buffer
    const data = buffer.getChannelData(0);
    const nPeaks = 150;
    const per = Math.max(1, Math.floor(data.length / nPeaks));
    const peaks: number[] = [];
    for (let i = 0; i < nPeaks; i++) {
      let max = 0;
      for (let j = i * per; j < (i + 1) * per && j < data.length; j++) {
        const a = Math.abs(data[j]);
        if (a > max) max = a;
      }
      peaks.push(max);
    }

    line.takes.push({
      take: line.takes.length + 1,
      dur: buffer.length / buffer.sampleRate,
      status: "alt",
      seed: line.takes.length * 131,
      stars: 0,
      buffer,
      peaks,
      label,
      text: `Comp of takes ${srcNums.join(" + ")}`
    });
    setCompOpen(false);
    bump();
    setStatusToast(`Added ${fileFor(lineIndex, label)} as take ${line.takes.length}`);
  }

  /** Play a rendered take (saved comp) — transport playhead stays put since it isn't master audio. */
  function handlePlayBuffer(buffer: AudioBuffer) {
    stopPlayback();
    setPlaying(false);
    const ctx = getAudioContext();
    void ctx.resume();
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.onended = () => {
      if (srcNodeRef.current === src) srcNodeRef.current = null;
    };
    src.start();
    srcNodeRef.current = src;
  }

  /** Export selected takes through ffmpeg (desktop only) + CSV manifest. */
  async function handleExport() {
    const bridge = getBridge();
    if (!bridge) {
      setImportError("Export needs the desktop app — ffmpeg runs in the Electron build (npm run electron:dev).");
      return;
    }
    if (!audio?.sourcePath) {
      setImportError("Re-import the master audio in the desktop app so the export can read the source file.");
      return;
    }
    const clips: {
      start: number;
      end: number;
      filename: string;
      line: string;
      scene: string;
      take: number;
      wav?: ArrayBuffer;
    }[] = [];
    let skipped = 0;
    scenes.forEach((sc) =>
      sc.lines.forEach((ln, li) => {
        const visible = ln.takes.filter((t) => isTakeVisible(t, sc.matchFilter ?? 0)); // per-asset filter; numbering mirrors the takes list
        visible.forEach((t, vi) => {
          if (t.status !== "good") return;
          if (t.start === undefined || t.end === undefined) {
            if (!t.buffer) {
              skipped++;
              return;
            }
          }
          clips.push({
            start: t.start ?? 0,
            end: t.end ?? t.dur,
            filename: filenameFor(pattern, characterName, sc, li, t.label ?? vi + 1),
            line: ln.text,
            scene: sc.code,
            take: vi + 1,
            // rendered takes (saved comps) ship their own audio instead of a master region
            wav: t.buffer ? encodeWav(t.buffer, 32) : undefined
          });
        });
      })
    );
    if (clips.length === 0) {
      setImportError(skipped > 0 ? "Selected takes have no region in the master — re-detect or split first." : "No takes selected yet — mark takes with “Use this” first.");
      return;
    }
    const outDir = await bridge.pickOutputDir();
    if (!outDir) return;
    setImportBusy("export");
    try {
      const res = await bridge.exportClips(audio.sourcePath, clips, outDir, prefs);
      setStatusToast(
        `Exported ${res.written} clip${res.written === 1 ? "" : "s"} + manifest.csv to ${res.dir}` +
          (skipped > 0 ? ` (${skipped} selected take${skipped === 1 ? "" : "s"} skipped — no region)` : "")
      );
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImportBusy("");
    }
  }

  /** Copy a [start, end] region of the master into its own AudioBuffer. */
  function sliceMasterRegion(start: number, end: number): AudioBuffer {
    const src = audio!.buffer;
    const rate = src.sampleRate;
    const from = Math.max(0, Math.floor(start * rate));
    const to = Math.min(src.length, Math.ceil(end * rate));
    const out = getAudioContext().createBuffer(src.numberOfChannels, Math.max(1, to - from), rate);
    for (let ch = 0; ch < src.numberOfChannels; ch++) {
      out.copyToChannel(src.getChannelData(ch).subarray(from, to), ch);
    }
    return out;
  }

  /**
   * One AAF per episode (asset code), a sound track per character, each line's
   * selected take placed at the line's script timecode. Without a TC column the
   * takes are strung out chronologically instead (master-recording order, small
   * gaps). Skips lines without a visible selected take.
   */
  async function handleExportAaf() {
    const bridge = getBridge();
    if (!bridge?.exportAaf) {
      setImportError("AAF export needs the desktop app — run it via npm run electron:dev.");
      return;
    }
    if (!audio) {
      setImportError("Import the master audio first — the AAF embeds each take's audio.");
      return;
    }

    const hasTc = scenes.some((sc) => sc.lines.some((ln) => ln.tc !== undefined));
    const tcStartSec = parseTimecode(prefs.tcStart) ?? 3600; // sequence origin TC (default 01:00:00:00)

    // collect clips per episode; tc stays undefined in chronological mode until placement
    interface PendingClip {
      track: string;
      name: string;
      wav: ArrayBuffer;
      dur: number;
      tc?: number;
      /** master-recording position for chronological ordering (buffer takes fall back to script order) */
      order: number;
      scriptIdx: number;
    }
    const byCode = new Map<string, PendingClip[]>();
    let skippedNoTake = 0;
    let scriptIdx = 0;
    scenes.forEach((sc) =>
      sc.lines.forEach((ln, li) => {
        scriptIdx++;
        if (hasTc && ln.tc === undefined) return; // timecode mode only places timecoded lines
        const visible = ln.takes.filter((t) => isTakeVisible(t, sc.matchFilter ?? 0));
        const vi = visible.findIndex((t) => t.status === "good" && (t.buffer || (t.start !== undefined && t.end !== undefined)));
        if (vi === -1) {
          skippedNoTake++;
          return;
        }
        const take = visible[vi];
        const buf = take.buffer ?? sliceMasterRegion(take.start!, take.end!);
        const clips = byCode.get(sc.code) ?? [];
        byCode.set(sc.code, clips);
        clips.push({
          track: ln.character || characterName,
          name: filenameFor(pattern, characterName, sc, li, take.label ?? vi + 1).replace(/\.wav$/i, ""),
          wav: encodeWav(buf, prefs.aafBits),
          dur: buf.duration,
          // timecode mode stores the clip's frame offset from the sequence origin (script TC − start);
          // chronological mode leaves it undefined until laid out below
          tc: ln.tc !== undefined ? Math.max(0, ln.tc - tcStartSec) : undefined,
          order: take.start ?? Number.MAX_SAFE_INTEGER,
          scriptIdx
        });
      })
    );

    // chronological mode: string clips out in master order (script order for buffer-only takes),
    // back to back from the sequence origin with a configurable gap, on a shared timeline so
    // cross-character order is preserved
    if (!hasTc) {
      for (const clips of byCode.values()) {
        clips.sort((a, b) => a.order - b.order || a.scriptIdx - b.scriptIdx);
        let pos = 0;
        for (const c of clips) {
          c.tc = pos;
          pos += c.dur + prefs.chronoGap;
        }
      }
    }

    if (byCode.size === 0) {
      setImportError(
        skippedNoTake > 0
          ? "No AAF clips — the lines have no selected take yet (mark takes with “Use this”)."
          : hasTc
          ? "No AAF clips — the timecoded lines have no selected take yet."
          : "No takes selected yet — mark takes with “Use this” first."
      );
      return;
    }
    const outDir = await bridge.pickOutputDir();
    if (!outDir) return;
    setImportBusy("export");
    try {
      const episodes = [...byCode.entries()].map(([code, clips]) => {
        const tracks = new Map<string, { name: string; tc: number; wav: ArrayBuffer }[]>();
        for (const c of clips) {
          const arr = tracks.get(c.track) ?? [];
          tracks.set(c.track, arr);
          arr.push({ name: c.name, tc: c.tc!, wav: c.wav });
        }
        return { code, tracks: [...tracks.entries()].map(([name, cs]) => ({ name, clips: cs })) };
      });
      const res = await bridge.exportAaf(episodes, outDir, { tcStartSec, fps: 25 });
      setStatusToast(
        `Exported ${res.written} AAF${res.written === 1 ? "" : "s"} to ${res.dir}` +
          (hasTc ? "" : " (chronological — no TC column in the script)") +
          (skippedNoTake > 0 ? ` (${skippedNoTake} line${skippedNoTake === 1 ? "" : "s"} skipped — no selected take)` : "")
      );
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImportBusy("");
    }
  }

  // --- project save / open ------------------------------------------------

  const openProjectInputRef = useRef<HTMLInputElement>(null);

  /** ⌘S saves to the project's file; Save As (⇧⌘S) or a never-saved project asks where. Resolves true once on disk. */
  async function handleSaveProject(saveAs = false): Promise<boolean> {
    if (scenes.length === 0) {
      setImportError("Nothing to save yet — import a script first.");
      return false;
    }
    const json = serializeProject({
      sessionTitle,
      characterName,
      scriptName,
      pattern,
      prefs,
      scenes,
      transcript,
      callSegments,
      callAligned,
      sceneIndex,
      lineIndex,
      activeCharacter,
      audio: audio ? { name: audio.name, sourcePath: audio.sourcePath, duration: audio.duration, sampleRate: audio.sampleRate } : null,
      sessionCall: sessionCall
        ? { name: sessionCall.name, sourcePath: sessionCall.sourcePath, duration: sessionCall.duration, sampleRate: sessionCall.sampleRate }
        : null
    });
    const filename = `${(sessionTitle || "session").replace(/[\\/:*?"<>|]/g, "_")}.clipstudio`;
    const bridge = getBridge();
    if (bridge?.saveProject) {
      try {
        const path = await bridge.saveProject(json, filename, projectPath ?? undefined, saveAs);
        if (!path) return false;
        setProjectPath(path);
        setDirty(false);
        setStatusToast(`Project saved to ${path}`);
        return true;
      } catch (err) {
        setImportError(err instanceof Error ? err.message : String(err));
        return false;
      }
    }
    // browser fallback: download the file
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    setDirty(false);
    setStatusToast(`Project downloaded as ${filename}`);
    return true;
  }

  /**
   * Re-decode one of the project's audio files. When it isn't where the project says (main
   * already tried the path relative to the project, then the absolute one), ask the user to
   * locate it, and refuse a replacement whose length / sample rate doesn't match — takes are
   * positions in the master, so a different file would silently misplace every one of them.
   */
  async function loadProjectAudio(
    ref: ProjectAudioRef,
    missing: boolean,
    kind: "master" | "sessioncall"
  ): Promise<{ audio: SourceAudio | null; relinked: boolean; problem?: string }> {
    const bridge = getBridge();
    const what = kind === "master" ? "master recording" : "session call";
    let src = missing ? undefined : ref.sourcePath;
    let relinked = false;
    if (!src) {
      if (!bridge?.pickAudio) return { audio: null, relinked, problem: `re-import ${ref.name}` };
      src =
        (await bridge.pickAudio(
          `Locate the ${what} “${ref.name}”${kind === "sessioncall" ? " (Cancel to open without it)" : ""}`
        )) ?? undefined;
      if (!src) return { audio: null, relinked, problem: `${ref.name} not found — re-import it` };
      relinked = true;
    }
    const name = relinked ? src.split(/[\\/]/).pop() || ref.name : ref.name;
    let imported: SourceAudio;
    try {
      imported = await importAudioFromPath(src, name, { compact: kind === "sessioncall" });
    } catch {
      return { audio: null, relinked: false, problem: `couldn't read ${name}` };
    }
    const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
    if (ref.duration && Math.abs(imported.duration - ref.duration) > 0.05) {
      return {
        audio: null,
        relinked: false,
        problem: `${name} is ${fmt(imported.duration)} long but the project's ${what} was ${fmt(ref.duration)} — not loaded, takes wouldn't line up`
      };
    }
    if (kind === "master" && ref.sampleRate && imported.sampleRate !== ref.sampleRate) {
      return {
        audio: null,
        relinked: false,
        problem: `${name} is ${imported.sampleRate / 1000} kHz but the project's master was ${ref.sampleRate / 1000} kHz — not loaded`
      };
    }
    return { audio: imported, relinked };
  }

  async function restoreProject(json: string, opened?: { path: string; missing: { audio: boolean; sessionCall: boolean } }) {
    setImportError("");
    setImportBusy("project");
    try {
      const { file, scenes: revived } = await deserializeProject(json);
      stopPlayback();
      setPlaying(false);
      setCurrentTime(0);

      scenesRef.current = revived;
      setSessionTitle(file.sessionTitle);
      setCharacterName(file.characterName);
      setScriptName(file.scriptName);
      setPattern(file.pattern);
      setPrefs({ ...DEFAULT_PREFS, ...file.prefs }); // merge: older projects lack newer prefs
      setTranscript(file.transcript ?? []);
      setCallSegments(file.callSegments ?? null);
      setCallAligned(file.callAligned ?? null);
      setActiveCharacter(file.activeCharacter ?? null);
      setSceneIndex(Math.min(file.sceneIndex ?? 0, Math.max(0, revived.length - 1)));
      setLineIndex(Math.min(file.lineIndex ?? 0, Math.max(0, (revived[file.sceneIndex ?? 0]?.lines.length ?? 1) - 1)));
      setCompOpen(false);
      setFocusedTakeIdx(null);

      // re-decode session audio from disk (Electron); in the browser it needs a manual re-import
      const problems: string[] = [];
      let relinked = false;
      setAudio(null);
      setSessionCall(null);
      if (file.audio) {
        const r = await loadProjectAudio(file.audio, opened?.missing.audio ?? false, "master");
        if (r.audio) setAudio(r.audio);
        if (r.problem) problems.push(r.problem);
        relinked ||= r.relinked;
      }
      if (file.sessionCall) {
        const r = await loadProjectAudio(file.sessionCall, opened?.missing.sessionCall ?? false, "sessioncall");
        if (r.audio) setSessionCall(r.audio);
        if (r.problem) problems.push(r.problem);
        relinked ||= r.relinked;
      }
      bump();
      setProjectPath(opened?.path ?? null);
      // a relinked file's new location only sticks once saved
      setDirty(relinked);
      setStatusToast(
        `Project opened — ${revived.length} asset${revived.length === 1 ? "" : "s"}` +
          (relinked ? " · audio relinked, save to keep the new location" : "") +
          (problems.length > 0 ? ` · ${problems.join("; ")}` : "")
      );
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImportBusy("");
    }
  }

  function confirmDiscard(): boolean {
    if (!dirty || scenes.length === 0) return true;
    return window.confirm(
      `“${sessionTitle || "This session"}” has unsaved changes. Discard them?\n\nChoose Cancel, then Save (⌘S) to keep them.`
    );
  }

  /** Open a project: the given file (recents, Finder) or one picked in a dialog. */
  function handleOpenProject(filePath?: string) {
    if (!confirmDiscard()) return;
    const bridge = getBridge();
    if (bridge?.openProject) {
      void bridge
        .openProject(filePath)
        .then((res) => res && restoreProject(res.json, res))
        .catch((err) => setImportError(err instanceof Error ? err.message : String(err)));
    } else {
      openProjectInputRef.current?.click(); // browser fallback: file picker
    }
  }

  // Keep the window told about unsaved changes (close prompt + macOS edited dot) and the title in sync.
  useEffect(() => {
    const name = sessionTitle || "Clip Studio";
    getBridge()?.setDocumentState?.({ dirty: dirty && scenes.length > 0, name, path: projectPath ?? undefined });
    document.title = sessionTitle ? `${sessionTitle}${dirty ? " — Edited" : ""} — Clip Studio` : "Clip Studio";
  }, [dirty, sessionTitle, projectPath, scenes.length]);

  // File menu + projects opened from Finder. Handlers are read through a ref so the
  // subscription (made once) always calls the latest closure.
  const menuRef = useRef<(cmd: MenuCommand) => void>(() => {});
  menuRef.current = (cmd) => {
    if (cmd.command === "open") handleOpenProject(cmd.path);
    if (cmd.command === "save") void handleSaveProject(false);
    if (cmd.command === "saveAs") void handleSaveProject(true);
    if (cmd.command === "saveAndClose") {
      void handleSaveProject(false).then((ok) => ok && getBridge()?.closeWindow?.());
    }
  };
  useEffect(() => {
    const bridge = getBridge();
    if (!bridge?.onMenu) return;
    const off = bridge.onMenu((cmd) => menuRef.current(cmd));
    void bridge.takePendingOpen?.().then((p) => {
      if (p) menuRef.current({ command: "open", path: p });
    });
    return off;
  }, []);

  function handleStarClick(takeIdx: number, n: number) {
    if (!line) return;
    const t = line.takes[takeIdx];
    t.stars = t.stars === n ? n - 1 : n;
    focusTake(takeIdx);
    bump();
  }

  function handleSelectTake(takeIdx: number) {
    if (!line) return;
    const t = line.takes[takeIdx];
    t.status = t.status === "good" ? "alt" : "good";
    focusTake(takeIdx);
    bump();
  }

  function handleFlagTake(takeIdx: number) {
    if (!line) return;
    const t = line.takes[takeIdx];
    t.status = t.status === "review" ? "alt" : "review";
    focusTake(takeIdx);
    bump();
  }

  function handleCompChange(comp: CompModel) {
    if (!line) return;
    line.comp = comp;
    bump();
  }

  const compFilename = fileFor(lineIndex, 1).replace(/_v01\.wav$/, "_compA.wav");
  const hasScript = scenes.length > 0;

  // Global keyboard shortcuts. No dependency array: re-subscribes every render so the
  // handler always closes over the latest line/focus/modal state (this component re-renders
  // on every bump(), and the alternative — chasing an exhaustive deps list for handlers that
  // read `line`, `audio`, `transcribeState`, etc. — is more fragile than just re-attaching).
  useEffect(() => {
    function isTypingTarget(el: EventTarget | null): boolean {
      if (!(el instanceof HTMLElement)) return false;
      return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
    }

    function onKeyDown(e: KeyboardEvent) {
      if (prefsOpen) return;
      if (reviewOpen && e.key.toLowerCase() !== "r") return;
      if (isTypingTarget(e.target)) return;
      if (e.repeat && e.key !== "ArrowUp" && e.key !== "ArrowDown") return;

      const meta = e.metaKey || e.ctrlKey;

      if (meta && e.key.toLowerCase() === "e") {
        e.preventDefault();
        void handleExport();
        return;
      }
      if (meta && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void handleSaveProject(e.shiftKey); // ⇧⌘S = Save As
        return;
      }
      if (meta && e.key.toLowerCase() === "o") {
        e.preventDefault();
        handleOpenProject();
        return;
      }
      if (meta || e.altKey) return;

      switch (e.key) {
        case " ": {
          if (!audio) return;
          e.preventDefault(); // keep space from scrolling or re-triggering the last-clicked button
          if (playing) {
            // stop whatever is playing (take or timeline)
            setCurrentTime(stopPlayback());
            setPlaying(false);
            return;
          }
          if (playTarget === "take" && line && focusedTakeIdx !== null && focusedTakeIdx < line.takes.length) {
            const t = line.takes[focusedTakeIdx];
            if (t.start !== undefined && t.end !== undefined) {
              handlePlayTake(t.start, t.end);
              return;
            }
            if (t.buffer) {
              handlePlayBuffer(t.buffer);
              return;
            }
          }
          togglePlay();
          return;
        }
        case "ArrowDown":
          if (!line) return;
          e.preventDefault();
          moveTakeFocus(1);
          break;
        case "ArrowUp":
          if (!line) return;
          e.preventDefault();
          moveTakeFocus(-1);
          break;
        case "f":
        case "F":
          if (focusedTakeIdx !== null && line && focusedTakeIdx < line.takes.length) handleFlagTake(focusedTakeIdx);
          break;
        case "1":
        case "2":
        case "3":
          if (focusedTakeIdx !== null && line && focusedTakeIdx < line.takes.length) {
            handleStarClick(focusedTakeIdx, Number(e.key));
          }
          break;
        case "s":
        case "S":
          if (focusedTakeIdx !== null && line && focusedTakeIdx < line.takes.length) handleSelectTake(focusedTakeIdx);
          break;
        case "t":
        case "T":
          void handleTranscribe();
          break;
        case "r":
        case "R":
          setReviewOpen((o) => !o);
          break;
        case "a":
        case "A":
          handleAutoDetect();
          break;
        case "b":
        case "B":
          handleSplit();
          break;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        position: "relative",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-canvas)",
        fontFamily: "var(--font-sans)",
        color: "var(--fg-default)",
        overflow: "hidden"
      }}
    >
      <TitleBar title={sessionTitle ? `Clip Studio — ${sessionTitle}${dirty ? " — Edited" : ""}` : "Clip Studio"} />

      {/* browser-mode project open (Electron uses the native dialog) */}
      <input
        ref={openProjectInputRef}
        type="file"
        accept=".clipstudio,application/json"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void f.text().then((json) => restoreProject(json));
          e.target.value = "";
        }}
      />

      <AppHeader
        totalLines={totalLines}
        sceneCount={scenes.length}
        readyCount={readyCount}
        scriptName={scriptName}
        audio={audio}
        sessionCall={sessionCall}
        importBusy={importBusy}
        onImportScript={handleImportScript}
        onImportAudio={(f) => handleImportAudio(f, "master")}
        onImportSessionCall={(f) => handleImportAudio(f, "sessioncall")}
        onOpenPrefs={() => setPrefsOpen(true)}
        onExport={handleExport}
        onSaveProject={() => void handleSaveProject(false)}
        onOpenProject={() => handleOpenProject()}
        unsaved={dirty && scenes.length > 0}
      />

      <div className="cs-scroll" style={{ flex: 1, display: "flex", minHeight: 0, overflowX: "auto" }}>
        {hasScript ? (
          <>
            <AssetsList
              scenes={scenes}
              activeSceneIndex={sceneIndex}
              characters={characters}
              activeCharacter={activeCharacter}
              lineVisible={lineVisible}
              onSelect={selectScene}
              onSelectCharacter={selectCharacter}
            />

            <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 320, background: "var(--bg-canvas)" }}>
              <div style={{ padding: "16px 22px 12px", display: "flex", alignItems: "center", gap: 12, flex: "none" }}>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--primary)",
                    background: "var(--highlight-bg)",
                    padding: "4px 9px",
                    borderRadius: "var(--radius-sm)"
                  }}
                >
                  {scene!.code}
                </span>
                <span
                  style={{
                    fontSize: 18,
                    fontWeight: 600,
                    color: "var(--fg-strong)",
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap"
                  }}
                >
                  {scene!.title}
                </span>
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: 12, color: "var(--fg-muted)", flex: "none", whiteSpace: "nowrap" }}>
                  Line {lineIndex + 1} of {scene!.lines.length}
                </span>
              </div>

              <WaveformCard
                audio={audio}
                sessionCall={sessionCall}
                playing={playing}
                currentTime={currentTime}
                zoom={zoom}
                regions={line!.takes
                  .filter((t) => isTakeVisible(t)) // hidden takes leave the timeline too
                  .map((t, vi) => ({ t, vi })) // numbered by visible order, shared with the takes list
                  .filter(({ t }) => t.start !== undefined)
                  .map(({ t, vi }) => ({
                    start: t.start!,
                    end: t.end ?? t.start!,
                    label: "v" + String(vi + 1).padStart(2, "0"),
                    status: t.status
                  }))}
                callSegments={callSegments}
                callAligned={callAligned}
                transcribeState={transcribeState}
                hasTranscript={transcript.length > 0}
                onTranscribe={handleTranscribe}
                onTogglePlay={togglePlay}
                onSeek={seekTo}
                onSplit={handleSplit}
                onAutoDetect={handleAutoDetect}
                onZoomChange={setZoom}
                onImportAudio={(f) => handleImportAudio(f, "master")}
                onOpenReview={() => setReviewOpen(true)}
              />

              <div className="cs-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "16px 22px 22px" }}>
                <LineDetail text={line!.text} note={line!.note} dirNotes={[]} />
                <TakesPanel
                  line={line!}
                  compOpen={compOpen}
                  compFilename={compFilename}
                  rateHz={prefs.rate * 1000}
                  masterAudio={audio}
                  focusedTakeIdx={focusedTakeIdx}
                  matchFilter={matchFilter}
                  onMatchFilterChange={applyMatchFilter}
                  filenameFor={(take) => fileFor(lineIndex, take)}
                  onToggleComp={() => setCompOpen((o) => !o)}
                  onAddTake={handleAddTake}
                  onStarClick={handleStarClick}
                  onSelectTake={handleSelectTake}
                  onFlagTake={handleFlagTake}
                  onFocusTake={focusTake}
                  onCompChange={handleCompChange}
                  onPlayTake={handlePlayTake}
                  onPlayBuffer={handlePlayBuffer}
                  onSaveCompAsTake={handleSaveCompAsTake}
                />
              </div>
            </div>

            <div
              style={{
                width: "clamp(264px, 26vw, 340px)",
                flex: "none",
                background: "var(--bg-surface)",
                borderLeft: "1px solid var(--border-subtle)",
                display: "flex",
                flexDirection: "column",
                minHeight: 0
              }}
            >
              <LineQueuePanel
                scene={scene!}
                activeLineIndex={lineIndex}
                lineVisible={lineVisible}
                onSelectLine={selectLine}
                filenameFor={(li, take) => fileFor(li, take)}
              />
              <NamingExportPanel
                pattern={pattern}
                onPatternChange={(p) => {
                  setPattern(p);
                  setDirty(true);
                }}
                patternPreview={fileFor(lineIndex, 1)}
                readyCount={readyCount}
                reviewCount={reviewCount}
                totalTakes={totalTakes}
                aafMode={scenes.some((sc) => sc.lines.some((ln) => ln.tc !== undefined)) ? "timecode" : "chronological"}
                onExport={handleExport}
                onExportAaf={handleExportAaf}
              />
            </div>
          </>
        ) : (
          <ImportHero
            importBusy={importBusy}
            importError={importError}
            audioName={audio?.name ?? ""}
            onImportScript={handleImportScript}
            onImportAudio={(f) => handleImportAudio(f, "master")}
            onOpenProject={handleOpenProject}
          />
        )}
      </div>

      {hasScript && importError && (
        <div
          style={{
            position: "absolute",
            bottom: 16,
            left: "50%",
            transform: "translateX(-50%)",
            maxWidth: "min(560px, calc(100vw - 32px))",
            padding: "10px 16px",
            background: "var(--orange-50)",
            border: "1px solid var(--orange-200)",
            borderRadius: "var(--radius-md)",
            color: "var(--orange-700)",
            fontSize: 13,
            boxShadow: "var(--shadow-modal)",
            display: "flex",
            alignItems: "center",
            gap: 10,
            zIndex: 40
          }}
        >
          <span style={{ minWidth: 0 }}>{importError}</span>
          <button
            onClick={() => setImportError("")}
            style={{ border: "none", background: "transparent", color: "var(--orange-700)", cursor: "pointer", fontSize: 14, flex: "none" }}
          >
            ✕
          </button>
        </div>
      )}

      {statusToast && (
        <div
          style={{
            position: "absolute",
            bottom: 16,
            left: "50%",
            transform: "translateX(-50%)",
            maxWidth: "min(560px, calc(100vw - 32px))",
            padding: "10px 16px",
            background: "var(--green-50)",
            border: "1px solid var(--green-200)",
            borderRadius: "var(--radius-md)",
            color: "var(--green-700)",
            fontSize: 13,
            boxShadow: "var(--shadow-modal)",
            display: "flex",
            alignItems: "center",
            gap: 10,
            zIndex: 40
          }}
        >
          <span style={{ minWidth: 0 }}>{statusToast}</span>
          <button
            onClick={() => setStatusToast("")}
            style={{ border: "none", background: "transparent", color: "var(--green-700)", cursor: "pointer", fontSize: 14, flex: "none" }}
          >
            ✕
          </button>
        </div>
      )}

      {reviewOpen && (
        <ScriptTranscriptModal
          scenes={scenes}
          transcript={transcript}
          onSeek={(t) => {
            setReviewOpen(false);
            togglePlayFrom(t);
          }}
          onSelectLine={(si, li) => {
            setReviewOpen(false);
            setSceneIndex(si);
            setLineIndex(li);
            setCompOpen(false);
          }}
          onClose={() => setReviewOpen(false)}
        />
      )}

      {prefsOpen && <PreferencesModal
          prefs={prefs}
          onChange={(p) => {
            setPrefs(p);
            setDirty(true);
          }}
          onClose={() => setPrefsOpen(false)} />}
    </div>
  );
}
