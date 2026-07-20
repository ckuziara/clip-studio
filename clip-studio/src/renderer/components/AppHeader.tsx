import { useRef } from "react";
import type { SourceAudio } from "../types";
import { formatTime } from "../utils/format";

interface AppHeaderProps {
  totalLines: number;
  sceneCount: number;
  readyCount: number;
  scriptName: string;
  audio: SourceAudio | null;
  sessionCall: SourceAudio | null;
  importBusy: string;
  onImportScript: (file: File) => void;
  onImportAudio: (file: File) => void;
  onImportSessionCall: (file: File) => void;
  onOpenPrefs: () => void;
  onExport: () => void;
  onSaveProject: () => void;
  onOpenProject: () => void;
}

function SourceChip({
  icon,
  filename,
  meta,
  tint,
  accept,
  busy,
  onFile
}: {
  icon: string;
  filename: string;
  meta: string;
  tint?: "green" | "empty";
  accept: string;
  busy: boolean;
  onFile: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const isEmpty = tint === "empty";
  const bg = tint === "green" ? "var(--green-50)" : "var(--bg-subtle)";
  const border = tint === "green" ? "var(--green-200)" : "var(--border-subtle)";
  const metaColor = tint === "green" ? "var(--green-700)" : "var(--fg-muted)";
  return (
    <button
      onClick={() => inputRef.current?.click()}
      disabled={busy}
      title={isEmpty ? "Click to import" : `${filename} — click to replace`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 12px",
        minWidth: 0,
        background: bg,
        borderRadius: "var(--radius-md)",
        border: `1px ${isEmpty ? "dashed" : "solid"} ${isEmpty ? "var(--border-strong)" : border}`,
        cursor: busy ? "wait" : "pointer",
        fontFamily: "var(--font-sans)",
        textAlign: "left",
        transition: "var(--transition-all)"
      }}
    >
      <span style={{ fontSize: 14, lineHeight: 1, color: tint === "green" ? "var(--green-600)" : "var(--fg-muted)" }}>
        {icon}
      </span>
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: isEmpty ? "var(--fg-muted)" : "var(--fg-strong)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis"
          }}
        >
          {busy ? "Importing…" : filename}
        </span>
        <span style={{ fontSize: 11, color: metaColor, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {meta}
        </span>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </button>
  );
}

function audioMeta(a: SourceAudio): string {
  const rate = `${a.sampleRate / 1000} kHz`;
  const bits = a.bitDepth ? ` · ${a.bitDepth}-bit` : "";
  return `${rate}${bits} · ${formatTime(a.duration).slice(0, 5)}`;
}

export default function AppHeader({
  totalLines,
  sceneCount,
  readyCount,
  scriptName,
  audio,
  sessionCall,
  importBusy,
  onImportScript,
  onImportAudio,
  onImportSessionCall,
  onOpenPrefs,
  onExport,
  onSaveProject,
  onOpenProject
}: AppHeaderProps) {
  const iconBtn: React.CSSProperties = {
    width: 38,
    height: 38,
    flex: "none",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "var(--bg-surface)",
    border: "1px solid var(--border-strong)",
    borderRadius: "var(--radius-md)",
    color: "var(--fg-muted)",
    fontSize: 15,
    cursor: "pointer",
    transition: "var(--transition-all)"
  };
  return (
    <div
      style={{
        minHeight: 60,
        flex: "none",
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 12,
        rowGap: 8,
        padding: "8px 20px",
        background: "var(--bg-surface)",
        borderBottom: "1px solid var(--border-subtle)"
      }}
    >
      <span style={{ fontSize: 15, fontWeight: 600, color: "var(--fg-strong)", flex: "none", whiteSpace: "nowrap" }}>
        Clip Studio
      </span>
      <div style={{ flex: 1 }} />
      <SourceChip
        icon="♪"
        filename={audio ? audio.name : "Import master audio…"}
        meta={audio ? audioMeta(audio) : "WAV session recording"}
        tint={audio ? undefined : "empty"}
        accept="audio/*,.wav"
        busy={importBusy === "master"}
        onFile={onImportAudio}
      />
      <SourceChip
        icon="▤"
        filename={scriptName || "Import script…"}
        meta={scriptName ? `${totalLines} lines · ${sceneCount} assets` : "PDF, CSV or XLSX script"}
        tint={scriptName ? undefined : "empty"}
        accept=".pdf,.csv,.xlsx,.xls,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        busy={importBusy === "script"}
        onFile={onImportScript}
      />
      <SourceChip
        icon={sessionCall ? "✓" : "◎"}
        filename={sessionCall ? sessionCall.name : "Import session call…"}
        meta={sessionCall ? `Director track · ${audioMeta(sessionCall)}` : "Optional director track"}
        tint={sessionCall ? "green" : "empty"}
        accept="audio/*,.wav"
        busy={importBusy === "sessioncall"}
        onFile={onImportSessionCall}
      />
      <button onClick={onOpenProject} title="Open project… (⌘O)" style={iconBtn}>
        📂
      </button>
      <button onClick={onSaveProject} title="Save project (⌘S)" style={iconBtn}>
        💾
      </button>
      <button onClick={onOpenPrefs} title="Preferences" style={{ ...iconBtn, fontSize: 16 }}>
        ⚙
      </button>
      <button
        onClick={onExport}
        disabled={readyCount === 0}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          height: 38,
          padding: "0 18px",
          background: readyCount > 0 ? "var(--primary)" : "var(--slate-300)",
          color: "var(--primary-contrast)",
          border: "none",
          borderRadius: "var(--radius-md)",
          fontFamily: "var(--font-sans)",
          fontSize: 14,
          fontWeight: 600,
          cursor: readyCount > 0 ? "pointer" : "default",
          transition: "var(--transition-all)",
          flex: "none",
          whiteSpace: "nowrap"
        }}
      >
        <span style={{ fontSize: 14 }}>⭳</span> Export {readyCount} clips
      </button>
    </div>
  );
}
