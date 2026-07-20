import { useRef, useState } from "react";

interface ImportHeroProps {
  importBusy: string;
  importError: string;
  audioName: string;
  onImportScript: (file: File) => void;
  onImportAudio: (file: File) => void;
}

function ImportTile({
  icon,
  title,
  hint,
  accept,
  busy,
  done,
  onFile
}: {
  icon: string;
  title: string;
  hint: string;
  accept: string;
  busy: boolean;
  done: string;
  onFile: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  return (
    <button
      onClick={() => inputRef.current?.click()}
      disabled={busy}
      onDragOver={(e) => {
        e.preventDefault();
        if (!busy) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (busy) return;
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        width: 240,
        padding: "26px 20px",
        background: dragOver ? "var(--highlight-bg)" : done ? "var(--green-50)" : "var(--bg-surface)",
        border: `2px dashed ${dragOver ? "var(--primary)" : done ? "var(--green-500)" : "var(--border-strong)"}`,
        borderRadius: "var(--radius-lg)",
        cursor: busy ? "wait" : "pointer",
        fontFamily: "var(--font-sans)",
        transition: "var(--transition-all)"
      }}
    >
      <span style={{ fontSize: 28, lineHeight: 1 }}>{done ? "✓" : icon}</span>
      <span style={{ fontSize: 14, fontWeight: 600, color: "var(--fg-strong)" }}>
        {busy ? "Importing…" : dragOver ? "Drop to import" : title}
      </span>
      <span
        style={{
          fontSize: 12,
          color: done ? "var(--green-700)" : "var(--fg-muted)",
          maxWidth: "100%",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap"
        }}
      >
        {done || hint}
      </span>
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

export default function ImportHero({ importBusy, importError, audioName, onImportScript, onImportAudio }: ImportHeroProps) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 320,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        padding: 32
      }}
    >
      <div style={{ fontSize: 22, fontWeight: 600, color: "var(--fg-strong)" }}>Start a session</div>
      <div style={{ fontSize: 13, color: "var(--fg-muted)", textAlign: "center", maxWidth: 420 }}>
        Import the session script to build the asset and line list, and the master recording to work with real audio.
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 16, marginTop: 16 }}>
        <ImportTile
          icon="▤"
          title="Import script"
          hint="PDF, CSV or XLSX — scenes, lines & direction"
          accept=".pdf,.csv,.xlsx,.xls,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          busy={importBusy === "script"}
          done=""
          onFile={onImportScript}
        />
        <ImportTile
          icon="♪"
          title="Import master audio"
          hint="WAV session recording"
          accept="audio/*,.wav"
          busy={importBusy === "master"}
          done={audioName}
          onFile={onImportAudio}
        />
      </div>
      {importError && (
        <div
          style={{
            marginTop: 8,
            padding: "8px 14px",
            background: "var(--orange-50)",
            border: "1px solid var(--orange-200)",
            borderRadius: "var(--radius-md)",
            color: "var(--orange-700)",
            fontSize: 13,
            maxWidth: 480
          }}
        >
          {importError}
        </div>
      )}
    </div>
  );
}
