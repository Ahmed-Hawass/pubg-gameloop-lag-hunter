// locales/en.ts: every user-facing string in the app. Single source of truth
// for English. The backend sends keys only; this file turns them into language.

export const en = {
  lang: { code: "en", dir: "ltr" as "ltr" | "rtl", label: "English" },

  // ---- shell / title bar ----
  minimize: "Minimize",
  maximize: "Maximize (window size is fixed)",
  close: "Close",

  // ---- dialog (unified, replaces toasts) ----
  dialog: {
    ok: "OK",
    cancel: "Cancel",
    confirm: "Confirm",
    delete: "Delete",
    deleteTitle: "Delete this session?",
    deleteBody: "Its samples and report will be permanently removed from your PC.",
    scanNeedsGame: "The game must be running to start a scan",
    scanNeedsGameBody:
      "PUBG Mobile must be running inside GameLoop before a scan can start. Start the game, then press Start again.",
    somethingWrong: "Something went wrong",
    gameloopClosed: "GameLoop was closed",
    gameloopClosedBody:
      "The game closed while the scan was running, so we stopped it and saved the report. Start a new scan when you're back in the game.",
    firstRunAdvice: "For accurate results",
    firstRunAdviceBody:
      "Start GameLoop and the game first, then press Start, and stay in the game while scanning. Minimizing GameLoop pauses GPU monitoring, and closing it ends the scan.",
  },

  // ---- error codes from the backend ----
  errors: {
    GAMELOOP_NOT_RUNNING: "PUBG Mobile isn't running inside GameLoop. Start the game first.",
    SESSION_ALREADY_RUNNING: "A scan is already running.",
    SESSION_STOPPING: "The previous scan is still being saved. Try again in a moment.",
    SESSION_SAVE_FAILED: "The session report couldn't be saved. Check free disk space and try again.",
  } as Record<string, string>,

  // ---- report highlights (composed in the UI from event kinds) ----
  highlights: {
    disk_queue: "Disk under load",
    disk_busy: "Disk under load",
    hard_faults: "Heavy file loading from disk",
    cpu_saturation: "CPU reached its limit",
    cpu_throttle: "CPU reduced its speed under load",
    mem_pressure: "Memory under pressure",
    gpu_mem_idle: "GPU in power-saving while rendering",
    render_stall: "Frame freeze detected",
    render_stall_loaded: "Frame freeze under load",
    gpu_clock_low: "GPU clock was low",
    gpu_temp: "GPU temperature high",
    spike: "Sustained performance drop",
    nothing: "Nothing notable happened during the session.",
    noSamples: "No samples were captured in this session.",
    mostly_background: "Most of this session was spent outside the game, so the results may not reflect a real match.",
  } as Record<string, string>,

  menu: "Menu",
  collapseMenu: "Collapse menu",
  expandMenu: "Expand menu",
  monitor: "Monitor",
  system: "System",
  topProcesses: "Top processes",
  systemChecks: "System checks",
  reports: "Reports",
  settings: "Settings",
  about: "About",
  language: "Language",

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

  // ---- system checks tab ----
  checksHint:
    "Read-only checks of settings that silently cause lag. Nothing is changed for you; each fix opens the relevant Windows settings page so you can change it yourself.",
  checkPower: "Power plan",
  checkPagefile: "Pagefile",
  checkCharger: "Power source",
  powerOk: (name: string) => `${name}: good`,
  powerWarn: (name: string) => `${name}: switch to High performance for stable FPS`,
  pagefileAuto: "Managed by Windows: good",
  pagefileManual: (mb: number) => `${(mb / 1024).toFixed(0)} GB fixed. Below 8 GB can cause stutters`,
  pagefileOff: "Disabled, a classic cause of heavy lag",
  chargerOk: "Plugged in",
  chargerWarn: "On battery: the machine throttles and results become unreliable",
  openSettings: "Open setting",

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
    "It never modifies Windows settings",
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
  time: "Time",
  timelineHint: "Every red dot is a lag spike we captured. The bar fills toward your auto-stop time.",

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
  gameBackground: "Game window is in the background, so GPU monitoring is paused until you return",

  // feed lines (by engine event kind)
  feed: {
    disk_queue: "Disk under load",
    disk_busy: "Disk under load",
    hard_faults: "Heavy file loading from disk",
    cpu_saturation: "CPU reached its limit",
    cpu_throttle: "CPU reduced its speed under load",
    mem_pressure: "Memory under pressure",
    gpu_mem_idle: "GPU power-saving while rendering",
    render_stall: "Frame freeze detected",
    render_stall_loaded: "Frame freeze under load",
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
  // honest outcomes
  clean: "Clean",
  findings: "Findings",
  lagCaptured: "Lag captured",
  partial: "Partial",
  samples: "samples",
  spikeCount: (n: number) => `${n} spike${n > 1 ? "s" : ""}`,
};

export type Locale = typeof en;
