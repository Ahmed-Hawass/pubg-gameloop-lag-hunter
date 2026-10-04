// bridge.ts — typed Tauri bindings. The ONLY file that talks to the backend.
// All types mirror engine/types.rs exactly.

import { listen } from "@tauri-apps/api/event";
import { Channel } from "@tauri-apps/api/core";
import type { EventCallback } from "@tauri-apps/api/event";

/** Browser-local invalidation event for feature state shared by Checks/Tools. */
export const FEATURE_STATE_CHANGED_EVENT = "laghunter:feature-state-changed";

export function notifyFeatureStateChanged(): void {
  window.dispatchEvent(new Event(FEATURE_STATE_CHANGED_EVENT));
}

// ---- types mirroring Rust ------------------------------------------------

/** event severity — mirrors engine types.rs Severity (as_str) */
export type Severity = "ok" | "warn" | "crit";

/**
 * diagnosis-card severity — mirrors the Diagnosis/FriendlyFinding severity
 * in types.rs ("high" | "medium" | "low"). A DIFFERENT vocabulary from
 * Severity on purpose: events say how bad a measurement is, cards say how
 * much the user should care. Do not merge them.
 */
export type CardSeverity = "high" | "medium" | "low";

export interface Diagnosis {
  key: string;
  title: string;
  simple: string;
  cause: string;
  fix: string;
  severity: CardSeverity;
  at: string;
}

export interface Bars {
  cpu: number | null;
  ram: number | null;
  gpu: number | null;
  disk: number | null;
}

export interface History {
  cpu: number[];
  ram: number[];
  gpu: number[];
  disk: number[];
}

export interface FeedEntry {
  phase: "start" | "end" | "instant";
  /** machine event kind — the UI translates it (e.g. "disk_queue") */
  kind: string;
  sev: Severity;
  /** clock time HH:MM:SS from the sample */
  clock: string;
}

export type Overall = "ok" | "watch" | "lag";

export type StopReason = "manual" | "auto_stop" | "gameloop_closed";

export interface UiState {
  v: number;
  session: string | null;
  started_at: string | null;
  time: string;
  game_running: boolean;
  /** Is the game window visible (not minimized)? null = not probed yet */
  game_visible: boolean | null;
  overall: Overall;
  lag_count: number;
  bars: Bars;
  history: History;
  spikes: SpikeMark[];
  elapsed_sec: number;
  auto_stop_sec: number | null;
  feed: FeedEntry[];
  diagnoses: Diagnosis[];
  samples_count: number;
  emulator: string | null;
}

export type SessionStatus = "idle" | "running" | "stopping" | "finished";

export interface StatusPayload {
  status: SessionStatus;
  ui: UiState | null;
  /** why the last session ended — present when a session just finished */
  stop_reason?: StopReason;
}

export interface Thresholds {
  cpu_saturation_pct: number;
  proc_perf_floor_pct: number;
  proc_perf_load_gate: number;
  avail_mem_floor_mb: number;
  hard_faults_per_sec: number;
  disk_queue_len: number;
  disk_busy_pct: number;
  gpu_clock_floor_pct: number;
  gpu_temp_warn_c: number;
  gpu_temp_crit_c: number;
  spike_cpu_drop_pct: number;
  spike_sustained_sec: number;
}

// ---- invoke wrappers ------------------------------------------------------

declare global {
  interface Window {
    __TAURI_INTERNALS__: {
      invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
    };
  }
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return window.__TAURI_INTERNALS__.invoke(cmd, args) as Promise<T>;
}

// ---- window + dialog bindings (the app's own window chrome, not engine
// commands — but the same rule applies: bridge.ts is the ONLY file that
// talks to Tauri, so these wrappers exist here for every consumer) -------

/** Reveal the main window (called by main.tsx on first paint). */
export async function showMainWindow(): Promise<void> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().show();
}

/** Apply the UI zoom factor to this webview (native WebView zoom:
    layout and fonts scale together, zero CSS changes). Factor only,
    persistence stays in settings like every other preference. */
