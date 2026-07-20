import { useMemo } from "react";
import type { SourceAudio, Take } from "../types";
import { waveBars } from "../data/rng";
import { formatTime } from "../utils/format";

interface TakeCardProps {
  take: Take;
  filename: string;
  masterAudio: SourceAudio | null;
  focused?: boolean;
  onStarClick: (n: number) => void;
  onSelect: () => void;
  onFlag: () => void;
  onPlay?: () => void;
}

export default function TakeCard({ take: t, filename, masterAudio, focused, onStarClick, onSelect, onFlag, onPlay }: TakeCardProps) {
  const isGood = t.status === "good";
  const isReview = t.status === "review";
  const border = isGood ? "var(--green-500)" : isReview ? "var(--orange-500)" : "var(--border-subtle)";
  const leftBorder = isGood ? "var(--green-500)" : isReview ? "var(--orange-500)" : "var(--slate-300)";
  const barColor = isGood ? "var(--green-500)" : isReview ? "var(--orange-500)" : "var(--slate-400)";

  // real waveform: rendered peaks (saved comps), a master-region slice, or placeholder bars
  const mini = useMemo(() => {
    if (t.peaks && t.peaks.length > 0) {
      const bars: number[] = [];
      for (let i = 0; i < 38; i++) {
        const a = Math.floor((i * t.peaks.length) / 38);
        const b = Math.max(a + 1, Math.floor(((i + 1) * t.peaks.length) / 38));
        bars.push(Math.max(0.08, ...t.peaks.slice(a, b)));
      }
      return bars;
    }
    if (masterAudio && t.start !== undefined && t.end !== undefined && masterAudio.duration > 0) {
      const peaks = masterAudio.peaks;
      const from = Math.floor((t.start / masterAudio.duration) * peaks.length);
      const to = Math.max(from + 1, Math.ceil((t.end / masterAudio.duration) * peaks.length));
      const slice = peaks.slice(from, to);
      const bars: number[] = [];
      for (let i = 0; i < 38; i++) {
        const a = Math.floor((i * slice.length) / 38);
        const b = Math.max(a + 1, Math.floor(((i + 1) * slice.length) / 38));
        bars.push(Math.max(0.08, ...slice.slice(a, b)));
      }
      return bars;
    }
    return waveBars(38, t.seed);
  }, [masterAudio, t.start, t.end, t.seed, t.peaks]);

  const canPlay = onPlay !== undefined && (t.buffer !== undefined || (t.start !== undefined && t.end !== undefined && masterAudio !== null));

  const dirChip = t.picked
    ? `Director pick — "${t.dirQuote || "that's the one"}"`
    : t.redundant
    ? "Flagged redundant on session call"
    : t.dirQuote
    ? `Direction — "${t.dirQuote}"`
    : "";
  const isDirection = !t.picked && !t.redundant && !!t.dirQuote;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        padding: "10px 12px",
        background: "var(--bg-surface)",
        border: `1px solid ${border}`,
        borderLeft: `3px solid ${leftBorder}`,
        borderRadius: "var(--radius-md)",
        boxShadow: focused ? "var(--shadow-field), 0 0 0 2px var(--primary)" : "var(--shadow-field)",
        transition: "var(--transition-all)"
      }}
    >
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12, rowGap: 8 }}>
        <button
          onClick={canPlay ? onPlay : undefined}
          title={canPlay ? "Play this take" : "No region in the master recording yet"}
          style={{
            width: 34,
            height: 34,
            flex: "none",
            borderRadius: "50%",
            border: "1px solid var(--border-strong)",
            background: "var(--bg-surface)",
            color: canPlay ? "var(--primary)" : "var(--slate-300)",
            fontSize: 12,
            cursor: canPlay ? "pointer" : "default",
            display: "flex",
            alignItems: "center",
            justifyContent: "center"
          }}
        >
          ▶
        </button>
        <div style={{ flex: "1 1 90px", minWidth: 60, maxWidth: 150, height: 34, display: "flex", alignItems: "center", gap: 1.5, overflow: "hidden" }}>
          {mini.map((h, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                height: `${Math.max(12, h * 100).toFixed(0)}%`,
                minWidth: 1,
                borderRadius: 1,
                background: barColor
              }}
            />
          ))}
        </div>
        <div style={{ flex: "none", fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg-muted)", whiteSpace: "nowrap" }}>
          {formatTime(t.dur).slice(3)}
        </div>
        <div style={{ flex: "1 1 150px", minWidth: 130, display: "flex", flexDirection: "column", gap: 2 }}>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 13,
              fontWeight: 600,
              color: "var(--fg-strong)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap"
            }}
          >
            {filename}
          </span>
          <span
            style={{
              fontSize: 11,
              color: "var(--fg-muted)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap"
            }}
          >
            Take {t.take}
            {t.match !== undefined ? ` · ${Math.round(t.match * 100)}% match` : ""}
            {t.text ? ` · “${t.text}”` : ""}
          </span>
        </div>
        <div style={{ display: "flex", gap: 3, flex: "none", alignItems: "center" }} title="Score">
          {[1, 2, 3].map((n) => (
            <span
              key={n}
              onClick={() => onStarClick(n)}
              style={{
                fontSize: 17,
                lineHeight: 1,
                cursor: "pointer",
                userSelect: "none",
                transition: "var(--transition-all)",
                color: n <= (t.stars || 0) ? "var(--orange-500)" : "var(--slate-300)"
              }}
            >
              ★
            </span>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, flex: "none", marginLeft: "auto" }}>
          <button
            onClick={onSelect}
            style={{
              height: 30,
              padding: "0 12px",
              borderRadius: "var(--radius-md)",
              fontFamily: "var(--font-sans)",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              transition: "var(--transition-all)",
              border: `1px solid ${isGood ? "var(--green-500)" : "var(--border-strong)"}`,
              background: isGood ? "var(--green-500)" : "var(--bg-surface)",
              color: isGood ? "#fff" : "var(--fg-strong)",
              whiteSpace: "nowrap"
            }}
          >
            {isGood ? "✓ Selected" : "Use this"}
          </button>
          <button
            onClick={onFlag}
            style={{
              height: 30,
              padding: "0 12px",
              borderRadius: "var(--radius-md)",
              fontFamily: "var(--font-sans)",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              transition: "var(--transition-all)",
              border: `1px solid ${isReview ? "var(--orange-500)" : "var(--border-strong)"}`,
              background: isReview ? "var(--orange-50)" : "var(--bg-surface)",
              color: isReview ? "var(--orange-700)" : "var(--fg-muted)",
              whiteSpace: "nowrap"
            }}
          >
            {isReview ? "Reviewing" : "Flag"}
          </button>
        </div>
      </div>
      {dirChip && (
        <div style={{ marginTop: 8, marginLeft: 46 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              fontSize: 11,
              fontWeight: 500,
              padding: "2px 9px",
              borderRadius: "var(--radius-pill)",
              background: t.picked ? "var(--green-50)" : isDirection ? "var(--highlight-bg)" : "var(--orange-50)",
              color: t.picked ? "var(--green-700)" : isDirection ? "var(--primary)" : "var(--orange-700)",
              border: `1px solid ${t.picked ? "var(--green-200)" : isDirection ? "var(--indigo-200)" : "var(--orange-200)"}`
            }}
          >
            {dirChip}
          </span>
        </div>
      )}
    </div>
  );
}
