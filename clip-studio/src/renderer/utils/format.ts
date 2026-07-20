import type { Scene } from "../types";

export function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 100);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(2, "0")}`;
}

export function filenameFor(
  pattern: string,
  characterName: string,
  scene: Scene,
  lineIndex: number,
  take: number | string
): string {
  // a string take is a pre-built token like "v01+02" (comp of takes 1 and 2)
  const takeToken = typeof take === "string" ? take : "v" + String(take).padStart(2, "0");
  // multi-character scripts: the line's own character wins over the session default
  const char = scene.lines[lineIndex]?.character || characterName;
  return (
    pattern
      .replace("{code}", scene.code)
      .replace("{char}", char)
      .replace("{line}", "L" + String(lineIndex + 1).padStart(2, "0"))
      .replace("{take}", takeToken) + ".wav"
  );
}
