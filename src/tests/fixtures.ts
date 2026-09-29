// tests/fixtures.ts — canned backend answers shared by component tests.
// Every value mirrors a bridge.ts contract; the mocks below only feed the
// UI, they never reimplement engine logic.

import type {
  CleanupScan,
  PagefileSettings,
  Settings,
  SystemInfo,
  Thresholds,
  TweakStates,
} from "../bridge";

export const thresholds: Thresholds = {
  cpu_saturation_pct: 90,
  proc_perf_floor_pct: 50,
  proc_perf_load_gate: 70,
  avail_mem_floor_mb: 512,
  hard_faults_per_sec: 100,
  disk_queue_len: 2,
  disk_busy_pct: 90,
  gpu_clock_floor_pct: 50,
  gpu_temp_warn_c: 80,
  gpu_temp_crit_c: 90,
  spike_cpu_drop_pct: 20,
  spike_sustained_sec: 3,
};

export function settings(over: Partial<Settings> = {}): Settings {
  return {
    version: 3,
    sensitivity: "normal",
    auto_stop_minutes: 5,
    language: "en",
    theme: "dark",
    sidebar_collapsed: false,
    onboarding_done: true,
    game_advice_done: true,
    background_advice_done: true,
    thresholds,
    ...over,
  };
}

export function tweakStates(over: Partial<TweakStates> = {}): TweakStates {
  return {
    game_dvr_enabled: true,
    storage_sense: false,
    game_mode: false,
    gpu_high_perf: "hidden",
    fso_disabled: "hidden",
    mouse_accel_off: false,
    windowed_game_opt: null,
    power_high_perf: "hidden",
    emulator_updated: false,
    emulator_version: "",
    ...over,
  };
}

export function pagefileSettings(
  over: Partial<PagefileSettings> = {},
): PagefileSettings {
  return {
    automatic: false,
    drives: [
      { drive: "C:", free_mb: 50000, mode: "system", min_mb: null, max_mb: null },
    ],
    pending: false,
    ram_total_mb: 32768,
    recommended_min_mb: 16384,
    recommended_max_mb: 49152,
    ...over,
  };
}

export function cleanupScan(): CleanupScan {
  return {
    categories: [
      { id: "user_temp", bytes: 10485760 },
      { id: "system_temp", bytes: 0 },
      { id: "recycle_bin", bytes: null },
    ],
    history: { last_freed_bytes: 0, last_at: null, last_30d_bytes: 0 },
  };
}

export function systemInfo(over: Partial<SystemInfo> = {}): SystemInfo {
  return {
    cpu: { name: "Core i7", mhz: 2700, cores: 4, threads: 8 },
    gpus: [],
    ram: { total_gb: 16, mem_type: "DDR4", speed_mhz: 3200 },
    disks: [],
    display: { width: 1920, height: 1080, refresh_hz: 60, scale_pct: 100 },
    system: {
      manufacturer: "Dell",
      model: "Precision",
      os_caption: "Windows 11 Pro",
      os_release: "25H2",
      directx: "DirectX 12",
    },
    ram_gb: 16,
    gpu_counters: false,
    powershell_available: true,
    ...over,
  };
}
