import { useEffect, useRef, useState } from "react";
import type { CompModel, Line, SourceAudio, Take } from "../types";
import { waveBars } from "../data/rng";
import { compSegments, fadeSeconds, renderComp } from "../utils/compAudio";
import { getAudioContext } from "../utils/audioImport";

interface CompEditorProps {
  line: Line;
  selectedTakes: { take: Take; index: number }[];
  compFilename: string;
  rateHz: number;
  masterAudio: SourceAudio | null;
  onCompChange: (comp: CompModel) => void;
  onPlayTake: (start: number, end: number) => void;
}

function ensureComp(line: Line, selIdx: number[]): CompModel {
  const words = line.text.replace(/\s*\/.*$/, "").split(/\s+/).filter(Boolean);
  const n = Math.min(5, Math.max(2, Math.ceil(words.length / 2)));
  const nSeg = Math.min(4, Math.max(2, n));

  if (!line.comp || line.comp.srcs.length !== nSeg) {
    line.comp = {
      bounds: Array.from({ length: nSeg - 1 }, (_, i) => ({ pos: (i + 1) / nSeg, fade: 0.02 })),
      srcs: Array.from({ length: nSeg }, (_, i) => (selIdx.length ? selIdx[i % selIdx.length] : 0))
    };
  } else if (line.comp.srcs.some((s) => !selIdx.includes(s))) {
    line.comp = {
      bounds: line.comp.bounds,
      srcs: line.comp.srcs.map((s) => (selIdx.includes(s) ? s : selIdx[0] ?? 0))
    };
  }
  return line.comp;
}

/** Display bars for fraction [f0, f1] of a take: real master peaks when the take has a region. */
function barsFor(take: Take, f0: number, f1: number, n: number, master: SourceAudio | null): number[] {
  if (master && take.start !== undefined && take.end !== undefined && master.duration > 0) {
    const dur = take.end - take.start;
    const p0 = ((take.start + f0 * dur) / master.duration) * master.peaks.length;
    const p1 = ((take.start + f1 * dur) / master.duration) * master.peaks.length;
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = Math.floor(p0 + ((p1 - p0) * i) / n);
      const b = Math.max(a + 1, Math.floor(p0 + ((p1 - p0) * (i + 1)) / n));
      let max = 0;
      for (let j = a; j < b && j < master.peaks.length; j++) {
        if (master.peaks[j] > max) max = master.peaks[j];
      }
      out.push(max);
    }
    return out;
  }
  const all = waveBars(Math.max(n, 8), take.seed);
  return all.slice(0, n);
}