export async function setWebviewZoom(factor: number): Promise<void> {
  const { getCurrentWebview } = await import("@tauri-apps/api/webview");
  await getCurrentWebview().setZoom(factor);
}

/** Is the main window maximized? */
export async function isWindowMaximized(): Promise<boolean> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow().isMaximized();
}

/** Subscribe to window resizes (used to re-read the maximized state). */
export async function onWindowResized(cb: () => void): Promise<() => void> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const un = await getCurrentWindow().onResized(cb);
  return un;
}

export async function minimizeWindow(): Promise<void> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().minimize();
}

export async function toggleMaximizeWindow(): Promise<void> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().toggleMaximize();
}

export async function closeWindow(): Promise<void> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().close();
}

/** Native save dialog (the update download's destination picker). */
export async function saveDialog(opts: {
  defaultPath: string;
  filters: { name: string; extensions: string[] }[];
}): Promise<string | null> {
  const { save } = await import("@tauri-apps/plugin-dialog");
  return save(opts);
}

export interface SpikeMark {
  offset_ms: number;
  kind: string;
}

export const api = {
  sessionStart: (autoStopSecs: number) => invoke<StatusPayload>("session_start", { autoStopSecs }),
  sessionStop: () => invoke<StatusPayload>("session_stop"),
  getState: () => invoke<StatusPayload>("get_state"),
  psAvailable: () => invoke<boolean>("ps_available"),
  watchGameloop: () => invoke<void>("watch_gameloop"),
  sessionEntries: () => invoke<SessionEntry[]>("session_entries"),
  loadReport: (id: string) => invoke<FriendlyReport>("load_report", { id }),
  deleteSession: (id: string) => invoke<void>("delete_session", { id }),
  deleteAllSessions: (excludeId: string | null) =>
    invoke<string[]>("delete_all_sessions", { excludeId }),
  sessionFolder: (id: string) => invoke<string>("session_folder", { id }),
  sessionsRoot: () => invoke<string>("sessions_root"),
  getSettings: () => invoke<Settings>("get_settings"),
  setLanguage: (lang: string) => invoke<string>("set_language", { lang }),
  setTheme: (theme: string) => invoke<string>("set_theme", { theme }),
  /** persist the UI zoom percent (the engine clamps to 80..=125 and
      hands the stored value back, like every other set_* command) */
  setUiZoom: (pct: number) => invoke<number>("set_ui_zoom", { pct }),
  setSidebarCollapsed: (collapsed: boolean) => invoke<boolean>("set_sidebar_collapsed", { collapsed }),
  finishOnboarding: () => invoke<void>("finish_onboarding"),
  finishGameAdvice: () => invoke<void>("finish_game_advice"),
  finishBackgroundAdvice: () => invoke<void>("finish_background_advice"),
  /** persist one dismissed intro card by id (a repeat id is a backend
      no-op, never a duplicate row) */
  dismissIntroCard: (id: string) => invoke<void>("dismiss_intro_card", { id }),
  /** empty the dismissed intro cards list (every card shows again) */
  resetIntroCards: () => invoke<void>("reset_intro_cards"),
  setAutoStop: (minutes: number) => invoke<number>("set_auto_stop", { minutes }),
  openPath: (path: string) => invoke<void>("open_path", { path }),
  openUrl: (url: string) => invoke<void>("open_url", { url }),
  getVersion: () => invoke<string>("get_version"),
  systemInfo: () => invoke<SystemInfo>("system_info"),
  topProcesses: (force?: boolean) => invoke<TopProcesses>("top_processes", { force: force ?? false }),
  systemChecks: (force?: boolean) =>
    invoke<SystemChecks>("system_checks", { force: force ?? false }),
  /** the Tools tab's switches only (microseconds, in-process) — the
      full systemChecks batch is never paid for a page that displays none
      of its rows */
  tweakStates: () => invoke<TweakStates>("tweak_states"),
  openWindowsPanel: (panel: string) => invoke<void>("open_windows_panel", { panel }),
  // update flow
  checkUpdate: () => invoke<UpdateInfo | null>("check_update"),
  updateAlreadyAnnounced: (version: string) =>
    invoke<boolean>("update_already_announced", { version }),
  announceUpdate: (version: string) => invoke<void>("announce_update", { version }),
  downloadUpdate: (info: UpdateInfo, dest: string, onEvent: (ev: DownloadEvent) => void) =>
    invoke<string>("download_update", {
      info,
      dest,
      onEvent: new Channel<DownloadEvent>(onEvent),
    }),
  cancelUpdateDownload: () => invoke<void>("cancel_update_download"),
  openDownloadFolder: (path: string) => invoke<void>("open_download_folder", { path }),
  // tweaks (Tools tab writes): the switch mirrors the live Windows state
  setTweak: (id: string, value: number) => invoke<TweakResult>("set_tweak", { id, value }),
  /** the Virtual Memory-style editor's single read (global flag + one
      live state per fixed drive) */
  pagefileSettings: () => invoke<PagefileSettings>("pagefile_settings"),
  /** validate-only entry for the editor's confirm step: the same keys as
      the write path, plus the pre-write warning ("off" | "small" | null).
      Arg keys are camelCase (Tauri maps them to the Rust snake_case
      params); a snake_case key here is a certain "missing key" error. */
  validatePagefileSettings: (
    automatic: boolean,
    drive: string,
    mode: string,
    minMb: string,
    maxMb: string,
  ) =>
    invoke<PagefileWarning>("validate_pagefile_settings", {
      automatic,
      drive,
      mode,
      minMb,
      maxMb,
    }),
  /** apply the editor's request (a mode is data, never a 0/1 tweak) */
  applyPagefileSettings: (
    automatic: boolean,
    drive: string,
    mode: string,
    minMb: string,
    maxMb: string,
  ) =>
    invoke<TweakResult>("apply_pagefile_settings", {
      automatic,
      drive,
      mode,
      minMb,
      maxMb,
    }),
  /** immediate reboot (page file changes apply at boot) */
  scheduleReboot: () => invoke<void>("schedule_reboot"),
  /** the Storage sweep's read-only scan (three quick places + memory),
      with per-category progress over the channel */
  storageScan: (onEvent: (ev: CleanupProgress) => void) =>
    invoke<CleanupScan>("storage_scan", {
      onEvent: new Channel<CleanupProgress>(onEvent),
    }),
  /** the opt-in deep scan (thumbnail previews, error reports, stale
      dumps), same answer shape as the standard scan */
  storageDeepScan: (onEvent: (ev: CleanupProgress) => void) =>
    invoke<CleanupScan>("storage_deep_scan", {
      onEvent: new Channel<CleanupProgress>(onEvent),
    }),
  /** delete only the ticked sweep categories, verified by re-measure */
  storageClean: (categories: string[], onEvent: (ev: CleanupProgress) => void) =>
    invoke<CleanupResult[]>("storage_clean", {
      categories,
      onEvent: new Channel<CleanupProgress>(onEvent),
    }),
  /** sweep memory read, no scan: last run + last-30-days totals for the
      Tools landing card and the sweep page (scanning stays manual) */
  cleanupHistory: () => invoke<CleanupHistory>("cleanup_history"),
  /** OS clock convention for wall-clock display (12-hour or not), read
      from the Windows time format itself, never the app language */
  clockHour12: () => invoke<boolean>("clock_hour12"),
};

