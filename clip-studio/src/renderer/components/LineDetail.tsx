import type { CSSProperties } from "react";
import type { DirectorNote } from "../types";

interface LineDetailProps {
  text: string;
  note: string;
  dirNotes: DirectorNote[];
}

function tagStyle(tag: string): CSSProperties {
  if (tag.indexOf("Pick") === 0) {
    return { background: "var(--green-50)", color: "var(--green-700)", border: "1px solid var(--green-200)" };
  }
  if (tag.indexOf("Redundant") === 0) {
    return { background: "var(--orange-50)", color: "var(--orange-700)", border: "1px solid var(--orange-200)" };
  }
  return { background: "var(--purple-50)", color: "var(--purple-700)", border: "1px solid var(--purple-200)" };
}

export default function LineDetail({ text, note, dirNotes }: LineDetailProps) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: "var(--fg-strong)", lineHeight: 1.4 }}>{text}</div>
        {note && (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              marginTop: 8,
              padding: "3px 10px",
              background: "var(--purple-50)",
              border: "1px solid var(--purple-200)",
              borderRadius: "var(--radius-pill)"
            }}
          >
            <span style={{ fontSize: 11, color: "var(--purple-700)" }}>↳ direction</span>
            <span style={{ fontSize: 12, color: "var(--purple-700)", fontWeight: 500 }}>{note}</span>
          </div>
        )}
        {dirNotes.length > 0 && (
          <div
            style={{
              marginTop: 10,
              padding: "10px 12px",
              background: "var(--bg-surface)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--radius-md)",
              boxShadow: "var(--shadow-field)"
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                color: "var(--fg-muted)",
                marginBottom: 6
              }}
            >
              From session call
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {dirNotes.map((n, i) => (
                <div key={i} style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-muted)", flex: "none" }}>
                    {n.t}
                  </span>
                  <span style={{ fontSize: 12.5, color: "var(--fg-default)", flex: "1 1 160px", minWidth: 0, fontStyle: "italic" }}>
                    "{n.quote}"
                  </span>
                  <span
                    style={{
                      flex: "none",
                      whiteSpace: "nowrap",
                      fontSize: 10,
                      fontWeight: 600,
                      padding: "1px 7px",
                      borderRadius: "var(--radius-pill)",
                      ...tagStyle(n.tag)
                    }}
                  >
                    {n.tag}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
