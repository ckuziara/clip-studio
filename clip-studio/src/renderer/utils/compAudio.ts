import type { CompModel, Take } from "../types";

export interface CompSegmentSpec {
  /** slice of the master recording, in seconds */
  srcStart: number;
  srcEnd: number;
}

/**
 * Map each comp segment onto its source take's region in the master.
 * Segment si covers fraction [edges[si], edges[si+1]] of its take.
 * Returns null when any source take has no region (manually added takes).
 */
export function compSegments(takes: Take[], comp: CompModel): CompSegmentSpec[] | null {
  const edges = [0, ...comp.bounds.map((b) => b.pos), 1];
  const segs: CompSegmentSpec[] = [];
  for (let si = 0; si < comp.srcs.length; si++) {
    const t = takes[comp.srcs[si]];
    if (!t || t.start === undefined || t.end === undefined) return null;
    const dur = t.end - t.start;
    segs.push({ srcStart: t.start + edges[si] * dur, srcEnd: t.start + edges[si + 1] * dur });
  }
  return segs;
}

/** Crossfade length in seconds at each boundary (footer shows the same figure). */
export function fadeSeconds(comp: CompModel, refDur: number): number[] {
  return comp.bounds.map((b) => b.fade * 2 * refDur);
}

/**
 * Render the comp to a playable buffer: concatenated take slices with
 * equal-power (sin/cos) crossfades overlapping at each cut.
 */
export function renderComp(
  master: AudioBuffer,
  takes: Take[],
  comp: CompModel,
  refDur: number
): AudioBuffer | null {
  const segs = compSegments(takes, comp);
  if (!segs || segs.length === 0) return null;

  const sr = master.sampleRate;
  const nCh = master.numberOfChannels;
  const segLens = segs.map((s) => Math.max(1, Math.round((s.srcEnd - s.srcStart) * sr)));
  const fades = fadeSeconds(comp, refDur).map((f, i) =>
    Math.min(Math.round(f * sr), Math.floor(Math.min(segLens[i], segLens[i + 1]) * 0.9))
  );

  const total = segLens.reduce((a, b) => a + b, 0) - fades.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  const ctx = new OfflineAudioContext(nCh, total, sr);
  const out = ctx.createBuffer(nCh, total, sr);

  let cursor = 0;
  for (let si = 0; si < segs.length; si++) {
    const startSamp = Math.round(segs[si].srcStart * sr);
    const len = segLens[si];
    const fadeIn = si > 0 ? fades[si - 1] : 0;
    const fadeOut = si < segs.length - 1 ? fades[si] : 0;

    for (let ch = 0; ch < nCh; ch++) {
      const src = master.getChannelData(ch);
      const dst = out.getChannelData(ch);
      for (let k = 0; k < len; k++) {
        const srcIdx = startSamp + k;
        if (srcIdx < 0 || srcIdx >= src.length) continue;
        let gain = 1;
        if (fadeIn > 0 && k < fadeIn) gain *= Math.sin((Math.PI / 2) * (k / fadeIn));
        if (fadeOut > 0 && k >= len - fadeOut) gain *= Math.cos((Math.PI / 2) * ((k - (len - fadeOut)) / fadeOut));
        const dstIdx = cursor + k;
        if (dstIdx >= 0 && dstIdx < total) dst[dstIdx] += src[srcIdx] * gain;
      }
    }
    cursor += len - fadeOut;
  }
  return out;
}
