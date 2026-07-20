import { useState } from "react";
import type { Prefs } from "../types";

interface PreferencesModalProps {
  prefs: Prefs;
  onChange: (prefs: Prefs) => void;
  onClose: () => void;
}

type Tab = "audio" | "transcription" | "export" | "shortcuts";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "audio", label: "Audio", icon: "♪" },
  { id: "transcription", label: "Transcription", icon: "✎" },
  { id: "export", label: "Export", icon: "⧉" },
  { id: "shortcuts", label: "Shortcuts", icon: "⌘" }
];

/** Normalise a timecode field toward HH:MM:SS:FF; empty parts default to 0, hours clamp to 2 digits. */
function normalizeTc(raw: string): string {
  const parts = raw.split(/[:;]/).map((p) => p.replace(/\D/g, ""));
  while (parts.length < 4) parts.push("0");
  const clamp = (v: string, max: number) => String(Math.min(max, Math.max(0, Number(v) || 0))).padStart(2, "0");
  return `${(Number(parts[0]) || 0).toString().padStart(2, "0")}:${clamp(parts[1], 59)}:${clamp(parts[2], 59)}:${clamp(parts[3], 24)}`;
}

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <div
      onClick={onToggle}
      style={{
        width: 40,
        height: 22,
        flex: "none",
        position: "relative",
        borderRadius: "var(--radius-pill)",
        cursor: "pointer",
        transition: "var(--transition-all)",
        background: on ? "var(--primary)" : "var(--slate-300)"
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 2,
          left: on ? 20 : 2,
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: "#fff",
          boxShadow: "var(--shadow-field)",
          transition: "var(--transition-all)"
        }}
      />
    </div>
  );
}

function Checkbox({ on, onClick, indented }: { on: boolean; onClick: () => void; indented?: boolean }) {
  return (
    <span
      onClick={onClick}
      style={{
        width: 18,
        height: 18,
        flex: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "var(--radius-sm)",
        fontSize: 12,
        fontWeight: 700,
        transition: "var(--transition-all)",
        background: on ? "var(--primary)" : "var(--bg-surface)",
        border: `1px solid ${on ? "var(--primary)" : "var(--border-strong)"}`,
        color: on ? "#fff" : "transparent",
        marginLeft: indented ? 27 : 0
      }}
    >
      {on ? "✓" : ""}
    </span>
  );
}

function SectionDivider() {
  return <div style={{ height: 1, background: "var(--border-subtle)" }} />;
}

function Kbd({ children }: { children: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 22,
        height: 22,
        padding: "0 6px",
        fontFamily: "var(--font-mono)",
        fontSize: 11.5,
        fontWeight: 600,
        color: "var(--fg-strong)",
        background: "var(--bg-subtle)",
        border: "1px solid var(--border-strong)",
        borderBottom: "2px solid var(--border-strong)",
        borderRadius: "var(--radius-sm)"
      }}
    >
      {children}
    </span>
  );
}

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ["Space"], label: "Play / stop the focused take, or the timeline after clicking it" },
  { keys: ["⌘", "Scroll"], label: "Zoom the waveform in and out" },
  { keys: ["↑", "↓"], label: "Move focus in Takes / Variations" },
  { keys: ["F"], label: "Flag the focused take" },
  { keys: ["1", "2", "3"], label: "Rate the focused take" },
  { keys: ["S"], label: "Use this take" },
  { keys: ["T"], label: "Transcribe the master recording" },
  { keys: ["R"], label: "Toggle Script ↔ Transcript review" },
  { keys: ["A"], label: "Auto-detect takes" },
  { keys: ["B"], label: "Split at playhead" },
  { keys: ["⌘", "E"], label: "Export CSV + WAV" },
  { keys: ["⌘", "S"], label: "Save project" },
  { keys: ["⌘", "O"], label: "Open project" }
];

