# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- In-app update flow. When a newer release exists, a modal appears once on
  the Monitor screen (and the same modal opens from About, both via the
  manual check and the "download it" link). The update check moved from the
  webview into the engine (Rust, allowlisted GitHub hosts, blocking pool) —
  the webview makes no network requests anymore and the CSP
  `connect-src` entry is gone. The flow is deliberately honest for a
  portable tool: no self-replace, no auto-restart:
  - "Update" opens the native save dialog (official dialog plugin) with the
    official versioned file name pre-filled, then downloads with a live
    progress bar and a cancel that leaves no partial file behind.
  - The downloaded exe is verified against the published SHA256SUMS.txt
    before it is ever written to the chosen path — files fetched by an HTTP
    client carry no Mark-of-the-Web (SmartScreen will not warn), so the
    hash check is the real protection here.
  - On success: "Open folder" opens Explorer with the file selected, plus
    one line of guidance ("close the app and run the new file"). Release
    notes render as plain text — never HTML.
  - Once-per-version: closing the modal records the announced version; the
    modal never nags again for that version, but a warn-yellow dot on the
    About entries (sidebar + Updates heading) carries the signal for the
    whole life of the release. The next version announces fresh. Manual
    checks from About always open the modal, announced or not.
  - First-run priority: the modal never appears for a user who has not
    completed the welcome screen — welcome first, updates later.
  - A GitHub 403/429 (rate-limited shared IPs — common behind Cloudflare
    WARP) is logged with the API's own reason line, not a bare "http 403".
  - The Windows system proxy (registry, the same setting browsers use) is
    honored for users whose VPN/proxy tools don't set env vars.

### Fixed
- Startup freeze ("Not Responding" for up to a minute, every launch on machines with an
  HDD): the rig-info query runs `Get-PhysicalDisk` — a live hardware inventory (SMART
  probes over every spindle) that costs 20+ seconds on such machines — and it ran on the
  IPC dispatcher thread, freezing the whole window until it finished. The rig profile is
  now cached on disk (`system-cache.json`): the first run pays the inventory once in the
  background, every later launch reads the cache in microseconds (measured: 28 s → 2.3 s
  ready on the dev machine's HDD+NVMe setup). All potentially slow commands became async
  on the blocking pool in the same pass — no IPC command can freeze the window anymore.
- Update check compared versions as strings: any different tag — including an OLDER
  one — showed "new version available", and "1.10.0" would lose to "1.2.0". Versions
  are now compared numerically (major/minor/patch) in one shared helper used by both
  the startup check and the About tab.
- About's manual update check claimed "up to date" when it actually couldn't know (no
  release tag or no local version) — those cases now honestly report a check failure.
- The Checks tab's "Open setting" buttons never actually sent the panel argument over
  IPC (the webview-side binding dropped it) — the power/pagefile buttons did nothing.
  Found while wiring the update flow's dialog permission; both are fixed.

### Added
- Flight-recorder technical log — the log was near-useless for diagnosing user reports
  (13 lines on a busy day, zero durations, panics invisible). It now covers:
  - Boot timing: `window shown: Xms`, `app ready in Xms` — slow launches visible at a glance
  - Every panic recorded via a panic hook that works even with `panic = "abort"`
    (installed before any thread spawns, lock-free writer for the dying moment)
  - Timings for every IPC command (`ipc: system_info: 21s (slow)` — WARN above 2 s)
  - Session lifecycle: stop reason, sampler spawn results, first-sample latency, GPU
    max clocks, window visibility at start
  - A one-line rig profile at boot (`rig: ram=…MB disks=… gpu_counters=… powershell=…`)
  - The sampler's 9 debug lines moved from `eprintln` (which is wiped in release builds,
    where the app has no console) into the real log
- Limited mode: a conservative one-shot probe detects whether PowerShell is usable at
  all (missing binary, execution-policy block, or a 5 s hang all read as unavailable).
  Sessions keep working (typeperf/tasklist/nvidia-smi are native), but the UI honestly
  shows what degrades — adaptive thresholds fall back to defaults, timestamps may read
  UTC, GPU window checks stay muted — instead of failing silently.
- CI (GitHub Actions, `windows-latest`): vitest + frontend build, engine tests including
  the live typeperf pipeline, and clippy with `-D warnings`. A full release build job is
  available on manual dispatch until it proves stable.
- Frontend unit tests (Vitest, 13 tests): version comparison, error-code-to-dialog
  mapping (extracted from App.tsx into a pure, testable function), and locale key parity
  between en and ar.

### Changed
- The Arabic locale is now type-checked against the English one (`ar: Locale`) — a
  missing or extra key is a build error instead of a silent runtime gap. The previous
  `as unknown as Locale` cast is gone.
