import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const isDev = !app.isPackaged;

// ffmpeg-static resolves to a bare binary path; inside an asar package it
// must be read from the unpacked copy.
const ffmpegPath: string = (require("ffmpeg-static") as string).replace("app.asar", "app.asar.unpacked");

function runFfmpeg(args: string[], captureStdout = false): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      ffmpegPath,
      args,
      { maxBuffer: 1024 * 1024 * 1024, encoding: "buffer" },
      (err, stdout, stderr) => {
        const errText = stderr.toString("utf8");
        // node-level failures (ENOENT, maxBuffer exceeded…) carry the detail on err, not stderr
        const detail = (msg: string) => new Error([errText.split("\n").slice(-4).join("\n").trim(), msg].filter(Boolean).join("\n"));
        // ffmpeg exits 0 on success; for probe-style calls we tolerate failure
        if (err && !captureStdout) return reject(detail(err.message));
        if (err && captureStdout && stdout.length === 0) return reject(detail(err.message));
        resolve({ stdout, stderr: errText });
      }
    );
  });
}

/**
 * Decode any audio file to 16-bit WAV; returns the WAV plus source format info parsed from ffmpeg's stream banner.
 * `compact` downmixes to 16 kHz mono — used for the session call, where an hour-plus recording at full
 * rate would blow past the exec maxBuffer / IPC / decodeAudioData memory limits.
 */
ipcMain.handle("audio:decode", async (_e, filePath: string, opts?: { compact?: boolean }) => {
  const compactArgs = opts?.compact ? ["-ac", "1", "-ar", "16000"] : [];
  const { stdout, stderr } = await runFfmpeg(
    ["-i", filePath, "-map", "0:a:0", ...compactArgs, "-c:a", "pcm_s16le", "-f", "wav", "pipe:1"],
    true
  );
  const rate = stderr.match(/(\d+) Hz/)?.[1];
  const bitsFromCodec = stderr.match(/pcm_[suf](\d+)/)?.[1] ?? stderr.match(/\((\d+) bit\)/)?.[1];
  return {
    wav: stdout.buffer.slice(stdout.byteOffset, stdout.byteOffset + stdout.byteLength),
    sampleRate: rate ? Number(rate) : 0,
    bitDepth: bitsFromCodec ? Number(bitsFromCodec) : 0
  };
});

interface ExportClip {
  start: number;
  end: number;
  filename: string;
  line: string;
  scene: string;
  take: number;
  /** Pre-rendered audio (saved comp takes) — written via a temp file instead of cutting the master. */
  wav?: ArrayBuffer;
}

interface ExportPrefs {
  norm: boolean;
  lufs: number;
  conv: boolean;
  rate: number;
  bitConv: boolean;
  keep32: boolean;
  mono: boolean;
}

/** Shared output args for the export pipeline: loudnorm / resample / downmix / bit depth per prefs. */
function prefsArgs(prefs: ExportPrefs, outFile: string): string[] {
  const codec = prefs.bitConv ? "pcm_s24le" : prefs.keep32 ? "pcm_f32le" : "pcm_s16le";
  const args: string[] = [];
  if (prefs.norm) args.push("-af", `loudnorm=I=${prefs.lufs}:TP=-1.0`);
  if (prefs.conv) args.push("-ar", String(prefs.rate * 1000));
  if (prefs.mono) args.push("-ac", "1");
  args.push("-c:a", codec, outFile);
  return args;
}

ipcMain.handle(
  "audio:export",
  async (_e, masterPath: string, clips: ExportClip[], outDir: string, prefs: ExportPrefs) => {
    for (const clip of clips) {
      const out = path.join(outDir, clip.filename);
      if (clip.wav) {
        const tmp = path.join(os.tmpdir(), `clipstudio-${Date.now()}-${clip.filename}`);
        await fs.writeFile(tmp, Buffer.from(clip.wav));
        try {
          await runFfmpeg(["-y", "-i", tmp, ...prefsArgs(prefs, out)]);
        } finally {
          await fs.unlink(tmp).catch(() => {});
        }
      } else {
        await runFfmpeg(["-y", "-ss", String(clip.start), "-to", String(clip.end), "-i", masterPath, ...prefsArgs(prefs, out)]);
      }
    }
    const csv = [
      "filename,scene,take,start,end,duration,line",
      ...clips.map(
        (c) =>
          `${c.filename},${c.scene},${c.take},${c.start.toFixed(3)},${c.end.toFixed(3)},${(c.end - c.start).toFixed(3)},"${c.line.replace(/"/g, '""')}"`
      )
    ].join("\n");
    await fs.writeFile(path.join(outDir, "manifest.csv"), csv, "utf8");
    return { written: clips.length, dir: outDir };
  }
);

// ---- AAF export (pyaaf2) -------------------------------------------------

interface AafClip {
  name: string;
  /** episode timecode in seconds */
  tc: number;
  wav: ArrayBuffer;
}
interface AafTrack {
  name: string;
  clips: AafClip[];
}
interface AafEpisode {
  code: string;
  tracks: AafTrack[];
}

/**
 * Generator script run via python3 + pyaaf2 (pure-python; `pip3 install pyaaf2`).
 * Embedded as a string so packaging needs no extra assets. Structure verified by
 * reading generated files back with pyaaf2: clips land at tc×fps frames on named
 * sound tracks, essence embedded.
 */
