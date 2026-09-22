// locales/en.ts: every user-facing string in the app. Single source of truth
// for English. The backend sends keys only; this file turns them into language.

export const en = {
  lang: { code: "en", dir: "ltr" as "ltr" | "rtl", label: "English" },

  // ---- shell / title bar ----
  minimize: "Minimize",
  maximize: "Maximize",
  restore: "Restore",
  close: "Close",

  // ---- dialog (unified, replaces toasts) ----
  dialog: {
    ok: "OK",
    cancel: "Cancel",
    delete: "Delete",
    deleteTitle: "Delete this session?",
    deleteBody: "Its samples and report will be permanently removed from your PC.",
    deleteAllTitle: "Delete all sessions?",
    deleteAllBody: (n: number) =>
      `All ${n} saved sessions and their reports will be permanently removed from your PC.`,
    scanNeedsGame: "The game must be running to start a scan",
    scanNeedsGameBody:
      "PUBG Mobile must be running inside GameLoop before a scan can start. Start the game, then press Start again.",
    somethingWrong: "Something went wrong",
    /** a novel backend error the code table doesn't know: the locale
        explains, the raw message rides along as a technical line */
    unknownErrorBody: (raw: string) => `An unexpected error occurred. Technical detail: ${raw}`,
    gameloopClosed: "GameLoop was closed",
    gameloopClosedBody:
      "The game closed while the scan was running, so we stopped it and saved the report. Start a new scan when you're back in the game.",
    firstRunAdvice: "For accurate results",
    firstRunAdviceBody:
      "Start GameLoop and the game first, then press Start, and stay in the game while scanning. Minimizing GameLoop pauses GPU monitoring, and closing it ends the scan.",
    gameAdviceTitle: "One tip before your first scan",
    gameAdviceBody:
      "Close background apps before playing. Browsers, downloads, and chat programs compete with the game for the processor, and each of them can appear in the results as a cause of stuttering.",
    backgroundAdviceTitle: "Stay in the game while scanning",
    backgroundAdviceBody:
      "The game window was in the background during this scan. GPU analysis pauses while the window is minimized, and other measurements continue. For the most complete results, stay inside the game until the scan finishes.",
  },

  // ---- error codes from the backend ----
  errors: {
    GAMELOOP_NOT_RUNNING: "PUBG Mobile isn't running inside GameLoop. Start the game first.",
    SESSION_ALREADY_RUNNING: "A scan is already running.",
    SESSION_STOPPING: "The previous scan is still being saved. Try again in a moment.",
    SESSION_SAVE_FAILED: "The session report couldn't be saved. Check free disk space and try again.",
    PF_READ_FAILED: "Could not read the page file settings.",
    PF_DRIVE_INVALID: "That drive is not available for a page file.",
    PF_MODE_INVALID: "That page file mode is not valid.",
    PF_NO_SPACE: "Could not read free space on that drive, refusing to guess a bound.",
    PF_INITIAL_INVALID: "The initial size is not valid for that drive.",
    PF_MAX_INVALID: "The maximum size is not valid for that drive.",
    PF_WRITE_FAILED: "Windows refused the page file change.",
  } as Record<string, string>,

  // ---- report highlights (composed in the UI from event kinds) ----
  highlights: {
    disk_queue: "Disk under load",
    disk_busy: "Disk under load",
    hard_faults: "Heavy file loading from disk",
    cpu_saturation: "CPU reached its limit",
    cpu_throttle: "CPU reduced its speed under load",
    mem_pressure: "Memory under pressure",
    paging_churn: "Background file shuffling",
    gpu_mem_idle: "GPU in power-saving while rendering",
    gpu_activity_cliff: "GPU activity dropped sharply",
    gpu_activity_cliff_loaded: "GPU activity dropped under load",
    gpu_clock_low: "GPU clock was low",
    gpu_temp: "GPU temperature high",
    spike: "Sustained performance drop",
    nothing: "Nothing notable happened during the session.",
    noSamples: "No samples were captured in this session.",
    mostly_background: "Most of this session was spent outside the game, so the results may not reflect a real match.",
  } as Record<string, string>,

  // ---- report metrics (composed in the UI from machine keys + numbers) ----
  metrics: {
    cpuPeak: (v: number) => `CPU peaked around ${v}% under load.`,
    cpuPerfMin: (v: number) => `CPU dropped to ${v}% of its speed at some point.`,
    ramFreeMin: (v: number) => `At least ${v} MB of RAM stayed free.`,
    gpuTempMax: (v: number) => `GPU reached ${v}\u00B0C at its hottest.`,
    gpuUsageAvg: (v: number) => `GPU averaged around ${v}% usage while rendering.`,
  } as Record<string, (v: number) => string>,

  menu: "Menu",
  collapseMenu: "Collapse menu",
  expandMenu: "Expand menu",
  monitor: "Monitor",
  system: "System",
  topProcesses: "Top processes",
  systemHealth: "System health",
  reports: "Reports",
  settings: "Settings",
  about: "About",
  language: "Language",
  theme: "Theme",
  themeAuto: "Automatic",
  themeDark: "Dark",
  themeLight: "Light",
  // language names in the picker: every user-facing string lives here,
  // including the names of the languages themselves (the hardcoded copies
  // in the views drifted from the dead lang.label key)
  langEn: "English",
  langAr: "العربية",
  // small measurement units (translated, not hardcoded Latin)
  gbUnit: "GB",
  ramUnit: "RAM",
  minUnit: "m",
  secUnit: "s",

  // ---- first-run welcome (two pages, once ever) ----
  welcomeTitle: "PUBG GameLoop Lag Hunter",
  welcomeWhat:
    "Analyze your PUBG Mobile performance on GameLoop, detect stutters, and uncover exactly what's causing them.",
  welcomeCardDisk: "Disk paging storms",
  welcomeCardCpu: "CPU saturation & throttling",
  welcomeCardGpu: "GPU power-state hitches",
  welcomeNext: "One more thing",
  welcomeTrustTitle: "It costs you almost nothing",
  welcomeBegin: "Let's start",

  // ---- system tab ----
  yourRig: "Your machine",
  whatWeSee: "What this tool can see",
  whatWeSeeHint:
    "The counters the engine actually reads. Anything missing appears as \"--\" instead of wrong numbers.",
  seeCpu: "CPU / RAM / Disk counters",
  seeGpu: "GPU counters (NVIDIA)",
  seeGame: "PUBG Mobile detection (GameLoop)",
  gpuCountersOff: "Not available on this machine. GPU shows \"--\" during scans.",
  seePs: "System fine-tuning (PowerShell)",
  seePsOff: "Unavailable. Scans still work, but machine tuning and clock correction are skipped.",
  psLimitedTitle: "Running in limited mode",
  psLimitedBody:
    "PowerShell is unavailable, so some checks run on safe defaults: machine tuning is skipped, clock times may read in UTC, and GPU pause/resume detection is muted. Scans still work; the core counters are native Windows.",

  // ---- top processes tab ----
  topProcessesHint:
    "The processes consuming the most resources right now: anything above 0.5% CPU, excluding GameLoop processes (the game itself is never counted as a suspect). Close the heavy ones before playing.",
  topProcessesEmpty: "Nothing significant is running",
  topProcessesRefreshing: "Checking what's running...",
  refresh: "Refresh",
  /** generic loading line for tabs that are not Top Processes */
  loading: "Loading...",
  /** About tab: the manual update check is in flight */
  checkingUpdate: "Checking for updates...",

  // ---- system checks tab ----
  checksHint:
    "Your machine's most important settings in one place: what helps your game and what quietly slows it down. Every card explains itself, and help is one click away.",
  checkPower: "Power plan",
  checkPowerDesc:
    "Controls whether the processor runs at full speed. Saver plans lower the CPU and cause stutters in fights.",
  checkPagefile: "Pagefile",
  checkPagefileDesc:
    "Backup memory on disk when RAM fills up. Too small or disabled causes hitches while the map loads.",
  checkCharger: "Power source",
  checkChargerDesc:
    "Laptops slow down on battery. A scan on battery throttles and gives unreliable results.",
  checkVt: "CPU virtualization (VT)",
  checkVtDesc:
    "GameLoop needs hardware virtualization. Disabled means slow software emulation and constant CPU stutters.",
  vtOk: "Enabled: good",
  vtWarn: "Disabled: enable it in BIOS for smooth emulation",
  checkDvr: "Background recording (DVR)",
  checkDvrDesc:
    "Background recording captures your play continuously. It steals GPU and disk mid-match and drops frames in fights.",
  dvrOk: "Off: good",
  dvrWarn: "On: turn off Record what happened in Gaming settings",
  checkOkBadge: "Good",
  checkWarnBadge: "Needs attention",
  powerOk: (name: string) => `${name}: good`,
  powerWarn: (name: string) => `${name}: switch to High performance for stable FPS`,
  pagefileAuto: "Managed by Windows: good",
  pagefileManual: (mb: number) => `${(mb / 1024).toFixed(0)} GB fixed. Below 8 GB can cause stutters`,
  pagefileOff: "Disabled, a classic cause of heavy lag",
  chargerOk: "Plugged in",
  chargerWarn: "On battery: the machine throttles and results become unreliable",
  openSettings: "Open setting",
  /** health-card button whose fix lives inside Tools (DVR today): same
      promise as openSettings, but the destination is in-app */
  openInTools: "Open in Tools",
  /** per-card background notes behind the (?) button: same contract as the
      Tools hints (plain language, at most 3 sentences, never invented
      numbers). The DVR card reuses the Tools note verbatim (same option,
      same note); the rest own theirs. States and effect timing stay in
      the card's own desc/state lines, never duplicated here. */
  checkPowerHint:
    "The power plan decides whether your processor may run at full speed. Saver plans slow the CPU down to save battery, and that shows up as stutters in fights. The fix is one switch in Windows Settings.",
  checkPagefileHint:
    "The pagefile is backup memory on disk for moments when RAM fills up. Too small or disabled means hitches while maps and textures load. Letting Windows manage it automatically suits most machines.",
  checkVtHint:
    "Virtualization lets GameLoop use your CPU directly instead of slow software emulation. Only you can change it, from the BIOS before Windows starts. One enable, no maintenance afterwards.",
  checkChargerHint:
    "Laptops slow themselves down on battery to protect it. A scan on battery measures a throttled machine, so its results mislead. Plug in before playing or scanning.",

  // ---- tools tab ----
  tools: "Tools",
  /** beta pill next to the Tools entry in the sidebar: the tab writes to
      Windows and ships before the v2 release, so it stays labelled until
      v2 goes stable */
  toolsBeta: "Beta",
  toolsBack: "Tools",
  toolGamingTweaks: "Gaming tweaks",
  toolGamingTweaksDesc: "Every game performance switch in one place.",
  toolStorage: "Storage",
  toolStorageDesc: "Automatic cleanup plus a manual sweep for junk files.",

  // ---- tweaks (Tools tab writes — switch mirrors live state) ----
  tweakDvrTitle: "Turn off background recording (DVR)",
  tweakDvrDesc:
    "Keeps background recording off so it never steals GPU and disk mid-match. Takes effect immediately.",
  tweakSsTitle: "Turn on automatic cleanup",
  tweakSsDesc:
    "Automatically frees drive space by removing unneeded temporary files when the drive runs low.",
  tweakGameModeTitle: "Turn on Game Mode",
  tweakGameModeDesc:
    "Lets Windows prioritize the game and hold update interruptions. Helps 1% lows on machines with background load; a few CPU-maxed titles prefer it off, so test both states.",
  tweakGpuTitle: "Run GameLoop on high-performance GPU",
  tweakGpuDesc:
    "Forces GameLoop to use your powerful graphics card instead of the built-in one. Close and reopen the game to apply. Only matters on laptops with two graphics cards.",
  tweakFsoTitle: "Turn off fullscreen optimizations",
  tweakFsoDesc:
    "Stops Windows from forcing its own fullscreen handling on the game, which hurts frame pacing in some titles. Close and reopen the game to apply.",
  tweakMouseTitle: "Turn off mouse acceleration",
  tweakMouseDesc:
    "Turns off pointer acceleration, so the cursor always moves the same distance for the same hand movement. A feel preference: it won't raise FPS.",
  tweakWindowedTitle: "Turn on optimizations for windowed games",
  tweakWindowedDesc:
    "Upgrades windowed and borderless games to modern flip-model presentation with lower latency. Close and reopen the game to apply.",
  /** per-row background notes behind the (?) button: at most 3 sentences,
      plain language (what it does, when it helps or hurts, one-tap revert),
      never invented numbers */
  tweakDvrHint:
    "Background recording keeps the last seconds of your play saved at all times, so the encoder and the disk never rest during a match. Turning it off removes a constant thief of GPU and disk with no downside for gameplay. Switching it back on takes one tap if you miss the captures.",
  tweakSsHint:
    "Windows deletes temporary files on its own when the drive runs low. It prevents a full drive, it does not free a drive that is already full. Turning it off stops future cleanups with one tap.",
  tweakGameModeHint:
    "Asks Windows to favor the game with CPU time and to hold update interruptions while you play. Independent frame-time tests show it mainly smooths sudden dips on machines running browsers or chat apps next to the game; a few CPU-maxed titles run better with it off. Leave it on unless a specific game stutters, switching back takes one tap.",
  tweakGpuHint:
    "On laptops with two graphics cards, Windows may run the game on the weaker built-in card to save power. This pins GameLoop to the powerful card instead. It changes nothing on single-GPU machines, and turning it off hands the choice back to Windows.",
  tweakFsoHint:
    "Some titles pace their frames worse under the Windows fullscreen handling and feel smoother without it. The effect differs per game, so this is a per-title experiment, not a universal win. Turning it back on takes one tap.",
  tweakMouseHint:
    "Pointer acceleration makes the cursor travel further the faster you move your hand. Turning it off gives the same cursor travel for the same hand movement every time. Pure feel, it does not change FPS, and turning it back on takes one tap.",
  tweakWindowedHint:
    "Modern Windows can present windowed and borderless games with lower latency through a newer path. Microsoft documents smoother play for these modes when the toggle is on. Turning it off restores the old path with one tap.",
  tweakPfTitle: "Virtual memory (page file)",
  tweakPfHint:
    "Mirrors the Windows Virtual Memory dialog: automatic management for all drives, or per-drive system-managed, custom, or no paging file. Only the selected drive ever changes; every other drive is preserved exactly. Changes apply after you restart Windows.",
  tweakPfAutoLabel: "Automatically manage paging file size for all drives",
  tweakPfStatusAuto: "Automatic: Windows manages every drive",
  tweakPfStatusManual: "Manual: per-drive settings below",
  tweakPfDrivesLabel: "Drives",
  tweakPfDriveFree: (drive: string, gb: number) => `${drive} · ${gb} GB free`,
  tweakPfDriveNoSpace: (drive: string) => `${drive} · free space unknown`,
  tweakPfModeSystem: "System managed size",
  tweakPfModeCustom: "Custom size",
  tweakPfModeOff: "No paging file",
  tweakPfModeUnknown: "Unreadable",
  tweakPfDriveCustom: (min: number, max: number) => `Custom ${min}–${max} MB`,
  tweakPfMinLabel: "Initial size (MB)",
  tweakPfMaxLabel: "Maximum size (MB)",
  tweakPfApply: "Apply",
  tweakPfWarnOffTitle: (drive: string) => `Remove the page file on ${drive}?`,
  tweakPfWarnOffBody: (drive: string) =>
    `Without a page file on ${drive}, out-of-memory crashes are likely under load. This takes effect after you restart Windows.`,
  tweakPfWarnSmallTitle: "Small page file?",
  tweakPfWarnSmallBody: (drive: string, max: number) =>
    `Below 8 GB has caused stutters on real machines. Set ${max} MB on ${drive} anyway?`,
  tweakPfPending: "Restart Windows to apply the page file change.",
  tweakPfPendingBadge: "Restart needed",
  rebootTitle: "Restart Windows?",
  rebootBody:
    "The page file change applies after a restart. Restarting now reboots Windows immediately.",
  rebootNow: "Restart",
  rebootLater: "Later",
  tweakPowerTitle: "Turn on High performance",
  tweakPowerDesc:
    "Switches Windows to the High performance plan. Takes effect immediately; turning it off brings back the plan you had.",
  tweakPowerHint:
    "Puts the processor on full speed by switching to the High performance plan. If the plan is missing it is restored first with Windows' own command, then switched on. Turning it off brings back the plan you had; machines locked to Balanced-only mode hide this row instead.",
  /** reason line under a greyed-out row whose precondition the user can
      fix (GameLoop exes not resolved) — never shown for rows that can
      never work here (those hide instead) */
  tweakNeedsGameloop: "Needs GameLoop installed on this PC.",
  tweakFailed: "The change could not be verified and was not applied.",
  /** storage sweep: scan four safe places, delete only the ticked ones */
  cleanupTitle: "Clean temporary files",
  cleanupDesc:
    "Scans four safe places and deletes only what you tick. Locked files are skipped, freed space is measured, never estimated.",
  cleanupScan: "Scan",
  cleanupScanning: "Scanning...",
  cleanupRescan: "Scan again",
  cleanupClean: "Clean selected",
  cleanupCleaning: "Cleaning...",
  cleanupSelectAll: "Select all",
  cleanupDeselectAll: "Deselect all",
  cleanupNothing: "Nothing to clean: every measured place is already empty.",
  cleanupScanFailed: "The scan could not read this PC. Try again.",
  cleanupFreed: (mb: number) => `Freed ${mb} MB, measured before and after.`,
  cleanupUnmeasured:
    "Plus freed space Windows would not let us measure, so it stays out of the number above.",
  cleanupSelected: (mb: number) => `Selected: ${mb} MB.`,
  cleanupLastNever: "Never cleaned yet.",
  cleanupLast: (mb: number, when: string) => `Last clean: ${mb} MB on ${when}.`,
  cleanup30d: (mb: number) => `Last 30 days: ${mb} MB.`,
  cleanupScanningCat: (name: string) => `Scanning ${name}...`,
  cleanupCleaningCat: (name: string) => `Cleaning ${name}...`,
  cleanupConfirmTitle: "Delete the selected files?",
  cleanupConfirmBody: (names: string) =>
    `This permanently deletes temporary files in: ${names}. Only the ticked places are touched, files in use are skipped.`,
  cleanupCatUserTemp: "My temporary files",
  cleanupCatUserTempHint:
    "Leftovers your apps left in your own temp folder. Safe to delete, apps rebuild what they still need.",
  cleanupCatSystemTemp: "Windows temporary files",
  cleanupCatSystemTempHint:
    "Leftovers Windows services and installers left behind. Safe to delete, files in use are skipped.",
  cleanupCatRecycle: "Recycle Bin",
  cleanupCatRecycleHint:
    "Files you already deleted that still occupy drive space. Emptying it is permanent, check it first.",
  cleanupCatDelivery: "Update sharing cache",
  cleanupCatDeliveryHint:
    "Windows Update files kept to share with other PCs on your network. Safe to delete, Windows re-downloads what it needs.",
  /** opt-in deep scan: same card flips to its results, never auto-ticked */
  cleanupDeepScan: "Deep scan",
  cleanupModeQuick: "Quick",
  cleanupModeDeep: "Deep",
  cleanupCatThumb: "Thumbnail previews",
  cleanupCatThumbHint:
    "Cached image previews Windows rebuilds on its own. Safe to delete.",
  cleanupCatReports: "Finished error reports",
  cleanupCatReportsHint:
    "Old Windows error reports already sent or abandoned. Safe to delete.",
  cleanupCatDumps: "Old crash dumps",
  cleanupCatDumpsHint:
    "Crash memory files older than 30 days. Recent dumps are never touched, they may explain a fresh crash.",
  cleanupCatDownload: "Update leftovers",
  cleanupCatDownloadHint:
    "Downloaded update files Windows no longer needs. Run after updates finish; Windows re-downloads what it still needs.",
  cleanupCatLogs: "System log files",
  cleanupCatLogsHint:
    "Old Windows logs that pile up after updates. Files from the last 7 days are never touched.",

  // ---- about tab ----
  aboutTitle: "PUBG GameLoop Lag Hunter",
  aboutWhat:
    "Analyze your PUBG Mobile performance on GameLoop, detect stutters, and uncover exactly what's causing them.",
  aboutImpact: "What it costs your machine",
  aboutImpactItems: [
    "Under 1% CPU while scanning: it measures, it doesn't compete",
    "~25 MB of RAM, less than one browser tab",
    "~200 KB per minute of scanning on disk",
    "Every session stops by itself, nothing runs forgotten",
    "It changes a setting only when you flip its switch yourself",
  ],
  aboutUpdate: "Updates",
  aboutCheckUpdate: "Check for updates",
  aboutUpToDate: "You're on the latest version",
  aboutNewVersion: "A new version is available. Download it",
  aboutUpdateErr: "Couldn't check right now. Try again later",
  aboutSupport: "Buy me a coffee",
  aboutMade: "Made with",
  version: "Version",

  // ---- update modal ----
  updateAvailableTitle: "A new version is available",
  updateDownload: "Update",
  updateClose: "Close",
  updateCancel: "Cancel",
  updateDownloading: "Downloading…",
  updateRetry: "Try again",
  updateDoneTitle: "Update downloaded",
  updateDoneHint: "Close the app and run the new file whenever you're ready.",
  updateOpenFolder: "Open folder",
  updateOk: "Done",
  updateFailedTitle: "Download failed",
  updateNotesLabel: "Release notes",

  // ---- monitor: controls ----
  startScanning: "Start",
  stop: "Stop",
  autoStop: "Auto-stop",
  min5: "5 min",
  min10: "10 min",
  min30: "30 min",
  min60: "60 min",
  /** fallback for a stored duration outside the four presets */
  minutesShort: (n: number) => `${n} min`,
  time: "Time",
  timelineHint: "Every red dot is a lag spike we captured. The bar fills toward your auto-stop time.",
  timelineAutoStop: "Auto-stop",
  timelineDuration: "Session duration",
  fixLabel: "Fix:",

  // ---- monitor: hero states ----
  spikesCaptured: (n: number) => `${n} lag spike${n === 1 ? "" : "s"} captured`,
  sessionClean: "Session was clean",

  // ---- monitor: metrics ----
  cpu: "CPU",
  ram: "RAM",
  gpu: "GPU",
  disk: "Disk",
  cpuHint:
    "Processor usage. High while GameLoop translates the game is fine, but sustained 95%+ with lag means the CPU can't keep up.",
  ramHint:
    "Memory in use. When it fills up, the game swaps files to disk, and every swap is a stutter.",
  gpuHint:
    "Graphics card usage while rendering. Low values during a match can mean power-saving hitches.",
  diskHint:
    "Disk activity. Spikes during hot drops are loading, but sustained 100% with lag is a paging storm.",

  // ---- monitor: activity feed ----
  activity: "Activity",
  activityHint:
    "Everything the tool detects during play, newest first. Whenever you feel a stutter, check this section: it will explain what happened.",
  nothingUnusual: "Nothing unusual so far. That's good.",
  waitingGameloopFeed: "Waiting for PUBG Mobile to start...",

  // feed lines (by engine event kind)
  feed: {
    disk_queue: "Disk under load",
    disk_busy: "Disk under load",
    hard_faults: "Heavy file loading from disk",
    cpu_saturation: "CPU reached its limit",
    cpu_throttle: "CPU reduced its speed under load",
    mem_pressure: "Memory under pressure",
    paging_churn: "Background file shuffling",
    gpu_mem_idle: "GPU power-saving while rendering",
    gpu_activity_cliff: "GPU activity dropped sharply",
    gpu_activity_cliff_loaded: "GPU activity dropped under load",
    gpu_clock_low: "GPU clock low",
    gpu_temp: "GPU temperature high",
    spike: "Sustained performance drop",
  } as Record<string, string>,

  // ---- monitor: summary ----
  openReportBtn: "Open full report",
  summaryHint: (n: number) => `Captured ${n} samples. Open the report to see what happened.`,

  // ---- diagnoses (by engine key, mirrors the backend dictionary) ----
  diagnoses: {
    disk_wait: {
      title: "Game was waiting on disk",
      simple:
        "The game stalled while loading its files from disk, causing severe lag when dropping into the map and during crowded fights.",
      fix: "Increase the pagefile size and allocate more RAM to GameLoop in its settings.",
    },
    cpu_busy: {
      title: "CPU at its limit",
      simple: "The processor was running at full capacity: the game needed more processing cores than were available.",
      fix: "Limit GameLoop to physical cores only, and close background apps (browsers, Discord) before playing.",
    },
    cpu_throttle: {
      title: "CPU slowing itself down",
      simple: "The processor temperature rose, so it reduced its speed to protect itself, and performance dropped sharply under load.",
      fix: "Clean the cooling fans, use a cooling pad, and keep the charger connected.",
    },
    mem_low: {
      title: "Memory nearly full",
      simple: "Memory filled up and the game kept moving files between RAM and disk, and every transfer caused a stutter.",
      fix: "Close background apps and increase the pagefile size.",
    },
    paging_churn: {
      title: "Background file shuffling",
      simple:
        "The system was moving game files between RAM and disk in the background, even though both were running normally. It's normal housekeeping, not a shortage, but each move can show up as a tiny hitch.",
      fix: "Give GameLoop more RAM in its settings. If it keeps happening, increase the pagefile size on an SSD.",
    },
    gpu_wake: {
      title: "GPU returning from power-saving mode",
      simple:
        "The graphics card switched to a power-saving state between scenes and needed time to return to full performance, and that transition appeared as a visible hitch.",
      fix: "In the GPU control panel (NVIDIA Control Panel), set GameLoop's power management to 'Prefer maximum performance': add every GameLoop process, not just the game. If it still appears, the driver is trimming memory clocks in light scenes (common on laptops with hybrid graphics); the effect is usually a brief hitch between scenes, not a persistent problem.",
    },
    scene_hitch: {
      title: "First-time scene loading",
      simple:
        "The first time a scene appears (lobby or a new map), the system prepares its graphics, causing one brief hitch, then full smoothness. Revisiting the same scene is smooth because it has been cached.",
      fix: "There is no permanent fix. It eases as scenes repeat and shrinks with GPU driver updates.",
    },
    gpu_busy: {
      title: "GPU at its limit",
      simple: "The graphics card was operating at full capacity, and the frame rate dropped as a result.",
      fix: "Reduce the game resolution or graphics quality by one step.",
    },
  } as Record<string, { title: string; simple: string; fix: string }>,

  // ---- reports ----
  sessions: "Sessions",
  sessionsHint: "Every finished scan is saved on your PC with its full report. Click one to read it here.",
  noSessions: "No sessions yet",
  noSessionsHint: "Run a scan from the Monitor tab. Finished sessions show up here with their reports.",
  loadingSessions: "Loading sessions...",
  /** deep link to a session id that is no longer saved (deleted meanwhile) */
  reportNotFound: "That session is no longer saved on this PC.",
  allSessions: "All sessions",
  sessionReport: "Session report",
  whatWeFound: "What we found",
  keyMoments: "Key moments",
  theNumbers: "The numbers",
  noIssuesCaptured: "No issues captured",
  noIssuesCapturedHint: "This session had no notable findings. If you felt lag anyway, run a longer scan while it happens.",
  openReportFile: "Open report file",
  openSessionsFolder: "Open sessions folder",
  deleteSession: "Delete session",
  deleteAllSessions: "Delete all",
  // honest outcomes
  clean: "Clean",
  findings: "Findings",
  lagCaptured: "Lag captured",
  partial: "Partial",
  samples: "samples",
  spikeCount: (n: number) => `${n} spike${n > 1 ? "s" : ""}`,
};

export type Locale = typeof en;
