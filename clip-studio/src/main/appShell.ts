import { app, BrowserWindow, dialog, Menu, type MenuItemConstructorOptions } from "electron";
import { readFileSync, writeFileSync } from "node:fs";

// Window-level document behaviour: the File menu, the unsaved-changes prompt
// on close, and .clipstudio files opened from Finder/Dock or the command line.

export type MenuCommand =
  | { command: "open"; path?: string }
  | { command: "save" }
  | { command: "saveAs" }
  | { command: "saveAndClose" };

interface DocState {
  dirty: boolean;
  name: string;
  forceClose: boolean;
}

const states = new WeakMap<BrowserWindow, DocState>();
let pendingOpen: string | null = process.argv.find((a) => a.toLowerCase().endsWith(".clipstudio")) ?? null;

function stateOf(win: BrowserWindow): DocState {
  let s = states.get(win);
  if (!s) {
    s = { dirty: false, name: "Untitled", forceClose: false };
    states.set(win, s);
  }
  return s;
}

function send(win: BrowserWindow | null | undefined, cmd: MenuCommand) {
  const target = win ?? BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  target?.webContents.send("menu", cmd);
}

export function setDocumentState(win: BrowserWindow, next: { dirty: boolean; name: string; path?: string }) {
  const s = stateOf(win);
  s.dirty = next.dirty;
  s.name = next.name || "Untitled";
  if (process.platform === "darwin") {
    win.setDocumentEdited(next.dirty);
    win.setRepresentedFilename(next.path ?? "");
  }
}

export function closeWindow(win: BrowserWindow) {
  stateOf(win).forceClose = true;
  win.close();
}

/** Close button / ⌘W / ⌘Q with unsaved changes: Save / Don't Save / Cancel. */
export function guardClose(win: BrowserWindow) {
  win.on("close", (e) => {
    const s = stateOf(win);
    if (!s.dirty || s.forceClose) return;
    e.preventDefault();
    const test = nextTestAnswer();
    const choice = test
      ? Number(test.answer)
      : dialog.showMessageBoxSync(win, {
          type: "warning",
          buttons: ["Save", "Don't Save", "Cancel"],
          defaultId: 0,
          cancelId: 2,
          message: `Do you want to save the changes to “${s.name}”?`,
          detail: "Your changes will be lost if you don't save them."
        });
    if (choice === 0) send(win, { command: "saveAndClose" });
    else if (choice === 1) closeWindow(win);
  });
}

export function takePendingOpen(): string | null {
  const p = pendingOpen;
  pendingOpen = null;
  return p;
}

/** macOS: a .clipstudio double-clicked in Finder or picked from File › Open Recent. Register before "ready". */
export function handleOpenFile() {
  app.on("open-file", (e, file) => {
    e.preventDefault();
    const win = BrowserWindow.getAllWindows()[0];
    if (win && !win.webContents.isLoading()) send(win, { command: "open", path: file });
    else pendingOpen = file;
  });
}

export function installMenu() {
  const isMac = process.platform === "darwin";
  // Save/Open shortcuts are handled by the renderer's keyboard handler (it also works in the
  // browser build), so the menu shows them without registering them — no double trigger.
  const shown = { registerAccelerator: false } as const;
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" as const }] : []),
    {
      label: "File",
      submenu: [
        { label: "Open Project…", accelerator: "CmdOrCtrl+O", ...shown, click: () => send(null, { command: "open" }) },
        ...(isMac ? [{ role: "recentDocuments" as const, submenu: [{ role: "clearRecentDocuments" as const }] }] : []),
        { type: "separator" },
        { label: "Save Project", accelerator: "CmdOrCtrl+S", ...shown, click: () => send(null, { command: "save" }) },
        { label: "Save Project As…", accelerator: "CmdOrCtrl+Shift+S", ...shown, click: () => send(null, { command: "saveAs" }) },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" }
      ]
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/**
 * Automated UI tests can't click native dialogs. In development builds only,
 * CLIP_STUDIO_TEST_DIALOGS may point at a JSON file holding a queue of answers;
 * each dialog consumes the next one (a path, null for Cancel, or a button index).
 * With no file or an empty queue the real dialog is shown.
 */
export function nextTestAnswer(): { answer: string | number | null } | null {
  const file = process.env.CLIP_STUDIO_TEST_DIALOGS;
  if (app.isPackaged || !file) return null;
  try {
    const queue = JSON.parse(readFileSync(file, "utf8"));
    if (!Array.isArray(queue) || queue.length === 0) return null;
    const answer = queue.shift();
    writeFileSync(file, JSON.stringify(queue));
    return { answer };
  } catch {
    return null;
  }
}
