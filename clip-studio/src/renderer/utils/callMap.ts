/**
 * Session-call contextual mapping (docs/session-call-pipeline.md, step D).
 *
 * Classifies call transcript segments as director instruction vs talent response,
 * then attaches the instruction block preceding each master take to that take.
 * All timestamps here are already on the master timeline — the offset map is
 * applied once, upstream, when the call transcript is produced.
 */

import type { CallSegment, Scene, Take, TranscriptSegment } from "../types";
import { textSimilarity } from "./takeDetect";

const RESPONSE_OVERLAP = 0.5; // fraction of a call segment inside master speech ⇒ talent bleed
const RESPONSE_ECHO = 0.6; // token-Dice vs the master transcript ⇒ same words = talent
const ECHO_NEAR_S = 3; // how far a master segment may sit from the call segment and still count
const LOOKBACK_S = 45; // cap so pre-session chatter doesn't become take 1's "direction"
const QUOTE_MAX = 160;

/** Fraction of [start, end] where the master speech mask is hot. */
function speechOverlap(seg: TranscriptSegment, mask: Uint8Array, rate: number): number {
  const a = Math.max(0, Math.floor(seg.start * rate));
  const b = Math.min(mask.length, Math.ceil(seg.end * rate));
  if (b <= a) return 0;
  let hot = 0;
  for (let i = a; i < b; i++) hot += mask[i];
  return hot / (b - a);
}

/**
 * Split the call transcript into instruction/response. Talent speech is identified by
 * coincidence with master speech on the aligned timeline, confirmed by text echo.
 */
export function classifyCallSegments(
  callTranscript: TranscriptSegment[],
  masterMask: { mask: Uint8Array; rate: number },
  masterTranscript: TranscriptSegment[]
): CallSegment[] {
  return callTranscript.map((s) => {
    const overlap = speechOverlap(s, masterMask.mask, masterMask.rate);
    let echo = 0;
    for (const m of masterTranscript) {
      if (m.end < s.start - ECHO_NEAR_S || m.start > s.end + ECHO_NEAR_S) continue;
      const sim = textSimilarity(s.text, m.text);
      if (sim > echo) echo = sim;
    }
    const kind = overlap > RESPONSE_OVERLAP || echo > RESPONSE_ECHO ? "response" : "instruction";
    return { ...s, kind };
  });
}

// --- lightweight semantic read of the director's words (heuristic; an LLM slots in here later) ---

const PICK_RES = [
  /that'?s the one/i,
  /\bwe got it\b/i,
  /\bgot it\b.*\bmov(e|ing) on\b/i,
  /\bperfect\b/i,
  /\blove (that|it)\b/i,
  /\bkeeper\b/i,
  /\bprint that\b/i
];
const REDUNDANT_RES = [/\balready have\b/i, /\bwe got that\b/i, /\bdon'?t need\b/i, /\bredundant\b/i, /\bskip (that|it)\b/i];
const TONE_WORDS: [RegExp, string][] = [
  [/\bfaster|quicker|pace it up|speed\b/i, "faster"],
  [/\bslower|slow (it )?down\b/i, "slower"],
  [/\bsofter|quieter|gentle|calm(er)?\b/i, "softer"],
  [/\blouder|project|bigger\b/i, "louder"],
  [/\bmore energy|energetic|excite|punchy\b/i, "more energy"],
  [/\baggressive|angrier|angry|tough(er)?\b/i, "aggressive"],
  [/\bhapp(y|ier)|cheer|smile|brighter\b/i, "happier"],
  [/\bsad(der)?|somber|down\b/i, "sadder"],
  [/\bwhisper|breathy\b/i, "whispered"],
  [/\bwalla|crowd|background\b/i, "walla"]
];

export interface DirectionInfo {
  quote: string;
  tone?: string;
  lineRef?: number;
}

/** Condense an instruction block: quote + tone tag + any "line N" callout. */
export function extractDirection(text: string): DirectionInfo | null {
  const quote = text.trim().replace(/\s+/g, " ");
  if (!quote) return null;
  const tone = TONE_WORDS.find(([re]) => re.test(quote))?.[1];
  const lineRef = quote.match(/\bline\s+(\d{1,3})\b/i)?.[1];
  return {
    quote: quote.length > QUOTE_MAX ? `${quote.slice(0, QUOTE_MAX - 1)}…` : quote,
    tone,
    lineRef: lineRef ? Number(lineRef) : undefined
  };
}

const isPick = (t: string) => PICK_RES.some((re) => re.test(t));
const isRedundant = (t: string) => REDUNDANT_RES.some((re) => re.test(t));

/**
 * Attach director context to takes. The call-and-response cycle bounds each take's
 * instruction window to the gap since the previous take ended; pick/redundant verdicts
 * in a gap refer to the take that just finished, not the next one.
 *
 * Mutates takes in place (scenes are a mutable object graph — see CLAUDE.md); the
 * caller bumps the render tick.
 */
export function applyInstructionMapping(scenes: Scene[], callSegments: CallSegment[]): number {
  const takes: Take[] = [];
  scenes.forEach((sc) =>
    sc.lines.forEach((ln) =>
      ln.takes.forEach((t) => {
        if (t.start !== undefined && t.end !== undefined) takes.push(t);
      })
    )
  );
  takes.sort((a, b) => a.start! - b.start!);
  const instructions = callSegments.filter((s) => s.kind === "instruction");

  let touched = 0;
  for (let i = 0; i < takes.length; i++) {
    const take = takes[i];
    const prevEnd = i > 0 ? takes[i - 1].end! : 0;
    const windowStart = Math.max(prevEnd, take.start! - LOOKBACK_S);
    const block = instructions.filter((s) => s.end > windowStart && s.end <= take.start!);
    if (block.length === 0) continue;

    const verdicts = block.filter((s) => isPick(s.text) || isRedundant(s.text));
    const direction = block.filter((s) => !verdicts.includes(s));

    // verdicts in the gap judge the take that just ended
    if (i > 0 && verdicts.length > 0) {
      const prev = takes[i - 1];
      const pick = verdicts.find((s) => isPick(s.text));
      if (pick) {
        prev.picked = true;
        prev.dirQuote = extractDirection(pick.text)?.quote ?? prev.dirQuote;
        touched++;
      } else if (verdicts.some((s) => isRedundant(s.text))) {
        prev.redundant = true;
        touched++;
      }
    }

    const info = extractDirection(direction.map((s) => s.text).join(" "));
    if (info && !take.picked) {
      take.dirQuote = info.tone ? `${info.tone} — ${info.quote}` : info.quote;
      touched++;
    }
  }

  // trailing verdict after the final take ("that's the one, we're done")
  if (takes.length > 0) {
    const last = takes[takes.length - 1];
    const after = instructions.filter((s) => s.start >= last.end! && s.start < last.end! + LOOKBACK_S);
    const pick = after.find((s) => isPick(s.text));
    if (pick) {
      last.picked = true;
      last.dirQuote = extractDirection(pick.text)?.quote ?? last.dirQuote;
      touched++;
    }
  }
  return touched;
}
