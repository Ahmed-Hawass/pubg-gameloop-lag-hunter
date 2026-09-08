# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project adheres to [Semantic Versioning](https://semver.org/).

## [1.4.0] - 2026-09-08

### Added
- Light theme, plus a softer dark theme. Settings now has a Theme picker
  (Automatic / Dark / Light, mirroring the language picker): Automatic
  follows the OS theme live, explicit choices win, and anything unknown
  falls back to dark, never to a third state. Stored in `settings.json`
  (default `dark`, so existing installs keep the exact look they have).
  The dark surfaces were lifted off pure black at the same time
  (`#060706` → `#141613` family) with matching hover and border steps.
- "Background file shuffling" diagnosis. Two real 12+ minute sessions
  showed the same unclassified shape: sustained pagefile reads
  (300–1900/s, peaking at 6211/s in one 29-minute match) with a FLAT
  disk queue (~0) and ~20 GB of free RAM. That is not memory pressure
  (nothing is starved) and not a disk storm (nothing is queued): it is
  Windows trimming game working sets to standby and the game faulting
  them back in. The engine now names it honestly (`paging_churn`: opens
  after 3+ consecutive sustained ticks, stays silent under real memory
  pressure or a loaded disk so those stories keep their owners) and the
  card only appears when a measured GPU activity collapse falls INSIDE
  the churn window, churn without a correlated stutter stays a feed
  observation, never a card.
- Delete-all-sessions on the Reports tab (confirm dialog with the live
  count, `danger` styling, disabled while a session runs). The backend
  only touches `session-*` directories, skips the live writer's folder
  even if asked directly, and returns the deleted ids; the Monitor
  forgets every deleted session so no dead summary card can linger.
