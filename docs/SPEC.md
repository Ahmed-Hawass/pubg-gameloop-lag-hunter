# PUBG GameLoop Lag Hunter, Specification

## What This Is

A Windows desktop tool for PUBG Mobile players on GameLoop.

It analyzes performance while they play, detects stutters, and uncovers what is causing them, answering the question that matters after a laggy match:

> **What caused it?**

It is **not** a benchmark, a tweak utility, or an FPS counter.

It is a **diagnostician with a memory**.

---

## The Problem, Concretely

A player drops into a match and the frames collapse at the worst moment.

The tool they try next shows them a wall of numbers.

Nothing says *why*.

The causes are usually one of a handful of well-known patterns:

| Pattern                   | What happens                                        |
| ------------------------- | --------------------------------------------------- |
| **Disk paging storm**     | Pagefile pressure during a heavy drop               |
| **CPU saturation**        | Emulator translation maxing the cores               |
| **Thermal throttling**    | Sustained load pushes the processor into throttling |
| **GPU power-state hitch** | GPU changes power state between scenes              |
| **First-load freeze**     | Shader compilation on a fresh scene                 |

Each has a distinct measurable fingerprint.

Lag Hunter matches live samples against those fingerprints and explains the match in plain language.

---

## How It Works

```text
typeperf (CPU/RAM/disk, 1 Hz)  ─┐
                                │
nvidia-smi dmon (GPU, 1 Hz)    ─┼─▶ Detector ─▶ Diagnoser ─▶ UI
                                │    (fingerprints)
tasklist (GameLoop probe)       ─┘
                                     │
                                     └─▶ Session storage
                                         (jsonl / csv / md)
```

### Detector

* Uses hysteresis per condition.
* Derives thresholds from the machine.
* RAM floor = **6% of installed RAM**, clamped to **1–4 GB**.
* Disk-queue tolerance scales with **physical spindle count**.

### Diagnoser

* Groups symptoms by root cause, one storm becomes one card.
* Subordinates short CPU spikes riding disk storms.
* Requires **≥3 seconds** of sustained evidence before a condition earns a card.

### Sessions

* Every sample is written to disk immediately.
* The RAM window is bounded at **300 ticks**.
* Reports are generated from the file, never from memory.

---

## Guarantees

### 🔒 Read-only on the user's machine

No settings are ever modified.

System checks open the relevant Windows page; **the user flips the switch**.

### 📏 No fabricated numbers

Unavailable sources show `--`.

Measured numbers are shown with their limits, such as frame-freeze durations at 1 Hz resolution.

### 📦 Bounded everything

* Sessions auto-stop: **≤1 h**
* Default session length: **5 min**
* RAM windows are capped
* Logs rotate after **7 days**
* Single instance is enforced

### 🎮 GameLoop-gated

A scan refuses to start without the game running.

Desktop-idle numbers would be meaningless.

When GameLoop closes, the scan stops itself after approximately **15 seconds**.

### 🌍 Localization owns all text

The backend emits machine keys.

Every human-facing string lives in the locale files.

**English and Arabic today.**

---

## Non-Goals

* **No FPS overlay**, anti-cheat territory, and not our question.
* **No system tweaking or repair**, diagnosis is the product; repair is the user's decision with our guidance.
* **No multi-emulator support**, GameLoop only. Identity beats reach.
* **No telemetry**, the only thing written is on the user's own disk.

---

## Success Criteria for v1

A player finishes a laggy match and opens the report.

Within **one minute**, they can point at one card and say:

> **"That's what happened to me."**

Then they can act on the linked advice and get a measurably cleaner session next match.
