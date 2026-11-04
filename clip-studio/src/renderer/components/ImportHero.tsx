import { useEffect, useRef, useState } from "react";
import { getBridge, type RecentProject } from "../bridge";

interface ImportHeroProps {
  importBusy: string;
  importError: string;
  audioName: string;
  onImportScript: (file: File) => void;
  onImportAudio: (file: File) => void;
  /** Open a saved project — a recent one by path, or (no path) via the open dialog. */
  onOpenProject: (path?: string) => void;
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

function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export default function ImportHero({ importBusy, importError, audioName, onImportScript, onImportAudio, onOpenProject }: ImportHeroProps) {
  const [recents, setRecents] = useState<RecentProject[]>([]);
  useEffect(() => {
    getBridge()
      ?.recentProjects?.()
      .then(setRecents)
      .catch(() => setRecents([]));
  }, [importError]);

  async function forget(path: string) {
    await getBridge()?.forgetRecent?.(path);
    setRecents((r) => r.filter((x) => x.path !== path));
  }

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
      <button
        onClick={() => onOpenProject()}
        style={{
          marginTop: 4,
          height: 32,
          padding: "0 14px",
          background: "transparent",
          border: "none",
          fontFamily: "var(--font-sans)",
          fontSize: 13,
          fontWeight: 500,
          color: "var(--primary)",
          cursor: "pointer"
        }}
      >
        or open a saved project… (⌘O)
      </button>
      {recents.length > 0 && (
        <div style={{ width: "100%", maxWidth: 560, marginTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--fg-muted)", marginBottom: 8 }}>
            Recent projects
          </div>
          <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
            {recents.map((r, i) => (
              <div
                key={r.path}
                className="cs-recent"
                onClick={() => r.exists && !importBusy && onOpenProject(r.path)}
                title={r.exists ? r.path : `${r.path} — not found`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 14px",
                  borderTop: i ? "1px solid var(--border-subtle)" : "none",
                  cursor: r.exists ? "pointer" : "default",
                  opacity: r.exists ? 1 : 0.55
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg-strong)" }}>{r.name}</div>
                  <div
                    style={{
                      fontSize: 11,
                      fontFamily: "var(--font-mono)",
                      color: "var(--fg-muted)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      direction: "rtl",
                      textAlign: "left"
                    }}
                  >
                    {r.path}
                  </div>
                </div>
                <span style={{ fontSize: 12, flex: "none", color: r.exists ? "var(--fg-muted)" : "var(--red-600)" }}>
                  {r.exists ? ago(r.openedAt) : "Not found"}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void forget(r.path);
                  }}
                  title="Remove from recent projects"
                  style={{ width: 24, height: 24, flex: "none", border: "none", background: "transparent", color: "var(--fg-muted)", cursor: "pointer", fontSize: 12 }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
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