- One-time advice modals for new players. The first session start ever
  shows a "close background apps" tip; the first measured background
  window mid-session shows a "stay inside the game" tip. Each shows
  exactly once (persisted flags, recorded at show time so closing the
  app can't resurrect them), neither ever blocks Start, and a click
  anywhere dismisses them like every other notice.
- Language switcher on the welcome screen: a quiet globe icon in the
  window corner (bottom, mirrored with direction): one click toggles
  en/ar with instant direction flip; the full picker stays in Settings.
- New app icon (regenerated icon set across all 51 platform files).

### Changed
- GPU stutter detection now learns the machine instead of using fixed
  numbers. The detector keeps a rolling baseline of the machine's own
  quiet rendering level (lower quartile over the visible history, never
  below the static floor) and a cliff is a DEEP crater on two axes at
  once, under 40% of the quiet level AND under 10% SM absolute.
  - Why: a 29-minute real match is bimodal on the same machine
    (roaming at 13–16%, combat at 40–50%). The old median baseline
    rode between the two modes and misread 16 mode transitions as
    collapses; the old fixed `prev > 40 → sm < 15` rule fired on
    burst endings (a 47% burst returning to a 14% baseline) while the
    real 4–5-second stalls at 3–5% SM passed silently.
  - `render_stall` is renamed `gpu_activity_cliff` everywhere (engine,
    reports, both locales): the event names the measurement (an
    activity cliff at 1 Hz), not a frame-time claim we never measured.
- Evidence freshness is per-source now, matched to each source's own
  cadence (GPU 2 s, emulator probe 12 s, visibility probe 30 s), and
  every snapshot is cleared at session start. The previous flat 2 s TTL
  against a ~10 s visibility cadence starved 85% of ticks of visibility
  evidence and silently muted the cliff rule for 8 of 9 real stutters
  in one session; the new TTLs restored 100% coverage with zero stale
  attribution (a snapshot older than its source's interval is dropped).
- `gpu_mem_idle` compares against the highest memory clock OBSERVED
  this session, not the theoretical max. On cards whose driver never
  approaches the queried max (a Quadro M2000M sitting at ~849 of a
  nominal 2505 MHz) the old comparison fired a dozen phantom "wake"
  cards per match; the observed reference silenced them while keeping
  the rule armed for a genuine idle-clock-while-rendering drop.
- Diagnosis correlation is temporal now: a collapse only confirms a
  wake card when it falls at or after the wake's start (a stall from
  minutes earlier no longer "confirms" a later wake), under named
  `LIVE_WINDOW_MS` / `CORRELATION_WINDOW_MS` constants.
- Session baseline warms up in ~10 visible ticks instead of 20, so early
  match play is judged on the machine's level sooner.
- The activity gate accepts a healthy share (60%) of the learned
  baseline instead of strict equality, mid-stutter the rolling average
  sags, and the old gate muted cliff detection halfway through the
  very stutter it existed to catch.
- Fonts: Inter (async webfont, first-paint swap) is replaced by subset,
  base64-inlined Google Sans (latin, OFL) + Cairo (arabic, OFL) split
  by unicode-range inside one stack, zero network fetch, zero
  first-paint text shift. IBM Plex Mono stays for numerals.
- Buttons and hint glyphs unified: About links, the sessions-folder
  button and the row delete action all ride the standard ghost Button;
  the MetricCard hint dot uses the same Info glyph as every other Hint.
- The Processes refresh button now forces a fresh read. It existed
  before but returned the same 10-second-cached numbers the silent
  5-second poll already showed, so presses visibly did nothing; the
  manual press now bypasses the cache (and warms it) while the silent
  poll keeps the cheap path.
- The background-window note is gone from the Monitor (it described a
  live state with a static sentence); its job moved to the one-time
  stay-in-game advice above.
- Session timeline is pinned left-to-right by design (it plots clock
  time; numerals read LTR even in Arabic) so spike markers track the
  reading direction; report bullets use logical insets and the Reports
  back-chevron mirrors in RTL like the sidebar chevrons.

### Fixed
- Phantom `cpu_throttle` crit events from a `-1` proc-perf sentinel:
  typeperf occasionally emits `-1` on transient PDH glitches, and the
  detector trusted it ("CPU frequency at -1% of nominal"). Negative
  readings are now rejected at parse time on both sampler paths
  (typeperf native + PowerShell PDH fallback): a negative ratio is
  no reading, not a throttle.
- `FIRST_SAMPLE_AT` lied after the first session in a process (a
  `OnceLock` set once ever, so session #2 logged "first sample:
  860383ms"). It is per-session now; TPM logs show honest ~4 s values.
- The pre-scan advice modal could appear a full launch late: it gated
  on game-detection while the first-run advice flag stayed sticky for
  the whole launch, deferring everything past it. It now fires on the
  first real session start, and "is the other dialog up" is derived
  from live toast state instead of a sticky boolean.
- Stale `game_visible=None` handling: samples with no probe result yet
  are treated conservatively (GPU rules muted) instead of joining the
  activity history as if visible.

### Tests
- Engine: 74 lib tests (fingerprints for every fixed false pattern,
  burst endings, shallow light-scene dips, mode transitions, and every
  real session stutter shape, plus churn open/close/guards and the new
  TTL + theme settings tests) + 2 live integration tests.
- Frontend: 22 Vitest tests across 5 files (theme resolution, version
  comparison, error mapping, locale parity, update flow).
- `cargo clippy --all-targets -- -D warnings` clean, `tsc` clean.

## [1.3.0] - 2026-09-06

### Added
- In-app update flow. When a newer release exists, a modal appears once on
  the Monitor screen (and the same modal opens from About, both via the
  manual check and the "download it" link). The update check moved from the
  webview into the engine (Rust, allowlisted GitHub hosts, blocking pool),
  the webview makes no network requests anymore and the CSP
  `connect-src` entry is gone. The flow is deliberately honest for a
  portable tool: no self-replace, no auto-restart:
  - "Update" opens the native save dialog (official dialog plugin) with the
    official versioned file name pre-filled, then downloads with a live
    progress bar and a cancel that leaves no partial file behind.
  - The downloaded exe is verified against the published SHA256SUMS.txt
    before it is ever written to the chosen path, files fetched by an HTTP
    client carry no Mark-of-the-Web (SmartScreen will not warn), so the
    hash check is the real protection here.
  - On success: "Open folder" opens Explorer with the file selected, plus
    one line of guidance ("close the app and run the new file"). Release
    notes render as plain text, never HTML.
  - Once-per-version: closing the modal records the announced version; the
    modal never nags again for that version, but a warn-yellow dot on the
    About entries (sidebar + Updates heading) carries the signal for the
    whole life of the release. The next version announces fresh. Manual
    checks from About always open the modal, announced or not.
  - First-run priority: the modal never appears for a user who has not
    completed the welcome screen, welcome first, updates later.
  - A GitHub 403/429 (rate-limited shared IPs, common behind Cloudflare
    WARP) is logged with the API's own reason line, not a bare "http 403".
  - The Windows system proxy (registry, the same setting browsers use) is
    honored for users whose VPN/proxy tools don't set env vars.

### Fixed
- Startup freeze ("Not Responding" for up to a minute, every launch on machines with an
  HDD): the rig-info query runs `Get-PhysicalDisk`, a live hardware inventory (SMART
  probes over every spindle) that costs 20+ seconds on such machines, and it ran on the
  IPC dispatcher thread, freezing the whole window until it finished. The rig profile is
  now cached on disk (`system-cache.json`): the first run pays the inventory once in the
  background, every later launch reads the cache in microseconds (measured: 28 s → 2.3 s
  ready on the dev machine's HDD+NVMe setup). All potentially slow commands became async
  on the blocking pool in the same pass, no IPC command can freeze the window anymore.
- Update check compared versions as strings: any different tag, including an OLDER
  one, showed "new version available", and "1.10.0" would lose to "1.2.0". Versions
  are now compared numerically (major/minor/patch) in one shared helper used by both
  the startup check and the About tab.
- About's manual update check claimed "up to date" when it actually couldn't know (no
  release tag or no local version): those cases now honestly report a check failure.
- The Checks tab's "Open setting" buttons never actually sent the panel argument over
  IPC (the webview-side binding dropped it): the power/pagefile buttons did nothing.
  Found while wiring the update flow's dialog permission; both are fixed.

### Added
- Flight-recorder technical log, the log was near-useless for diagnosing user reports
  (13 lines on a busy day, zero durations, panics invisible). It now covers:
  - Boot timing: `window shown: Xms`, `app ready in Xms`, slow launches visible at a glance
  - Every panic recorded via a panic hook that works even with `panic = "abort"`
    (installed before any thread spawns, lock-free writer for the dying moment)
  - Timings for every IPC command (`ipc: system_info: 21s (slow)`, WARN above 2 s)
  - Session lifecycle: stop reason, sampler spawn results, first-sample latency, GPU
    max clocks, window visibility at start
  - A one-line rig profile at boot (`rig: ram=…MB disks=… gpu_counters=… powershell=…`)
  - The sampler's 9 debug lines moved from `eprintln` (which is wiped in release builds,
    where the app has no console) into the real log
- Limited mode: a conservative one-shot probe detects whether PowerShell is usable at
  all (missing binary, execution-policy block, or a 5 s hang all read as unavailable).
  Sessions keep working (typeperf/tasklist/nvidia-smi are native), but the UI honestly
  shows what degrades, adaptive thresholds fall back to defaults, timestamps may read
  UTC, GPU window checks stay muted, instead of failing silently.
- CI (GitHub Actions, `windows-latest`): vitest + frontend build, engine tests including
  the live typeperf pipeline, and clippy with `-D warnings`. A full release build job is
  available on manual dispatch until it proves stable.
- Frontend unit tests (Vitest, 13 tests): version comparison, error-code-to-dialog
  mapping (extracted from App.tsx into a pure, testable function), and locale key parity
  between en and ar.

### Changed
- The Arabic locale is now type-checked against the English one (`ar: Locale`): a
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
  via `spawn_blocking`, the async runtime and the UI thread never stall on it.
- The update flow's security surfaces are unit-tested: SHA256SUMS line parsing
  (including the GNU `*name` marker), the download-host allowlist (https +
  GitHub hosts only, redirect-aware), and the numeric version comparison on
  the engine side (mirroring the frontend's). The once-per-version decision
  logic is a pure function with its own Vitest suite.
- Rust test suite grew from 46 to 54; frontend grew from zero to 19 Vitest
  tests (version comparison, error-to-dialog mapping, locale parity, and the
  update-modal decision rules).

## [1.2.0] - 2026-09-04

### Fixed
- Clock and session times showed UTC instead of the user's local time, on Egypt (UTC+3) a
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
- The reports list did not refresh after a session finished, a finished scan only appeared
  after restarting the app. The list now re-reads every time the Reports tab is opened.
- First-run flash: on a fresh install the main UI appeared for a few seconds, then flipped to
  the welcome screen. The welcome decision now resolves before anything decisive renders.
- The "GameLoop closed" notice could appear in a stale language if the user switched language
  mid-session, dialog text now always follows the current language.
- Duplicate guard threads: rapidly starting a new session could leave the previous session's
  liveness guard and auto-stop timer running in parallel (doubling the probe cadence). Each
  session now carries a generation number; old guards retire the moment a new session starts.
- Child-process leak on hard crashes: with `panic = "abort"`, a force-killed app left
  typeperf (up to ~9 h) and `nvidia-smi dmon` (forever, it had no cap) running behind. All
  spawned sources are now assigned to a Windows Job Object with kill-on-close, if the app
  dies, the kernel reaps the children with it.
- The pagefile "Open setting" button opened the System Properties **General** tab, not the
  page where virtual memory lives. It now opens the Advanced System Properties page (the
  Performance/Virtual memory dialog is one click away), and the promise in the checks tab
  copy was softened to match reality.
- Build warnings: 6 clippy warnings (an 11-argument function, missing `Default`, clamp-like
  patterns, and more) and a Vite `INEFFECTIVE_DYNAMIC_IMPORT` warning, all gone.

### Security
- `open_url` now enforces its own allowlist in Rust (https + github.com/api.github.com/paypal.me
  only). The comment previously claimed the opener plugin's capabilities scoped this command,
  they do not: plugin capabilities only guard the JS-side command path, and a Rust-side opener
  call was unconstrained. Practical risk was low (the UI passes fixed URLs), but the claimed
  protection now actually exists.

### Changed
- The release binary now carries its version in the filename straight from the build
  (`pubg-gameloop-lag-hunter-<version>.exe`, via Tauri's `mainBinaryName`): no manual renaming.
- Removed the unused `log = "0.4"` dependency (the engine has its own logger).
- Docs: the "capped at 2 h" comment corrected (the cap is 1 h), the reference to a
  nonexistent release workflow removed, and the headless `engine_probe`'s unbounded sessions
  documented as intentional.
- Test suite grew from 44 to 46 (time-zone truth test against the OS clock, live Get-Counter
  emitter check, GUID and Arabic-name power-plan matching).

## [1.1.0] - 2026-09-02

### Fixed
- Phantom GPU cards: GPU rules (power-state wake, low clock, temp) no longer fire while the
  game window is minimized or on a static screen (lobby/result): desktop activity was being
  reported as in-game GPU problems.
- `gpu_wake` cards now require a measured frame freeze (render stall) within the live window,
  a wake story with no recorded hitch stays in the activity feed only.
- Returning to the game after minimizing no longer registers as a render stall.
- Missing dialog buttons (Cancel/Delete) rendered empty in Arabic.
- External links in the About tab did nothing (`open_url` was never registered).
- GPU utilization columns were never read (dmon needed the `u` selector): GPU metrics showed
  `--` on all NVIDIA machines.
- Honest WebView2 disk footprint (~2 MB is the downloader only; the runtime needs a few
  hundred MB) in README and the missing-runtime dialog.
- Start-button behavior described accurately (always pressable; pressing without the game
  shows an explaining dialog): it never "lit up".
- Versioned release naming (`pubg-gameloop-lag-hunter-<version>.exe`) no longer makes the
  tool appear in its own top-processes list.
- GPU VRAM above 4 GB reported correctly (nvidia-smi instead of the 32-bit CIM field).
- Session loading and report opening validate session IDs the same way deletion does.
- Start/Stop toggle no longer jitters (stable width + matched icon sizes).
- Tab switching no longer unmounts and rebuilds every view, all tabs stay alive and switching
  is instant (a CSS-visibility bug briefly stacked all views on top of each other; fixed the
  same day).

### Added
- Playing-state gating: the engine knows whether the game window is visible and whether real
  rendering is happening, "is the user actually playing?" gates every GPU rule.
- GameLoop-closed notice: when the game closes mid-session, a dialog explains why the scan
  stopped (once per session; manual stops stay silent).
- First-run advice dialog after the welcome: start the game first, stay in it while scanning.
- Background note in Monitor while the game window is minimized.
- Reports flag sessions spent mostly outside the game ("Most of this session was not actual
  gameplay") with a background-percentage statistic.
- Honest `gpu_wake` advice: what to do if "Prefer maximum performance" is already set and it
  still appears (driver memory-clock trimming on hybrid-graphics laptops).
- Stop reason (`manual` / `auto_stop` / `gameloop_closed`) travels with every state push.
- A small "?" tooltip on each metric card (CPU/RAM/GPU/Disk) explains what it measures,
  per-metric text in English and Arabic, replacing the single generic hint row.
- Live refresh in Top processes (every 5 s) and System checks (every 30 s) while their tab is
  the active one, silent, never disables the manual refresh button.
- Background prefetch at launch: system info, checks, and top processes are warmed before
  the user opens those tabs, the first open is as instant as every later one.
- TTL caches with stale-while-revalidate for top processes (10 s) and system checks (30 s),
  tab revisits never re-pay a PowerShell spawn.

### Changed
- Default scan duration for new users: 30 min → 5 min.
- Longest scan duration removed: the 2-hour option is gone; the hard cap is now 1 hour.
- Stop button is now filled red (was an outline): matches the app's filled-active language.
- Sidebar and title bar have visible borders again (separate planes).
- Sidebar collapse control moved to the bottom of the sidebar.
- Unified product description everywhere (README, About, welcome): "Analyze your PUBG Mobile
  performance on GameLoop, detect stutters, and uncover exactly what's causing them."
- App version now comes from one source (tauri.conf.json): TitleBar, About, and the update
  check ask the backend instead of hardcoding.
- Arabic copy upgraded to formal register (فصحى) across the new strings.
- README restructured (screenshots first, tables, step-by-step usage); CONTRIBUTING,
  ARCHITECTURE, SPEC, and SECURITY reformatted to match.
- Test suite grew from 33 to 42 (playing-gate coverage, wake correlation, background stats,
  versioned self-detection).

## [1.0.0] - 2026-09-01

First public release.

### Added
- Real-time monitoring of CPU, RAM, GPU, and disk while PUBG Mobile runs on GameLoop, one sample per second.
- Root-cause diagnosis of stutters in plain language (disk paging storms, CPU saturation, thermal throttling, GPU power-state hitches, first-load freezes), each with a recommended fix.
- Detection thresholds adapt to the machine (RAM size, physical disk count): same rules on an office laptop and a tower.
- Live activity feed: everything the engine notices, newest first.
- Session reports with honest outcomes (Clean / Findings / Lag captured / Partial), key moments, and plain-language numbers.
- Report cards group symptoms by cause, one disk storm shows one card, not three.
- Auto-stop sessions (5 min to 2 h, default 5 min): nothing runs forgotten.
- GameLoop gate: scanning starts only while the game is running; auto-stops ~15 s after GameLoop closes.
- System tab: your rig + what we can see.
- Top processes tab: who is eating the machine (GameLoop excluded, it's the game, not a suspect).
- System checks tab: read-only checks of lag-inducing Windows settings (power plan, pagefile, charger) with one-click jumps to the exact Windows page, the tool never modifies your system.
- Full English and Arabic interface with automatic OS-language detection and a language toggle.
- Technical log with 7-day rotation (`%LOCALAPPDATA%\LagHunter\logs`) for support and self-diagnosis.

### Engineering
- Single binary, no installer required, download and run.
- Fixed-size window (940×600) with a custom title bar; one visual plane.
- Single-instance: a second launch focuses the first window.
- Atomic settings writes with schema migration (v1 → v3 preserved across upgrades).
- 33 automated tests covering detection fingerprints, settings migration, and security (path traversal, corrupted files, crash classification).
