/**
 * Session-call ↔ master alignment (docs/session-call-pipeline.md, step A).
 *
 * The talent's voice is on both tracks (isolated on the master, bleed in the call mix),
 * so cross-correlating loudness envelopes finds the time offset even though the call
 * contains other speakers. A single global offset is wrong by drift_ppm × t on long
 * calls, so short anchor windows re-correlate through the file and offsets interpolate
 * piecewise-linearly between them. Audio is never resampled — only timestamps translate.
 */

export const ENV_RATE = 50; // envelope samples/sec (20 ms hop)
const ANCHOR_EVERY = 60; // seconds between drift anchors
const ANCHOR_WIN = 30; // seconds correlated per anchor
const ANCHOR_SLOP = 2; // ± seconds searched around the predicted lag
const MIN_ANCHOR_CONF = 0.4; // normalized-correlation floor for a usable anchor
const MIN_GLOBAL_CONF = 0.3; // psr 6: the max of ~10⁵ noise samples reaches ~4.5σ by chance, real peaks are ≫

export interface AlignAnchor {
  /** master-timeline position (s) */
  t: number;
  /** call time − master time at t (s) */
  offset: number;
  confidence: number;
}

export interface OffsetMap {
  /** true when correlation was confident; false = identity fallback (lag 0) */
  aligned: boolean;
  confidence: number;
  anchors: AlignAnchor[];
  toCall(tMaster: number): number;
  toMaster(tCall: number): number;
}

/** RMS envelope of channel 0 at ENV_RATE samples/sec. */
export function envelope(buffer: AudioBuffer, rate = ENV_RATE): Float32Array {
  const data = buffer.getChannelData(0);
  const hop = Math.max(1, Math.round(buffer.sampleRate / rate));
  const n = Math.ceil(data.length / hop);
  const env = new Float32Array(n);
  for (let b = 0; b < n; b++) {
    const start = b * hop;
    const end = Math.min(data.length, start + hop);
    let sum = 0;
    for (let i = start; i < end; i++) sum += data[i] * data[i];
    env[b] = Math.sqrt(sum / Math.max(1, end - start));
  }
  return env;
}

// --- in-place iterative radix-2 complex FFT ---
function fft(re: Float64Array, im: Float64Array, invert: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((invert ? 1 : -1) * 2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const uRe = re[i + k];
        const uIm = im[i + k];
        const vRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const vIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k] = uRe + vRe;
        im[i + k] = uIm + vIm;
        re[i + k + len / 2] = uRe - vRe;
        im[i + k + len / 2] = uIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
  if (invert) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

/**
 * GCC-PHAT peak between two envelopes: returns the lag (in samples, callIdx − masterIdx)
 * that best aligns them, plus a peak-to-sidelobe confidence in [0, 1]-ish.
 */
function gccPhatPeak(master: Float32Array, call: Float32Array): { lag: number; confidence: number } {
  let size = 1;
  while (size < master.length + call.length) size <<= 1;
  const aRe = new Float64Array(size);
  const aIm = new Float64Array(size);
  const bRe = new Float64Array(size);
  const bIm = new Float64Array(size);
  // zero-mean so DC doesn't dominate the whitened spectrum
  const mean = (x: Float32Array) => x.reduce((s, v) => s + v, 0) / x.length;
  const mMean = mean(master);
  const cMean = mean(call);
  for (let i = 0; i < master.length; i++) aRe[i] = master[i] - mMean;
  for (let i = 0; i < call.length; i++) bRe[i] = call[i] - cMean;

  fft(aRe, aIm, false);
  fft(bRe, bIm, false);

  // cross-spectrum B × conj(A), PHAT-whitened
  for (let i = 0; i < size; i++) {
    const xRe = bRe[i] * aRe[i] + bIm[i] * aIm[i];
    const xIm = bIm[i] * aRe[i] - bRe[i] * aIm[i];
    const mag = Math.hypot(xRe, xIm) || 1e-12;
    bRe[i] = xRe / mag;
    bIm[i] = xIm / mag;
  }
  fft(bRe, bIm, true);

  // peak over circular lags; index > size/2 means negative lag
  let best = 0;
  let bestVal = -Infinity;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < size; i++) {
    const v = bRe[i];
    sum += v;
    sumSq += v * v;
    if (v > bestVal) {
      bestVal = v;
      best = i;
    }
  }
  const lag = best > size / 2 ? best - size : best;
  // peak-to-sidelobe ratio: length-independent, unlike peak/mean which grows with file size
  const avg = sum / size;
  const std = Math.sqrt(Math.max(0, sumSq / size - avg * avg));
  const psr = std > 0 ? (bestVal - avg) / std : 0;
  const confidence = Math.min(1, psr / 20); // psr ≥ 4 (conf 0.2) = a real correlation peak
  return { lag, confidence };
}

