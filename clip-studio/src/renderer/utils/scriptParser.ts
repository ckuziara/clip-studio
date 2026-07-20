import "./uint8Polyfill"; // main-thread side (pdfjs calls .toBase64 / Uint8Array.fromBase64 here)
import * as pdfjsLib from "pdfjs-dist";
import PdfWorker from "./pdfWorker?worker";
import type { Scene } from "../types";

// A polyfilled worker instead of the bare bundled worker URL — the worker calls
// Uint8Array.prototype.toHex, which Electron 33's Chromium 130 lacks. workerPort
// overrides workerSrc, so pdfjs uses this instance.
pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker();

export interface ParsedScript {
  sessionTitle: string;
  characterName: string;
  scenes: Scene[];
}

interface TextRow {
  y: number;
  text: string;
}

/** Rebuild visual text rows from pdf.js text items (grouped by baseline y). */
async function extractRows(data: ArrayBuffer): Promise<string[]> {
  const doc = await pdfjsLib.getDocument({ data }).promise;
  const rows: string[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const byY = new Map<number, { x: number; str: string; w: number }[]>();

    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const y = Math.round(item.transform[5]);
      // merge rows whose baselines are within 2pt of each other
      let key = y;
      for (const existing of byY.keys()) {
        if (Math.abs(existing - y) <= 2) {
          key = existing;
          break;
        }
      }
      const arr = byY.get(key) ?? [];
      arr.push({ x: item.transform[4], str: item.str, w: item.width });
      byY.set(key, arr);
    }

    const pageRows: TextRow[] = [...byY.entries()].map(([y, items]) => {
      items.sort((a, b) => a.x - b.x);
      let text = "";
      let prevEnd = -Infinity;
      for (const it of items) {
        if (text && it.x - prevEnd > 1 && !text.endsWith(" ") && !it.str.startsWith(" ")) {
          text += " ";
        }
        text += it.str;
        prevEnd = it.x + it.w;
      }
      return { y, text: text.replace(/\s+/g, " ").trim() };
    });

    pageRows.sort((a, b) => b.y - a.y); // pdf y-axis points up
    rows.push(...pageRows.map((r) => r.text).filter(Boolean));
  }

  return rows;
}

const SECTION_RE = /^(lines|walla)\s*:$/i;
// "EMWW0109: Pink Mermaid" or "EMWW0110 Mermaid Club:" — code contains letters+digits
const CODED_SCENE_RE = /^([A-Z]{2,}[A-Z0-9]*\d[A-Z0-9]*)\s*:?\s+(.+?)\s*:?\s*$/;
// "Outro 2:" — codeless scene header
const PLAIN_SCENE_RE = /^([^-].*?)\s*:\s*$/;

function slugCode(title: string): string {
  return title.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12) || "SCENE";
}

/** Split a trailing " - direction note" off a line's text. */
export function splitDirection(raw: string): { text: string; note: string } {
  const idx = raw.lastIndexOf(" - ");
  if (idx > 0) {
    const note = raw.slice(idx + 3).trim();
    if (note.length > 0 && note.length <= 60 && /^[a-z(]/.test(note)) {
      return { text: raw.slice(0, idx).trim(), note };
    }
  }
  return { text: raw.trim(), note: "" };
}

/** Parse a script file by extension: PDF (text layout), CSV or XLSX/XLS (tabular). */
export async function parseScriptFile(file: File): Promise<ParsedScript> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "csv") {
    const { parseScriptCsv } = await import("./tabularParser");
    return parseScriptCsv(file);
  }
  if (ext === "xlsx" || ext === "xls") {
    const { parseScriptXlsx } = await import("./tabularParser");
    return parseScriptXlsx(file);
  }
  if (ext === "pdf") {
    return parseScriptPdf(await file.arrayBuffer());
  }
  throw new Error(`Unsupported script format ".${ext}" — use a PDF, CSV or XLSX file.`);
}

export async function parseScriptPdf(data: ArrayBuffer): Promise<ParsedScript> {
  const rows = await extractRows(data);
  if (rows.length === 0) throw new Error("No text found in this PDF.");

  const sessionTitle = rows[0];
  const characterName = sessionTitle.split(/\s+[-–—]\s+/)[0].trim() || "Character";

  const scenes: Scene[] = [];
  let section = "";
  let current: Scene | null = null;

  const pushScene = (code: string, title: string): Scene => {
    const isWalla = section.toLowerCase() === "walla" && title.toLowerCase() !== section.toLowerCase();
    const fullTitle = isWalla ? `${title} (Walla)` : title;
    const existing = scenes.find((s) => s.code === code && s.title === fullTitle);
    if (existing) return existing;
    const created: Scene = { code, title: fullTitle, lines: [] };
    scenes.push(created);
    return created;
  };

  for (const row of rows.slice(1)) {
    if (SECTION_RE.test(row)) {
      section = row.replace(/\s*:$/, "");
      current = null;
      continue;
    }

    if (row.startsWith("-")) {
      if (!current) current = pushScene(slugCode(section || "General"), section || "General");
      const { text, note } = splitDirection(row.replace(/^-\s*/, ""));
      current.lines.push({ text, note, takes: [] });
      continue;
    }

    const coded = row.match(CODED_SCENE_RE);
    if (coded) {
      current = pushScene(coded[1], coded[2]);
      continue;
    }

    const plain = row.match(PLAIN_SCENE_RE);
    if (plain) {
      current = pushScene(slugCode(plain[1]), plain[1]);
      continue;
    }

    // wrapped continuation of the previous bullet line
    if (current && current.lines.length > 0) {
      const last = current.lines[current.lines.length - 1];
      const { text, note } = splitDirection(`${last.text} ${row}`);
      last.text = text;
      if (note) last.note = note;
    }
  }

  const withLines = scenes.filter((s) => s.lines.length > 0);
  if (withLines.length === 0) {
    throw new Error("Couldn't find any scenes or lines in this PDF — is it a session script?");
  }

  return { sessionTitle, characterName, scenes: withLines };
}
