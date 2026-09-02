# Architecture

The tool has one brain and one face. Everything that decides lives in Rust;
everything that displays lives in the browser layer. They meet in exactly one
place: a JSON state contract pushed over Tauri events.

```
┌─ Interface (src/) ─────────────────────┐
│  views/     seven pages, zero logic   │
│  components/ the design system        │
│  locales/   every human string        │
│  bridge.ts  the ONLY file that talks  │
│             to the backend            │
└───────────────┬────────────────────────┘
                │  commands ↓   ↑ engine://state pushes
┌───────────────┴──────────────────────────────────────┐
│ Engine (src-tauri/src/engine/)                       │
│                                                      │
│  sampler   typeperf (CPU/RAM/disk 1Hz)               │
│            nvidia-smi dmon (GPU 1Hz)                │
│            tasklist (GameLoop probe)                 │
│  detector  fingerprints → engine events              │
│            (hysteresis per condition)               │
│  diagnoser events → root-cause cards                 │
│            (grouping, subordination, ≥3s rule)      │
│  session   lifecycle, rolling 300-tick RAM window   │
│  storage   %LOCALAPPDATA%\LagHunter                  │
│  settings  schema v3, atomic writes, migration      │
│  system    rig info (cached), top processes, checks │
│  logging   7-day rotating technical log              │
└──────────────────────────────────────────────────────┘
```

## The rules that keep it sane

1. **One brain.** If logic appears in a component, it moves to the engine.
2. **Keys, not sentences.** The backend emits machine keys
   (`"disk_wait"`, `"GAMELOOP_NOT_RUNNING"`); the UI owns every human word.
3. **No fabricated numbers.** Unavailable sources show `--`. Measured limits
   are stated (freeze durations at 1 Hz resolution).
4. **Read-only on the user's machine.** The engine reads counters and opens
   whitelisted Windows panels. It never flips a switch.
5. **Bounded everything.** Sessions cap at 2 h. RAM window at 300 ticks.
   Logs rotate at 7 days. Process lists truncate at 12.

## Why these choices

- **typeperf over native APIs**: spawn-and-parse, zero drivers, zero admin.
  The live-sample integration test (`src-tauri/tests/typeperf_live.rs`)
  guards the whole pipeline against silent death.
- **Rolling window on disk, not memory**: a crashed session loses nothing;
  the file *is* the record, and the report is generated from it.
- **Machine-adaptive thresholds**: a fixed 2 GB RAM floor would cry wolf on a
  4 GB machine and sleep through pressure on a 64 GB one. The floor is 6% of
  installed RAM, clamped 1–4 GB; disk-queue tolerance scales with spindle count.
- **Tasklist over PowerShell for the GameLoop probe**: ~5 MB transient per
  call, zero resident cost, no script host in the process list.

## Testing

`cargo test` covers the fingerprints with real-world shapes (the disk-storm
test is literally the session that started this project), settings migration
across all schema versions, and security (path traversal, corrupted files,
crash classification — a crashed session can never be reported "clean").
