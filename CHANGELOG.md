# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project adheres to [Semantic Versioning](https://semver.org/).

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
- System tab: your rig + what the tool can see.
- Top processes tab: who is eating the machine (GameLoop excluded — it's the game, not a suspect).
- System checks tab: read-only checks of lag-inducing Windows settings (power plan, pagefile, charger) with one-click jumps to the exact Windows page — the tool never modifies your system.
- Full English and Arabic interface with automatic OS-language detection and a language toggle.
- Technical log with 7-day rotation (`%LOCALAPPDATA%\LagHunter\logs`) for support and self-diagnosis.

### Engineering
- Single binary, no installer required — download and run.
- Fixed-size window (940×600) with a custom title bar; one visual plane.
- Single-instance: a second launch focuses the first window.
- Atomic settings writes with schema migration (v1 → v3 preserved across upgrades).
- 42 automated tests covering detection fingerprints, playing-state gating, settings migration, and security (path traversal, corrupted files, crash classification).