/** Pearson-normalized direct cross-correlation of a short window over a bounded lag range. */
function windowPeak(
  master: Float32Array,
  call: Float32Array,
  mStart: number,
  winLen: number,
  cCenter: number,
  slop: number
): { lag: number; confidence: number } | null {
  const mEnd = Math.min(master.length, mStart + winLen);
  const len = mEnd - mStart;
  if (len < winLen / 2) return null;

  let mMean = 0;
  for (let i = 0; i < len; i++) mMean += master[mStart + i];
  mMean /= len;
  let mNorm = 0;
  for (let i = 0; i < len; i++) mNorm += (master[mStart + i] - mMean) ** 2;
  mNorm = Math.sqrt(mNorm);
  if (mNorm < 1e-9) return null; // silent master window — junk peak territory

  let bestLag = 0;
  let bestR = -Infinity;
  for (let lag = -slop; lag <= slop; lag++) {
    const cStart = cCenter + lag;
    if (cStart < 0 || cStart + len > call.length) continue;
    let cMean = 0;
    for (let i = 0; i < len; i++) cMean += call[cStart + i];
    cMean /= len;
    let dot = 0;
    let cNorm = 0;
    for (let i = 0; i < len; i++) {
      const cv = call[cStart + i] - cMean;
      dot += (master[mStart + i] - mMean) * cv;
      cNorm += cv * cv;
    }
    cNorm = Math.sqrt(cNorm);
    if (cNorm < 1e-9) continue;
    const r = dot / (mNorm * cNorm);
    if (r > bestR) {
      bestR = r;
      bestLag = lag;
    }
  }
  if (bestR === -Infinity) return null;
  return { lag: bestLag, confidence: bestR };
}

function buildMap(aligned: boolean, confidence: number, anchors: AlignAnchor[]): OffsetMap {
  const pts = anchors.length > 0 ? anchors : [{ t: 0, offset: 0, confidence: 0 }];
  const offsetAt = (t: number): number => {
    if (t <= pts[0].t) return pts[0].offset;
    for (let i = 1; i < pts.length; i++) {
      if (t <= pts[i].t) {
        const a = pts[i - 1];
        const b = pts[i];
        const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
        return a.offset + f * (b.offset - a.offset);
      }
    }
    return pts[pts.length - 1].offset;
  };
  return {
    aligned,
    confidence,
    anchors,
    toCall: (t) => t + offsetAt(t),
    // offset varies by ppm — one fixed-point refinement is far below envelope resolution
    toMaster: (tc) => {
      const guess = tc - offsetAt(tc);
      return tc - offsetAt(guess);
    }
  };
}

/** Align the session call to the master. Cheap relative to transcription (envelopes + one FFT). */
export function computeOffsetMap(master: AudioBuffer, call: AudioBuffer): OffsetMap {
  const envM = envelope(master);
  const envC = envelope(call);

  const coarse = gccPhatPeak(envM, envC);
  if (coarse.confidence < MIN_GLOBAL_CONF) {
    return buildMap(false, coarse.confidence, []);
  }
  const lag0 = coarse.lag;

  const winLen = ANCHOR_WIN * ENV_RATE;
  const slop = ANCHOR_SLOP * ENV_RATE;
  const anchors: AlignAnchor[] = [];
  for (let t = 0; t + winLen <= envM.length; t += ANCHOR_EVERY * ENV_RATE) {
    const hit = windowPeak(envM, envC, t, winLen, t + lag0, slop);
    if (hit && hit.confidence >= MIN_ANCHOR_CONF) {
      anchors.push({
        t: (t + winLen / 2) / ENV_RATE,
        offset: (lag0 + hit.lag) / ENV_RATE,
        confidence: hit.confidence
      });
    }
  }

  if (anchors.length === 0) {
    // short file or sparse bleed: fall back to the single coarse offset
    anchors.push({ t: 0, offset: lag0 / ENV_RATE, confidence: coarse.confidence });
  }
  const median = anchors.map((a) => a.confidence).sort((a, b) => a - b)[Math.floor(anchors.length / 2)];
  return buildMap(true, median, anchors);
}

/** Boolean speech mask over the master envelope (adaptive threshold), for call-segment classification. */
export function speechMask(buffer: AudioBuffer): { mask: Uint8Array; rate: number } {
  const env = envelope(buffer);
  const sorted = Array.from(env).sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.1)];
  const loud = sorted[Math.floor(sorted.length * 0.9)];
  const thresh = floor + (loud - floor) * 0.25;
  const mask = new Uint8Array(env.length);
  for (let i = 0; i < env.length; i++) mask[i] = env[i] > thresh ? 1 : 0;
  return { mask, rate: ENV_RATE };
}
