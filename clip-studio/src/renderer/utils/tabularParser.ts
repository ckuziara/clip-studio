import * as XLSX from "xlsx";
import type { Scene } from "../types";
import { splitDirection, type ParsedScript } from "./scriptParser";

/** Minimal RFC-4180-ish CSV parser (quoted fields, escaped quotes, CRLF). */
export function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const COL_MATCHERS: Record<string, RegExp> = {
  code: /^(code|asset ?code|scene ?code|show ?code|asset ?id|ref|id)$/i,
  title: /^(title|scene|asset|asset ?name|scene ?name|episode( ?title)?|name)$/i,
  text: /^(line|lines|text|dialogue|dialog|script|line ?text)$|voice ?line|description/i,
  note: /^(note|notes|direction|directions|delivery|read|mood)$/i,
  character: /^(char|character|talent|artist|voice|speaker)$/i,
  type: /^(type|category|line ?type)$/i,
  tc: /^(tc|time ?code|start ?tc|tc ?in|time ?in|start ?time)$/i
};

const TC_FPS = 25;

/** Parse "HH:MM:SS:FF" (or "HH:MM:SS" / drop-frame ";") at 25 fps into seconds; null when not a timecode. */
export function parseTimecode(raw: string, fps = TC_FPS): number | null {
  const m = raw.trim().match(/^(\d{1,2})[:;](\d{1,2})[:;](\d{1,2})(?:[:;](\d{1,2}))?$/);
  if (!m) return null;
  const [, h, min, s, ff] = m;
  return Number(h) * 3600 + Number(min) * 60 + Number(s) + (ff ? Number(ff) / fps : 0);
}

function detectHeader(row: string[]): Partial<Record<keyof typeof COL_MATCHERS, number>> | null {
  const map: Partial<Record<string, number>> = {};
  row.forEach((cell, i) => {
    const v = cell.trim();
    for (const [key, re] of Object.entries(COL_MATCHERS)) {
      if (re.test(v) && map[key] === undefined) map[key] = i;
    }
  });
  // a real header must at least name the line-text column
  return map.text !== undefined ? map : null;
}

function slugCode(title: string): string {
  return title.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12) || "SCENE";
}

function baseName(filename: string): string {
  return filename.replace(/\.[^.]+$/, "");
}

/** Build a script from spreadsheet-style rows. */
export function rowsToScript(rawRows: string[][], filename: string): ParsedScript {
  const rows = rawRows
    .map((r) => r.map((c) => String(c ?? "").trim()))
    .filter((r) => r.some((c) => c !== ""));
  if (rows.length === 0) throw new Error("The file is empty.");

  let cols = detectHeader(rows[0]);
  let dataRows = rows;
  if (cols) {
    dataRows = rows.slice(1);
  } else {
    // no header — infer by column count: [code, title, text, note?] / [title, text] / [text]
    const width = Math.max(...rows.map((r) => r.length));
    cols =
      width >= 3
        ? { code: 0, title: 1, text: 2, note: 3 }
        : width === 2
        ? { title: 0, text: 1 }
        : { text: 0 };
  }

  const scenes: Scene[] = [];
  const charCounts = new Map<string, number>();
  let lastCode = "";
  let lastTitle = "";

  for (const row of dataRows) {
    const cell = (i?: number) => (i !== undefined && i < row.length ? row[i].trim() : "");
    const rawText = cell(cols.text);
    if (!rawText) continue;

    let code = cell(cols.code);
    let title = cell(cols.title);
    // carry forward blank code/title cells (merged-cell style sheets)
    if (!code && !title) {
      code = lastCode;
      title = lastTitle;
    }
    if (!title) title = code || baseName(filename);
    if (!code) code = slugCode(title);
    lastCode = code;
    lastTitle = title;

    // a "Type" column of Walla/Efforts/etc splits those rows into their own asset
    const rowType = cell(cols.type);
    if (rowType && !/^lines?$/i.test(rowType)) {
      title = `${title} (${rowType})`;
    }

    const noteCell = cell(cols.note);
    const { text, note } = noteCell ? { text: rawText, note: noteCell } : splitDirection(rawText);

    let scene = scenes.find((s) => s.code === code && s.title === title);
    if (!scene) {
      scene = { code, title, lines: [] };
      scenes.push(scene);
    }
    const ch = cell(cols.character);
    const tc = parseTimecode(cell(cols.tc)) ?? undefined;
    scene.lines.push({ text, note, takes: [], tc, character: ch || undefined });

    if (ch) charCounts.set(ch, (charCounts.get(ch) ?? 0) + 1);
  }

  if (scenes.length === 0) {
    throw new Error("Couldn't find any line text in this file — expected a column like “Line”, “Text” or “Dialogue”.");
  }

  const characterName =
    [...charCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
    baseName(filename).split(/[_\-\s]/)[0] ??
    "Character";

  return { sessionTitle: baseName(filename), characterName, scenes };
}

export async function parseScriptCsv(file: File): Promise<ParsedScript> {
  return rowsToScript(parseCsvText(await file.text()), file.name);
}

export async function parseScriptXlsx(file: File): Promise<ParsedScript> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error("The workbook has no sheets.");
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "" });
  return rowsToScript(rows, file.name);
}
