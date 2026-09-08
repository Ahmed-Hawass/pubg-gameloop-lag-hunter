// bridge.ts — typed Tauri bindings. The ONLY file that talks to the backend.
// All types mirror engine/types.rs exactly.

import { listen } from "@tauri-apps/api/event";
import { Channel } from "@tauri-apps/api/core";
import type { EventCallback, UnlistenFn } from "@tauri-apps/api/event";

// ---- types mirroring Rust ------------------------------------------------

export interface GpuSample {
  pclk: number | null;
  mclk: number | null;
  sm_pct: number | null;
  mem_pct: number | null;
  temp: number | null;
  pstate: string | null;
}

export interface ProcInfo {
  name: string;
  pid: number | null;
  ws_mb: number | null;
  cpu_seconds: number | null;
}

export interface Diagnosis {
  key: string;
  title: string;
  simple: string;
  cause: string;
  fix: string;
  severity: string;
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
  sev: string;
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

export interface SpikeMark {
  offset_ms: number;
  kind: string;
}

export const api = {
  sessionStart: (autoStopSecs: number) => invoke<StatusPayload>("session_start", { autoStopSecs }),
  sessionStop: () => invoke<StatusPayload>("session_stop"),
  getState: () => invoke<StatusPayload>("get_state"),
  gameloopStatus: () => invoke<boolean>("gameloop_status"),
  psAvailable: () => invoke<boolean>("ps_available"),
  watchGameloop: () => invoke<void>("watch_gameloop"),
  sessionEntries: () => invoke<SessionEntry[]>("session_entries"),
  loadReport: (id: string) => invoke<FriendlyReport>("load_report", { id }),
  deleteSession: (id: string) => invoke<void>("delete_session", { id }),
  deleteAllSessions: (excludeId: string | null) =>
    invoke<string[]>("delete_all_sessions", { excludeId }),
  sessionFolder: (id: string) => invoke<string>("session_folder", { id }),
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
  systemChecks: () => invoke<SystemChecks>("system_checks"),
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
}

// ---- gameloop watcher events ----------------------------------------------
// The backend emits `engine://gameloop` (true/false) while idle, so the UI
// knows the moment the user opens GameLoop (the Start button stays pressable
// either way — pressing without the game shows an explaining dialog).
// Note: static import — @tauri-apps/api/event is already in the main chunk
// via TitleBar's window import, so a dynamic import split nothing (Vite
// warned INEFFECTIVE_DYNAMIC_IMPORT).

export async function onGameloopChange(cb: (up: boolean) => void): Promise<UnlistenFn> {
  return listen<boolean>("engine://gameloop", (ev) => cb(ev.payload));
}

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
  /** "clean" | "issues" | "laggy" | "partial" */
  outcome: string;
}

export interface FriendlyFinding {
  /** machine key for UI translation (e.g. "disk_wait") */
  key: string;
  /** English fallback text */
  title: string;
  simple: string;
  fix: string;
  severity: string;
}

export interface HighlightEntry {
  kind: string;
  clock: string;
  dur_sec: number | null;
}

export interface FriendlyReport {
  id: string;
  date: string;
  duration_sec: number;
  samples: number;
  lag_spikes: number;
  /** "clean" | "issues" | "laggy" | "partial" */
  outcome: string;
  highlights: HighlightEntry[];
  metrics_summary: string[];
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

// ---- event helpers --------------------------------------------------------

export async function onEngineState(cb: EventCallback<StatusPayload>): Promise<() => void> {
  const un = await listen<StatusPayload>("engine://state", cb);
  return un;
}
