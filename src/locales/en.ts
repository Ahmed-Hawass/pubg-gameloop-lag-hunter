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
    dismiss: "Dismiss",
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
    exitTitle: "Exit before finishing?",
    exitBodyScan: "A scan is running. It will stop and its report will be saved.",
    exitBodyDownload: "An update is downloading. It will be cancelled.",
    exitBodyCleaning: "A cleanup is running. It will stop.",
    exitConfirm: "Exit",
    emulatorUpdatedTitle: "GameLoop was updated",
    emulatorUpdatedBody: (v: string) =>
      `GameLoop is now on ${v}. Windows ties graphics settings to each install location, so re-check the Tools switches and flip back anything the update switched off.`,
  },

  // ---- error codes from the backend ----
  errors: {
    GAMELOOP_NOT_RUNNING: "PUBG Mobile isn't running inside GameLoop. Start the game first.",
    SESSION_ALREADY_RUNNING: "A scan is already running.",
    SESSION_STOPPING: "The previous scan is still being saved. Try again in a moment.",
    SESSION_RUNNING: "The active scan cannot be deleted.",
    SESSION_SAVE_FAILED: "The session report couldn't be saved. Check free disk space and try again.",
    APP_SHUTTING_DOWN: "The app is closing. Please try again.",
    PF_READ_FAILED: "Could not read the page file settings.",
    PF_DRIVE_INVALID: "That drive is not available for a page file.",
    PF_MODE_INVALID: "That page file mode is not valid.",
    PF_NO_SPACE: "Could not read free space on that drive, refusing to guess a bound.",
    PF_INITIAL_INVALID: "The initial size is not valid for that drive.",
    PF_MAX_INVALID: "The maximum size is not valid for that drive.",
    PF_WRITE_FAILED: "Windows refused the page file change.",
    POWERSHELL_TIMEOUT: "Checking the system took too long. Try again.",
    EMULATOR_UNKNOWN:
      "GameLoop seems to be running a build this tool does not recognize yet. If the game is running, update Lag Hunter to the latest version.",
    PROCESS_NOT_FOUND: "That app already closed. Nothing was stopped.",
    PROCESS_ACCESS_DENIED: "Windows refused to stop that app. It needs administrator rights.",
    PROCESS_KILL_FAILED: "That app could not be stopped. Try again.",
    PROCESS_REFUSED: "That process is protected and can never be stopped from here.",
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
  /** interface zoom group (Small/Default/Large pills, same segmented
      control as language and theme; shortcuts mirror these steps) */
  zoomTitle: "Interface size",
  zoomSmall: "Small",
  zoomDefault: "Default",
  zoomLarge: "Large",
  showUnsupportedTitle: "Show unavailable options",
  showUnsupportedHint:
    "Shows Tools rows this machine cannot run, greyed with the reason. Switches stay off: nothing here can be turned on.",
  settingOff: "Off",
  settingOn: "On",
  // language names in the picker: every user-facing string lives here,
  // including the names of the languages themselves (the hardcoded copies
  // in the views drifted from the dead lang.label key)
  langEn: "English",
  langAr: "العربية",
  /** re-show action for dismissed intro cards: visible only while the
      dismissal list is non-empty (a button with nothing to restore
      would be a dead control) */
  introResetTitle: "Introduction cards",
  introResetAction: "Show again",
  /** (?) behind the re-show group: what the button does (every card
      closed with X comes back on its page) */
  introResetHint: "Shows again every introduction card you closed with X.",
  // small measurement units (translated, not hardcoded Latin)
  gbUnit: "GB",
  minUnit: "m",
  secUnit: "s",

  // ---- first-run welcome (three slides, once ever) ----
  welcomeTitle: "PUBG GameLoop Lag Hunter",
  welcomeWhat:
    "Analyze your PUBG Mobile performance on GameLoop, detect stutters, and uncover exactly what's causing them.",
  /** slide 1: what it finds (titles reuse the short card names) */
  welcomeFindsLabel: "What it finds",
  welcomeCardDisk: "Disk paging storms",
  welcomeFindDiskDesc: "The game freezes while loading files",
  welcomeCardCpu: "CPU saturation & throttling",
  welcomeFindCpuDesc: "Your processor can't keep up in big fights",
  welcomeCardGpu: "Hidden GPU slowdowns",
  welcomeFindGpuDesc: "We catch quiet power dips and pin the right settings",
  welcomeNextBtn: "Next",
  /** slide 2: how it works, then the sample, then the cost */
  welcomeHowTitle: "Press Start, then play normally",
  welcomeHowSub: "It measures in the background and hands you the cause with a fix",
  welcomeSampleLabel: "What you will see",
  welcomeBack: "Back",
  welcomeSkip: "Skip",
  /** slide 3: what it costs (values stay Latin in both languages) */
  welcomeTrustTitle: "It costs you almost nothing",
  welcomeCostCpuVal: "<1%",
  welcomeCostCpuLabel: "CPU while scanning",
  welcomeCostRamVal: "25 MB",
  welcomeCostRamLabel: "of RAM",
  welcomeCostPrivacyVal: "Local",
  welcomeCostPrivacyLabel: "reports never leave your PC",
  welcomeBegin: "Let's start",

  // ---- system tab ----
  yourRig: "Your device",
  storageTitle: "Storage",
  deviceSystemTitle: "Device and system",
  /** spec card labels */
  specCpu: "CPU",
  specGpu: "GPU",
  specRam: "Memory",
  specDisplay: "Display",
  /** spec value labels (label: value lines, MSA-safe for every count) */
  specBase: "base",
  specCores: "Cores",
  specThreads: "Threads",
  specDedicated: "dedicated",
  specDriver: "Driver",
  specScale: "Scale",
  /** device and system row labels */
  specModel: "Model",
  specOs: "OS",
  specDirectx: "DirectX",
  /** copy-all button + its transient confirmation */
  copySpecs: "Copy all specs",
  copiedSpecs: "Copied",
  copySpecsFailed: "Could not copy. Select the text manually.",
  psLimitedTitle: "Running in limited mode",
  psLimitedBody:
    "PowerShell is unavailable, so some checks run on safe defaults: device tuning is skipped, clock times may read in UTC, and GPU pause/resume detection is muted. Scans still work; the core counters are native Windows.",

  // ---- top processes tab ----
  /** one-shot page card (title plus page-level guidance, never option
      mechanics): the close-before-playing decision and the apps versus
      system-tasks rule */
  introProcessesTitle: "Close the heavy apps before you play",
  introProcessesBody:
    "These are the programs eating CPU and RAM right now, game excluded. Close what you don't need before playing.",
  topProcessesEmpty: "Nothing significant is running",
  refresh: "Refresh",
  /** background totals header: the list below is truncated, these are not */
  totalCpuBackground: "total CPU in background",
  totalRamBackground: "total RAM in background",
  /** the single apps group: every row ends, nothing here is
      guidance-free */
  groupAppsTitle: "Apps you opened",
  groupAppsHint: "Safe to close before playing",
  /** end-task action on every row: confirm names the app,
      unsaved work may be lost */
  endTask: "End",
  endingTask: "Ending...",
  endConfirmTitle: (name: string) => `Stop ${name}?`,
  endConfirmBody: (name: string) =>
    `${name} will close immediately. Unsaved work in it will be lost.`,
  /** grouped confirm: the count string comes from procCount (one MSA
      site), so this key never pluralizes itself */
  endConfirmBodyCount: (name: string, count: string) =>
    `${name} (${count}) will close immediately. Unsaved work in them will be lost.`,
  /** grouped-row size line under the app name (MSA-safe counts live
      here alone, like spikeCount) */
  procCount: (n: number) => `${n} process${n === 1 ? "" : "es"}`,
  /** curated process display names (stable OS staples only; user
      software names itself via ProductName, raw names back both) */
  procNames: {
    procPowershell: "PowerShell",
    procCmd: "Command Prompt",
    procConsoleHost: "Console Host",
    procServiceHost: "Service Host",
    procCsrss: "Client Server Runtime",
    procDwm: "Desktop Window Manager",
    procShellHost: "Shell Infrastructure Host",
    procCtfmon: "Text Input Manager",
    procExplorer: "File Explorer",
    procTaskHost: "Host Process for Tasks",
    procRuntimeBroker: "Runtime Broker",
    procSearchHost: "Search Host",
    procStartMenu: "Start Menu",
    procShellExperience: "Shell Experience Host",
    procSpooler: "Print Spooler",
    procEdgeWebView: "WebView2 Runtime",
  } as Record<string, string>,
  /** generic loading line for tabs that are not Top Processes */
  loading: "Loading...",
  /** About tab: the manual update check is in flight */
  checkingUpdate: "Checking for updates...",

  // ---- system checks tab ----
  checksHint:
    "Your device's most important settings in one place: what helps your game and what quietly slows it down. Details are one click away.",
  /** one-shot page card: the smooth-or-stuttering verdict and the
      one-click fix path (healthy quiet is a feature, not emptiness) */
  introHealthTitle: "What quietly slows your game",
  introHealthBody:
    "A few Windows settings decide smooth or stuttering play. Anything marked goes straight to its fix with one click.",
  checkPower: "Power plan",
  checkPagefile: "Virtual memory (page file)",
  checkCharger: "Power source",
  checkVt: "CPU virtualization (VT)",
  vtOk: "Enabled",
  vtWarn: "Disabled: enable it in BIOS for smooth emulation",
  checkDvr: "Background recording (DVR)",
  dvrOk: "Off",
  dvrWarn: "On: turn off Record what happened in Gaming settings",
  checkOkBadge: "Good",
  checkWarnBadge: "Needs attention",
  /** (?) buttons: screen-reader name carries the "about" context so it is
      not announced as a bare duplicate of the row name */
  hintAbout: (name: string) => `About ${name}`,
  /** summary banner: one-glance verdict above the cards, derived in the
      UI from the five checks (no backend change — counts warn cards) */
  healthAllGood: "All good",
  healthAllGoodSub: "Nothing on this device is holding your game back",
  healthNeedsTitle: (n: number) => `${n} setting${n === 1 ? "" : "s"} needs attention`,
  healthNeedsSub: "Everything else looks good",
  /** header above the full archive list (attention cards repeat above it
      as the featured summary, so this labels what follows, not a filter) */
  healthAllSettings: "All settings",
  powerOk: (name: string) => name,
  powerWarn: (name: string) => `${name}: switch to High performance for stable FPS`,
  pagefileAuto: "Managed by Windows",
  pagefileManual: (mb: number) => `${(mb / 1024).toFixed(0)} GB fixed. Below 8 GB can cause stutters`,
  pagefileOff: "Disabled, a classic cause of heavy lag",
  chargerOk: "Plugged in",
  chargerWarn: "On battery: the device throttles and results become unreliable",
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
    "The pagefile is backup memory on disk for moments when RAM fills up. Too small or disabled means hitches while maps and textures load. Letting Windows manage it automatically suits most devices.",
  checkVtHint:
    "Virtualization lets GameLoop use your CPU directly instead of slow software emulation. Only you can change it, from the BIOS before Windows starts. One enable, no maintenance afterwards.",
  checkChargerHint:
    "Laptops slow themselves down on battery to protect it. A scan on battery measures a throttled device, so its results mislead. Plug in before playing or scanning.",

  // ---- tools tab ----
  tools: "Tools",
  /** beta pill next to the Tools entry in the sidebar: the tab writes to
      Windows and ships before the v2 release, so it stays labelled until
      v2 goes stable */
  toolsBeta: "Beta",
  toolsBack: "Tools",
  toolGamingTweaks: "Game performance",
  toolGamingTweaksDesc: "Performance switches for smoother play",
  toolPagefileDesc: "Fewer stutters when memory fills up",
  toolCleanup: "Disk cleanup",
  toolCleanupDesc: "Reclaim disk space, nothing important touched",
  /** landing status badge over the gaming card (on/shown optimized):
      same rules as the details rows, via the shared summary */
  toolBadgeOptimized: (on: number, total: number) => `${on}/${total} optimized`,
  toolStorage: "Storage",
  toolStorageDesc: "Automatic cleanup plus a manual sweep for junk files.",

  // ---- tweaks (Tools tab writes — switch mirrors live state).
  // Row copy is the name alone; the definition plus the effect timing
  // live behind the (?) button (same contract as the health cards). */
  tweakDvrTitle: "Turn off background recording (DVR)",
  tweakSsTitle: "Turn on automatic cleanup",
  tweakGameModeTitle: "Turn on Game Mode",
  tweakGpuTitle: "Run GameLoop on high-performance GPU",
  tweakFsoTitle: "Turn off fullscreen optimizations",
  tweakMouseTitle: "Turn off mouse acceleration",
  tweakWindowedTitle: "Turn on optimizations for windowed games",
  /** per-row background notes behind the (?) button: at most 3 sentences,
      plain language (what it does, when it helps or hurts, effect timing,
      one-tap revert), never invented numbers */
  tweakDvrHint:
    "Background recording keeps the last seconds of your play saved at all times, so the encoder and the disk never rest during a match. Turning it off removes a constant thief of GPU and disk with no downside for gameplay. Switching it back on takes one tap if you miss the captures.",
  tweakSsHint:
    "Windows deletes temporary files on its own when the drive runs low. It prevents a full drive, it does not free a drive that is already full. Turning it off stops future cleanups with one tap.",
  tweakGameModeHint:
    "Asks Windows to favor the game with CPU time and to hold update interruptions while you play. Independent frame-time tests show it mainly smooths sudden dips on devices running browsers or chat apps next to the game; a few CPU-maxed titles run better with it off. Leave it on unless a specific game stutters, switching back takes one tap.",
  tweakGpuHint:
    "On laptops with two graphics cards, Windows may run the game on the weaker built-in card to save power. This pins GameLoop to the powerful card instead. It changes nothing on single-GPU devices, and turning it off hands the choice back to Windows.",
  tweakFsoHint:
    "Some titles pace their frames worse under the Windows fullscreen handling and feel smoother without it. The effect differs per game, so this is a per-title experiment, not a universal win. Turning it back on takes one tap.",
  tweakMouseHint:
    "Pointer acceleration makes the cursor travel further the faster you move your hand. Turning it off gives the same cursor travel for the same hand movement every time. Pure feel, it does not change FPS, and turning it back on takes one tap.",
  tweakWindowedHint:
    "Modern Windows can present windowed and borderless games with lower latency through a newer path. Microsoft documents smoother play for these modes when the toggle is on. Turning it off restores the old path with one tap.",
  tweakPfTitle: "Virtual memory (page file)",
  /** one-shot page card: the why (borrowed disk instead of a crash)
      and the honest default (automatic suits almost everyone) */
  introPagefileTitle: "Backup room for when memory fills up",
  introPagefileBody:
    "When RAM fills up, Windows borrows disk space so the game keeps going instead of crashing. Automatic suits almost everyone.",
  tweakPfHint:
    "Mirrors the Windows Virtual Memory dialog: automatic management for all drives, or per-drive system-managed, custom, or no paging file. Only the selected drive ever changes; every other drive is preserved exactly. Changes apply after you restart Windows.",
  tweakPfAutoLabel: "Automatically manage paging file size for all drives",
  tweakPfDrivesLabel: "Drives",
  /** short drive-card lines (letter rides its own span, so no drive
      prefix here): free space and mode stay separate spans */
  tweakPfDriveFreeShort: (gb: number) => `${gb} GB free`,
  tweakPfDriveNoSpaceShort: "free space unknown",
  tweakPfModeLabel: "Mode",
  tweakPfModeSystem: "System managed size",
  tweakPfModeCustom: "Custom size",
  tweakPfModeOff: "No paging file",
  tweakPfModeUnknown: "Unreadable",
  tweakPfDriveCustom: (min: number, max: number) => `Custom ${min}–${max} MB`,
  tweakPfMinLabel: "Initial size (MB)",
  tweakPfMaxLabel: "Maximum size (MB)",
  tweakPfApply: "Apply",
  /** status strip (mode state plus installed RAM) and the engine
      recommendation next to the inputs: values stay Latin */
  pfRamInstalled: (gb: number) => `${gb} GB RAM installed`,
  pfRecommend: (gb: number, min: number, max: number) =>
    `Recommended for ${gb} GB RAM: ${min.toLocaleString("en-US")}–${max.toLocaleString("en-US")} MB`,
  /** committed sizes for the "Currently using" strip line (manual mode
      only): the sum of custom initials plus the live drive count.
      Values stay Latin; the all-system variant names no sum because
      those sizes are Windows-owned. */
  pfCurrentlyUsing: (sum: string, n: number) =>
    `Currently using ${sum} MB across ${n} drive${n === 1 ? "" : "s"}`,
  pfSystemSizes: (n: number) =>
    `Across ${n} drive${n === 1 ? "" : "s"}: sizes managed by Windows`,
  tweakPfWarnOffTitle: (drive: string) => `Remove the page file on ${drive}?`,
  tweakPfWarnOffBody: (drive: string) =>
    `Without a page file on ${drive}, out-of-memory crashes are likely under load. This takes effect after you restart Windows.`,
  tweakPfWarnSmallTitle: "Small page file?",
  tweakPfWarnSmallBody: (drive: string, max: number) =>
    `Below 8 GB has caused stutters on real devices. Set ${max} MB on ${drive} anyway?`,
  tweakPfPending: "Restart Windows to apply the page file change.",
  tweakPfPendingBadge: "Restart needed",
  rebootTitle: "Restart Windows?",
  rebootBody:
    "The page file change applies after a restart. Restarting now reboots Windows immediately.",
  rebootNow: "Restart",
  rebootLater: "Later",
  tweakPowerTitle: "Turn on High performance",
  /** visible effect timing (shared lines, verified rows only — the
      card shows when, the (?) shows what and why) */
  tweakEffectNow: "Takes effect immediately",
  tweakEffectReopen: "Close and reopen the game to apply",
  tweakEffectSignin: "Takes effect after signing out of Windows and back in",
  tweakPowerHint:
    "Puts the processor on full speed by switching to the High performance plan. If the plan is missing it is restored first with Windows' own command, then switched on. Turning it off brings back the plan you had; devices locked to Balanced-only mode hide this row instead.",
  /** summary banner over the gaming rows (same pattern as the health
      tab): one-glance verdict derived from the rendered rows, zero
      backend cost */
  tweakBannerGood: "All optimized",
  tweakBannerGoodSub: "Every tweak holds its recommended state",
  tweakBannerNeeds: (n: number) => `${n} tweak${n === 1 ? "" : "s"} needs attention`,
  tweakBannerNeedsSub: "Everything else is optimized",
  /** archive title under the featured repeat (same pattern as the
      gaming page; future switches join this list, never the banner) */
  storageAllTitle: "All storage options",
  /** header above the full archive list (attention rows repeat above it
      as the featured summary, so this labels what follows, not a filter) */
  tweakAllTweaks: "All tweaks",
  /** reason line under a greyed-out row whose precondition the user can
      fix (GameLoop exes not resolved). Rows that can never work here
      hide by default; the show-unsupported preference reveals them
      greyed with one of the reasons below (never flippable). */
  tweakNeedsGameloop: "Needs GameLoop installed on this PC.",
  tweakNeedsWin11: "Needs Windows 11 or later on this PC.",
  tweakNeeds1803: "Needs Windows 10 version 1803 or later.",
  tweakHiddenS0: "Unavailable here: this device runs Modern Standby (S0) power only.",
  tweakHiddenUltimate: "Unavailable here: Ultimate Performance is already active.",
  /** discover line on the gaming page (no count: hidden rows are
      invisible by design, the number would need plural forms for a
      line whose only job is pointing at the preference) */
  showUnsupportedLink: "Show unavailable options",
  tweakFailed: "The change could not be verified and was not applied.",
  /** storage sweep: scan four safe places, delete only the ticked ones */
  cleanupTitle: "Clean temporary files",
  /** one-shot page card: the trust rule (important stuff is never
      even listed) plus what counts as leftovers */
  introCleanupTitle: "Only you decide what goes",
  introCleanupBody:
    "Everything here is leftovers Windows and apps forgot: temporary files, old logs, finished reports. Tick what you no longer need; anything important is never listed.",
  cleanupDesc:
    "Reclaims disk space from safe places. Only what you tick gets deleted, nothing important is ever touched.",
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
  /** scanned hero + cleaned payoff labels (the numbers ride their own
      lines, units stay Latin in both languages) */
  cleanupReadyToFree: "ready to free up",
  cleanupCleanedTag: "Your disk has a little more room to breathe.",
  /** sweep memory lines (last run + last-30-days, bytes only): the same
      shapes the storage summary used before the card split, restored
      for the landing card and the sweep page */
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
    "Leftovers Windows services and installers left behind. Safe to delete.",
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
  aboutImpact: "What it costs your device",
  aboutImpactItems: [
    "Under 1% CPU while scanning: it measures, it doesn't compete",
    "~25 MB of RAM, less than one browser tab",
    "~200 KB per minute of scanning on disk",
    "Your reports stay on your PC",
    "It changes a setting only when you flip its switch yourself",
  ],
  aboutUpdate: "Updates",
  aboutCheckUpdate: "Check for updates",
  aboutUpToDate: "You're on the latest version",
  aboutNewVersion: "A new version is available. Download it",
  aboutUpdateErr: "Couldn't check right now. Try again later",
  aboutSupport: "Buy me a coffee",
  aboutGitHub: "GitHub",
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
  updateExeFilter: "Application",

  // ---- monitor: controls ----
  autoStop: "Auto-stop",
  min5: "5 min",
  min10: "10 min",
  min30: "30 min",
  min60: "60 min",
  /** fallback for a stored duration outside the four presets */
  minutesShort: (n: number) => `${n} min`,
  fixLabel: "Fix:",
  /** collapsible event log toggle (Reports shares the same pair) */
  showEventLog: "Show event log",
  hideEventLog: "Hide event log",

  // ---- monitor: idle state (one centered column: the session plan) ----
  scanPlanKicker: "Ready to scan",
  // the big duration number is split from its unit so the number can read
  // at display size; the unit takes the minutes because Arabic plurals and
  // word order differ from English, and both locales must stay honest.
  scanPlanUnit: (_m: number) => "min session",
  scanStep1: "Start the scan",
  scanStep2: "Play normally",
  scanStep3: "Read the report",
  scanIdleStart: "Start scan",
  scanIdleCloseApps:
    "Close your browser and heavy apps. The scan measures the whole machine.",

  // ---- monitor: running state (the user is away) ----
  scanRunningTitle: "Leave this window and go play",
  scanRunningBody: "We are measuring. You will get the result when it is done.",
  // the live doubt this screen settles: "can I minimize this?" Asked and
  // answered where the window is actually open — idle could only promise
  // it in theory, so the sentence moved here instead of being duplicated.
  scanRunningNote:
    "Nothing to watch. You can minimize this window, the scan keeps running.",
  scanElapsed: "Elapsed",
  scanRemainingLabel: "Auto-stop in",
  scanRemaining: (m: number) => `${m} min left`,
  scanSamples: "Samples",
  scanOfSession: "of session",
  scanMoments: (n: number) => `${n} moment${n === 1 ? "" : "s"} captured`,
  scanStop: "Stop the scan",

  // ---- monitor: result state (never auto-dismisses) ----
  scanResultLagTitle: "Lag was captured",
  scanResultCleanTitle: "Nothing unusual",
  scanResultOver: (m: number) => `Over your ${m} minute session`,
  scanResultSeconds: "seconds",
  scanResultMoments: "Moments",
  scanResultTopSignal: "Top signal",
  scanResultNone: "None",
  scanResultOpenReport: "Open the full report",
  scanResultAgain: "Scan again",
  scanResultFootnote:
    "The report has the timeline, every moment, and what to do about it.",

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
  /** totals card labels (numbers ride their own lines, so no plural
      forms are ever needed) */
  reportTotalSessions: "sessions",
  reportTotalIssues: "had issues",
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
