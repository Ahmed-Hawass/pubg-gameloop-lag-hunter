# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Storage sweep in the Storage card: a Scan button measures four safe
  places (user temp, Windows temp, Recycle Bin, update sharing cache),
  checkboxes select what to delete, and one Clean button removes only
  the ticked places after a confirm dialog. Locked files are skipped,
  freed space is measured before and after (never estimated), and the
  two admin places go through one UAC prompt per clean with a silent
  rollback on refusal. Shader and prefetch caches are deliberately out
  of scope (rebuilding them causes the first-load hitches this tool
  diagnoses), as are the registry, RAM boosting, Downloads, and browser
  caches. Refinements: the bin is measured by walking $Recycle.Bin per
  drive (the Shell probe undercounted folders), the summary edge reads
  the last scan (green under 500 MB, warn above), zero rows stay visible
  but muted with disabled boxes, a per-category progress bar rides both
  scan and clean, and a numbers-only history feeds the summary
  (last run plus last-30-days) with success lines in the technical log.
  The sweep never scans by itself (Scan is the only trigger), an
  all-unreadable scan reports a read failure instead of a clean drive,
  and runs that free nothing leave the history untouched. An opt-in
  deep scan shares the card through a Quick versus Deep
  toggle with one Scan button. Quick holds the three no-judgment
  places (both temps plus update sharing); Deep gathers all nine
  (those plus the bin, update leftovers, system logs older than 7
  days, thumbnails, finished reports, and dumps older than 30 days).
  Nothing deep is ever auto-ticked, and Clean takes only the ticked
  rows of the visible set, measured and logged the same way. Recent
  dumps and fresh logs are never touched. One toggle selects or
  clears the visible list only (never the set hidden behind the mode).
  Partial reads report no-data instead of a short sum, and admin
  verdicts are measured by the elevated run itself (an unmeasurable
  clean says so instead of printing 0).
- Tools wears a Beta pill in the sidebar until v2 goes stable: the tab
  writes to Windows and ships early, so it stays labelled (the cards
  themselves carry no pill).
- Page file editor in the Storage card (elevated), mirroring the Windows
  Virtual Memory dialog: an automatic-management checkbox for all drives,
  one selectable row per fixed drive, and per-drive system-managed,
  custom, or no-paging-file modes with the dialog's own validation
  (digits-only at the keystroke, 10-digit cap, 16MB floor, free-space
  bound). Only the selected drive ever changes; every other drive is
  preserved exactly. Confirms before removing a drive's file or going
  below 8GB, verifies by re-read, and every write ends in a
  Restart-now-or-Later offer (Restart now reboots immediately, Later
  leaves the self-clearing pending note). The editor collapses under a
  summary row carrying the live status (plus a restart badge while a
  reboot is pending). Empty entries end the drive list exactly like
  Windows reads them (never skipped), and every rewrite drops strays,
  healing poisoned lists instead of preserving them. No auto-reboot, no
  invented sizes.
