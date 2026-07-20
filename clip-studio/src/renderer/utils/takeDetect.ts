import type { Scene, TranscriptSegment } from "../types";

export interface Region {
  start: number;
  end: number;
}

const WINDOW_S = 0.02; // RMS window
const MIN_SILENCE_S = 0.45; // gap that separates takes
const MIN_TAKE_S = 0.4; // discard blips shorter than this
const PAD_S = 0.08; // breathing room around detected speech

/** Silence-based take detection: RMS scan with a threshold adaptive to the file's noise floor. */
export function detectRegions(buffer: AudioBuffer): Region[] {
  const data = buffer.getChannelData(0);
  const win = Math.max(1, Math.floor(buffer.sampleRate * WINDOW_S));
  const nWin = Math.floor(data.length / win);
  const rms = new Float32Array(nWin);
  for (let w = 0; w < nWin; w++) {
    let sum = 0;
    const off = w * win;
    for (let i = 0; i < win; i++) sum += data[off + i] * data[off + i];
    rms[w] = Math.sqrt(sum / win);
  }

  // threshold: between the noise floor (20th percentile) and speech level (90th)
  const sorted = [...rms].sort((a, b) => a - b);
  const floor = sorted[Math.floor(nWin * 0.2)] ?? 0;
  const speech = sorted[Math.floor(nWin * 0.9)] ?? 0;
  const threshold = Math.max(floor * 3, speech * 0.1, 1e-4);

  const regions: Region[] = [];
  const minGapWin = MIN_SILENCE_S / WINDOW_S;
  let start = -1;
  let lastLoud = -1;
  for (let w = 0; w < nWin; w++) {
    const loud = rms[w] > threshold;
    if (loud) {
      if (start < 0) start = w;
      lastLoud = w;
    } else if (start >= 0 && w - lastLoud > minGapWin) {
      regions.push({ start: start * WINDOW_S, end: (lastLoud + 1) * WINDOW_S });
      start = -1;
    }
  }
  if (start >= 0) regions.push({ start: start * WINDOW_S, end: (lastLoud + 1) * WINDOW_S });

  return regions
    .filter((r) => r.end - r.start >= MIN_TAKE_S)
    .map((r) => ({
      start: Math.max(0, r.start - PAD_S),
      end: Math.min(buffer.duration, r.end + PAD_S)
    }));
}

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s']/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1)
  );
}

/** Dice similarity between two texts' token sets. */
export function textSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let common = 0;
  ta.forEach((t) => {
    if (tb.has(t)) common++;
  });
  return (2 * common) / (ta.size + tb.size);
}

/** Concatenate transcript text overlapping [start, end]. */
export function transcriptForRegion(segments: TranscriptSegment[], region: Region): string {
  return segments
    .filter((s) => s.end > region.start && s.start < region.end)
    .map((s) => s.text)
    .join(" ")
    .trim();
}

export interface LineRef {
  sceneIndex: number;
  lineIndex: number;
}

const MATCH_THRESHOLD = 0.25;

export interface ScoredMatch extends LineRef {
  score: number;
}

/** Best-scoring script line for a piece of transcript text, with its similarity score. */
export function bestMatch(scenes: Scene[], text: string): ScoredMatch | null {
  if (!text) return null;
  let best: ScoredMatch | null = null;
  scenes.forEach((scene, si) =>
    scene.lines.forEach((line, li) => {
      const score = textSimilarity(line.text, text);
      if (score > (best?.score ?? 0)) {
        best = { sceneIndex: si, lineIndex: li, score };
      }
    })
  );
  return best;
}

/**
 * Find the script line best matching a region's transcript.
 * Returns null below the confidence threshold (caller falls back to sequential assignment).
 */
export function matchLine(scenes: Scene[], text: string): LineRef | null {
  const best = bestMatch(scenes, text);
  return best && best.score > MATCH_THRESHOLD ? best : null;
}
