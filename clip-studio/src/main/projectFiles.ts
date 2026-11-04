import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";

// .clipstudio file handling on the main side: atomic writes, media paths kept
// both absolute and relative to the project file (so a project folder moved
// together with its audio still opens), and the recent-projects list.

interface MediaRef {
  name: string;
  sourcePath?: string;
  /** Written here on save: sourcePath relative to the project file's folder ("/" separators). */
  relPath?: string;
}

interface ProjectJson {
  app?: string;
  sessionTitle?: string;
  audio?: MediaRef | null;
  sessionCall?: MediaRef | null;
}

export interface OpenedProjectFile {
  path: string;
  /** The project JSON with audio/sessionCall sourcePaths resolved to files that exist. */
  json: string;
  /** Media the project references that couldn't be found at either its relative or absolute path. */
  missing: { audio: boolean; sessionCall: boolean };
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function withRelPath(ref: MediaRef | null | undefined, dir: string): MediaRef | null | undefined {
  if (!ref?.sourcePath) return ref;
  const rel = path.relative(dir, ref.sourcePath);
  // across drives (Windows) the "relative" path is still absolute — don't store it
  return { ...ref, relPath: path.isAbsolute(rel) ? undefined : rel.split(path.sep).join("/") };
}

async function resolveRef(ref: MediaRef | null | undefined, dir: string): Promise<{ ref: MediaRef | null | undefined; missing: boolean }> {
  if (!ref) return { ref, missing: false };
  const candidates = [ref.relPath ? path.resolve(dir, ...ref.relPath.split("/")) : null, ref.sourcePath].filter(Boolean) as string[];
  for (const c of candidates) if (await exists(c)) return { ref: { ...ref, sourcePath: c }, missing: false };
  return { ref, missing: true };
}

/** Add relative media paths, write next to the target and rename (a crash mid-save never truncates the project). */
export async function writeProjectFile(target: string, json: string): Promise<string> {
  const file = path.extname(target) ? target : `${target}.clipstudio`;
  const dir = path.dirname(file);
  const data = JSON.parse(json) as ProjectJson;
  data.audio = withRelPath(data.audio, dir);
  data.sessionCall = withRelPath(data.sessionCall, dir);
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data), "utf8");
  try {
    await fs.rename(tmp, file);
  } catch (e) {
    await fs.rm(tmp, { force: true });
    throw e;
  }
  await rememberRecent(file, data.sessionTitle || path.basename(file, path.extname(file)));
  return file;
}

export async function readProjectFile(file: string): Promise<OpenedProjectFile> {
  const raw = await fs.readFile(file, "utf8");
  let data: ProjectJson;
  try {
    data = JSON.parse(raw);
  } catch {
    // let the renderer's validator produce the user-facing message
    return { path: file, json: raw, missing: { audio: false, sessionCall: false } };
  }
  const dir = path.dirname(file);
  const audio = await resolveRef(data.audio, dir);
  const call = await resolveRef(data.sessionCall, dir);
  data.audio = audio.ref;
  data.sessionCall = call.ref;
  if (data.app === "clip-studio") await rememberRecent(file, data.sessionTitle || path.basename(file, path.extname(file)));
  return { path: file, json: JSON.stringify(data), missing: { audio: audio.missing, sessionCall: call.missing } };
}

// ---- recent projects -----------------------------------------------------

export interface RecentProject {
  path: string;
  name: string;
  openedAt: string;
  exists: boolean;
}

const MAX_RECENTS = 8;
const recentsFile = () => path.join(app.getPath("userData"), "recent-projects.json");

async function loadRecents(): Promise<Omit<RecentProject, "exists">[]> {
  try {
    const list = JSON.parse(await fs.readFile(recentsFile(), "utf8"));
    return Array.isArray(list) ? list.filter((r) => r && typeof r.path === "string") : [];
  } catch {
    return [];
  }
}

async function saveRecents(list: Omit<RecentProject, "exists">[]) {
  await fs.mkdir(path.dirname(recentsFile()), { recursive: true });
  await fs.writeFile(recentsFile(), JSON.stringify(list, null, 1), "utf8");
}

async function rememberRecent(file: string, name: string) {
  const list = (await loadRecents()).filter((r) => r.path !== file);
  list.unshift({ path: file, name, openedAt: new Date().toISOString() });
  await saveRecents(list.slice(0, MAX_RECENTS));
  app.addRecentDocument(file);
}

export async function recentProjects(): Promise<RecentProject[]> {
  return Promise.all((await loadRecents()).map(async (r) => ({ ...r, exists: await exists(r.path) })));
}

export async function forgetRecent(file: string) {
  await saveRecents((await loadRecents()).filter((r) => r.path !== file));
}