- High Performance power row (first elevated tweak): one switch for the
  built-in plan (restored with Microsoft's own command when missing),
  OFF restores your previous plan from settings, verified by re-read
  through one UAC prompt per flip (a refused prompt rolls back
  silently). The health power card links to the row; S0-only machines
  and active Ultimate hide it instead of pretending.
- Per-action elevation groundwork (no user-facing change yet): an
  elevated id runs as the same binary with a hidden flag through one
  UAC prompt per flip (never at launch), writes only, then exits while
  the normal flow verifies by re-read. A refused prompt reports exact
  "cancelled" and rolls the switch back silently (a choice, not an
  error); only a failure after consent shows the Dialog.
- Tools is two cards now: Gaming tweaks (the six game rows, no area
  dividers left inside) and Storage (Storage Sense moved there, with a
  placeholder note until the storage phase starts).
- Tools rows carry a (?) background note behind the row name: at most 3
  plain-language sentences per tweak (what it does, when it helps or
  hurts, one-tap revert), shown in the one unified Dialog, never invented
  numbers. The Game Mode note is the documented case (independent
  frame-time tests under background load, CPU-maxed exceptions named).
- System health cards carry the same (?) background notes as Tools: the
  DVR card reuses the Tools note verbatim (same option, same note),
  power, pagefile, VT, and charger own theirs. Same contract (plain
  language, at most 3 sentences, no invented numbers, one unified
  Dialog); states and effect timing stay in the card's own lines.
- System health DVR card links inside the app: its button opens the Tools
  DVR row directly (same card name on both sides, smooth scroll plus focus
  plus a temporary ring, one-shot like the Reports deep link) instead of
  the Windows Settings page. Every other health card keeps its external
  page: power and pagefile have no in-app counterpart yet, and VT/charger
  can never have one (BIOS and hardware).
- Performance tweaks: five new rows in the Tools tab Gaming group (the
  System tweaks card is renamed, content unchanged): Game Mode on/off
  (both master toggles together), per-exe high-performance GPU
  preference for the GameLoop renderers, per-exe fullscreen-optimizations
  opt-out, pointer-precision off, and windowed-games optimizations. Same
  contract as the existing rows (live mirror, optimistic flip, verify by
  re-read, audit log); the two per-exe rows resolve GameLoop paths live
  from Tencent's own InstallPath values plus the stock location, writes
  touch only our own token/flag (sibling tokens and foreign flags are
  preserved), and turning a row off reverts to Windows decides instead of
  ever forcing power-saving — except windowed-games off, which writes
  `=0` exactly like the Settings toggle itself does (verified live).
  Row copy states the function plus the required action (close and reopen
  the game), never bare mechanics; the mouse row states plainly that it
  is a feel preference with no FPS claim. The windowed row hides below
  Windows 11 (no such toggle to mirror there) and its backing store
  (DirectXUserGlobalSettings) was identified by live before/after
  registry diffing, not from guides.
- Per-exe rows that cannot resolve GameLoop render greyed-out with a
  translated reason instead of hiding: a missing precondition the user
  can fix (install GameLoop) must explain itself, while rows that can
  never work here (unsupported OS build) still hide. The GPU row
  additionally hides below Windows 10 1803, whose builds ignore the
  preference value while a re-read would still verify: a manufactured
  success the gate refuses to ship.
- Tools tab: a System tweaks card (theme-aware spot illustration) opening
  a list grouped by area. Switches mirror the live Windows result (ON =
  the named action holds right now, whoever flipped it): optimistic
  flips, explicit writes both directions, verify-by-re-read, audit log,
  rows hide when the Windows build lacks the feature, and fresh reads on
  open and window focus pick up manual changes. Engine: tweaks.rs
  (HKCU-only writes, whitelisted ids, value validation) plus the
  set_tweak IPC command, and Storage Sense availability/value inside
  SystemChecks.
- Boot log carries the Windows build (registry read via winreg, no
  PowerShell), and hiding a feature row on a build that lacks it is
  logged explicitly: every user-sent log is readable on the 10/11 axis
  from its first line.
- All registry access goes through winreg in-process: a toggle answers
  in milliseconds instead of seconds, string-built scripts (and their
  quoting traps, the .'01' bug class) are structurally impossible, and
  access errors come back as typed Results instead of silently empty
  output. Storage Sense writes through a dedicated KEY_SET_VALUE handle
  (the read handle is KEY_READ only; writing through it was os error 5,
  verified live and fixed).
- ESLint (typescript-eslint recommended + the react-hooks rules) wired as
  npm run lint and a CI step before the tests: the repo had no lint
  anywhere, the exact gap the summary-timer bug slipped through. The
  deliberate fire-once effects carry documented suppress comments.
- Single-session delete is guarded at the engine level: deleting the live
  session is refused with a SESSION_RUNNING key (en + ar) no matter what
  the frontend passes, under the same filesystem guard as start and bulk
  delete.
- Shutdown is a gate, not a hope: closing the window marks shutdown first
  (plus a generation bump retiring guard threads), and a start racing the
  close is retired with an APP_SHUTTING_DOWN key (en + ar) instead of
  spawning samplers mid-exit. A stop that finishes with no report behind
  it surfaces SESSION_SAVE_FAILED instead of going quiet.
- Slow system queries speak keys, not English: a PowerShell timeout in the
  rig inventory, top processes, or health checks returns
  POWERSHELL_TIMEOUT (en + ar) on the existing inline EmptyState with its
  retry path. The one-time hardware inventory gets a 30s bound (then
  disk-cached); polls stay at 15s, and every probe (typeperf, nvidia-smi,
  tasklist, visibility, clocks, RAM, disks, powercfg) runs under a tracked
  deadline inside the kill-on-close job.
- Storage writes are honest end to end: append, flush, autosave, and
  finalize return errors instead of swallowing them, the summary carries
  a storageWriteFailed flag, and the autosave cadence ticks on every
  sample even while writes fail (a frozen counter used to turn it into a
  per-tick storm).
- Settings flips roll back visibly: theme, auto-stop, sidebar, and
  language revert on a failed write (the first three through the dialog,
  language silently), and Tools notifies Checks through a local
  feature-state event so the health cards refresh right after a flip.
- Closing the window asks first when work is in flight: the X button
  opens an exit confirm naming the running scan (stops, report saved),
  the active download (cancelled), or the running cleanup, on the one
  modal surface with a red Exit button on the standard frame. Cancelling
  is non-destructive and quiet work still closes straight away.

### Fixed
- Power ON no longer clones a new plan every flip: duplicatescheme mints
  a fresh GUID on each run, so "builtin missing" as presence check
  re-created forever. Presence is any performance-class plan now, the
  switch activates what exists, creation happens only at zero plans, and
  verification reads performance-class instead of one GUID.
- The Ultimate Performance GUID was a transposed variant that could
  never match, so Ultimate machines fell through to name matching (and
  Arabic Ultimates to a false "switch to High performance" warn). It is
  Microsoft's documented GUID now, pinned by a test, with the reported
  Arabic display name as fallback.
- The sustained CPU perf cliff (the spike rule) fires on AMD/Intel too:
  it used to live behind two early returns inside the GPU cliff path, so
  machines without an nvidia-smi feed could never reach it (pure CPU
  evidence silenced by a GPU gate). It is its own check fed every
  sample, GPU or not, with the same load gate and accumulator semantics.
- Open conditions keep their cards beyond the 5-minute live window: a
  condition that stays open (mem_pressure for 20 minutes) emitted one
  Start, it aged out of the window, and the card vanished while the
  problem was ongoing with Overall still red and nothing explaining why.
  A Start with no later End for its kind is still open by definition and
  passes the age filter; closed conditions still expire.
- Cliff classification is decided once, at emit time. The diagnoser used
  to re-derive it from the LATEST sample, so a cliff that fired while
  the machine was healthy retroactively read as gpu_busy minutes later
  once the machine dipped (and the reverse), and the saved report carried
  a third, static dictionary that could disagree with both. The event kind
  carries the answer; the report dictionary is pinned to it by a parity
  test over every known kind.
- The others_ok gate is machine-tuned (moved onto Thresholds): disk-queue
  and RAM-floor bars are the session's own (a static 0.5 called a healthy
  2-disk machine loaded; a static 2048MB bar read a mem_pressure 64GB
  machine healthy). The missing-counter abstention rule is unchanged.
