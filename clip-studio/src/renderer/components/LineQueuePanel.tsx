import type { Line, Scene } from "../types";

interface LineQueuePanelProps {
  scene: Scene;
  activeLineIndex: number;
  /** Line passes the active character filter; hidden lines keep their numbers (no renumbering). */
  lineVisible: (ln: Line) => boolean;
  onSelectLine: (index: number) => void;
  filenameFor: (lineIndex: number, take: number) => string;
}

export default function LineQueuePanel({ scene, activeLineIndex, lineVisible, onSelectLine, filenameFor }: LineQueuePanelProps) {
  // keep original indices so line numbers and filenames stay stable across character filters
  const visibleLines = scene.lines.map((ln, i) => ({ ln, i })).filter(({ ln }) => lineVisible(ln));
  return (
    <div className="cs-scroll" style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
      <div
        style={{
          padding: "14px 16px 8px",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--fg-muted)"
        }}
      >
        Lines in this asset
      </div>
      <div style={{ padding: "0 10px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
        {visibleLines.map(({ ln, i }) => {
          const active = i === activeLineIndex;
          const good = ln.takes.some((t) => t.status === "good");
          const rev = ln.takes.some((t) => t.status === "review");
          const status = good ? "Ready" : rev ? "Review" : "Pending";
          const [bg, fg, bd] = good
            ? ["var(--green-50)", "var(--green-700)", "var(--green-200)"]
            : rev
            ? ["var(--orange-50)", "var(--orange-700)", "var(--orange-200)"]
            : ["var(--bg-subtle)", "var(--fg-muted)", "var(--border-subtle)"];
          const best = Math.max(...ln.takes.map((t) => t.stars || 0), 0);
          const takeSummary = `${ln.takes.length} take${ln.takes.length > 1 ? "s" : ""} · best ${"★".repeat(best)}${"☆".repeat(
            3 - best
          )} · ${filenameFor(i, 1)}`;

          return (
            <div
              key={i}
              onClick={() => onSelectLine(i)}
              style={{
                padding: "8px 8px",
                borderRadius: "var(--radius-md)",
                cursor: "pointer",
                transition: "var(--transition-all)",
                background: active ? "var(--highlight-bg)" : "transparent"
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    width: 20,
                    height: 20,
                    flex: "none",
                    borderRadius: "var(--radius-sm)",
                    background: "var(--bg-subtle)",
                    fontSize: 11,
                    fontWeight: 600,
                    color: "var(--fg-muted)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center"
                  }}
                >
                  {i + 1}
                </span>
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: 13,
                    color: "var(--fg-default)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap"
                  }}
                >
                  {ln.text}
                </span>
                <span
                  style={{
                    flex: "none",
                    fontSize: 10,
                    fontWeight: 600,
                    padding: "2px 7px",
                    borderRadius: "var(--radius-pill)",
                    background: bg,
                    color: fg,
                    border: `1px solid ${bd}`
                  }}
                >
                  {status}
                </span>
              </div>
              <div style={{ marginLeft: 28, marginTop: 3, fontSize: 11, color: "var(--fg-muted)" }}>{takeSummary}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