const AAF_PY = `
import json, sys
try:
    import aaf2
except ImportError:
    sys.stderr.write("pyaaf2 is not installed - run: pip3 install pyaaf2\\n")
    sys.exit(3)

def build_episode(episode, fps, tc_start):
    with aaf2.open(episode["out"], "w") as f:
        comp = f.create.CompositionMob()
        comp.name = episode["code"]
        comp.usage = "Usage_TopLevel"
        f.content.mobs.append(comp)
        total_frames = 0
        for track in episode["tracks"]:
            slot = comp.create_sound_slot(fps)
            slot.name = track["name"]
            seq = f.create.Sequence(media_kind="sound")
            slot.segment = seq
            pos = 0
            for clip_info in sorted(track["clips"], key=lambda c: c["tc"]):
                master = f.create.MasterMob(clip_info["name"])
                f.content.mobs.append(master)
                master.import_audio_essence(clip_info["wav"], fps)
                start = int(round(clip_info["tc"] * fps))
                if start > pos:
                    seq.components.append(f.create.Filler("sound", start - pos))
                    pos = start
                clip = master.create_source_clip(slot_id=1)
                seq.components.append(clip)
                pos += clip.length
            total_frames = max(total_frames, pos)
        tc_slot = comp.create_timeline_slot(fps)
        tc_slot.name = "TC"
        timecode = f.create.Timecode(fps, drop=False)
        timecode.start = tc_start   # sequence origin timecode (frames)
        timecode.length = max(total_frames, 1)
        tc_slot.segment = timecode

with open(sys.argv[1]) as fh:
    manifest = json.load(fh)
fps = int(manifest.get("fps", 25))
tc_start = int(manifest.get("tc_start", 0))
for ep in manifest["episodes"]:
    build_episode(ep, fps, tc_start)
print(json.dumps({"written": len(manifest["episodes"])}))
`;

function runPython(args: string[]): Promise<string> {
  const attempt = (bin: string) =>
    new Promise<string>((resolve, reject) => {
      execFile(bin, args, { maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) {
          const e = new Error(stderr.toString().trim() || err.message) as Error & { code?: string };
          e.code = (err as NodeJS.ErrnoException).code;
          return reject(e);
        }
        resolve(stdout.toString());
      });
    });
  // GUI-launched Electron may not have the shell PATH — fall back to the system python
  return attempt("python3").catch((err) =>
    err.code === "ENOENT" ? attempt("/usr/bin/python3") : Promise.reject(err)
  );
}

ipcMain.handle("aaf:export", async (_e, episodes: AafEpisode[], outDir: string, opts?: { tcStartSec?: number; fps?: number }) => {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "clipstudio-aaf-"));
  try {
    let wavIdx = 0;
    const fps = opts?.fps ?? 25;
    const manifest = {
      fps,
      tc_start: Math.round((opts?.tcStartSec ?? 3600) * fps), // sequence origin, in frames
      episodes: await Promise.all(
        episodes.map(async (ep) => ({
          code: ep.code,
          out: path.join(outDir, `${ep.code}.aaf`),
          tracks: await Promise.all(
            ep.tracks.map(async (tr) => ({
              name: tr.name,
              clips: await Promise.all(
                tr.clips.map(async (c) => {
                  const wavPath = path.join(work, `clip-${wavIdx++}.wav`);
                  await fs.writeFile(wavPath, Buffer.from(c.wav));
                  return { name: c.name, tc: c.tc, wav: wavPath };
                })
              )
            }))
          )
        }))
      )
    };
    const scriptPath = path.join(work, "aaf_export.py");
    const manifestPath = path.join(work, "manifest.json");
    await fs.writeFile(scriptPath, AAF_PY, "utf8");
    await fs.writeFile(manifestPath, JSON.stringify(manifest), "utf8");
    const out = JSON.parse(await runPython([scriptPath, manifestPath])) as { written: number };
    return { written: out.written, dir: outDir };
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => {});
  }
});

// ---- project save / open -------------------------------------------------

ipcMain.handle("project:save", async (_e, json: string, suggestedName: string) => {
  const win = BrowserWindow.getFocusedWindow();
  const res = await dialog.showSaveDialog(win!, {
    title: "Save project",
    defaultPath: suggestedName,
    filters: [{ name: "Clip Studio project", extensions: ["clipstudio"] }]
  });
  if (res.canceled || !res.filePath) return null;
  await fs.writeFile(res.filePath, json, "utf8");
  return res.filePath;
});

ipcMain.handle("project:open", async () => {
  const win = BrowserWindow.getFocusedWindow();
  const res = await dialog.showOpenDialog(win!, {
    title: "Open project",
    filters: [{ name: "Clip Studio project", extensions: ["clipstudio", "json"] }],
    properties: ["openFile"]
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  const json = await fs.readFile(res.filePaths[0], "utf8");
  return { path: res.filePaths[0], json };
});

ipcMain.handle("dialog:pickOutputDir", async () => {
  const win = BrowserWindow.getFocusedWindow();
  const res = await dialog.showOpenDialog(win!, {
    title: "Choose export folder",
    properties: ["openDirectory", "createDirectory"]
  });
  return res.canceled ? null : res.filePaths[0];
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 840,
    minHeight: 600,
    title: "Clip Studio",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    backgroundColor: "#f8fafc",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (isDev) {
    win.loadURL("http://localhost:5173");
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(path.join(__dirname, "../../dist/index.html"));
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
