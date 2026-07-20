# Session-Call Pipeline — architecture

Turns the session call (director + engineer + talent + clients) from a passive
reference lane into the context source for take naming, metadata, and review.

```
Script ─────────────┐
Master audio ───────┤──▶ align ──▶ dual transcribe ──▶ slice takes ──▶ map instructions ──▶ name + tag + visualize
Session call ───────┘    (A)          (B)               (C, master only)     (D)                (E)
```

Design constraints already baked into the codebase:

- The session call is decoded **compact** (16 kHz mono, `importAudioFile(file, { compact: true })`).
  That is deliberately Whisper's native input rate — alignment and transcription
  both run on this buffer with no further resampling.
- Takes are sliced from the **master only** (`utils/takeDetect.ts`); the session
  call never defines take boundaries.
- All timestamps below live on the **master timeline**. The alignment map is the
  single translation layer; nothing else is allowed to do its own offset math.

---

## A. Alignment & drift

The talent's voice appears on *both* tracks (isolated on the master, bleeding
through the call mix), so cross-correlating **loudness envelopes** — not raw
samples — finds the offset robustly even though the call has other speakers.

```python
ENV_RATE = 50            # envelope samples/sec (20 ms hop) — coarse but plenty
ANCHOR_EVERY = 60.0      # seconds between drift anchors
ANCHOR_WIN = 30.0        # correlation window per anchor

def envelope(buffer, rate=ENV_RATE):
    # RMS per 20ms hop over the mono 16k buffer -> Float32Array, 50/s
    ...

def align(master, call):
    env_m, env_c = envelope(master), envelope(call)

    # 1. coarse global offset: argmax of normalized cross-correlation (FFT, GCC-PHAT
    #    weighting so level differences between the tracks don't bias the peak)
    lag0 = gcc_phat_peak(env_m, env_c)          # seconds; call_time = master_time + lag0

    # 2. drift anchors: re-correlate short windows spaced through the file.
    #    Two devices' clocks drift linearly (crystal ppm), so offset(t) is ~linear;
    #    a session that was paused/restarted shows up as a step between anchors.
    anchors = []
    for t in range(0, master.duration, ANCHOR_EVERY):
        w_m = env_m[t : t + ANCHOR_WIN]
        w_c = env_c[t + lag0 - SLOP : t + lag0 + ANCHOR_WIN + SLOP]
        lag, confidence = gcc_phat_peak(w_m, w_c)
        if confidence > MIN_CONF:               # silent stretches produce junk peaks — skip
            anchors.append((t, lag0 + lag))

    # 3. offset map: piecewise-linear through confident anchors.
    #    Pure drift -> the anchors fit one line (slope = clock ratio - 1, a few ppm).
    #    A restart/step -> segmented fit; each segment keeps its own line.
    return OffsetMap(anchors)                   # .to_call(t) / .to_master(t)

class OffsetMap:
    def to_call(self, t_master):   # interpolate between surrounding anchors
    def to_master(self, t_call):   # inverse
```

Why this handles drift: a single global offset is wrong by `drift_ppm × t` at the
far end of an hour-long call (48 kHz devices 20 ppm apart ≈ 72 ms/hour — audibly
wrong for word-level mapping). Anchoring every minute keeps interpolation error
below one envelope hop (20 ms), which is finer than Whisper's own timestamp
accuracy, so nothing downstream needs sample-accurate warping. We **never
resample** the call audio to correct drift; we only translate timestamps through
the map.

## B. Dual transcription

Both tracks go through the existing `utils/transcribe.ts` engine (local Whisper
fp32 / cloud), independently:

```python
segs_master = transcribe(master)                       # talent only (exists today)
segs_call   = transcribe(call)                         # director + talent + banter
segs_call   = [s.shift(offset_map.to_master) for s in segs_call]   # -> master timeline
```

## C. Take slicing — master only

Unchanged: `utils/takeDetect.ts` adaptive-RMS silence detection over the master.
The rule "never slice on the call" is structural — the detector simply is never
handed the call buffer.

## D. Instruction → response mapping

Classify call segments, then attach the nearest preceding instruction block to
each take. Talent speech on the call is identified by *coincidence with master
speech* — on an aligned timeline, whenever the master has energy, whoever is
speaking on the call is the talent (their bleed), and text similarity confirms it.

```python
def classify_call_segments(segs_call, takes, segs_master):
    for s in segs_call:
        overlap = fraction_overlapping_master_speech(s, takes)      # aligned timeline
        echo    = max(dice(s.text, m.text) for m in segs_master.near(s))  # token-Dice, reuse the
        s.kind  = "response" if overlap > 0.5 or echo > 0.6 else "instruction"  # script-matcher's metric

def map_instructions(takes, segs_call, lookback=45.0):
    for take in takes:
        prev_end = end_of_previous_take(take) or 0
        window = [s for s in segs_call
                  if s.kind == "instruction"
                  and prev_end <= s.end <= take.start          # the gap before this take
                  and take.start - s.end < lookback]
        take.instruction = merge_text(window)                  # contiguous director speech
```

The "call-and-response" cycle means the correct instruction is bounded by the
previous take's end — direction given *before take N−1 ended* belongs to N−1's
retry context, not to N. That structural bound does most of the matching work;
the lookback cap just keeps pre-session chatter from leaking into take 1.

The LLM's job is **semantic, never temporal**. Timestamp pairing is done by the
deterministic code above; the model only interprets the already-paired text:

```python
prompt = f"""Script line: "{take.line_text}"
Director said before this take: "{take.instruction}"
Return JSON: {{ "line_ref": …, "tone": …, "note": …, "picked": bool }}"""
# -> tone tag for the filename ("Aggressive"), a one-line metadata comment
#    ("Take 3 — aggressive tone, as requested"), detected line numbers when the
#    director calls one out ("let's do line 12"), and director picks ("that's the one").
```

Fields land on the existing `Take` type (`dirQuote` / `picked` / `redundant`
already exist for exactly this) and flow into the naming pattern + manifest.csv
untouched.

## E. Visualization

The dual-lane `WaveformCard` already renders the call time-proportionally under
the master. Mapping adds two overlay region sets on the call lane, both drawn on
the master timeline (regions translate through the offset map once, at
classification time — the canvas never touches the map):

- **Instruction regions** (blue, `var(--primary)`-tinted): classified director
  speech, click-to-play from that point, hover shows the transcribed direction.
- **Response regions** (green, `var(--success)`-tinted): each master take's
  span projected onto the call lane — visually confirms alignment (the take's
  bleed on the call should sit exactly inside its green box; if it doesn't, the
  offset map is wrong *and the user can see where*).

## Failure modes handled

| Case | Behaviour |
|---|---|
| Call shorter/longer than master (late record start) | offset map covers the intersection; call lane clips; segments outside the master timeline are dropped |
| Session paused/restarted mid-call | anchor step detection → segmented offset map |
| No talent bleed on the call (rare, clean feed) | correlation confidence stays low → alignment falls back to lag 0 with a visible "unaligned" badge; mapping still runs but is flagged low-confidence |
| Director talks over a take | segment is both overlap-heavy and instruction-like → tagged `response`; talk-over never creates a phantom instruction for the *next* take |
