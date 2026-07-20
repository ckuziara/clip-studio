import { useEffect, useRef } from "react";
import type { CallSegment, SourceAudio, TakeStatus } from "../types";
import { formatTime } from "../utils/format";
import WaveformCanvas from "./WaveformCanvas";

export interface WaveRegion {
  start: number;
  end: number;
  label: string;
  status: TakeStatus;
}

interface WaveformCardProps {
  audio: SourceAudio | null;
  sessionCall: SourceAudio | null;
  playing: boolean;
  currentTime: number;
  zoom: number;
  regions: WaveRegion[];
  /** Classified call transcript on the master timeline; null before analysis. */
  callSegments: CallSegment[] | null;
  /** false = correlation failed (call drawn at lag 0); null before analysis. */
  callAligned: boolean | null;
  transcribeState: { busy: boolean; label: string; fraction: number | null };
  hasTranscript: boolean;
  onTranscribe: () => void;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  onSplit: () => void;
  onAutoDetect: () => void;
  onZoomChange: (zoom: number) => void;
  onImportAudio: (file: File) => void;
  onOpenReview: () => void;
}

const REGION_COLOR: Record<TakeStatus, string> = {
  good: "var(--success)",
  review: "var(--warn)",
  alt: "var(--primary)"
};

export default function WaveformCard({
  audio,
  sessionCall,
  playing,
  currentTime,
  zoom,
  regions,
  callSegments,
  callAligned,
  transcribeState,
  hasTranscript,
  onTranscribe,
  onTogglePlay,
  onSeek,
  onSplit,
  onAutoDetect,
  onZoomChange,
  onImportAudio,
  onOpenReview
}: WaveformCardProps) {
  const laneRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const playheadPct = audio && audio.duration > 0 ? (currentTime / audio.duration) * 100 : 0;

  function seekFromClick(e: React.MouseEvent) {
    if (!audio || !laneRef.current) return;
    const rect = laneRef.current.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(frac * audio.duration);
  }

  // zoom anchors on the red playhead: keep it centred in the viewport when the level changes
  const prevZoomRef = useRef(zoom);
  useEffect(() => {
    if (prevZoomRef.current === zoom) return;
    prevZoomRef.current = zoom;
    const scroller = scrollRef.current;
    const lane = laneRef.current;
    if (!scroller || !lane) return;
    const x = (playheadPct / 100) * lane.clientWidth; // lane already has the new zoomed width here
    scroller.scrollLeft = Math.max(0, x - scroller.clientWidth / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  // keep the playhead in view while playing at zoom > 1
  useEffect(() => {
    const scroller = scrollRef.current;
    const lane = laneRef.current;
    if (!playing || !scroller || !lane || zoom <= 1) return;
    const x = (playheadPct / 100) * lane.clientWidth;
    if (x < scroller.scrollLeft + 40 || x > scroller.scrollLeft + scroller.clientWidth - 40) {
      scroller.scrollLeft = Math.max(0, x - scroller.clientWidth * 0.3);
    }
  }, [playheadPct, playing, zoom]);

  // Cmd/Ctrl+Scroll to zoom — attached natively (not React's onWheel) because React
  // marks wheel listeners passive by default, which silently ignores preventDefault().
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      if (!audio || (!e.metaKey && !e.ctrlKey)) return;
      e.preventDefault();
      const dir = e.deltaY < 0 ? 1 : -1;
      onZoomChange(Math.max(1, Math.min(16, zoom + dir)));
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [audio, zoom, onZoomChange]);

  return (
    <div
      ref={cardRef}
      style={{
        margin: "0 22px",
        flex: "none",
        background: "var(--bg-surface)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-field)",
        overflow: "hidden"
      }}
    >
      <div style={{ position: "relative", padding: "12px 16px 10px" }}>
        {!audio ? (
          <div
            style={{
              height: sessionCall ? 92 : 92 + 52,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 8
            }}
          >
            <span style={{ fontSize: 13, color: "var(--fg-muted)" }}>No master audio loaded</span>
            <button
              onClick={() => inputRef.current?.click()}
              style={{
                height: 30,
                padding: "0 14px",
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
              ♪ Import master audio…
            </button>
            <input
              ref={inputRef}
              type="file"
              accept="audio/*,.wav"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onImportAudio(f);
                e.target.value = "";
              }}
            />
          </div>
        ) : (
          <div
            ref={scrollRef}
            className="cs-scroll"
            style={{ overflowX: zoom > 1 ? "auto" : "hidden", overflowY: "hidden", position: "relative" }}
          >
            {/* zoomed inner timeline — master + session lanes scroll together */}
            <div style={{ width: `${zoom * 100}%`, minWidth: "100%" }}>
              <div ref={laneRef} onClick={seekFromClick} style={{ position: "relative", height: 92, cursor: "text" }}>
                <WaveformCanvas buffer={audio.buffer} color="var(--slate-400)" />
                {audio.duration > 0 &&
                  regions.map((r, i) => (
                    <div
                      key={i}
                      style={{
                        position: "absolute",
                        top: 2,
                        bottom: 2,
                        left: `${(r.start / audio.duration) * 100}%`,
                        width: `${(Math.max(0.01, r.end - r.start) / audio.duration) * 100}%`,
                        background: `color-mix(in srgb, ${REGION_COLOR[r.status]} 12%, transparent)`,
                        border: `1px solid ${REGION_COLOR[r.status]}`,
                        borderRadius: 4,
                        pointerEvents: "none"
                      }}
                    >
                      <span
                        style={{
                          position: "absolute",
                          top: -1,
                          left: 4,
                          fontFamily: "var(--font-mono)",
                          fontSize: 10,
                          fontWeight: 600,
                          color: REGION_COLOR[r.status]
                        }}
                      >
                        {r.label}
                      </span>
                    </div>
                  ))}
                <div
                  style={{
                    position: "absolute",
                    top: 2,
                    bottom: 2,
                    left: `${playheadPct}%`,
                    width: 2,
                    background: "var(--red-500)",
                    boxShadow: "0 0 0 2px rgba(239,68,68,.15)",
                    zIndex: 3,
                    pointerEvents: "none"
                  }}
                />
              </div>

              {sessionCall && (
                <div
                  style={{
                    position: "relative",
                    height: 44,
                    marginTop: 8,
                    borderTop: "1px dashed var(--border-subtle)"
                  }}
                >
                  {/* time-proportional: 1s of call spans the same width as 1s of master; a longer call clips at the master's end (until alignment lands) */}
                  <div style={{ position: "absolute", inset: "6px 0 0 0", opacity: 0.9, overflow: "hidden" }}>
                    <div
                      style={{
                        position: "relative", // WaveformCanvas fills its nearest positioned ancestor
                        width: `${audio.duration > 0 ? (sessionCall.duration / audio.duration) * 100 : 100}%`,
                        height: "100%"
                      }}
                    >
                      <WaveformCanvas buffer={sessionCall.buffer} color="var(--purple-300)" gain={0.8} midline={false} />
                    </div>
                  </div>
                  {/* classified call segments: blue = director instruction, green = talent response bleed */}
                  {audio.duration > 0 &&
                    callSegments?.map((s, i) => {
                      const instruction = s.kind === "instruction";
                      const color = instruction ? "var(--primary)" : "var(--success)";
                      return (
                        <div
                          key={i}
                          title={`${instruction ? "Direction" : "Take"}: ${s.text}`}
                          onClick={(e) => {
                            e.stopPropagation(); // don't double-seek through the lane's own handler
                            onSeek(Math.max(0, s.start));
                          }}
                          style={{
                            position: "absolute",
                            top: 4,
                            bottom: 2,
                            left: `${(Math.max(0, s.start) / audio.duration) * 100}%`,
                            width: `${((Math.min(audio.duration, s.end) - Math.max(0, s.start)) / audio.duration) * 100}%`,
                            background: `color-mix(in srgb, ${color} 14%, transparent)`,
                            borderLeft: `2px solid ${color}`,
                            borderRadius: 3,
                            cursor: "pointer",
                            zIndex: 2
                          }}
                        />
                      );
                    })}
                  {/* playhead continues through the director lane */}
                  <div
                    style={{
                      position: "absolute",
                      top: 0,
                      bottom: 0,
                      left: `${playheadPct}%`,
                      width: 2,
                      background: "var(--red-500)",
                      opacity: 0.4,
                      pointerEvents: "none"
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {audio && sessionCall && (
          <span
            style={{
              position: "absolute",
              left: 16,
              bottom: 38,
              zIndex: 2,
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              color: "var(--purple-600)",
              background: "color-mix(in srgb, var(--bg-surface) 80%, transparent)",
              padding: "1px 5px",
              borderRadius: 3,
              whiteSpace: "nowrap",
              pointerEvents: "none"
            }}
          >
            Session call
            {callAligned === false && (
              <span style={{ marginLeft: 6, color: "var(--orange-700)" }} title="The call didn't correlate with the master — shown from its own start (no offset applied)">
                · unaligned
              </span>
            )}
          </span>
        )}
      </div>

      {/* Transport */}
      <div
        style={{
          minHeight: 52,
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 10,
          rowGap: 8,
          padding: "8px 16px",
          borderTop: "1px solid var(--border-subtle)",
          background: "var(--slate-50)"
        }}
      >
        <button
          onClick={onTogglePlay}
          disabled={!audio}
          style={{
            width: 36,
            height: 36,
            borderRadius: "50%",
            border: "none",
            background: audio ? "var(--primary)" : "var(--slate-300)",
            color: "#fff",
            fontSize: 14,
            cursor: audio ? "pointer" : "default",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "var(--transition-all)"
          }}
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--fg-strong)", whiteSpace: "nowrap", flex: "none" }}>
          {formatTime(currentTime)} / {audio ? formatTime(audio.duration) : "--:--.--"}
        </span>
        <div style={{ width: 1, height: 24, background: "var(--border-subtle)" }} />
        <button
          onClick={onSplit}
          disabled={!audio}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            height: 32,
            padding: "0 12px",
            background: "var(--bg-surface)",
            border: "1px solid var(--border-strong)",
            borderRadius: "var(--radius-md)",
            fontFamily: "var(--font-sans)",
            fontSize: 13,
            fontWeight: 500,
            color: audio ? "var(--fg-strong)" : "var(--fg-muted)",
            cursor: audio ? "pointer" : "default",
            transition: "var(--transition-all)",
            flex: "none",
            whiteSpace: "nowrap"
          }}
        >
          <span style={{ color: "var(--primary)" }}>✂</span> Split at playhead
        </button>
        <button
          onClick={onAutoDetect}
          disabled={!audio}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            height: 32,
            padding: "0 12px",
            background: "var(--bg-surface)",
            border: "1px solid var(--border-strong)",
            borderRadius: "var(--radius-md)",
            fontFamily: "var(--font-sans)",
            fontSize: 13,
            fontWeight: 500,
            color: audio ? "var(--fg-strong)" : "var(--fg-muted)",
            cursor: audio ? "pointer" : "default",
            transition: "var(--transition-all)",
            flex: "none",
            whiteSpace: "nowrap"
          }}
        >
          <span style={{ color: "var(--primary)" }}>⋈</span> Auto-detect takes
        </button>
        <button
          onClick={onTranscribe}
          disabled={!audio || transcribeState.busy}
          title={
            transcribeState.busy
              ? transcribeState.label
              : hasTranscript
              ? "Re-run transcription"
              : "Transcribe the master recording for automatic line matching"
          }
          style={{
            position: "relative",
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            gap: 6,
            height: 32,
            padding: "0 12px",
            minWidth: transcribeState.busy ? 220 : undefined, // room for the stage label while progressing
            background: hasTranscript ? "var(--green-50)" : "var(--bg-surface)",
            border: `1px solid ${hasTranscript ? "var(--green-200)" : "var(--border-strong)"}`,
            borderRadius: "var(--radius-md)",
            fontFamily: "var(--font-sans)",
            fontSize: 13,
            fontWeight: 500,
            color: !audio ? "var(--fg-muted)" : hasTranscript ? "var(--green-700)" : "var(--fg-strong)",
            cursor: audio && !transcribeState.busy ? "pointer" : "default",
            transition: "var(--transition-all)",
            flex: "none",
            whiteSpace: "nowrap"
          }}
        >
          {/* progress fill behind the label: determinate width when a % is known, sweeping band otherwise */}
          {transcribeState.busy &&
            (transcribeState.fraction !== null ? (
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  inset: 0,
                  transformOrigin: "left",
                  transform: `scaleX(${Math.max(0, Math.min(1, transcribeState.fraction))})`,
                  background: "color-mix(in srgb, var(--primary) 18%, transparent)",
                  transition: "transform 0.2s ease",
                  pointerEvents: "none"
                }}
              />
            ) : (
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: 0,
                  width: "35%",
                  background: "color-mix(in srgb, var(--primary) 20%, transparent)",
                  animation: "cs-indeterminate 1.1s ease-in-out infinite",
                  pointerEvents: "none"
                }}
              />
            ))}
          <span style={{ position: "relative", color: hasTranscript ? "var(--green-600)" : "var(--primary)" }}>
            {transcribeState.busy ? "◌" : hasTranscript ? "✓" : "✎"}
          </span>
          <span
            style={{
              position: "relative",
              overflow: "hidden",
              textOverflow: "ellipsis",
              flex: transcribeState.busy ? 1 : "none"
            }}
          >
            {transcribeState.busy ? transcribeState.label : hasTranscript ? "Transcribed" : "Transcribe"}
          </span>
          {transcribeState.busy && transcribeState.fraction !== null && (
            <span
              style={{
                position: "relative",
                fontVariantNumeric: "tabular-nums",
                fontWeight: 600,
                color: "var(--primary)"
              }}
            >
              {Math.round(transcribeState.fraction * 100)}%
            </span>
          )}
        </button>
        <button
          onClick={onOpenReview}
          title="Preview the imported script and transcript side by side"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            height: 32,
            padding: "0 12px",
            background: "var(--bg-surface)",
            border: "1px solid var(--border-strong)",
            borderRadius: "var(--radius-md)",
            fontFamily: "var(--font-sans)",
            fontSize: 13,
            fontWeight: 500,
            color: "var(--fg-strong)",
            cursor: "pointer",
            transition: "var(--transition-all)",
            flex: "none",
            whiteSpace: "nowrap"
          }}
        >
          <span style={{ color: "var(--primary)" }}>⇄</span> Review
        </button>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: "var(--fg-muted)" }}>Zoom</span>
        <input
          type="range"
          min={1}
          max={16}
          value={zoom}
          onChange={(e) => onZoomChange(+e.target.value)}
          title={`${zoom}× — zooms into the timeline, scroll to navigate`}
          style={{ width: "clamp(70px, 9vw, 120px)", accentColor: "var(--primary)" as any }}
        />
      </div>
    </div>
  );
}
