// locales/en.ts: every user-facing string in the app. Single source of truth
// for English. The backend sends keys only; this file turns them into language.

export const en = {
  lang: { code: "en", dir: "ltr" as "ltr" | "rtl", label: "English" },

  // ---- shell / title bar ----
  minimize: "Minimize",
  maximize: "Maximize",
  restore: "Restore",
  /** the X button no longer quits: it hides the window to the notification
      area, so it must not claim to close the app */
  hideToTray: "Hide to tray",

  // ---- tray (the notification-area icon) ----
  trayOpen: "Open",
  trayQuickScan: "Quick scan",
  /** the scan item while measuring: the live percent rides in the label so
      the menu itself answers progress (same number as the tooltip, Latin
      digits and percent sign like every unit in both languages) */
  trayStopScan: (pct: number) => `Stop scan (${pct}%)`,
  trayExit: "Exit",
  /** idle tooltip: the app name only (the menu carries the actions) */
  trayTooltipIdle: "PUBG GameLoop Lag Hunter",
  /** scanning tooltip: the live percent is the only signal a hidden-window
      user gets that a scan is still measuring */
  trayTooltipScanning: (pct: number) => `Scanning… ${pct}%`,
  /** finished tooltip: a verdict is waiting to be read (shows until the
      verdict card is dismissed or its session is deleted) */
  trayTooltipDone: "Scan complete, open to see the verdict",

  // ---- dialog (unified, replaces toasts) ----
  dialog: {
    ok: "OK",
    cancel: "Cancel",
    dismiss: "Dismiss",
    delete: "Delete",
    deleteTitle: "Delete this session?",
    deleteBody: "Its samples and report will be permanently deleted from this PC.",
    deleteAllTitle: "Delete all sessions?",
    deleteAllBody: (n: number) =>
      `All ${n} saved sessions and their reports will be permanently deleted from this PC.`,
    scanNeedsGame: "Start the game to begin scanning",
    scanNeedsGameBody:
      "PUBG Mobile needs to be running in GameLoop before a scan can start. Launch the game, then click Start scan again.",
    somethingWrong: "Something went wrong",
    /** a novel backend error the code table doesn't know: the locale
        explains, the raw message rides along as a technical line */
    unknownErrorBody: (raw: string) => `An unexpected error occurred. Technical details: ${raw}`,
    gameloopClosed: "GameLoop was closed",
    gameloopClosedBody:
      "The game closed during the scan, so the scan was stopped and its report saved. Start a new scan when you're back in the game.",
    firstRunAdvice: "For accurate results",
    firstRunAdviceBody:
      "Launch GameLoop and the game first, then click Start scan and stay in the game while it runs. Minimizing GameLoop pauses GPU monitoring, and closing it ends the scan.",
    gameAdviceTitle: "One tip before your first scan",
    gameAdviceBody:
      "Close background apps before you play. Browsers, downloads, and chat apps compete with the game for CPU time, and any of them can show up in the results as a cause of stutter.",
    backgroundAdviceTitle: "Stay in the game while scanning",
    backgroundAdviceBody:
      "The game window was in the background during this scan. GPU analysis pauses while the window is minimized; other measurements continue. For the most complete results, stay in the game until the scan finishes.",
    exitTitle: "Exit before finishing?",
    exitBodyScan: "A scan is running. It will stop, and its report will be saved.",
    exitBodyDownload: "An update is downloading. The download will be cancelled.",
    exitBodyCleaning: "A cleanup is running. It will stop.",
    exitConfirm: "Exit",
    emulatorUpdatedTitle: "GameLoop was updated",
    emulatorUpdatedBody: (v: string) =>
      `GameLoop is now on version ${v}. Windows stores graphics preferences per install location, so check the switches in Tools and turn back on anything the update reset.`,
  },

  // ---- error codes from the backend ----
  errors: {
    GAMELOOP_NOT_RUNNING: "PUBG Mobile isn't running in GameLoop. Start the game first.",
    /** no install evidence anywhere: GameLoop was never installed here,
        so "start the game" would be the wrong advice */
    GAMELOOP_NOT_INSTALLED:
      "GameLoop isn't installed on this PC. Install GameLoop first, then start a scan.",
    SESSION_ALREADY_RUNNING: "A scan is already running.",
    SESSION_STOPPING: "The previous scan is still being saved. Try again in a moment.",
    SESSION_RUNNING: "The active scan can't be deleted.",
    APP_SHUTTING_DOWN: "The app is closing. Please try again.",
    PF_READ_FAILED: "Couldn't read the page file settings.",
    PF_DRIVE_INVALID: "That drive can't be used for a page file.",
    PF_MODE_INVALID: "That page file mode isn't valid.",
    PF_NO_SPACE: "Couldn't read the free space on that drive, so no size limit was applied.",
    PF_INITIAL_INVALID: "The initial size isn't valid for that drive.",
    PF_MAX_INVALID: "The maximum size isn't valid for that drive.",
    PF_WRITE_FAILED: "Windows rejected the page file change.",
    POWERSHELL_TIMEOUT: "The system check took too long. Try again.",
    EMULATOR_UNKNOWN:
      "This GameLoop version isn't recognized yet. If the game is running, update Lag Hunter to the latest version.",
    PROCESS_NOT_FOUND: "That app has already closed, so nothing was ended.",
    PROCESS_ACCESS_DENIED: "Windows denied the request to end that app. Administrator rights are required.",
    PROCESS_KILL_FAILED: "Couldn't end that app. Try again.",
    PROCESS_REFUSED: "That process is protected and can't be ended from here.",
    STARTUP_UNKNOWN_ID: "That startup entry is no longer listed. The list was re-read.",
    STARTUP_LOCKED: "That startup entry is locked by Windows and can't be changed from here.",
    STARTUP_WRITE_FAILED: "The change couldn't be verified, so it wasn't applied.",
  } as Record<string, string>,

  // ---- report highlights (composed in the UI from event kinds) ----
  highlights: {
    disk_queue: "Disk under load",
    disk_busy: "Disk under load",
    hard_faults: "Heavy file loading from disk",
    cpu_saturation: "CPU maxed out",
    cpu_throttle: "CPU throttled under load",
    mem_pressure: "Memory under pressure",
    paging_churn: "Background file shuffling",
    gpu_mem_idle: "GPU in power-saving mode while rendering",
    gpu_activity_cliff: "GPU activity dropped sharply",
    gpu_activity_cliff_loaded: "GPU activity dropped under load",
    gpu_clock_low: "GPU clock was low",
    gpu_temp: "GPU temperature high",
    spike: "Sustained performance drop",
    nothing: "Nothing notable happened during this session.",
    noSamples: "No samples were captured in this session.",
    mostly_background: "The game was in the background for most of this session, so the results may not reflect a real match.",
  } as Record<string, string>,

  // ---- report metrics (composed in the UI from machine keys + numbers) ----
  metrics: {
    cpuPeak: (v: number) => `CPU peaked at around ${v}% under load.`,
    cpuPerfMin: (v: number) => `CPU speed dropped to ${v}% of full speed at one point.`,
    ramFreeMin: (v: number) => `At least ${v} MB of RAM stayed free.`,
    gpuTempMax: (v: number) => `GPU peaked at ${v}\u00B0C.`,
    gpuUsageAvg: (v: number) => `GPU usage averaged around ${v}% while rendering.`,
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
    "Shows Tools options this PC can't use, dimmed with the reason. Their switches stay off because none of them can be turned on.",
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
  introResetHint: "Brings back every introduction card you closed with X.",
  // small measurement units (translated, not hardcoded Latin)
  gbUnit: "GB",
  minUnit: "m",
  secUnit: "s",

  // ---- first-run welcome (three slides, once ever) ----
  welcomeTitle: "PUBG GameLoop Lag Hunter",
  welcomeWhat:
    "Analyze your PUBG Mobile performance on GameLoop, find stutters, and see exactly what's causing them.",
  /** slide 1: what it finds (titles reuse the short card names) */
  welcomeFindsLabel: "What it finds",
  welcomeCardDisk: "Heavy disk paging",
  welcomeFindDiskDesc: "The game freezes while loading files",
  welcomeCardCpu: "CPU maxing out and throttling",
  welcomeFindCpuDesc: "Your processor can't keep up in big fights",
  welcomeCardGpu: "Hidden GPU slowdowns",
  welcomeFindGpuDesc: "We spot silent power dips and point to the right setting",
  welcomeNextBtn: "Next",
  /** slide 2: how it works, then the sample, then the cost */
  welcomeHowTitle: "Click Start scan, then play normally",
  welcomeHowSub: "It measures in the background and shows you the cause and the fix",
  welcomeSampleLabel: "What you will see",
  welcomeBack: "Back",
  welcomeSkip: "Skip",
  /** slide 3: what it costs (values stay Latin in both languages) */
  welcomeTrustTitle: "Almost no overhead",
  welcomeCostCpuVal: "<1%",
  welcomeCostCpuLabel: "CPU while scanning",
  welcomeCostRamVal: "25 MB",
  welcomeCostRamLabel: "of RAM",
  welcomeCostPrivacyVal: "Local",
  welcomeCostPrivacyLabel: "reports never leave your PC",
  welcomeBegin: "Get started",

  // ---- system tab ----
  /** one-shot page intro: the page name plus its one-number-per-part
      promise (the cards below deliver it) */
  introSystemTitle: "Your PC by the numbers",
  introSystemBody: "Every part of your PC, summed up in the one number that counts.",
  /** scope line under the System tab title: the standing header shows it
      on every visit (loading and error states included); the one-shot
      card below owns the longer promise, so this never repeats it */
  systemScope: "Processor, memory, graphics, and storage at a glance.",
  yourRig: "Your device",
  storageTitle: "Storage",
  deviceSystemTitle: "Device and system",
  /** spec card labels */
  specCpu: "Processor",
  specGpu: "Graphics card",
  specRam: "Installed RAM",
  specDisplay: "Display",
  /** spec value labels (label: value lines, MSA-safe for every count) */
  specCores: "cores",
  specThreads: "threads",
  specDedicated: "dedicated VRAM",
  specSpeedLabel: "Speed",
  specScaleLabel: "Scale",
  /** per-disk usage sentence (kind, size, and free share one line) */
  diskFree: (gb: number) => `${Math.round(gb)} GB free`,
  diskUsed: (pct: number) => `${Math.round(pct)}% used`,
  /** device and system row labels */
  specModel: "Model",
  specOs: "Windows",
  specDirectx: "DirectX",
  /** copy-all button + its transient confirmation */
  copySpecs: "Copy all specs",
  copiedSpecs: "Copied",
  copySpecsFailed: "Couldn't copy. Select the text manually.",
  psLimitedTitle: "Running in limited mode",
  psLimitedBody:
    "PowerShell isn't available, so some checks fall back to safe defaults: device tuning is skipped, clock times may show in UTC, and GPU pause/resume detection is off. Scans still work, and the core counters are read directly from Windows.",

  // ---- top processes tab ----
  introProcessesTitle: "Close heavy apps before you play",
  introProcessesBody:
    "These are the apps using the most memory right now, not counting the game. Close what you don't need before you play.",
  /** always-on one-liner above the list (the intro card is one-shot and
      disappears): the action and what the user gets for it, in their
      words. The scope and the ordering live in the intro card and the
      page header, not here */
  procsAbout: "Close apps you aren't using to free up memory for your game.",
  topProcessesEmpty: "Nothing significant is running",
  // ---- startup tab (own sidebar entry, Tools-section shape for a later move) ----
  /** tab label + standing header (the header sub leads with the benefit
      and states the scope in plain words: scheduled tasks and services
      are not listed, and the page says so) */
  startup: "Startup apps",
  startupScope:
    "Choose what opens when you sign in: fewer auto-starts, faster startup. Scheduled tasks and services are not listed here.",
  introStartupTitle: "Speed up your startup",
  introStartupBody:
    "Turn off what you don't need right away. Everything stays installed and opens normally whenever you need it.",
  startupEmpty: "No startup programs found",
  /** locked rows name their reason and offer the shield button: one
      system prompt clears the machine stamp, then the normal flip runs
      (a dismissed prompt rolls back silently, never dialogs) */
  startupLockedReason: "Locked by Windows: changing it needs administrator approval.",
  /** shield-button action on locked rows (the button text itself stays
      the state word: the action lives in the accessible name only) */
  startupChangeAsAdmin: "Change as administrator",
  /** enable confirm names the program and its cost: turning on is the
      additive direction (slower startup), turning off stays direct */
  startupEnableConfirmTitle: "Start automatically at sign-in?",
  startupEnableConfirmBody: (name: string) =>
    `${name} will open every time you sign in, which adds to your startup time.`,
  /** row action + status words (Task Manager language, merged into one
      control: the button text names the state, its accessible name the
      action — no switch implies no preferred direction) */
  startupEnable: "Enable",
  startupDisable: "Disable",
  startupStateOn: "Enabled",
  startupStateOff: "Disabled",
  refresh: "Refresh",
  endTask: "End",
  endingTask: "Ending...",
  endConfirmTitle: (name: string) => `End ${name}?`,
  endConfirmBody: (name: string) =>
    `${name} will close immediately and any unsaved work in it will be lost.`,
  endConfirmBodyCount: (name: string, count: string) =>
    `${name} (${count}) will close immediately and any unsaved work in them will be lost.`,
  procCount: (n: number) => `${n} ${n === 1 ? "process" : "processes"}`,
  /** per-row RAM line under the app name: the number plus what it is,
      so a bare figure never sits unexplained. At and above a gigabyte
      the figure reads in GB (same threshold as the sweep summary),
      never a four-digit MB count */
  procRamUsage: (mb: number) =>
    mb >= 1024
      ? `RAM usage: ${(mb / 1024).toFixed(1)} GB`
      : `RAM usage: ${Math.round(mb)} MB`,
  /** curated process display names (stable OS staples only; user
      software names itself via ProductName, raw names back both) */
  procNames: {
    procPowershell: "PowerShell",
    procCmd: "Command Prompt",
    procConsoleHost: "Console Window Host",
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
  } as Record<string, string>,
  /** generic loading line for tabs that are not Top Processes */
  loading: "Loading...",
  /** About tab: the manual update check is in flight */
  checkingUpdate: "Checking for updates...",

  // ---- system checks tab ----
  checksHint:
    "Your device's key settings in one place: what helps your game and what quietly slows it down.",
  introHealthTitle: "What quietly slows your game",
  introHealthBody:
    "A few Windows settings decide whether play is smooth or stuttery. Anything flagged takes you straight to its fix in one click.",
  checkPower: "Power plan",
  checkPagefile: "Virtual memory (page file)",
  checkCharger: "Power source",
  checkVt: "CPU virtualization (VT)",
  vtOk: "Enabled",
  vtWarn: "Disabled: turn it on in the BIOS for smooth emulation",
  checkDvr: "Background recording (DVR)",
  dvrOk: "Off",
  dvrWarn: "On: turn off Record what happened in Windows Gaming settings",
  checkHvci: "Memory integrity (HVCI)",
  checkHvciOn: "On",
  checkHvciOff: "Off",
  checkOkBadge: "Good",
  checkWarnBadge: "Needs attention",
  /** (?) buttons: screen-reader name carries the "about" context so it is
      not announced as a bare duplicate of the row name */
  hintAbout: (name: string) => `About ${name}`,
  /** summary banner: one-glance verdict above the cards, derived in the
      UI from the five checks (no backend change — counts warn cards) */
  healthAllGood: "Everything looks good",
  healthAllGoodSub: "Nothing on this PC is holding your game back",
  healthNeedsTitle: (n: number) => `${n} ${n === 1 ? "setting needs" : "settings need"} attention`,
  healthNeedsSub: "Everything else looks good",
  /** header above the full archive list (attention cards repeat above it
      as the featured summary, so this labels what follows, not a filter) */
  healthAllSettings: "All settings",
  powerOk: (name: string) => name,
  powerWarn: (name: string) => `${name}: switch to High performance for stable frame rates`,
  pagefileAuto: "Managed automatically by Windows",
  pagefileManual: (mb: number) => `${(mb / 1024).toFixed(0)} GB fixed. Anything below 8 GB can cause stutters`,
  pagefileOff: "Disabled, a common cause of severe stutter",
  chargerOk: "Plugged in",
  chargerWarn: "On battery: the device throttles, so results become unreliable",
  openSettings: "Open settings",
  /** health-card button whose fix lives inside Tools (DVR today): same
      promise as openSettings, but the destination is in-app */
  openInTools: "Open in Tools",
  /** per-card background notes behind the (?) button: same contract as the
      Tools hints (plain language, at most 3 sentences, never invented
      numbers). The DVR card reuses the Tools note verbatim (same option,
      same note); the rest own theirs. States and effect timing stay in
      the card's own desc/state lines, never duplicated here. */
  checkPowerHint:
    "The power plan decides whether the processor is allowed to run at full speed. Power-saver plans slow it down to stretch battery life, which shows up as stutter in fights.",
  checkPagefileHint:
    "The page file is backup memory on disk, used when RAM fills up. If it's too small or disabled, you get stutter while maps and textures load. Letting Windows manage it automatically suits most PCs.",
  checkVtHint:
    "Virtualization lets GameLoop use your processor directly instead of slow software emulation. It can only be changed manually, from the BIOS before Windows starts.",
  checkChargerHint:
    "Laptops slow themselves down on battery to protect it. A scan on battery measures a throttled device, so its results can mislead. Plug in before you play or scan.",

  // ---- tools tab ----
  tools: "Tools",
  /** beta pill next to the Tools entry in the sidebar: the tab writes to
      Windows and ships before the v2 release, so it stays labelled until
      v2 goes stable */
  toolsBeta: "Beta",
  toolsBack: "Tools",
  /** scope line under the Tools landing title: what the tab holds at a
      glance (per-card descriptions below own the details, this never
      repeats them) */
  toolsScope: "Tweaks, cleanup, and virtual memory. Every change is verified on the spot.",
  toolGamingTweaks: "Gaming performance",
  toolGamingTweaksDesc: "Performance switches for smoother play",
  /** one-shot intro for the gaming section: what the switches do and
      the two row rules (verify live, greyed means unsupported).
      The card takes its own friendly title (the standing header keeps
      the section name, same split as every other page) */
  introGamingTitle: "Reclaim your frames",
  introGamingBody:
    "Every Windows setting that costs you frames, on a switch of its own. Changes apply live; unsupported rows stay grey, with the reason.",
  toolPagefileDesc: "Fewer stutters when memory fills up",
  toolCleanup: "Disk cleanup",
  toolCleanupDesc: "Get disk space back without touching anything important",
  /** landing status badge over the gaming card (on/shown optimized):
      same rules as the details rows, via the shared summary */
  toolBadgeOptimized: (on: number, total: number) => `${on}/${total} optimized`,
  toolStorage: "Storage",
  toolStorageDesc: "Automatic cleanup plus a manual sweep for junk files.",
  /** one-shot intro for the storage section: who decides and who
      reports (mirrors the gaming intro contract above).
      The card takes its own friendly title (the standing header keeps
      the section name, same split as every other page) */
  introStorageTitle: "Keep your disk tidy",
  introStorageBody:
    "Watch your disk space and keep it tidy, automatically or on demand.",

  // ---- tweaks (Tools tab writes — switch mirrors live state).
  // Row copy is the name alone; the definition plus the effect timing
  // live behind the (?) button (same contract as the health cards). */
  tweakDvrTitle: "Turn off background recording (DVR)",
  tweakSsTitle: "Turn on automatic cleanup",
  tweakGameModeTitle: "Turn on Game Mode",
  tweakGpuTitle: "Run GameLoop on the high-performance GPU",
  tweakFsoTitle: "Turn off fullscreen optimizations",
  tweakMouseTitle: "Turn off mouse acceleration",
  tweakWindowedTitle: "Turn on optimizations for windowed games",
  tweakHvciTitle: "Turn off Memory integrity (HVCI)",
  /** per-row background notes behind the (?) button: at most 3 sentences,
      plain language (what it does, when it helps or hurts, effect
      timing), never invented numbers. No revert pattern: the switch
      itself is the way back, saying so every time is noise. */
  tweakDvrHint:
    "Background recording keeps the last few seconds of your play saved at all times, so the video encoder and the disk never get a break during a match. Turning it off removes a constant drain on the GPU and disk, with no downside for gameplay.",
  tweakSsHint:
    "Windows deletes temporary files on its own when free disk space runs low. This prevents a full disk, but it won't free space on a disk that's already full. Turning it off stops future cleanups.",
  tweakGameModeHint:
    "Asks Windows to prioritize the game for CPU time and hold back update interruptions while you play. Independent frame-time tests show it mainly smooths sudden dips, especially on PCs running a browser or chat app next to the game; a few CPU-bound titles run better with it off. Leave it on unless one specific game stutters.",
  tweakGpuHint:
    "On laptops with two graphics cards, Windows may run the game on the weaker built-in one to save power. This option pins GameLoop to the stronger GPU instead. It changes nothing on PCs with a single graphics card, and turning it off hands the decision back to Windows.",
  tweakFsoHint:
    "Some games pace their frames worse under Windows' fullscreen handling and feel smoother without it. The effect varies by game, so treat it as a per-title experiment, not a guaranteed win.",
  tweakMouseHint:
    "Pointer acceleration makes the cursor travel farther the faster you move your hand. Turning it off gives the same cursor distance for the same hand movement every time. It's purely about feel and doesn't change frame rate.",
  tweakWindowedHint:
    "Modern Windows can present windowed and borderless games with lower latency through a newer path. Microsoft documents smoother play in these modes when this switch is on. Turning it off restores the old path.",
  tweakHvciHint:
    "Memory integrity isolates the Windows kernel behind virtualization, which costs CPU time in games. Turning it off frees that overhead but weakens kernel protection, so only do this on a machine you trust. The change applies after a restart, and turning it back on restores protection.",
  tweakPfTitle: "Virtual memory (page file)",
  /** one-shot page card: the why (borrowed disk instead of a crash)
      and the honest default (automatic suits almost everyone) */
  introPagefileTitle: "A safety net for when memory fills up",
  introPagefileBody:
    "When RAM fills up, Windows borrows disk space so the game keeps running instead of crashing. This mirrors the system dialog: only the drive you pick changes, after a restart, and automatic suits almost everyone.",
  tweakPfAutoLabel: "Automatically manage page file size for all drives",
  tweakPfDrivesLabel: "Drives",
  /** short drive-card lines (letter rides its own span, so no drive
      prefix here): free space and mode stay separate spans */
  tweakPfDriveFreeShort: (gb: number) => `${gb} GB free`,
  tweakPfDriveNoSpaceShort: "Free space unknown",
  tweakPfModeLabel: "Mode",
  tweakPfModeSystem: "System managed size",
  tweakPfModeCustom: "Custom size",
  tweakPfModeOff: "No page file",
  tweakPfModeUnknown: "Couldn't be read",
  tweakPfDriveCustom: (min: number, max: number) => `Custom: ${min}–${max} MB`,
  tweakPfMinLabel: "Initial size (MB)",
  tweakPfMaxLabel: "Maximum size (MB)",
  tweakPfApply: "Apply",
  /** engine recommendation next to the inputs: values stay Latin */
  pfRecommend: (gb: number, min: number, max: number) =>
    `Recommended for ${gb} GB of RAM: ${min.toLocaleString("en-US")}–${max.toLocaleString("en-US")} MB`,
  tweakPfWarnOffTitle: (drive: string) => `Remove the page file on ${drive}?`,
  tweakPfWarnOffBody: (drive: string) =>
    `Without a page file on ${drive}, out-of-memory crashes are likely under load. The change takes effect after you restart Windows.`,
  tweakPfWarnSmallTitle: "Small page file?",
  tweakPfWarnSmallBody: (drive: string, max: number) =>
    `Sizes below 8 GB have caused stutters on real PCs. Set ${max} MB on ${drive} anyway?`,
  tweakPfPending: "Restart Windows to apply the page file change.",
  tweakPfPendingBadge: "Restart needed",
  /** restart-wait badge for the Memory Integrity row (same words as the
      page file badge: one vocabulary for one wait) */
  tweakHvciPendingBadge: "Restart needed",
  rebootTitle: "Restart Windows?",
  rebootBody:
    "The page file change takes effect after a restart. Restarting now will reboot Windows immediately.",
  rebootNow: "Restart",
  rebootLater: "Later",
  tweakPowerTitle: "Turn on High performance",
  /** visible effect timing (shared lines, verified rows only — the
      card shows when, the (?) shows what and why) */
  tweakEffectNow: "Takes effect immediately",
  tweakEffectReopen: "Close and reopen the game to apply",
  tweakEffectSignin: "Takes effect after you sign out of Windows and back in",
  tweakEffectRestart: "Takes effect after restart",
  tweakPowerHint:
    "Runs the processor at full speed by switching to the High performance plan. If the plan is missing, it's restored first with Windows' own command, then switched on. Turning it off brings back the plan you had before; PCs locked to Balanced-only mode hide this row instead.",
  /** summary banner over the gaming rows (same pattern as the health
      tab): one-glance verdict derived from the rendered rows, zero
      backend cost */
  tweakBannerGood: "All optimized",
  tweakBannerGoodSub: "Every tweak is at its recommended setting",
  tweakBannerNeeds: (n: number) => `${n} ${n === 1 ? "tweak needs" : "tweaks need"} attention`,
  tweakBannerNeedsSub: "Everything else is optimized",
  storageAllTitle: "All storage options",
  /** header above the full archive list (attention rows repeat above it
      as the featured summary, so this labels what follows, not a filter) */
  tweakAllTweaks: "All tweaks",
  /** reason line under a greyed-out row whose precondition the user can
      fix (GameLoop exes not resolved) — never shown for rows that can
      never work here (those hide instead) */
  tweakNeedsGameloop: "Requires GameLoop to be installed on this PC.",
  tweakNeedsWin11: "Requires Windows 11 or later on this PC.",
  tweakNeeds1803: "Requires Windows 10 version 1803 or later.",
  tweakHiddenS0: "Unavailable here: this device only supports Modern Standby (S0) power management.",
  tweakHiddenUltimate: "Unavailable here: the Ultimate Performance plan is already active.",
  /** reason line under a greyed-out row owned by policy or UEFI lock
      (shown, never hidden: the user must learn why it refuses) */
  tweakHvciLockedReason: "Controlled by your administrator or UEFI lock and can't be changed from here.",
  showUnsupportedLink: "Show unavailable options",
  tweakFailed: "The change couldn't be verified, so it wasn't applied.",
  /** storage sweep: scan four safe places, delete only the ticked ones */
  cleanupTitle: "Clean temporary files",
  introCleanupTitle: "You decide what gets deleted",
  introCleanupBody:
    "Everything here is leftovers that Windows and apps forgot to remove: temporary files, old logs, finished reports. Tick what you no longer need; anything important is never listed.",
  cleanupDesc:
    "Frees disk space from safe locations. Only what you tick is deleted, and nothing important is ever touched.",
  cleanupScan: "Scan",
  cleanupScanning: "Scanning...",
  cleanupRescan: "Scan again",
  cleanupClean: "Clean selected",
  cleanupCleaning: "Cleaning...",
  cleanupSelectAll: "Select all",
  cleanupDeselectAll: "Deselect all",
  cleanupNothing: "Nothing to clean: every scanned location is already empty.",
  cleanupScanFailed: "Couldn't read this PC during the scan. Try again.",
  /** shared legend for the "~" marker on sweep rows (shown once under
      the list, only while a partial row is visible): what the mark
      means and what to do about it. Never invents the hidden remainder. */
  cleanupPartialNote:
    "A ~ mark means Windows blocked reading some files, so the number counts only what could be read.",
  cleanupFreed: (mb: number) => `Freed ${mb} MB, measured before and after.`,
  cleanupUnmeasured:
    "Windows also wouldn't let us measure some of the space freed, so it isn't included in the number above.",
  /** scanned hero + cleaned payoff labels (the numbers ride their own
      lines, units stay Latin in both languages) */
  cleanupReadyToFree: "ready to free up",
  cleanupCleanedTag: "Your disk has a little more room to breathe.",
  cleanupLastNever: "Never cleaned yet.",
  cleanupLast: (mb: number, when: string) => `Last cleanup: ${mb} MB on ${when}.`,
  cleanup30d: (mb: number) => `Last 30 days: ${mb} MB.`,
  cleanupScanningCat: (name: string) => `Scanning ${name}...`,
  cleanupCleaningCat: (name: string) => `Cleaning ${name}...`,
  cleanupConfirmTitle: "Delete the selected files?",
  cleanupConfirmBody: (names: string) =>
    `This permanently deletes temporary files in: ${names}. Only the ticked locations are touched, and files in use are skipped.`,
  cleanupCatUserTemp: "My temporary files",
  cleanupCatUserTempHint:
    "Leftovers your apps left in your own temp folder. Safe to delete; apps rebuild whatever they still need.",
  cleanupCatSystemTemp: "Windows temporary files",
  cleanupCatSystemTempHint:
    "Leftovers from Windows services and installers. Safe to delete.",
  cleanupCatRecycle: "Recycle Bin",
  cleanupCatRecycleHint:
    "Files you deleted yourself that still take up space. Emptying it is permanent, so review it first.",
  cleanupCatDelivery: "Update sharing cache",
  cleanupCatDeliveryHint:
    "Windows Update files kept so they can be shared with other PCs on your network. Safe to delete; Windows re-downloads what it needs.",
  /** opt-in deep scan: same card flips to its results, never auto-ticked */
  cleanupDeepScan: "Deep scan",
  cleanupModeQuick: "Quick",
  cleanupModeDeep: "Deep",
  cleanupCatThumb: "Thumbnail previews",
  cleanupCatThumbHint:
    "Cached image previews that Windows rebuilds on its own. Safe to delete.",
  cleanupCatReports: "Finished error reports",
  cleanupCatReportsHint:
    "Old Windows error reports that were already sent or abandoned. Safe to delete.",
  cleanupCatDumps: "Old crash dumps",
  cleanupCatDumpsHint:
    "Crash memory dumps older than 30 days. Recent dumps are never touched, because they may explain a recent crash.",
  cleanupCatDownload: "Update leftovers",
  cleanupCatDownloadHint:
    "Downloaded update files Windows no longer needs. Best run after updates finish; Windows re-downloads anything it still needs.",
  cleanupCatLogs: "System log files",
  cleanupCatLogsHint:
    "Old Windows logs that pile up after updates. Files from the last 7 days are never touched.",

  // ---- about tab ----
  aboutTitle: "PUBG GameLoop Lag Hunter",
  aboutWhat:
    "Analyzes your PUBG Mobile performance on GameLoop, finds stutters, and shows exactly what's causing them.",
  aboutImpact: "What it costs your PC",
  aboutImpactItems: [
    "Under 1% CPU while scanning: it measures, it doesn't compete with the game",
    "About 25 MB of RAM, less than a single browser tab",
    "About 200 KB per minute of scanning on disk",
    "Your reports stay on your PC",
    "It never changes a setting unless you flip its switch yourself",
  ],
  aboutUpdate: "Updates",
  aboutCheckUpdate: "Check for updates",
  aboutUpToDate: "You're on the latest version",
  aboutNewVersion: "A new version is available. Download it now",
  aboutUpdateErr: "Couldn't check right now. Try again later",
  aboutSupport: "Buy me a coffee",
  aboutGitHub: "GitHub",
  aboutMade: "Made with",
  version: "Version",

  // ---- update modal ----
  updateAvailableTitle: "A new version is available",
  updateDownload: "Download update",
  updateClose: "Close",
  updateCancel: "Cancel",
  updateDownloading: "Downloading…",
  updateRetry: "Try again",
  updateDoneTitle: "Update downloaded",
  updateDoneHint: "Close the app and run the new file when you're ready.",
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
  // the big number is rendered separately; the unit only has to agree with it
  scanPlanUnit: (_m: number) => "min session",
  scanStep1: "Start the scan",
  scanStep2: "Play normally",
  scanStep3: "Read the report",
  scanIdleStart: "Start scan",
  scanIdleCloseApps: "Close your browser and heavy apps. The scan measures the whole machine.",

  // ---- monitor: running state (the user is away) ----
  scanRunningTitle: "Leave this window and go play",
  scanRunningBody: "Measuring now. You'll get the result when it's done.",
  // the live doubt this screen settles: "can I minimize this?"
  scanRunningNote:
    "Nothing to watch. You can minimize this window; the scan keeps running.",
  scanElapsed: "Elapsed",
  scanRemainingLabel: "Auto-stop in",
  scanRemaining: (m: number) => `${m} min left`,
  scanSamples: "Samples",
  scanOfSession: "of session",
  scanMoments: (n: number) => `${n} moment${n === 1 ? "" : "s"} captured`,
  scanStop: "Stop scan",

  // ---- monitor: result state (never auto-dismisses) ----
  scanResultLagTitle: "Lag captured",
  scanResultCleanTitle: "Nothing unusual",
  scanResultOver: (m: number) => `Over a ${m}-minute session`,
  scanResultSeconds: "seconds",
  scanResultMoments: "moments",
  scanResultTopSignal: "Top signal",
  scanResultNone: "None",
  scanResultOpenReport: "Open full report",
  scanResultAgain: "Scan again",
  scanResultFootnote: "The report has the timeline, every moment, and what to do about each one.",

  // ---- diagnoses (by engine key, mirrors the backend dictionary) ----
  diagnoses: {
    disk_wait: {
      title: "The game was waiting on the disk",
      simple:
        "The game stalled while loading files from disk, which causes severe stutter when dropping into the map and during crowded fights.",
      fix: "Increase the page file size and give GameLoop more RAM in its settings.",
    },
    cpu_busy: {
      title: "CPU at its limit",
      simple: "The processor was running at full capacity: the game needed more CPU cores than were available.",
      fix: "Limit GameLoop to physical cores only, and close background apps (browsers, Discord) before you play.",
    },
    cpu_throttle: {
      title: "CPU is slowing itself down",
      simple: "The processor got hot, so it lowered its speed to protect itself, and performance dropped sharply under load.",
      fix: "Clean the cooling fans, use a cooling pad, and keep the charger plugged in.",
    },
    mem_low: {
      title: "Memory nearly full",
      simple: "Memory filled up and the game kept moving files between RAM and disk, and every transfer caused a stutter.",
      fix: "Close background apps and increase the page file size.",
    },
    paging_churn: {
      title: "Background file shuffling",
      simple:
        "The system was moving game files between RAM and disk in the background even though both were healthy. This is normal and doesn't mean you're short on resources, but each transfer can show up as a small stutter.",
      fix: "Give GameLoop more RAM in its settings. If it keeps happening, increase the page file size on an SSD.",
    },
    gpu_wake: {
      title: "GPU waking from power-saving mode",
      simple:
        "The GPU dropped into power-saving mode between scenes and needed a moment to return to full speed, which showed up as a visible hitch.",
      fix: "In your GPU control panel (NVIDIA Control Panel), set GameLoop's power management to \"Prefer maximum performance\" and add every GameLoop process, not just the game. If it still happens, the driver is probably lowering memory clocks in light scenes (common on laptops with hybrid graphics). The effect is usually a brief hitch between scenes, not a lasting problem.",
    },
    scene_hitch: {
      title: "First-time scene loading",
      simple:
        "When a scene appears for the first time (like the lobby or a new map), your PC prepares its graphics, which causes one small hitch and then smooth play. Returning to the same scene is smooth because it's now cached.",
      fix: "There's no permanent fix. It eases as scenes repeat and improves with GPU driver updates.",
    },
    gpu_busy: {
      title: "GPU at its limit",
      simple: "The GPU was running at full capacity, which lowered the frame rate.",
      fix: "Lower the game's resolution or graphics quality by one step.",
    },
  } as Record<string, { title: string; simple: string; fix: string }>,

  // ---- reports ----
  sessions: "Sessions",
  sessionsHint: "Every finished scan is saved on your PC with its full report. Click a session to read it here.",
  /** totals card labels (numbers ride their own lines, so no plural
      forms are ever needed) */
  reportTotalSessions: "sessions",
  reportTotalIssues: "had issues",
  noSessions: "No sessions yet",
  noSessionsHint: "Run a scan from the Monitor tab. Finished sessions appear here with their reports.",
  loadingSessions: "Loading sessions...",
  /** deep link to a session id that is no longer saved (deleted meanwhile) */
  reportNotFound: "This session is no longer saved on this PC.",
  allSessions: "All sessions",
  sessionReport: "Session report",
  whatWeFound: "What we found",
  keyMoments: "Key moments",
  theNumbers: "The numbers",
  noIssuesCaptured: "No issues captured",
  noIssuesCapturedHint: "This session had nothing notable. If you felt lag anyway, run a longer scan while it's happening.",
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
  spikeCount: (n: number) => `${n} spike${n === 1 ? "" : "s"}`,
};

export type Locale = typeof en;
