# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project adheres to [Semantic Versioning](https://semver.org/).

## [1.1.0] — 2026-09-02

### Fixed
- Phantom GPU cards: GPU rules (power-state wake, low clock, temp) no longer fire while the
  game window is minimized or on a static screen (lobby/result) — desktop activity was being
  reported as in-game GPU problems.
- `gpu_wake` cards now require a measured frame freeze (render stall) within the live window —
  a wake story with no recorded hitch stays in the activity feed only.
- Returning to the game after minimizing no longer registers as a render stall.
- Missing dialog buttons (Cancel/Delete) rendered empty in Arabic.
- External links in the About tab did nothing (`open_url` was never registered).
- GPU utilization columns were never read (dmon needed the `u` selector) — GPU metrics showed
  `--` on all NVIDIA machines.
- Honest WebView2 disk footprint (~2 MB is the downloader only; the runtime needs a few
  hundred MB) in README and the missing-runtime dialog.
- Start-button behavior described accurately (always pressable; pressing without the game
  shows an explaining dialog) — it never "lit up".
- Versioned release naming (`pubg-gameloop-lag-hunter-<version>.exe`) no longer makes the
  tool appear in its own top-processes list.
- GPU VRAM above 4 GB reported correctly (nvidia-smi instead of the 32-bit CIM field).
- Session loading and report opening validate session IDs the same way deletion does.
- Start/Stop toggle no longer jitters (stable width + matched icon sizes).
- Tab switching no longer unmounts and rebuilds every view — all tabs stay alive and switching
  is instant (a CSS-visibility bug briefly stacked all views on top of each other; fixed the
  same day).

### Added
- Playing-state gating: the engine knows whether the game window is visible and whether real
  rendering is happening — "is the user actually playing?" gates every GPU rule.
- GameLoop-closed notice: when the game closes mid-session, a dialog explains why the scan
  stopped (once per session; manual stops stay silent).
- First-run advice dialog after the welcome: start the game first, stay in it while scanning.
- Background note in Monitor while the game window is minimized.
- Reports flag sessions spent mostly outside the game ("Most of this session was not actual
  gameplay") with a background-percentage statistic.
- Honest `gpu_wake` advice: what to do if "Prefer maximum performance" is already set and it
  still appears (driver memory-clock trimming on hybrid-graphics laptops).
- Stop reason (`manual` / `auto_stop` / `gameloop_closed`) travels with every state push.
- A small "?" tooltip on each metric card (CPU/RAM/GPU/Disk) explains what it measures —
  per-metric text in English and Arabic, replacing the single generic hint row.
- Live refresh in Top processes (every 5 s) and System checks (every 30 s) while their tab is
  the active one — silent, never disables the manual refresh button.
- Background prefetch at launch: system info, checks, and top processes are warmed before
  the user opens those tabs — the first open is as instant as every later one.
- TTL caches with stale-while-revalidate for top processes (10 s) and system checks (30 s) —
  tab revisits never re-pay a PowerShell spawn.

### Changed
- Default scan duration for new users: 30 min → 5 min.
- Longest scan duration removed: the 2-hour option is gone; the hard cap is now 1 hour.
- Stop button is now filled red (was an outline) — matches the app's filled-active language.
- Sidebar and title bar have visible borders again (separate planes).
- Sidebar collapse control moved to the bottom of the sidebar.
- Unified product description everywhere (README, About, welcome): "Analyze your PUBG Mobile
  performance on GameLoop, detect stutters, and uncover exactly what's causing them."
- App version now comes from one source (tauri.conf.json) — TitleBar, About, and the update
  check ask the backend instead of hardcoding.
- Arabic copy upgraded to formal register (فصحى) across the new strings.
- README restructured (screenshots first, tables, step-by-step usage); CONTRIBUTING,
  ARCHITECTURE, SPEC, and SECURITY reformatted to match.
- Test suite grew from 33 to 42 (playing-gate coverage, wake correlation, background stats,
  versioned self-detection).

## [1.0.0] — 2026-09-01

First public release.

### Added
- Real-time monitoring of CPU, RAM, GPU, and disk while PUBG Mobile runs on GameLoop — one sample per second.
- Root-cause diagnosis of stutters in plain language (disk paging storms, CPU saturation, thermal throttling, GPU power-state hitches, first-load freezes), each with a recommended fix.
- Detection thresholds adapt to the machine (RAM size, physical disk count) — same rules on an office laptop and a tower.
- Live activity feed: everything the engine notices, newest first.
- Session reports with honest outcomes (Clean / Findings / Lag captured / Partial), key moments, and plain-language numbers.
- Report cards group symptoms by cause — one disk storm shows one card, not three.
- Auto-stop sessions (5 min to 2 h, default 5 min) — nothing runs forgotten.
- GameLoop gate: scanning starts only while the game is running; auto-stops ~15 s after GameLoop closes.
- System tab: your rig + what we can see.
- Top processes tab: who is eating the machine (GameLoop excluded — it's the game, not a suspect).
- System checks tab: read-only checks of lag-inducing Windows settings (power plan, pagefile, charger) with one-click jumps to the exact Windows page — the tool never modifies your system.
- Full English and Arabic interface with automatic OS-language detection and a language toggle.
- Technical log with 7-day rotation (`%LOCALAPPDATA%\LagHunter\logs`) for support and self-diagnosis.

### Engineering
- Single binary, no installer required — download and run.
- Fixed-size window (940×600) with a custom title bar; one visual plane.
- Single-instance: a second launch focuses the first window.
- Atomic settings writes with schema migration (v1 → v3 preserved across upgrades).
- 33 automated tests covering detection fingerprints, settings migration, and security (path traversal, corrupted files, crash classification).