// ---- system tabs -----------------------------------------------------------

export interface GpuInfo {
  name: string;
  vram_gb: number | null;
  driver: string | null;
}

export interface DiskInfo {
  name: string;
  media: string;
  bus: string;
  size_gb: number;
}

export interface CpuInfo {
  name: string;
  mhz: number | null;
  cores: number | null;
  threads: number | null;
}

export interface RamInfo {
  total_gb: number;
  mem_type: string | null;
  speed_mhz: number | null;
}

export interface DisplayInfo {
  width: number | null;
  height: number | null;
  refresh_hz: number | null;
  scale_pct: number | null;
}

export interface SystemIdentity {
  manufacturer: string;
  model: string;
  os_caption: string;
  os_release: string;
  directx: string;
}

export interface SystemInfo {
  cpu: CpuInfo;
  gpus: GpuInfo[];
  ram: RamInfo;
  disks: DiskInfo[];
  display: DisplayInfo;
  system: SystemIdentity;
  ram_gb: number;
  /** can the tool read NVIDIA GPU counters? */
  gpu_counters: boolean;
  /** is PowerShell usable? false = limited mode (defaults, muted GPU checks) */
  powershell_available: boolean;
}

export interface TopProcess {
  name: string;
  pid: number;
  cpu_pct: number;
  ram_mb: number;
  /** "app" (user software) or "system" (leave running), decided by the engine */
  kind: "app" | "system";
  /** curated display key (e.g. "procPowershell") for known OS staples */
  display_key: string | null;
  /** ProductName from the exe itself, else the raw process name */
  display_name: string;
}