export default function PreferencesModal({ prefs, onChange, onClose }: PreferencesModalProps) {
  const [tab, setTab] = useState<Tab>("audio");
  const set = (patch: Partial<Prefs>) => onChange({ ...prefs, ...patch });

  return (
    <div
      onClick={onClose}
      style={{
        position: "absolute",
        inset: 0,
        background: "var(--mask-bg)",
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(620px, calc(100vw - 32px))",
          height: "min(560px, calc(100vh - 32px))",
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
            padding: "16px 20px",
            borderBottom: "1px solid var(--border-subtle)",
            flex: "none"
          }}
        >
          <span style={{ fontSize: 16, fontWeight: 600, color: "var(--fg-strong)" }}>Preferences</span>
          <button
            onClick={onClose}
            style={{
              width: 28,
              height: 28,
              border: "none",
              background: "transparent",
              color: "var(--fg-muted)",
              fontSize: 16,
              cursor: "pointer",
              borderRadius: "var(--radius-sm)",
              transition: "var(--transition-all)"
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
          {/* Side menu */}
          <div
            style={{
              width: 168,
              flex: "none",
              borderRight: "1px solid var(--border-subtle)",
              background: "var(--slate-50)",
              padding: "10px 8px",
              display: "flex",
              flexDirection: "column",
              gap: 2
            }}
          >
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  height: 34,
                  padding: "0 10px",
                  border: "none",
                  borderRadius: "var(--radius-md)",
                  fontFamily: "var(--font-sans)",
                  fontSize: 13,
                  fontWeight: 600,
                  textAlign: "left",
                  cursor: "pointer",
                  transition: "var(--transition-all)",
                  background: tab === t.id ? "var(--highlight-bg)" : "transparent",
                  color: tab === t.id ? "var(--highlight-fg)" : "var(--fg-muted)"
                }}
              >
                <span style={{ fontSize: 13, width: 16, textAlign: "center", flex: "none" }}>{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="cs-scroll" style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "18px 22px" }}>
            {tab === "audio" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                {/* Normalisation */}
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg-strong)" }}>Clip normalisation</div>
                    <Toggle on={prefs.norm} onToggle={() => set({ norm: !prefs.norm })} />
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: "8px 12px",
                      background: "var(--bg-subtle)",
                      borderRadius: "var(--radius-md)",
                      transition: "var(--transition-all)",
                      opacity: prefs.norm ? 1 : 0.45,
                      pointerEvents: prefs.norm ? "auto" : "none"
                    }}
                  >
                    <span style={{ fontSize: 12, fontWeight: 500, color: "var(--fg-default)" }}>Target loudness</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <input
                        type="number"
                        step={0.5}
                        min={-36}
                        max={-6}
                        value={prefs.lufs}
                        onChange={(e) => set({ lufs: +e.target.value })}
                        style={{
                          width: 84,
                          height: 32,
                          padding: "0 10px",
                          fontFamily: "var(--font-mono)",
                          fontSize: 13,
                          color: "var(--fg-strong)",
                          background: "var(--bg-surface)",
                          border: "1px solid var(--border-strong)",
                          borderRadius: "var(--radius-md)",
                          outline: "none"
                        }}
                      />
                      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--fg-muted)" }}>LUFS</span>
                    </div>
                  </div>
                </div>

                <SectionDivider />

                {/* Sample rate */}
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg-strong)" }}>Sample rate</div>
                  <label onClick={() => set({ conv: !prefs.conv })} style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer", width: "fit-content" }}>
                    <Checkbox on={prefs.conv} onClick={() => set({ conv: !prefs.conv })} />
                    <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--fg-default)" }}>Automatically convert sample rate</span>
                  </label>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: "8px 12px",
                      background: "var(--bg-subtle)",
                      borderRadius: "var(--radius-md)",
                      transition: "var(--transition-all)",
                      opacity: prefs.conv ? 1 : 0.45,
                      pointerEvents: prefs.conv ? "auto" : "none"
                    }}
                  >
                    <span style={{ fontSize: 12, fontWeight: 500, color: "var(--fg-default)" }}>Convert imports to</span>
                    <div style={{ display: "flex", gap: 0, border: "1px solid var(--border-strong)", borderRadius: "var(--radius-md)", overflow: "hidden", width: "fit-content", background: "var(--bg-surface)" }}>
                      {[44.1, 48, 96].map((r, i) => (
                        <button
                          key={r}
                          onClick={() => set({ rate: r })}
                          style={{
                            height: 30,
                            padding: "0 12px",
                            border: "none",
                            borderLeft: i > 0 ? "1px solid var(--border-strong)" : "none",
                            fontFamily: "var(--font-sans)",
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: "pointer",
                            transition: "var(--transition-all)",
                            background: prefs.rate === r ? "var(--highlight-bg)" : "var(--bg-surface)",
                            color: prefs.rate === r ? "var(--highlight-fg)" : "var(--fg-muted)"
                          }}
                        >
                          {r} kHz
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Bit depth */}
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg-strong)" }}>Bit depth</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <label onClick={() => set({ bitConv: !prefs.bitConv })} style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer", width: "fit-content" }}>
                      <Checkbox on={prefs.bitConv} onClick={() => set({ bitConv: !prefs.bitConv })} />
                      <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--fg-default)" }}>Automatically convert to 24-bit</span>
                    </label>
                    <label
                      onClick={() => set({ keep32: !prefs.keep32 })}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 9,
                        cursor: "pointer",
                        width: "fit-content",
                        transition: "var(--transition-all)",
                        opacity: prefs.bitConv ? 1 : 0.45,
                        pointerEvents: prefs.bitConv ? "auto" : "none"
                      }}
                    >
                      <Checkbox on={prefs.keep32} onClick={() => set({ keep32: !prefs.keep32 })} indented />
                      <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--fg-default)" }}>Keep 32-bit</span>
                    </label>
                  </div>
                </div>

                <SectionDivider />

                {/* Downmix */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg-strong)" }}>Downmix imports to mono</div>
                  <Toggle on={prefs.mono} onToggle={() => set({ mono: !prefs.mono })} />
                </div>
              </div>
            )}

            {tab === "transcription" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg-strong)" }}>Transcription engine</div>
                <div
                  style={{
                    display: "flex",
                    gap: 0,
                    border: "1px solid var(--border-strong)",
                    borderRadius: "var(--radius-md)",
                    overflow: "hidden",
                    width: "fit-content",
                    background: "var(--bg-surface)"
                  }}
                >
                  {(
                    [
                      ["local", "Local Whisper"],
                      ["cloud", "Cloud API"]
                    ] as const
                  ).map(([value, label], i) => (
                    <button
                      key={value}
                      onClick={() => set({ transcribe: value })}
                      style={{
                        height: 30,
                        padding: "0 12px",
                        border: "none",
                        borderLeft: i > 0 ? "1px solid var(--border-strong)" : "none",
                        fontFamily: "var(--font-sans)",
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: "pointer",
                        transition: "var(--transition-all)",
                        background: prefs.transcribe === value ? "var(--highlight-bg)" : "var(--bg-surface)",
                        color: prefs.transcribe === value ? "var(--highlight-fg)" : "var(--fg-muted)"
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--fg-muted)" }}>
                  {prefs.transcribe === "local"
                    ? "Runs on this machine — audio never leaves it. First run downloads the model (~300 MB, one-time)."
                    : "Sends session audio to the OpenAI transcription API."}
                </div>
                {prefs.transcribe === "cloud" && (
                  <input
                    type="password"
                    placeholder="OpenAI API key (sk-…)"
                    value={prefs.apiKey}
                    onChange={(e) => set({ apiKey: e.target.value })}
                    spellCheck={false}
                    style={{
                      width: "100%",
                      height: 32,
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
                )}
              </div>
            )}

            {tab === "export" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                {/* AAF timecode start */}
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg-strong)" }}>AAF timecode start</div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: "8px 12px",
                      background: "var(--bg-subtle)",
                      borderRadius: "var(--radius-md)"
                    }}
                  >
                    <span style={{ fontSize: 12, fontWeight: 500, color: "var(--fg-default)" }}>Session start (HH:MM:SS:FF)</span>
                    <input
                      value={prefs.tcStart}
                      onChange={(e) => set({ tcStart: e.target.value })}
                      onBlur={(e) => set({ tcStart: normalizeTc(e.target.value) })}
                      spellCheck={false}
                      placeholder="01:00:00:00"
                      style={{
                        width: 128,
                        height: 32,
                        padding: "0 10px",
                        fontFamily: "var(--font-mono)",
                        fontSize: 13,
                        textAlign: "center",
                        color: "var(--fg-strong)",
                        background: "var(--bg-surface)",
                        border: "1px solid var(--border-strong)",
                        borderRadius: "var(--radius-md)",
                        outline: "none"
                      }}
                    />
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--fg-muted)" }}>
                    Every episode AAF timeline begins here — at the script timecode, or strung out from this point when the script has no TC. 25 fps.
                  </div>
                </div>

                <SectionDivider />

                {/* Chronological gap */}
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg-strong)" }}>Chronological spacing</div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: "8px 12px",
                      background: "var(--bg-subtle)",
                      borderRadius: "var(--radius-md)"
                    }}
                  >
                    <span style={{ fontSize: 12, fontWeight: 500, color: "var(--fg-default)" }}>Gap between clips</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <input
                        type="number"
                        step={0.1}
                        min={0}
                        max={10}
                        value={prefs.chronoGap}
                        onChange={(e) => set({ chronoGap: Math.max(0, Math.min(10, +e.target.value)) })}
                        style={{
                          width: 84,
                          height: 32,
                          padding: "0 10px",
                          fontFamily: "var(--font-mono)",
                          fontSize: 13,
                          color: "var(--fg-strong)",
                          background: "var(--bg-surface)",
                          border: "1px solid var(--border-strong)",
                          borderRadius: "var(--radius-md)",
                          outline: "none"
                        }}
                      />
                      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--fg-muted)" }}>sec</span>
                    </div>
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--fg-muted)" }}>
                    Silence inserted between takes when a script has no timecode and clips are laid out in recording order.
                  </div>
                </div>

                <SectionDivider />

                {/* AAF audio bit depth */}
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg-strong)" }}>AAF embedded audio</div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: "8px 12px",
                      background: "var(--bg-subtle)",
                      borderRadius: "var(--radius-md)"
                    }}
                  >
                    <span style={{ fontSize: 12, fontWeight: 500, color: "var(--fg-default)" }}>Bit depth</span>
                    <div style={{ display: "flex", gap: 0, border: "1px solid var(--border-strong)", borderRadius: "var(--radius-md)", overflow: "hidden", width: "fit-content", background: "var(--bg-surface)" }}>
                      {([16, 24] as const).map((b, i) => (
                        <button
                          key={b}
                          onClick={() => set({ aafBits: b })}
                          style={{
                            height: 30,
                            padding: "0 14px",
                            border: "none",
                            borderLeft: i > 0 ? "1px solid var(--border-strong)" : "none",
                            fontFamily: "var(--font-sans)",
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: "pointer",
                            transition: "var(--transition-all)",
                            background: prefs.aafBits === b ? "var(--highlight-bg)" : "var(--bg-surface)",
                            color: prefs.aafBits === b ? "var(--highlight-fg)" : "var(--fg-muted)"
                          }}
                        >
                          {b}-bit
                        </button>
                      ))}
                    </div>
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--fg-muted)" }}>
                    Audio essence is embedded directly in the AAF so it opens without relinking. 24-bit preserves headroom; 16-bit halves the file size.
                  </div>
                </div>
              </div>
            )}

            {tab === "shortcuts" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {SHORTCUTS.map((s, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 16,
                      padding: "9px 4px",
                      borderBottom: i < SHORTCUTS.length - 1 ? "1px solid var(--border-subtle)" : "none"
                    }}
                  >
                    <span style={{ fontSize: 12.5, color: "var(--fg-default)" }}>{s.label}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, flex: "none" }}>
                      {s.keys.map((k, ki) => (
                        <Kbd key={ki}>{k}</Kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            padding: "14px 20px",
            borderTop: "1px solid var(--border-subtle)",
            background: "var(--slate-50)",
            flex: "none"
          }}
        >
          <button
            onClick={onClose}
            style={{
              height: 36,
              padding: "0 18px",
              background: "var(--primary)",
              color: "var(--primary-contrast)",
              border: "none",
              borderRadius: "var(--radius-md)",
              fontFamily: "var(--font-sans)",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              transition: "var(--transition-all)"
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
