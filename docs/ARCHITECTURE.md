# Architecture

The tool has **one brain and one face**.

Everything that decides lives in Rust.
Everything that displays lives in the browser layer.

They meet in exactly one place: a JSON state contract pushed over Tauri events.

```text
┌─ Interface (src/) ────────────────────────────────┐
│                                                   │
│  views/       seven pages, zero logic             │
│  components/  the design system                   │
│  locales/     every human string                   │
│  bridge.ts    the ONLY file that talks             │
│               to the backend                       │
│  version.ts   numeric release comparison           │
│  errors.ts    error codes → dialog copy            │
│                                                   │
└──────────────────────┬────────────────────────────┘
                       │
              commands ↓   ↑ engine://state pushes
                       │
┌──────────────────────┴────────────────────────────┐
│ Engine (src-tauri/src/engine/)                    │
│                                                   │
│  sampler    typeperf (CPU/RAM/disk 1Hz)           │
│             nvidia-smi dmon (GPU 1Hz)             │
│             tasklist (GameLoop probe)             │
│                                                   │
│  detector   fingerprints → engine events          │
│             (hysteresis per condition)             │
│                                                   │
│  diagnoser  events → root-cause cards             │
│             (grouping, subordination, ≥3s rule)    │
│                                                   │
│  session    lifecycle, rolling 300-tick RAM       │
│             window                                 │
│                                                   │
│  storage    %LOCALAPPDATA%\LagHunter              │
│                                                   │
│  settings   schema v3, atomic writes, migration   │
│                                                   │
│  system     rig info (disk-cached across runs),  │
│             top processes, checks                │
│                                                   │
│  logging    the flight recorder: boot timing,    │
│             panics, IPC durations, 7-day        │
│             rotation                              │
│                                                   │
└───────────────────────────────────────────────────┘
```

## The Rules That Keep It Sane

### 🧠 One brain

If logic appears in a component, it moves to the engine.

### 🔑 Keys, not sentences

The backend emits machine keys such as:

```text
"disk_wait"
"GAMELOOP_NOT_RUNNING"
```

The UI owns every human word.

### 📏 No fabricated numbers

Unavailable sources show `--`.

Measured limits are stated, including freeze durations at 1 Hz resolution.

### 🔒 Read-only on the user's machine

The engine reads counters and opens whitelisted Windows panels.

It never flips a switch.

### 📦 Bounded everything

* Sessions cap at **1 h**
* RAM window at **300 ticks**
* Logs rotate at **7 days**
* Process lists truncate at **12**

### ⚡ Nothing slow on the UI's threads

Sync Tauri commands run on the IPC dispatcher thread, one slow command
freezes the window (the original "Not Responding for a minute" bug:
a 20-second `Get-PhysicalDisk` hardware inventory). Every potentially
slow command is `async` and parks its blocking work on `spawn_blocking`.

### 📼 The log is a flight recorder

If it matters for diagnosing a user's machine, it gets a line: boot
timings, panics (even with `panic = "abort"`), IPC durations, sampler
spawn results, session lifecycle events.

---

## Why These Choices

### `typeperf` over native APIs

Spawn-and-parse, zero drivers, zero admin.

The live-sample integration test (`src-tauri/tests/typeperf_live.rs`) guards the whole pipeline against silent death.

### Rolling window on disk, not memory

A crashed session loses nothing.

The **file is the record**, and the report is generated from it.

### Machine-adaptive thresholds

A fixed 2 GB RAM floor would cry wolf on a 4 GB machine and sleep through pressure on a 64 GB one.

The floor is **6% of installed RAM**, clamped to **1–4 GB**. Disk-queue tolerance scales with spindle count.

The rig profile (RAM, disks, GPU) is cached **on disk** (`system-cache.json`): the hardware inventory (`Get-PhysicalDisk`) costs 20+ seconds on HDD machines and the rig doesn't change between launches, the first run pays it once, every later launch reads the cache in microseconds.

### `tasklist` over PowerShell for the GameLoop probe

~5 MB transient per call, zero resident cost, no script host in the process list.

---

## Testing

`cargo test` covers:

* Fingerprints with real-world shapes
* Settings migration across all schema versions
* Security:

  * Path traversal
  * Corrupted files
  * Crash classification

The disk-storm test is literally the session that started this project.

A crashed session can **never** be reported as `"clean"`.

`npm test` (Vitest) covers the frontend's pure logic:

* Version comparison (the update check)
* Error-code → dialog mapping
* Locale key parity between en and ar

CI (`.github/workflows/ci.yml`) runs both suites plus clippy
(`-D warnings`) on every push and PR.