/** ranked rows plus honest background totals (every non-excluded process,
    not just the displayed top rows) */
export interface TopProcesses {
  processes: TopProcess[];
  total_cpu: number;
  total_ram_mb: number;
}

export interface SystemChecks {
  power_name: string;
  power_ok: boolean;
  pagefile_mode: "auto" | "manual" | "off";
  pagefile_mb: number;
  pagefile_ok: boolean;
  laptop: boolean;
  on_ac: boolean;
  /** true when CPU virtualization (VT) is enabled in firmware */
  vt_enabled: boolean;
  /** true when Game DVR / background recording is on */
  game_dvr_enabled: boolean;
  /** Storage Sense on/off; null = feature unavailable on this Windows
      build (the row hides, never a dead switch) */
  storage_sense: boolean | null;
}

/** Visibility of a Tools row whose availability depends on the machine —
    mirrors RowState in engine/system.rs. `disabled_gameloop_not_found`
    renders greyed with a translated reason (fixable by the user);
    `hidden` renders nothing (can never work here). */
export type RowState = "on" | "off" | "disabled_gameloop_not_found" | "hidden";
export interface TweakStates {
  game_dvr_enabled: boolean;
  storage_sense: boolean | null;
  /** Game Mode master toggles read 1 (missing reads as the OS default) */
  game_mode: boolean;
  /** every resolved GameLoop exe prefers the high-performance GPU */
  gpu_high_perf: RowState;
  /** every resolved GameLoop exe carries the fullscreen-optimizations
      opt-out flag */
  fso_disabled: RowState;
  /** pointer precision values all read zero (missing reads as the OS
      default, precision on) */
  mouse_accel_off: boolean;
  /** windowed-games optimization state (Win11+ only); None = unsupported
      build (row hides — there is no such Settings toggle to mirror there) */
  windowed_game_opt: boolean | null;
  /** High Performance row state: on/off/disabled-with-reason/hidden,
      same contract as the per-exe rows */
  power_high_perf: RowState;
  /** one-time client-update notice: the GameLoop build changed since the
      last Tools read (path-keyed GPU/FSO prefs orphan on client updates).
      The engine persists on the notifying read — later reads stay quiet. */
  emulator_updated: boolean;
  /** detected GameLoop client version ("7.0.19.05"), "" when unknown */
  emulator_version: string;
}

/** one fixed drive's page file state (mirrors PagefileDriveState in
    engine/system.rs; mode is a machine key, the UI translates it) */
export type PagefileMode = "system" | "custom" | "off" | "unknown";
export interface PagefileDrive {
  drive: string;
  /** free MB on this drive (null = unreadable, custom refuses blind) */
  free_mb: number | null;
  mode: PagefileMode;
  /** live sizes, custom only */
  min_mb: number | null;
  max_mb: number | null;
}
/** the editor's single read (mirrors PagefileSettings in system.rs) */
export interface PagefileSettings {
  automatic: boolean;
  drives: PagefileDrive[];
  /** a page file write is waiting for a reboot (self-clearing) */
  pending: boolean;
  /** installed RAM in MB (null = unreadable): strip + recommendation only */
  ram_total_mb: number | null;
  /** recommended custom sizes for the installed RAM (null when unknown) */
  recommended_min_mb: number | null;
  recommended_max_mb: number | null;
}
/** pre-write warning from validate_pagefile_settings */
export type PagefileWarning = "off" | "small" | null;