export default function CompEditor({
  line,
  selectedTakes,
  compFilename,
  rateHz,
  masterAudio,
  onCompChange,
  onPlayTake
}: CompEditorProps) {
  const tlRef = useRef<HTMLDivElement>(null);
  const [dragIdx, setDragIdx] = useState<{ i: number; kind: "pos" | "fade" } | null>(null);
  const [playingComp, setPlayingComp] = useState(false);
  const compSrcRef = useRef<AudioBufferSourceNode | null>(null);

  const selIdx = selectedTakes.map((s) => s.index);
  // computed fresh every render: takes/comp are mutated in place, memoising here
  // is what made drags snap back
  const comp = ensureComp(line, selIdx);

  const edges = [0, ...comp.bounds.map((b) => b.pos), 1];
  const durSec = Math.max(...selectedTakes.map((s) => s.take.dur), 0.001);
  const compReady =
    masterAudio !== null && comp.srcs.every((s) => line.takes[s]?.start !== undefined && line.takes[s]?.end !== undefined);

  function stopComp() {
    if (compSrcRef.current) {
      compSrcRef.current.onended = null;
      try {
        compSrcRef.current.stop();
      } catch {
        /* already stopped */
      }
      compSrcRef.current = null;
    }
    setPlayingComp(false);
  }

  useEffect(() => stopComp, []);

  function toggleCompPlay() {
    if (playingComp) {
      stopComp();
      return;
    }
    if (!masterAudio || !compReady) return;
    const buffer = renderComp(masterAudio.buffer, line.takes, comp, durSec);
    if (!buffer) return;
    const ctx = getAudioContext();
    void ctx.resume();
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.onended = () => {
      compSrcRef.current = null;
      setPlayingComp(false);
    };
    src.start();
    compSrcRef.current = src;
    setPlayingComp(true);
  }

  function updateComp(next: CompModel) {
    stopComp();
    line.comp = next;
    onCompChange(next);
  }

  function startDrag(e: React.PointerEvent, i: number, kind: "pos" | "fade") {
    e.preventDefault();
    e.stopPropagation();
    const rect = tlRef.current?.getBoundingClientRect();
    if (!rect) return;
    const b = comp.bounds[i];
    const startX = e.clientX;
    const startPos = b.pos;
    const startFade = b.fade;
    const prev = i > 0 ? comp.bounds[i - 1].pos : 0;
    const next = i < comp.bounds.length - 1 ? comp.bounds[i + 1].pos : 1;

    setDragIdx({ i, kind });

    const move = (ev: PointerEvent) => {
      const d = (ev.clientX - startX) / rect.width;
      const newBounds = comp.bounds.map((bd, idx) => ({ ...bd }));
      if (kind === "pos") {
        newBounds[i].pos = Math.min(next - 0.03, Math.max(prev + 0.03, startPos + d));
      } else {
        newBounds[i].fade = Math.min(0.12, Math.max(0, startFade + d));
      }
      updateComp({ ...comp, bounds: newBounds });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDragIdx(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function assignZone(segIndex: number, origIndex: number) {
    const newSrcs = comp.srcs.map((s, idx) => (idx === segIndex ? origIndex : s));
    updateComp({ ...comp, srcs: newSrcs });
  }

  return (
    <div
      style={{
        marginBottom: 14,
        background: "var(--bg-surface)",
        border: "1px solid var(--indigo-200)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-field)",
        overflow: "hidden",
        userSelect: "none"
      }}
    >
      <div style={{ display: "flex", alignItems: "stretch" }}>
        {/* labels column */}
        <div style={{ width: 110, flex: "none", borderRight: "1px solid var(--border-subtle)" }}>
          <div
            style={{
              height: 64,
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "0 12px",
              background: "var(--highlight-bg)",
              borderBottom: "1px solid var(--indigo-200)"
            }}
          >
            <button
              onClick={toggleCompPlay}
              disabled={!compReady}
              title={compReady ? "Play the comped result" : "Comp playback needs takes with regions in the master"}
              style={{
                width: 26,
                height: 26,
                flex: "none",
                borderRadius: "50%",
                border: "none",
                background: compReady ? "var(--primary)" : "var(--slate-300)",
                color: "#fff",
                fontSize: 9,
                cursor: compReady ? "pointer" : "default",
                display: "flex",
                alignItems: "center",
                justifyContent: "center"
              }}
            >
              {playingComp ? "❚❚" : "▶"}
            </button>
            <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--indigo-700)" }}>Comp A</span>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 9.5,
                  color: "var(--fg-muted)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap"
                }}
              >
                {compFilename}
              </span>
            </div>
          </div>
          {selectedTakes.map(({ take }) => {
            const hasRegion = take.start !== undefined && take.end !== undefined;
            return (
              <div
                key={take.take}
                style={{
                  height: 56,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "0 12px",
                  borderBottom: "1px solid var(--border-subtle)"
                }}
              >
                <button
                  onClick={() => hasRegion && onPlayTake(take.start!, take.end!)}
                  disabled={!hasRegion}
                  title={hasRegion ? `Play take ${take.take}` : "No region in the master for this take"}
                  style={{
                    width: 24,
                    height: 24,
                    flex: "none",
                    borderRadius: "50%",
                    border: "1px solid var(--border-strong)",
                    background: "var(--bg-surface)",
                    color: hasRegion ? "var(--primary)" : "var(--slate-300)",
                    fontSize: 9,
                    cursor: hasRegion ? "pointer" : "default",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center"
                  }}
                >
                  ▶
                </button>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--fg-strong)" }}>Take {take.take}</span>
              </div>
            );
          })}
        </div>

        {/* timeline */}
        <div ref={tlRef} style={{ flex: 1, position: "relative" }}>
          {/* comp result lane */}
          <div style={{ height: 64, position: "relative", background: "var(--highlight-bg)", borderBottom: "1px solid var(--indigo-200)" }}>
            {comp.srcs.map((s, si) => {
              const t = line.takes[s];
              const w = edges[si + 1] - edges[si];
              const crBars = barsFor(t, edges[si], edges[si + 1], Math.max(6, Math.round(w * 60)), masterAudio);
              return (
                <div
                  key={si}
                  style={{
                    position: "absolute",
                    top: 5,
                    bottom: 5,
                    left: `${(edges[si] * 100).toFixed(3)}%`,
                    width: `${(w * 100).toFixed(3)}%`,
                    background: "var(--bg-surface)",
                    border: "1px solid var(--indigo-300)",
                    borderRadius: 3
                  }}
                >
                  <span style={{ fontSize: 9, fontWeight: 600, color: "var(--indigo-700)", position: "absolute", top: 3, left: 6 }}>
                    v{String(t.take).padStart(2, "0")}
                  </span>
                  <div style={{ position: "absolute", inset: "15px 6px 5px", display: "flex", alignItems: "center", gap: 1.5 }}>
                    {crBars.map((h, bi) => (
                      <div
                        key={bi}
                        style={{
                          flex: 1,
                          height: `${Math.max(10, h * 100).toFixed(0)}%`,
                          minWidth: 1,
                          borderRadius: 1,
                          background: "var(--indigo-500)"
                        }}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
            {/* crossfades */}
            {comp.bounds.map((b, i) => {
              const w = Math.max(b.fade, 0.006);
              return (
                <div
                  key={i}
                  onPointerDown={(e) => startDrag(e, i, "fade")}
                  title="Drag to adjust crossfade"
                  style={{
                    position: "absolute",
                    top: 8,
                    bottom: 8,
                    left: `${((b.pos - w) * 100).toFixed(3)}%`,
                    width: `${(w * 2 * 100).toFixed(3)}%`,
                    background: "color-mix(in srgb, var(--indigo-500) 10%, transparent)",
                    border: "1px solid var(--indigo-300)",
                    borderRadius: 2,
                    cursor: "col-resize",
                    zIndex: 4
                  }}
                >
                  <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}>
                    <path d="M0 0 C 45 0 55 100 100 100" fill="none" stroke="var(--indigo-600)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                    <path d="M0 100 C 45 100 55 0 100 0" fill="none" stroke="var(--indigo-600)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                  </svg>
                </div>
              );
            })}
          </div>

          {/* take lanes */}
          {selectedTakes.map(({ take: t, index: orig }) => {
            const laneBars = barsFor(t, 0, 1, 90, masterAudio);
            return (
              <div
                key={orig}
                style={{ height: 56, position: "relative", borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-surface)" }}
              >
                <div style={{ position: "absolute", inset: "6px 0", display: "flex", alignItems: "center", gap: 1.5, padding: "0 2px" }}>
                  {laneBars.map((h, bi) => (
                    <div
                      key={bi}
                      style={{ flex: 1, height: `${Math.max(8, h * 100).toFixed(0)}%`, minWidth: 1, borderRadius: 1, background: "var(--slate-300)" }}
                    />
                  ))}
                </div>
                {comp.srcs.map((s, si) =>
                  s === orig ? (
                    <div
                      key={si}
                      style={{
                        position: "absolute",
                        top: 0,
                        bottom: 0,
                        left: `${(edges[si] * 100).toFixed(3)}%`,
                        width: `${((edges[si + 1] - edges[si]) * 100).toFixed(3)}%`,
                        background: "color-mix(in srgb, var(--indigo-500) 18%, transparent)",
                        borderTop: "2px solid var(--indigo-400)",
                        borderBottom: "2px solid var(--indigo-400)"
                      }}
                    />
                  ) : null
                )}
                {comp.srcs.map((_s, si) => (
                  <div
                    key={si}
                    onClick={() => assignZone(si, orig)}
                    style={{
                      position: "absolute",
                      top: 0,
                      bottom: 0,
                      left: `${(edges[si] * 100).toFixed(3)}%`,
                      width: `${((edges[si + 1] - edges[si]) * 100).toFixed(3)}%`,
                      cursor: "pointer",
                      zIndex: 2
                    }}
                  />
                ))}
              </div>
            );
          })}

          {/* cut boundaries */}
          {comp.bounds.map((b, i) => (
            <div
              key={i}
              onPointerDown={(e) => startDrag(e, i, "pos")}
              title="Drag to slide cut"
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: `calc(${(b.pos * 100).toFixed(3)}% - 5px)`,
                width: 10,
                cursor: "ew-resize",
                zIndex: 5
              }}
            >
              <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 2, marginLeft: -1, background: "var(--indigo-600)" }} />
            </div>
          ))}
        </div>
      </div>

      {/* readout footer */}
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 16, rowGap: 4, padding: "7px 14px", background: "var(--slate-50)" }}>
        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--fg-muted)" }}>
          Cuts
        </span>
        {compReady && masterAudio && (
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--indigo-700)", fontWeight: 600 }}>
            comp {(() => {
              const segs = compSegments(line.takes, comp)!;
              const lens = segs.map((s) => s.srcEnd - s.srcStart);
              const fades = fadeSeconds(comp, durSec).map((f, i) => Math.min(f, Math.min(lens[i], lens[i + 1]) * 0.9));
              return (lens.reduce((a, b) => a + b, 0) - fades.reduce((a, b) => a + b, 0)).toFixed(2);
            })()} s
          </span>
        )}
        {comp.bounds.map((b, i) => {
          const smp = Math.round(b.pos * durSec * rateHz);
          const fadeMs = Math.round(b.fade * 2 * durSec * 1000);
          const active = dragIdx?.i === i;
          return (
            <span
              key={i}
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                transition: "var(--transition-all)",
                color: active ? "var(--indigo-700)" : "var(--fg-muted)",
                fontWeight: active ? 600 : 400
              }}
            >
              {i + 1} · {smp.toLocaleString("en-GB")} smp · fade {fadeMs} ms
            </span>
          );
        })}
      </div>
    </div>
  );
}
