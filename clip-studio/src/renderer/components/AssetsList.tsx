import type { Line, Scene } from "../types";

interface AssetsListProps {
  scenes: Scene[];
  activeSceneIndex: number;
  /** All per-line characters found in the script (empty/1 entry = selector hidden). */
  characters: string[];
  activeCharacter: string | null;
  /** Line passes the active character filter. */
  lineVisible: (ln: Line) => boolean;
  onSelect: (index: number) => void;
  onSelectCharacter: (ch: string | null) => void;
}

export default function AssetsList({
  scenes,
  activeSceneIndex,
  characters,
  activeCharacter,
  lineVisible,
  onSelect,
  onSelectCharacter
}: AssetsListProps) {
  const isSceneDone = (scene: Scene) => scene.lines.filter(lineVisible).every((ln) => ln.takes.some((t) => t.status === "good"));
  // scenes the active character appears in, with their real indices
  const shown = scenes.map((sc, i) => ({ sc, i })).filter(({ sc }) => sc.lines.some(lineVisible));
  const doneScenes = shown.filter(({ sc }) => isSceneDone(sc)).length;

  return (
    <div
      className="cs-scroll"
      style={{
        width: "clamp(184px, 19vw, 250px)",
        flex: "none",
        background: "var(--bg-surface)",
        borderRight: "1px solid var(--border-subtle)",
        overflowY: "auto"
      }}
    >
      {characters.length > 1 && (
        <div style={{ padding: "12px 16px 0" }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "var(--fg-muted)",
              marginBottom: 6
            }}
          >
            Character
          </div>
          <select
            value={activeCharacter ?? ""}
            onChange={(e) => onSelectCharacter(e.target.value || null)}
            style={{
              width: "100%",
              height: 32,
              padding: "0 8px",
              fontFamily: "var(--font-sans)",
              fontSize: 13,
              fontWeight: 600,
              color: activeCharacter ? "var(--primary)" : "var(--fg-strong)",
              background: activeCharacter ? "var(--highlight-bg)" : "var(--bg-surface)",
              border: `1px solid ${activeCharacter ? "var(--indigo-200)" : "var(--border-strong)"}`,
              borderRadius: "var(--radius-md)",
              outline: "none",
              cursor: "pointer"
            }}
          >
            <option value="">All characters</option>
            {characters.map((ch) => (
              <option key={ch} value={ch}>
                {ch}
              </option>
            ))}
          </select>
        </div>
      )}
      <div style={{ padding: "14px 16px 8px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--fg-muted)"
          }}
        >
          Assets
        </span>
        <span style={{ fontSize: 11, color: "var(--fg-muted)" }}>
          {doneScenes}/{shown.length} done
        </span>
      </div>
      <div style={{ padding: "0 8px 16px" }}>
        {shown.map(({ sc, i }) => {
          const active = i === activeSceneIndex;
          const done = isSceneDone(sc);
          const visLines = sc.lines.filter(lineVisible);
          const doneLabel = `${visLines.filter((ln) => ln.takes.some((t) => t.status === "good")).length}/${visLines.length}`;
          return (
            <div
              key={`${sc.code}-${i}`}
              onClick={() => onSelect(i)}
              style={{
                padding: "8px 8px",
                borderRadius: "var(--radius-md)",
                cursor: "pointer",
                marginBottom: 2,
                transition: "var(--transition-all)",
                background: active ? "var(--highlight-bg)" : "transparent",
                boxShadow: active ? "inset 2px 0 0 var(--primary)" : "none"
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    width: 7,
                    height: 7,
                    flex: "none",
                    borderRadius: "50%",
                    background: done ? "var(--success)" : "var(--slate-300)"
                  }}
                />
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600, color: "var(--fg-strong)" }}>
                  {sc.code}
                </span>
                <span
                  style={{
                    marginLeft: "auto",
                    fontSize: 10,
                    fontFamily: "var(--font-mono)",
                    color: "var(--fg-muted)",
                    background: "var(--bg-subtle)",
                    padding: "1px 5px",
                    borderRadius: "var(--radius-xs)"
                  }}
                >
                  {doneLabel}
                </span>
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "var(--fg-muted)",
                  marginLeft: 16,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap"
                }}
              >
                {sc.title}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