/** one measured sweep place (mirrors CleanupCategory in engine/cleanup.rs;
    bytes null = unreadable, the UI shows "--", never a guess) */
export interface CleanupCategory {
  id: string;
  bytes: number | null;
}
/** measured freed bytes per swept category (null = unmeasurable,
    the UI says so instead of printing 0) */
export interface CleanupResult {
  id: string;
  freed_bytes: number | null;
}
/** sweep memory: last run + last-30-days total, bytes only */
export interface CleanupHistory {
  last_freed_bytes: number;
  last_at: string | null;
  last_30d_bytes: number;
}
/** the scan answer: measured places plus the sweep memory */
export interface CleanupScan {
  categories: CleanupCategory[];
  history: CleanupHistory;
}
/** per-category progress streamed over the scan/clean channel */
export type CleanupProgress = {
  event: "category";
  id: string;
  index: number;
  total: number;
};

// ---- settings (persisted user preferences — schema v3) --------------------

export interface Settings {
  version: number;
  /** legacy from v2 — ignored by the engine */
  sensitivity: string;
  /** default auto-stop in minutes (5..=120) */
  auto_stop_minutes: number;
  /** "auto" | "en" | "ar" — "auto" follows the OS at launch */
  language: string;
  /** "dark" | "light" | "auto" — "auto" follows the OS theme */
  theme: string;
  sidebar_collapsed: boolean;
  /** first-run welcome screen completed */
  onboarding_done: boolean;
  /** pre-scan advice ("close background apps") shown once ever */
  game_advice_done: boolean;
  /** stay-in-game advice shown once ever */
  background_advice_done: boolean;
  /** dismissed one-shot page cards, by card id (old files: empty list) */
  dismissed_cards: string[];
  /** UI zoom percent (80..=125, 100 = no zoom) */
  ui_zoom_pct: number;
  thresholds: Thresholds;
}

// ---- reports ------------------------------------------------------------

export interface SessionEntry {
  id: string;
  date: string;
  duration_sec: number;
  samples: number;
  lag_spikes: number;
  /** honest outcome — mirrors storage.rs honest_outcome() */
  outcome: Outcome;
}

export type Outcome = "clean" | "issues" | "laggy" | "partial";

export interface FriendlyFinding {
  /** machine key for UI translation (e.g. "disk_wait") */
  key: string;
  /** English fallback text */
  title: string;
  simple: string;
  fix: string;
  severity: CardSeverity;
}

export interface HighlightEntry {
  kind: string;
  clock: string;
  dur_sec: number | null;
}

/** One metrics-summary fact: machine key + measured number. */
export interface MetricEntry {
  key: string;
  value: number;
}

export interface FriendlyReport {
  id: string;
  date: string;
  duration_sec: number;
  samples: number;
  lag_spikes: number;
  /** honest outcome — mirrors storage.rs honest_outcome() */
  outcome: Outcome;
  highlights: HighlightEntry[];
  /** metric facts: machine keys + raw numbers, the UI composes the
      sentence per language */
  metrics_summary: MetricEntry[];
  findings: FriendlyFinding[];
  raw_path: string;
}

// ---- update flow (backend engine/update.rs) ------------------------------

export interface UpdateInfo {
  version: string;
  /** release notes, plain text — rendered pre-wrap, never HTML */
  notes: string;
  asset_url: string;
  asset_name: string;
  sums_url: string;
}

/** progress events streamed over the download channel */
export type DownloadEvent =
  | { event: "progress"; downloaded: number; total: number }
  | { event: "done"; path: string }
  | { event: "failed"; reason: string };

// ---- tweaks (backend engine/tweaks.rs) ------------------------------

/** result of a write: what was there, what was written, and whether
    a fresh re-read confirms it — verified == false is a failure, never ok */
export interface TweakResult {
  id: string;
  previous: number | null;
  value: number;
  verified: boolean;
}

// ---- event helpers --------------------------------------------------------

export async function onEngineState(cb: EventCallback<StatusPayload>): Promise<() => void> {
  const un = await listen<StatusPayload>("engine://state", cb);
  return un;
}