- check_gameloop_alive applies its TTL: the comment always promised fresh
  evidence but the code read the raw snapshot, so a dead probe thread
  left the session running on ghost evidence. A stale read counts as a
  miss now.
- Session start order: the cross-session snapshot wipe ran AFTER the
  visibility/emulator probes stored their fresh results, discarding the
  probes' work in the same critical section every time. The wipe runs
  first, then the seeds, so tick zero carries real evidence.
- Same-second restart no longer truncates the previous session: ids are
  second-resolution and File::create truncates, so a stop+start inside
  one wall-clock second destroyed the just-finalized session's samples.
  A collision takes a monotonic -2/-3 suffix; ids stay sortable.
- The live session is hidden from the reports list by the ENGINE's own
  id, not the file heuristic that broke at the first autosave (~50s in,
  summary.json appears with partial:true and the half-written session
  showed up as a half-finished report).
- Severity escalates while a condition is open: a saturation opening at
  86% (warn) then pegging 99% used to keep a medium card for the whole
  condition. One Instant escalation event now fires when an open warn
  condition crosses into crit; the diagnoser keeps the worst severity.
- Correlation pairing is per window: a cliff in the gap between two
  churn windows (or before a wake started) confirms nothing. The old
  earliest-wake check and first-start/last-end envelope are gone.
