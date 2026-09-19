// bridge.ts — typed Tauri bindings. The ONLY file that talks to the backend.
// All types mirror engine/types.rs exactly.

import { listen } from "@tauri-apps/api/event";
import { Channel } from "@tauri-apps/api/core";
import type { EventCallback } from "@tauri-apps/api/event";

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
  setSidebarCollapsed: (collapsed: boolean) => invoke<boolean>("set_sidebar_collapsed", { collapsed }),
  finishOnboarding: () => invoke<void>("finish_onboarding"),
  finishGameAdvice: () => invoke<void>("finish_game_advice"),
  finishBackgroundAdvice: () => invoke<void>("finish_background_advice"),
  setAutoStop: (minutes: number) => invoke<number>("set_auto_stop", { minutes }),
  openPath: (path: string) => invoke<void>("open_path", { path }),
  openUrl: (url: string) => invoke<void>("open_url", { url }),
  getVersion: () => invoke<string>("get_version"),
  systemInfo: () => invoke<SystemInfo>("system_info"),
  topProcesses: (force?: boolean) => invoke<TopProcess[]>("top_processes", { force: force ?? false }),
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
};

// ---- system tabs -----------------------------------------------------------

export interface GpuInfo {
  name: string;
  vram_gb: number | null;
}

export interface DiskInfo {
  name: string;
  media: string;
  bus: string;
  size_gb: number;
}

export interface SystemInfo {
  cpu: string;
  gpus: GpuInfo[];
  ram_gb: number;
  disks: DiskInfo[];
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
}
/** pre-write warning from validate_pagefile_settings */
export type PagefileWarning = "off" | "small" | null;

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
