interface NamingExportPanelProps {
  pattern: string;
  onPatternChange: (pattern: string) => void;
  patternPreview: string;
  readyCount: number;
  reviewCount: number;
  totalTakes: number;
  /** timecode = script has a TC column (clips at TC); chronological = strung out in master order */
  aafMode: "timecode" | "chronological";
  onExport: () => void;
  onExportAaf: () => void;
}

const TOKENS = ["{code}", "{char}", "{line}", "{take}"];

export default function NamingExportPanel({
  pattern,
  onPatternChange,
  patternPreview,
  readyCount,
  reviewCount,
  totalTakes,
  aafMode,
  onExport,
  onExportAaf
}: NamingExportPanelProps) {
  return (
    <div style={{ flex: "none", borderTop: "1px solid var(--border-subtle)", padding: "14px 16px", background: "var(--slate-50)" }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--fg-muted)",
          marginBottom: 8
        }}
      >
        Naming pattern
      </div>
      <input
        value={pattern}
        onChange={(e) => onPatternChange(e.target.value)}
        spellCheck={false}
        style={{
          width: "100%",
          height: 34,
          padding: "0 10px",
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          color: "var(--fg-strong)",
          background: "var(--bg-surface)",
          border: "1px solid var(--border-strong)",
          borderRadius: "var(--radius-md)",
          outline: "none"
        }}
      />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 8 }}>
        {TOKENS.map((tok) => (
          <span
            key={tok}
            style={{
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              color: "var(--fg-muted)",
              background: "var(--bg-subtle)",
              padding: "2px 6px",
              borderRadius: "var(--radius-xs)"
            }}
          >
            {tok}
          </span>
        ))}
      </div>
      <div
        style={{
          marginTop: 10,
          padding: "8px 10px",
          background: "var(--bg-surface)",
          border: "1px dashed var(--border-strong)",
          borderRadius: "var(--radius-md)"
        }}
      >
        <span style={{ fontSize: 11, color: "var(--fg-muted)" }}>Preview</span>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--primary)", marginTop: 2, overflowWrap: "anywhere" }}>
          {patternPreview}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10, marginTop: 12 }}>
        <div style={{ flex: "1 1 130px" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg-strong)" }}>{readyCount} clips ready</div>
          <div style={{ fontSize: 11, color: "var(--fg-muted)" }}>
            {reviewCount} need review · {totalTakes} total takes
          </div>
        </div>
        <button
          onClick={onExport}
          style={{
            height: 38,
            padding: "0 16px",
            background: "var(--success)",
            color: "#fff",
            border: "none",
            borderRadius: "var(--radius-md)",
            fontFamily: "var(--font-sans)",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            flex: "none",
            whiteSpace: "nowrap"
          }}
        >
          Export CSV + WAV
        </button>
      </div>
      <button
        onClick={onExportAaf}
        title={
          aafMode === "timecode"
            ? "One .aaf per episode (asset code) at 25 fps — each character on their own track, selected takes placed at the script's timecode, audio embedded"
            : "One .aaf per episode (asset code) at 25 fps — no TC column in the script, so selected takes are strung out in recording order with small gaps, each character on their own track"
        }
        style={{
          width: "100%",
          marginTop: 8,
          height: 34,
          padding: "0 16px",
          background: "var(--bg-surface)",
          color: "var(--primary)",
          border: "1px solid var(--indigo-200)",
          borderRadius: "var(--radius-md)",
          fontFamily: "var(--font-sans)",
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
          whiteSpace: "nowrap"
        }}
      >
        ⧉ Export AAF per episode
        <span style={{ fontWeight: 500, color: "var(--fg-muted)" }}>
          {aafMode === "timecode" ? " · at script TC" : " · chronological"}
        </span>
      </button>
    </div>
  );
}