- Session start reads RAM/disk facts from the rig cache instead of its own PowerShell
  round-trips; a cache miss (first machine run) falls back to the documented defaults
  rather than blocking the scan.
- README: the version badge reads from package.json (was a hardcoded "1.1.0" that
  drifted); the manual exe-renaming instructions removed (the binary has been
  version-named by the build since 1.2.0).

### Engineering
- Slow engine work (system queries, session start/stop, report loading, deletion) runs
  via `spawn_blocking` — the async runtime and the UI thread never stall on it.
- The update flow's security surfaces are unit-tested: SHA256SUMS line parsing
  (including the GNU `*name` marker), the download-host allowlist (https +
  GitHub hosts only, redirect-aware), and the numeric version comparison on
  the engine side (mirroring the frontend's). The once-per-version decision
  logic is a pure function with its own Vitest suite.
- Rust test suite grew from 46 to 54; frontend grew from zero to 19 Vitest
  tests (version comparison, error-to-dialog mapping, locale parity, and the
  update-modal decision rules).

## [1.2.0] — 2026-09-04

### Fixed
- Clock and session times showed UTC instead of the user's local time — on Egypt (UTC+3) a
  session run at 03:19 was named and reported as 00:19. All timestamps (session names, the
  report clock column, technical logs) now show real wall-clock time, DST-aware, with the
  time-zone offset re-read every ~10 minutes so a session crossing a DST boundary stays honest.
- Power-plan check failed on Arabic Windows: the plan name comes back localized ("أقصى أداء")
  and the English-only match marked a perfectly good plan as "not good". The check now matches
  the scheme GUID (language-independent) first, with localized names (English + Arabic) as
  fallback for OEM/custom schemes.
- Monitoring on localized (Arabic) Windows could run CPU/RAM/disk-blind: typeperf sometimes
  rejects the English counter paths on translated Windows builds, and the session would show
  GPU-only numbers with no error. A one-shot probe at session start detects this and switches
  to a locale-proof sampling path (PowerShell `Get-Counter`, verified live on real machines).
- Arabic-Indic thousands separators (٬) in process memory numbers now parse correctly.
- The reports list did not refresh after a session finished — a finished scan only appeared
  after restarting the app. The list now re-reads every time the Reports tab is opened.
- First-run flash: on a fresh install the main UI appeared for a few seconds, then flipped to
  the welcome screen. The welcome decision now resolves before anything decisive renders.
- The "GameLoop closed" notice could appear in a stale language if the user switched language
  mid-session — dialog text now always follows the current language.
- Duplicate guard threads: rapidly starting a new session could leave the previous session's
  liveness guard and auto-stop timer running in parallel (doubling the probe cadence). Each
  session now carries a generation number; old guards retire the moment a new session starts.
- Child-process leak on hard crashes: with `panic = "abort"`, a force-killed app left
  typeperf (up to ~9 h) and `nvidia-smi dmon` (forever — it had no cap) running behind. All
  spawned sources are now assigned to a Windows Job Object with kill-on-close — if the app
  dies, the kernel reaps the children with it.
- The pagefile "Open setting" button opened the System Properties **General** tab, not the
  page where virtual memory lives. It now opens the Advanced System Properties page (the
  Performance/Virtual memory dialog is one click away), and the promise in the checks tab
  copy was softened to match reality.
- Build warnings: 6 clippy warnings (an 11-argument function, missing `Default`, clamp-like
  patterns, and more) and a Vite `INEFFECTIVE_DYNAMIC_IMPORT` warning — all gone.

### Security
- `open_url` now enforces its own allowlist in Rust (https + github.com/api.github.com/paypal.me
  only). The comment previously claimed the opener plugin's capabilities scoped this command —
  they do not: plugin capabilities only guard the JS-side command path, and a Rust-side opener
  call was unconstrained. Practical risk was low (the UI passes fixed URLs), but the claimed
  protection now actually exists.

### Changed
- The release binary now carries its version in the filename straight from the build
  (`pubg-gameloop-lag-hunter-<version>.exe`, via Tauri's `mainBinaryName`) — no manual renaming.
- Removed the unused `log = "0.4"` dependency (the engine has its own logger).
- Docs: the "capped at 2 h" comment corrected (the cap is 1 h), the reference to a
  nonexistent release workflow removed, and the headless `engine_probe`'s unbounded sessions
  documented as intentional.
- Test suite grew from 44 to 46 (time-zone truth test against the OS clock, live Get-Counter
  emitter check, GUID and Arabic-name power-plan matching).

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
