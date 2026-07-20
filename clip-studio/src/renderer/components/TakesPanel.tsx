import { useEffect, useRef } from "react";
import type { CompModel, Line, SourceAudio } from "../types";
import CompEditor from "./CompEditor";
import TakeCard from "./TakeCard";

interface TakesPanelProps {
  line: Line;
  compOpen: boolean;
  compFilename: string;
  rateHz: number;
  masterAudio: SourceAudio | null;
  focusedTakeIdx: number | null;
  /** Hide takes whose transcript↔script match is below this (0–1); 0 shows everything. */
  matchFilter: number;
  onMatchFilterChange: (v: number) => void;
  filenameFor: (take: number | string) => string;
  onToggleComp: () => void;
  onAddTake: () => void;
  onStarClick: (takeIdx: number, n: number) => void;
  onSelectTake: (takeIdx: number) => void;
  onFlagTake: (takeIdx: number) => void;
  onFocusTake: (takeIdx: number) => void;
  onCompChange: (comp: CompModel) => void;
  onPlayTake: (start: number, end: number) => void;
  onPlayBuffer: (buffer: AudioBuffer) => void;
  onSaveCompAsTake: () => void;
}

export default function TakesPanel({
  line,
  compOpen,
  compFilename,
  rateHz,
  masterAudio,
  focusedTakeIdx,
  matchFilter,
  onMatchFilterChange,
  filenameFor,
  onToggleComp,
  onAddTake,
  onStarClick,
  onSelectTake,
  onFlagTake,
  onFocusTake,
  onCompChange,
  onPlayTake,
  onPlayBuffer,
  onSaveCompAsTake
}: TakesPanelProps) {
  const cardRefs = useRef(new Map<number, HTMLDivElement>());

  useEffect(() => {
    if (focusedTakeIdx === null) return;
    cardRefs.current.get(focusedTakeIdx)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusedTakeIdx]);
  const selectedTakes = line.takes
    .map((take, index) => ({ take, index }))
    .filter((x) => x.take.status === "good");
  const canComp = selectedTakes.length > 1;
  const open = compOpen && canComp;

  // match filter: hide badly-matched suggestions; takes without a score (no transcript) always show
  const hasScores = line.takes.some((t) => t.match !== undefined);
  const indexed = line.takes.map((take, index) => ({ take, index }));
  const visible = indexed.filter(({ take }) => take.match === undefined || take.match >= matchFilter);
  const hiddenCount = indexed.length - visible.length;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            color: "var(--fg-muted)"
          }}
        >
          Takes / variations
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          {canComp && (
            <button
              onClick={onToggleComp}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                height: 30,
                padding: "0 12px",
                borderRadius: "var(--radius-md)",
                fontFamily: "var(--font-sans)",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                transition: "var(--transition-all)",
                background: open ? "var(--primary)" : "var(--bg-surface)",
                border: `1px solid ${open ? "var(--primary)" : "var(--border-strong)"}`,
                color: open ? "#fff" : "var(--fg-strong)"
              }}
            >
              {open ? "Close comp" : "Comp takes"}
            </button>
          )}
          {open ? (
            <button
              onClick={onSaveCompAsTake}
              title="Render Comp A and add it to this line as a new take"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                height: 30,
                padding: "0 12px",
                background: "var(--green-50)",
                border: "1px solid var(--green-200)",
                borderRadius: "var(--radius-md)",
                fontFamily: "var(--font-sans)",
                fontSize: 13,
                fontWeight: 600,
                color: "var(--green-700)",
                cursor: "pointer",
                transition: "var(--transition-all)"
              }}
            >
              + Save as take
            </button>
          ) : (
            <button
              onClick={onAddTake}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                height: 30,
                padding: "0 12px",
                background: "var(--highlight-bg)",
                border: "1px solid var(--indigo-200)",
                borderRadius: "var(--radius-md)",
                fontFamily: "var(--font-sans)",
                fontSize: 13,
                fontWeight: 600,
                color: "var(--primary)",
                cursor: "pointer"
              }}
            >
              + Add take
            </button>
          )}
        </div>
      </div>

      {hasScores && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 10,
            padding: "6px 10px",
            background: "var(--bg-subtle)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-md)"
          }}
        >
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--fg-muted)", whiteSpace: "nowrap" }}>
            Script match
          </span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(matchFilter * 100)}
            onChange={(e) => onMatchFilterChange(Number(e.target.value) / 100)}
            style={{ flex: 1, minWidth: 60, accentColor: "var(--primary)" }}
            title="Hide takes whose transcription matches the script line below this"
          />
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11.5,
              fontWeight: 600,
              color: "var(--fg-strong)",
              width: 44,
              textAlign: "right",
              whiteSpace: "nowrap"
            }}
          >
            ≥ {Math.round(matchFilter * 100)}%
          </span>
          {hiddenCount > 0 && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "var(--orange-700)",
                background: "var(--orange-50)",
                border: "1px solid var(--orange-200)",
                borderRadius: "var(--radius-pill)",
                padding: "1px 8px",
                whiteSpace: "nowrap"
              }}
            >
              {hiddenCount} hidden
            </span>
          )}
        </div>
      )}

      {open && (
        <CompEditor
          line={line}
          selectedTakes={selectedTakes}
          compFilename={compFilename}
          rateHz={rateHz}
          masterAudio={masterAudio}
          onCompChange={onCompChange}
          onPlayTake={onPlayTake}
        />
      )}

      {line.takes.length === 0 && (
        <div
          style={{
            padding: "22px 16px",
            border: "1px dashed var(--border-strong)",
            borderRadius: "var(--radius-md)",
            textAlign: "center",
            fontSize: 13,
            color: "var(--fg-muted)"
          }}
        >
          No takes yet — split the master recording at the playhead, or add a take manually.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {visible.map(({ take: t, index: i }, vi) => (
          <div
            key={i}
            ref={(el) => {
              if (el) cardRefs.current.set(i, el);
              else cardRefs.current.delete(i);
            }}
            onClick={() => onFocusTake(i)}
          >
            <TakeCard
              take={t}
              filename={filenameFor(t.label ?? vi + 1)} // named by visible order — hidden takes don't consume numbers
              masterAudio={masterAudio}
              focused={focusedTakeIdx === i}
              onStarClick={(n) => onStarClick(i, n)}
              onSelect={() => onSelectTake(i)}
              onFlag={() => onFlagTake(i)}
              onPlay={
                t.start !== undefined && t.end !== undefined
                  ? () => onPlayTake(t.start!, t.end!)
                  : t.buffer
                  ? () => onPlayBuffer(t.buffer!)
                  : undefined
              }
            />
          </div>
        ))}
      </div>
    </>
  );
}
