import { useEffect, useRef } from "react";
import { getMinMaxPeaks } from "../utils/waveformData";

interface WaveformCanvasProps {
  buffer: AudioBuffer;
  /** CSS color; var(--x) references are resolved against :root. */
  color: string;
  /** Vertical scale, 1 = full lane height. */
  gain?: number;
  /** Draw the faint horizontal centre line. */
  midline?: boolean;
}

function resolveColor(color: string): string {
  const m = color.match(/^var\((--[^)]+)\)$/);
  if (!m) return color;
  return getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() || "#94a3b8";
}

/** True min/max waveform render: one vertical column per device pixel. */
export default function WaveformCanvas({ buffer, color, gain = 1, midline = true }: WaveformCanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    let raf = 0;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const W = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const H = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== W) canvas.width = W;
      if (canvas.height !== H) canvas.height = H;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const { mins, maxs } = getMinMaxPeaks(buffer);
      const nBuckets = mins.length;
      const mid = H / 2;
      const amp = (H / 2 - 1 * dpr) * gain;
      const fill = resolveColor(color);

      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = fill;

      for (let x = 0; x < W; x++) {
        const b0 = Math.floor((x / W) * nBuckets);
        const b1 = Math.max(b0 + 1, Math.floor(((x + 1) / W) * nBuckets));
        let min = Infinity;
        let max = -Infinity;
        for (let b = b0; b < b1 && b < nBuckets; b++) {
          if (mins[b] < min) min = mins[b];
          if (maxs[b] > max) max = maxs[b];
        }
        if (min === Infinity) continue;
        const y0 = mid - max * amp;
        const y1 = mid - min * amp;
        ctx.fillRect(x, y0, 1, Math.max(dpr * 0.75, y1 - y0));
      }

      if (midline) {
        ctx.globalAlpha = 0.35;
        ctx.fillRect(0, mid - dpr / 2, W, dpr);
        ctx.globalAlpha = 1;
      }
    };

    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(draw);
    };
    schedule();
    const ro = new ResizeObserver(schedule);
    ro.observe(canvas);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [buffer, color, gain, midline]);

  return (
    <canvas
      ref={ref}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
    />
  );
}