- Settings writes are serialized (one settings::update lock across the
  read-modify-write; overlapping set_* commands used to race on the
  fixed .tmp name and the loser's change silently vanished).
- Download single-flight is enforced in the engine: register_cancel used
  to write over a live download's Arc, dropping its only cancel path.
  watch_gameloop spawns its never-exiting watcher thread once per process.
- Counter values parse in both decimal cultures: typeperf CSV is always
  dot-decimal, but the PowerShell Get-Counter emitter formats with the
  CURRENT culture ("12,5" on de-DE/fr-FR). One parse_counter_value serves
  both paths; the emitter splits pairs on the path separator so a comma
  inside a value survives; the first converted value logs one culture
  line. The live typeperf integration test was also locale-brittle (it
  asserted the bare parse the production code does not do) and now checks
  what actually runs.
- The report events table reads timestamps with .get instead of a raw
  slice: a malformed timestamp from a future producer would panic the
  finalizer, and the app builds with panic=abort.
- The WebView2 boot probe also checks the per-user install under
  LOCALAPPDATA (common on non-admin accounts): those users got a false
  runtime-missing dialog and could not start the app at all.
- Report metrics are machine keys + raw numbers, not English sentences:
  Arabic users read English lines in the middle of an Arabic report. The
  locale files own the sentence per language; unknown keys fall back to
  key: value, never a blank line.
- Frontend honesty pass: the summary auto-dismiss timer actually expires
  (an unstable callback identity restarted it on every App re-render), the
  advice flags reset by the FLAG not the toast value (a stuck-high flag
  silently suppressed the update modal for the rest of the launch),
  SystemView recovers from a transient failure (retry + window-focus
  re-read instead of a dead tab until app restart), ChecksView keeps its
  header above the error state, ProcessesView queues a manual press that
  lands mid-poll, and UpdateModal guards the save-dialog path (closing
  the modal while the OS dialog was up, then confirming, started an
  orphaned download with no UI attached).
- Keyboard and screen-reader fixes: report rows are focusable buttons
  with Enter/Space handlers, confirm dialogs move focus to CANCEL (Enter
  on the trigger used to re-fire the delete through the overlay),
  radiogroup options carry role/aria-checked, window controls and the
  metric-hint trigger have accessible names, the sidebar announces the
  current tab, and the update dots are polite status regions.
- Dead code out after consumer greps: Detector.gpu_max_mem,
  GpuSample.pstate, and a comment documenting a helper that never
  existed. The GameLoop process-name list is ONE const now (the matcher
  and the visibility probe built their own copies).

- Logging unit tests no longer touch the production logs directory: they
  aim the same code at throwaway temp dirs, so `cargo test` can neither
  write into nor prune (7-day retention) the real flight-recorder logs.
- Session events/summary (and the rig cache) are written atomically
  (temp file + rename, the settings pattern): the Reports list reads
  those files while autosave rewrites them, and a reader must only ever
  see the previous complete file or the new complete file, never a
  truncated half-write.
- Bulk delete is serialized against session start at the engine level:
  the live-id snapshot used to be taken before the background deletion
  task ran, so a session born in that window could slip into the walk
  unexcluded. Both sides now share one guard, taken in the same order.
- Settings migration persists through the same serialized update path
  as every set_* command: a first-boot toggle landing in the same moment
  as the upgrade write can no longer be overwritten by it (the legacy
  prefs file is retired only after the upgraded file commits).
- An in-flight update download is cancelled when its modal is swapped out
  mid-flight (a GameLoop-closed push or a one-shot advice used to unmount
  the UpdateModal silently and orphan the engine-side stream; only the
  Escape path cancelled before).
- The update Download button re-fires while the OS save dialog is open
  (the dialog does not block the WebView): a second click opened a second
  save dialog and raced two downloads. The button is busy-gated for the
  whole offer, save dialog, and download handoff.
- Unknown backend errors no longer ship raw English into an Arabic
  interface: the locale explains (a new unknownErrorBody key, en + ar)
  and the raw message rides along as a technical line.
- Error surfaces follow one rule now: ACTION failures (open a report,
  delete a session, open the folder, a failed tweak write) show the one
  Dialog; LOAD failures (a tab's data) show an honest EmptyState with
  the retry path that already existed. The stray inline red line in
  Reports (and its reports-error CSS) is gone; Processes' inline line
  became the same EmptyState.
- Tools › System tweaks no longer spins "Loading..." forever when the
  underlying checks read keeps failing: the details page states the
  failure honestly, and the switch busy gate is a ref (a double-click
  could slip two writes through the state gate).
- A view-level dialog (Reports' delete confirmations, Tools' notice)
  yields when the app-level dialog opens on top of it: two stacked
  overlays meant one Escape closed both. A dedicated APP_DIALOG_OPEN
  signal (separate from the tooltip-hiding one) drives the yield.
- The sessions "Open sessions folder" and "Delete all" buttons render
  only with saved sessions again (the agreed empty state for a fresh
  user). The engine still names the root itself (a new sessions_root
  command): no path string surgery in the UI, and the sessions folder is
  created at boot so a missing folder can never produce an os-error-2
  dialog in the first place.
- Arabic counting: spikesCaptured no longer doubles "one" ("تم رصد 1
  تقطيعة واحدة"), and spikeCount uses proper MSA forms (dual for 2,
  plural for 3-10, singular for 11+).
- Standalone measurement units render Latin in Arabic ("25 MB", "32 GB
  RAM", "5m 30s"): the unit keys stay (1:1 parity holds), their values
  are the technical token users read natively. Explanatory sentences
  stay Arabic.
- Ctrl+Shift+J (the devtools console) slipped through the
  browser-shortcut block; only Ctrl+Shift+I was covered.
- CPU p95 in reports is nearest-rank: every session under 21 samples
  reported its MAXIMUM as p95 (a floor-index artifact of the old
  formula).
- Command failures are LOGGED before they reach the UI (open_path,
  open_url, open_windows_panel, set_tweak, load_report, delete_session,
  delete_all_sessions, open_download_folder, download_update): the
  open_path os-error-2 shipped for weeks as a user-visible dialog with
  zero log lines.
- New-format settings files are recognized by version, not by content: a
  v3 file without the legacy sensitivity key used to be misclassified as
  legacy and reset every pref (language, theme, onboarding) on the next
  launch, then saved back over the real file. Version 3+ is current by
  definition now, pinned by regression tests.
- The updater follows redirects by hand: each hop is allowlisted before
  the next request (the library used to follow six hops internally and
  only the final URL was checked), and release metadata is capped at 2MB
  with a UTF-8 check so a hostile feed cannot OOM the parse.
- Pagefile writes are atomic with rollback: the previous automatic flag
  is read first and restored if the entries write fails, so a failure
  can never leave automatic off with stale entries behind it. Reads are
  strict too (a missing automatic flag is unknown, a missing list is
  empty, any other error is unknown).
- The Recycle Bin is measured user-scoped through PowerShell (walking
  every SID could count other users' items that the clean would never
  remove for this user), and a clean re-measures only the selected ids
  (the full-map re-read is gone); ticked rows that come back empty are
  pruned, and the summary edge dedupes quick/deep overlap by id.
- Top-processes and health-checks queries are serialized per source (one
  query lock each, reused by warm-up): rapid tab flips past the TTL could
  spawn unbounded parallel powershell.exe bursts. The rig disk cache
  expires after 30 days instead of living forever, with a logged warning
  when its write fails.
- Finalize is best-effort: a failing disk still leaves a listable partial
  session (summary.json is the commit point everything else degrades
  toward) instead of an invisible directory the summary card points at,
  and storageWriteFailed maps to the partial outcome in both the list
  and the reader.
- The engine state subscription registers before the cold-boot snapshot
  resolves, so a push landing between the two can no longer be
  overwritten by the marginally older snapshot; the app version is asked
  once and shared by the title bar and About (it used to be two IPC
  calls).
- The Monitor report card no longer opens a dead "no longer saved" error
  for a just-finished session: the deep link arrived with the stale
  Reports list (the tab only refreshes on visibility) and the one-shot
  link cleared itself on the first miss. A first miss now triggers one
  fresh re-read and resolves on it, so only a miss on the fresh list
  reports.
- Cleanup rows are real rows, not labels: the hint (?) button nested
  inside the row label used to toggle the checkbox as a side effect. Rows
  are divs with aria labels now, and the System/Processes/Checks load
  failures prefer the locale copy for known backend keys (raw English
  only for genuinely novel failures).
- Tools confirms yield to the app dialog like the notices already did:
  the pagefile, clean, and reboot offers no longer stack under the exit
  confirm (all three are re-askable, and Later stays the reboot default).

### Changed
- The Tools tab's details page reads only the two switches it displays,
  live from the registry in microseconds (a new tweak_states command):
  every visit used to pay a full system_checks PowerShell batch
  (powercfg + CIM queries, 0.5-2s) for rows the page never shows, on tab
  open and on every window focus. The freshness guarantee is unchanged
  (still a live read on details open and on focus return), and the
  focus re-read no longer fires while the landing card shows.
- The diagnoser correlator builds its indexes in ONE pass per tick
  instead of nested full scans (events × starts) while holding the
  session lock, and the live view reads a bounded 15-minute window
  (still-open conditions ride along however old) while the full history
  stays the source of truth for autosave, finalize, and the saved
  report. The correlation-window inequality is compile-time asserted.
- Hard-fault instants stop firing on every tick while the paging-churn
  or disk-queue condition is already open describing the same storm
  (a 10-minute storm used to emit ~600 near-identical events that
  polluted the feed and double-counted the disk evidence).
- A still-open gpu_wake/paging_churn condition no longer drives the red
  "Lag" banner on its own (its card is correlation-gated, so the banner
  showed red with zero cards explaining why).
- The RAM bar shows "--" (honest no-data) when the available reading
  meets or exceeds the assumed total, instead of painting a permanently
  full stick (the 8 GB fallback meeting a 32 GB machine).
- Window chrome and the save dialog route through bridge.ts like every
  other backend call (the three files that called Tauri APIs directly
  now use wrappers), and the dead frontend copy of the version
  comparison was removed: the engine's comparison is the single source.
- Streaming sources (typeperf, the PDH emitter, nvidia-smi dmon) are
  reaped by a watchdog even when their stream goes silent mid-session:
  a wedged emitter used to outlive every stop/start cycle until app
  exit. Session sample counts are streamed (buffered line walks)
  instead of reading whole samples files into memory on every Reports
  refresh.
- The OS theme answer is seeded on <html> before the first React paint
  (the common cases render flash-free; a saved theme that contradicts
  the OS still settles after the settings IPC, unavoidable without a
  synchronous bridge).
- The About cost list no longer claims the tool never modifies Windows:
  it promises a change only by the user's own switch flip. Two stale
  "two switches" comments (bridge, engine) now say switches.
- The System health intro no longer talks about read-only mechanics:
  it names what the tab is (the machine's most important settings) and
  promises one-click help. The product docs (README, SPEC,
  ARCHITECTURE, CONTRIBUTING) now describe settings changes the same
  way the app behaves: only by the user's hand, verified by re-read.
- The settings file no longer stores the dead sensitivity/thresholds
  fields (thresholds are computed per device each session), and the
  PowerShell poll budget const is platform-independent so non-Windows
  targets keep compiling.
- The window opens at 1180x760 (min 960x620): content pages breathe at a
  1100px measure, System health stays one readable column at every width,
  the Tools grid collapses to one column under 760px, and the unused
  quiet-danger button variant is gone.
- Scrollbars are thin and themed (6px, thumb-only on a transparent track,
  hover lightens, stable gutter so pages never shift): the hidden-bar
  experiment removed every scroll affordance on data pages whose lists
  are unbounded by nature.
- "machine" reads "device" across the English copy (laptops included by
  definition; the Arabic copy already said device), and the
  Windows-temp hint drops the skipped-files clause.
- The scan timeline fill is one step heavier and its header always reads
  the session duration (the auto-stop word is gone).

### Removed
- The System health disk-space card is gone (measurement only, no in-app
  fix, and its Storage Sense page link duplicated a destination nothing
  else needs): the struct fields, the Win32_LogicalDisk query line, the
  level helper with its test, the "storage" panel route, the card, and
  both locales. Storage Sense itself stays as a Tools switch.

## [1.6.0] - 2026-09-11

### Added
- System health checks: CPU virtualization (VT firmware flag), background
  recording (warns only on the real background toggle,
  HistoricalCaptureEnabled, verified against a false positive on factory
  defaults), and system-drive free space with ok/low/critical levels.
  Each card carries a description, its live measurement, and a deep link to
  the relevant Windows page. The tab is renamed from System checks to
  System health.
- Manual refresh button on System health (same ghost button with spinner as
  Top processes, queued so one press always lands) plus an automatic refresh
  when the window regains focus. The silent 30s poll is unchanged.

### Changed
- The window is resizable (1024x680 minimum, opens at the familiar size)
  with a working maximize/restore control in the custom title bar.
  Content pages use centered containers and the health list reflows to two
  columns on wide screens.
- Health cards use the filled design-system language (filled status chips
  and badges, function icon per card) with no outlines.

## [1.5.0] - 2026-09-10

### Fixed
- The Pagefile row's "Open setting" button did nothing since v1.2.0 (it
  tried to open a requireAdministrator exe, which an unprivileged app can
  never spawn). It now runs `control sysdm.cpl,,3`: the same Advanced tab,
  verified working with no elevation.
- Sidebar (and every other) tooltips no longer stick open: hiding used to
  rely on `mouseleave` alone, so a dialog mounting under a parked cursor,
  an Alt+Tab away, or a wheel-scroll detach left the bubble painted until
  the user hovered the trigger again. The shared tooltip hook now also
  hides on window blur, captured scroll, captured pointer press, and an
  `app:modal-open` signal the shell broadcasts whenever its modal surface
  opens.
- No more dark empty window on launch: the window stays hidden until the
  UI reveals it on first paint (static branded splash in `index.html`
  paints during parse, ahead of the JS bundle and IPC gates), with an 8s
  Rust safety net so a broken frontend can never leave the app invisible.
  Requires the new `core:window:allow-show` capability.
- The app icon (titlebar, welcome, about) no longer pops in a second or
  two after everything else: the source was a 1024px / 543KB PNG shown at
  20-64px, now a pre-scaled 128px / ~9KB file (visually identical at
  display sizes, exact at 200% DPI), preloaded before first paint so its
  fetch and decode overlap the settings IPC gate instead of waiting
  behind it.
- Diagnosis wording can no longer drift between the live cards and saved
  reports: the report reader now uses the diagnoser's own dictionary
  (single source), and unknown engine kinds map to "" on both sides
  instead of being mislabeled as GPU strain in reports.
- A GPU collapse under RAM pressure could be recorded as `loaded` yet
  displayed as a harmless scene hitch: the detector and the diagnoser now
  share one `others_ok()` gate (disk, CPU, and RAM).
- Report header badges and session-list icons for the middle tone
  (`issues` / `partial`) were unstyled (missing `.badge-mid` /
  `.sl-icon-mid`); they now render in warn like the list badge already did.
- Loading lines no longer borrow the Top Processes copy: System and
  Checks show a generic "Loading...", and the About update button shows
  "Checking for updates..." while a check is in flight.
- A deep link to a deleted session no longer silently opens the first
  session in the list; it says the session is gone.
- A failed update download whose message merely contains the word
  "cancelled" no longer closes the modal as if the user had cancelled;
  only the exact backend `"cancelled"` reason does.
- Timeline spike markers and metric bars are clamped to their tracks.
- A stored scan duration outside the four presets now renders localized
  (`t.minutesShort`) instead of a bare English "Nm".
- `session_start` without an explicit duration falls back to the user's
  own auto-stop default from settings instead of a second hardcoded
  30 minutes.

### Changed
- The default theme is now `auto` (follow the OS) instead of `dark`:
  fresh installs open light on a light system and dark on a dark one from
  the first frame. Unknown stored values also resolve to `auto` on both
  sides (backend `normalize_theme` and frontend `resolveTheme` finally
  agree). Explicit `dark`/`light` choices are untouched.
- Dead code removed: `storage::settings_path`, `Engine::thresholds`,
  the `gameloop_status` IPC command with its bridge wrapper and event
  listener (the watcher thread itself still runs), the unused
  `GpuSample`/`ProcInfo` bridge types, the `Button.style` and
  `Hint.children` props, the `--ok` token, and an unreachable scrollbar
  selector block.
- The ISO-timestamp parser and the diagnosis-copy dictionary each exist
  once now (`types::iso_ms`, `diagnoser::diagnosis_copy`) instead of
  three and two copies respectively.

### Fixed
- Security: the update download path is now validated before anything is
  written (absolute paths only, parent folder must exist, destination must
  not be a directory), and a cancelled/failed download only ever removes
  its own `.part` file: a file the user already had at the chosen path can
  no longer be deleted by a cancelled update. `open_download_folder` also
  refuses paths containing characters Explorer cannot select safely.
- Race: a double-click on Start could slip two sessions past the engine's
  start gate (the slow emulator/PowerShell gates ran unlocked), double-
  spawning samplers and orphaning a writer. The status is now re-checked
  under the second lock, so a second start is refused.
- Race: a fast stop→start leaked the previous session's typeperf/dmon
  readers (the shared running flag could be flipped back to true before
  the old 1Hz reader ever saw false), doubling the sample rate for the
  rest of the app's life. Each session's readers now own a per-session
  stop flag that can never be resurrected.
- Crash: a single "NaN" value from typeperf could panic the report builder
  (`partial_cmp().unwrap()` with `panic="abort"` kills the whole app and
  the session with it). Sorting is now NaN-safe.
- The manual "Check for updates" in About could succeed silently and show
  nothing when the startup check had failed (e.g. app booted offline,
  network came back after), the fresh result is now handed to the shell
  before the modal opens.
- Timeline spike tooltips showed raw machine keys (`disk_queue`, `spike`)
  to Arabic users; they now go through the same translation table as the
  activity feed. The timeline head labels ("Auto-stop" / "Session
  duration") and the diagnosis cards' "Fix" label are localized too.
- CSS: the sidebar update dot lost its ring and the update modal lost its
  inset panel backgrounds (`--bg-1`/`--bg-2` were referenced but never
  defined). Both tokens are now defined for dark and light themes.
- The process bars in Top Processes filled from the left in RTL, against
  the reading direction, they now grow from the reading side.
- The sidebar no longer flashes expanded-then-collapsed (or the reverse)
  on launch: it renders only after the saved preference arrives, the same
  defer-to-IPC pattern the welcome screen already used.
- The stay-in-game / pre-scan advice dialogs were persisted twice (at
  show and again at close), the close-time call was removed; the show-
  time call is the contract.
- UpdateModal could call `onClose` twice (Escape during download, then the
  cancelled promise rejecting after unmount), closes are now idempotent.
- ChecksView could stack system-check queries (30s interval vs a slow
  PowerShell batch), it now has the same busy-guard as Top Processes.
- The pre-scan advice copy was Egyptian colloquial while the rest of the
  Arabic locale is Modern Standard, unified to MSA.

### Changed
- `delete_all_sessions` now excludes the LIVE session from the engine side:
  the frontend's exclude-id is honored as a bonus, but the running
  session's directory can never be bulk-deleted even if the UI passes
  nothing or the wrong id.
- Tooltip positioning logic (Tip / MetricHint / Hint) unified into one
  `useAnchoredTooltip` hook: a positioning fix now lands everywhere at
  once. Dialog gained a proper focus trap (Tab cycles inside the modal).
- Dead code removed: `system_info_cached` (engine), the `gameloopUp`
  prop/state chain with no consumer (the watcher thread itself still
  runs), and the unused `dialog.confirm` locale key.
- The mm:ss duration formatter is exported once from the design system
  instead of being copy-pasted per view.
- Scrollbar styling collapsed from three 15-selector blocks into one
  `:is()` list.

### Added
- CI: dependency audits on both sides (`npm audit --audit-level=high`,
  `cargo audit`), a version-sync gate (package.json, tauri.conf.json
  version + mainBinaryName, Cargo.toml, and CHANGELOG.md must all agree),
  least-privilege workflow permissions, and the release-build job now
  generates SHA256SUMS.txt and uploads the exe + checksums as artifacts.
- Dependabot watches npm, cargo, and GitHub Actions weekly.
- Engine tests: start-gate double-start refusal, per-session running-flag
  isolation, update destination validation, and cleanup-removes-only-the-
  `.part`-sibling (a pre-existing destination file survives a cancelled
  download).
- `tsconfig.node.json`: `vite.config.ts` is now type-checked by the build
  (it previously escaped `tsc` entirely).

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
