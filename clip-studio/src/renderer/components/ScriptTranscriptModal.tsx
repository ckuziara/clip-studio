import { useMemo } from "react";
import type { Scene, TranscriptSegment } from "../types";
import { bestMatch, type ScoredMatch } from "../utils/takeDetect";
import { formatTime } from "../utils/format";

interface ScriptTranscriptModalProps {
  scenes: Scene[];
  transcript: TranscriptSegment[];
  onSeek: (time: number) => void;
  onSelectLine: (sceneIndex: number, lineIndex: number) => void;
  onClose: () => void;
}

const GOOD = 0.5;
const OK = 0.25;

function scoreColor(score: number): { bg: string; border: string; fg: string } {
  if (score >= GOOD) return { bg: "var(--green-50)", border: "var(--green-200)", fg: "var(--green-700)" };
  if (score >= OK) return { bg: "var(--orange-50)", border: "var(--orange-200)", fg: "var(--orange-700)" };
  return { bg: "var(--bg-subtle)", border: "var(--border-subtle)", fg: "var(--fg-muted)" };
}

function PaneTitle({ children, count }: { children: string; count: number }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 16px",
        borderBottom: "1px solid var(--border-subtle)",
        flex: "none"
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--fg-muted)"
        }}
      >
        {children}
      </span>
      <span style={{ fontSize: 11, color: "var(--fg-muted)" }}>{count}</span>
    </div>
  );
}

export default function ScriptTranscriptModal({
  scenes,
  transcript,
  onSeek,
  onSelectLine,
  onClose
}: ScriptTranscriptModalProps) {
  // per-segment best line + per-line matched segments (inverse index)
  const segMatches = useMemo<(ScoredMatch | null)[]>(
    () => transcript.map((seg) => bestMatch(scenes, seg.text)),
    [scenes, transcript]
  );
  const lineSegs = useMemo(() => {
    const map = new Map<string, number[]>();
    segMatches.forEach((m, i) => {
      if (m && m.score >= OK) {
        const key = `${m.sceneIndex}:${m.lineIndex}`;
        map.set(key, [...(map.get(key) ?? []), i]);
      }
    });
    return map;
  }, [segMatches]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 60,
        padding: 16
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(1060px, calc(100vw - 32px))",
          height: "min(720px, calc(100vh - 32px))",
          background: "var(--bg-surface)",
          borderRadius: "var(--radius-xl)",
          boxShadow: "var(--shadow-modal)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden"
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "14px 20px",
            borderBottom: "1px solid var(--border-subtle)",
            flex: "none"
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--fg-strong)" }}>Script ↔ Transcript</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 11.5, color: "var(--fg-muted)" }}>
              <span style={{ color: "var(--green-700)" }}>●</span> strong match&ensp;
              <span style={{ color: "var(--orange-700)" }}>●</span> weak&ensp;
              <span style={{ color: "var(--fg-muted)" }}>●</span> none
            </span>
            <button
              onClick={onClose}
              style={{
                width: 28,
                height: 28,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "var(--bg-subtle)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-sm)",
                color: "var(--fg-muted)",
                fontSize: 13,
                cursor: "pointer"
              }}
            >
              ✕
            </button>
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
          {/* Script pane */}
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", borderRight: "1px solid var(--border-subtle)" }}>
            <PaneTitle count={scenes.reduce((n, s) => n + s.lines.length, 0)}>Imported script</PaneTitle>
            <div className="cs-scroll" style={{ flex: 1, overflowY: "auto", padding: "10px 16px 16px" }}>
              {scenes.map((scene, si) => (
                <div key={`${scene.code}-${si}`} style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "8px 0 6px" }}>
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 11,
                        fontWeight: 600,
                        color: "var(--primary)",
                        background: "var(--highlight-bg)",
                        padding: "2px 7px",
                        borderRadius: "var(--radius-sm)",
                        flex: "none"
                      }}
                    >
                      {scene.code}
                    </span>
                    <span
                      style={{
                        fontSize: 12.5,
                        fontWeight: 600,
                        color: "var(--fg-strong)",
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap"
                      }}
                    >
                      {scene.title}
                    </span>
                  </div>
                  {scene.lines.map((line, li) => {
                    const segIdxs = lineSegs.get(`${si}:${li}`) ?? [];
                    const matched = segIdxs.length > 0;
                    return (
                      <div
                        key={li}
                        onClick={() => onSelectLine(si, li)}
                        title="Open this line"
                        style={{
                          display: "flex",
                          alignItems: "baseline",
                          gap: 8,
                          padding: "5px 8px",
                          borderRadius: "var(--radius-sm)",
                          cursor: "pointer",
                          background: matched ? "var(--green-50)" : "transparent"
                        }}
                      >
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-muted)", flex: "none" }}>
                          L{String(li + 1).padStart(2, "0")}
                        </span>
                        <span style={{ fontSize: 12.5, color: "var(--fg-default)", minWidth: 0 }}>
                          {line.text}
                          {line.note && <span style={{ color: "var(--purple-600)", fontStyle: "italic" }}> — {line.note}</span>}
                        </span>
                        {matched && (
                          <span
                            style={{
                              marginLeft: "auto",
                              flex: "none",
                              fontFamily: "var(--font-mono)",
                              fontSize: 10.5,
                              color: "var(--green-700)"
                            }}
                          >
                            {segIdxs.map((i) => formatTime(transcript[i].start).slice(0, 5)).join(" · ")}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
              {scenes.length === 0 && (
                <div style={{ padding: 24, fontSize: 13, color: "var(--fg-muted)", textAlign: "center" }}>
                  No script imported yet.
                </div>
              )}
            </div>
          </div>

          {/* Transcript pane */}
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
            <PaneTitle count={transcript.length}>Transcript</PaneTitle>
            <div className="cs-scroll" style={{ flex: 1, overflowY: "auto", padding: "10px 16px 16px" }}>
              {transcript.map((seg, i) => {
                const m = segMatches[i];
                const colors = scoreColor(m?.score ?? 0);
                const matchedLine = m && m.score >= OK ? scenes[m.sceneIndex] : null;
                return (
                  <div
                    key={i}
                    onClick={() => onSeek(seg.start)}
                    title="Play from here"
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      padding: "7px 9px",
                      marginBottom: 6,
                      borderRadius: "var(--radius-md)",
                      border: `1px solid ${colors.border}`,
                      background: colors.bg,
                      cursor: "pointer"
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-muted)", flex: "none" }}>
                        ▶ {formatTime(seg.start).slice(0, 5)}–{formatTime(seg.end).slice(0, 5)}
                      </span>
                      <span
                        style={{
                          marginLeft: "auto",
                          flex: "none",
                          fontFamily: "var(--font-mono)",
                          fontSize: 10.5,
                          fontWeight: 600,
                          color: colors.fg
                        }}
                      >
                        {matchedLine && m
                          ? `${matchedLine.code} · L${String(m.lineIndex + 1).padStart(2, "0")} · ${Math.round(m.score * 100)}%`
                          : "no match"}
                      </span>
                    </div>
                    <span style={{ fontSize: 12.5, color: "var(--fg-default)" }}>{seg.text}</span>
                    {matchedLine && m && (
                      <span style={{ fontSize: 11.5, color: colors.fg, fontStyle: "italic" }}>
                        ↳ {scenes[m.sceneIndex].lines[m.lineIndex].text}
                      </span>
                    )}
                  </div>
                );
              })}
              {transcript.length === 0 && (
                <div style={{ padding: 24, fontSize: 13, color: "var(--fg-muted)", textAlign: "center" }}>
                  No transcript yet — run Transcribe on the master recording first.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
