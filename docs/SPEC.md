# PUBG GameLoop Lag Hunter — Specification

## What this is

A Windows desktop tool for PUBG Mobile players on GameLoop. It watches the
machine while they play, captures every stutter, and answers the only question
that matters after a laggy match: **what caused it, and how do I fix it?**

It is not a benchmark, not a tweak utility, and not an FPS counter. It is a
diagnostician with a memory.

## The problem, concretely

A player drops into a match and the frames collapse at the worst moment. The
tool they try next shows them a wall of numbers. Nothing says *why*. The
causes are usually one of a handful of well-known patterns:

- a disk paging storm (pagefile too small for a heavy drop)
- CPU saturation (emulator translation maxing the cores)
- thermal throttling under sustained load
- GPU power-state hitches between scenes
- first-load freezes (shader compile on a fresh scene)

Each has a distinct measurable fingerprint. This tool matches live samples
against those fingerprints and explains the match in plain language.

## How it works

```
typeperf (CPU/RAM/disk, 1 Hz)  ─┐
nvidia-smi dmon (GPU, 1 Hz)     ─┼─▶ Detector (fingerprints) ─▶ Diagnoser ─▶ UI
tasklist (GameLoop probe)      ─┘        │
                                         └─▶ Session storage (jsonl/csv/md)
```

- **Detector**: hysteresis per condition; thresholds derived from the machine
  (RAM floor = 6% of installed RAM clamped 1–4 GB, disk queue = physical
  spindle count).
- **Diagnoser**: groups symptoms by root cause (one storm = one card),
  subordinates short CPU spikes riding disk storms, requires ≥3 s of
  sustained evidence before a condition earns a card.
- **Sessions**: every sample hits disk immediately; the RAM window is bounded
  (300 ticks); reports are generated from the file, never from memory.

## Guarantees

1. **Read-only on the user's machine.** No settings are ever modified. System
   checks open the relevant Windows page; the user flips the switch.
2. **No fabricated numbers.** Unavailable sources show `--`. Measured numbers
   are shown with their limits (e.g. frame-freeze durations at 1 Hz).
3. **Bounded everything.** Sessions auto-stop (≤2 h, default 30 min). RAM
   windows capped. Logs rotate after 7 days. Single instance enforced.
4. **GameLoop-gated.** The scan refuses to start without the game running —
   desktop-idle numbers would be meaningless — and stops itself ~15 s after
   GameLoop closes.
5. **Localization owns all text.** The backend emits machine keys; every
   human string lives in the locale files (English and Arabic today).

## Non-goals

- No FPS overlay (anti-cheat territory, and not our question).
- No system tweaking/repair (diagnosis is the product; repair is the user's
  decision with our guidance).
- No multi-emulator support. GameLoop only — identity beats reach.
- No telemetry. The only thing written is on the user's own disk.

## Success criteria for v1

A player finishes a laggy match, opens the report, and within one minute can
point at one card and say *"that's what happened to me"* — then fix it with
the linked advice and get a measurably cleaner session next match.
