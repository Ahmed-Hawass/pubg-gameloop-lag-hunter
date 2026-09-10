// types.rs — the single data model shared by sampler, detector, diagnoser, UI state
// This is the contract. Everything speaks these types.

use serde::{Deserialize, Serialize};

/// One measurement tick, ~1/sec. All fields optional: sources may be unavailable.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Sample {
    /// ISO-8601 timestamp of when the tick was taken
    pub t: String,
    /// Total CPU utilization % (0-100)
    pub cpu_total: Option<f64>,
    /// Actual CPU frequency as % of nominal (throttle detection; >100 = turbo)
    pub proc_perf: Option<f64>,
    /// Available RAM in MB
    pub avail_mb: Option<f64>,
    /// Hard page faults (pages read from disk) per second
    pub pages_in: Option<f64>,
    /// Disk queue length
    pub disk_queue: Option<f64>,
    /// Disk busy % (100 - idle)
    pub disk_busy_pct: Option<f64>,
    /// GPU sample, when an NVIDIA/AMD source is available
    pub gpu: Option<GpuSample>,
    /// Emulator processes snapshot (periodic)
    pub emu: Vec<ProcInfo>,
    /// Is the game window VISIBLE (not minimized)? None = not probed yet.
    /// GPU rules are muted while the window is in the background — otherwise
    /// desktop activity (browser, video) masquerades as in-game GPU events.
    #[serde(default)]
    pub game_visible: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GpuSample {
    /// Graphics core clock MHz
    pub pclk: Option<f64>,
    /// Memory clock MHz
    pub mclk: Option<f64>,
    /// SM/shader utilization % (render activity)
    pub sm_pct: Option<f64>,
    /// Memory controller utilization %
    pub mem_pct: Option<f64>,
    /// GPU temperature C
    pub temp: Option<f64>,
    /// Performance state, e.g. "P0", "P8"
    pub pstate: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProcInfo {
    pub name: String,
    pub pid: Option<u32>,
    /// Working set RAM in MB
    pub ws_mb: Option<f64>,
    /// Cumulative CPU seconds (used to derive per-window CPU rate)
    pub cpu_seconds: Option<f64>,
}

/// Raw engine event, produced by the Detector. Phase = state transitions.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineEvent {
    /// Machine key, e.g. "disk_queue", "gpu_activity_cliff"
    pub kind: String,
    /// "start" | "end" | "instant"
    pub phase: Phase,
    /// "ok" | "warn" | "crit"
    pub severity: Severity,
    pub t: String,
    /// Duration in seconds, present on "end" phase
    pub duration_sec: Option<f64>,
    /// Human details (English, UI-facing through Diagnoser)
    pub detail: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    Start,
    End,
    Instant,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Ok,
    Warn,
    Crit,
}

impl Severity {
    pub fn as_str(&self) -> &'static str {
        match self {
            Severity::Ok => "ok",
            Severity::Warn => "warn",
            Severity::Crit => "crit",
        }
    }
}

/// Shared "everything else looks healthy" gate for GPU-cliff
/// classification. ONE definition: the detector (emit-time event kind)
/// and the diagnoser (display-time card) must agree — with two copies the
/// detector checked disk+CPU+RAM while the diagnoser checked disk+CPU
/// only, so a collapse under RAM pressure was recorded `loaded` yet
/// displayed as a harmless scene hitch.
/// Missing counters abstain as healthy: without evidence we never blame
/// load (a missing counter is a blind sensor, not a loaded machine —
/// GPU-less and localized-Windows machines would otherwise manufacture
/// `gpu_busy` cards out of thin air).
pub fn others_ok(
    disk_queue: Option<f64>,
    cpu_total: Option<f64>,
    avail_mb: Option<f64>,
) -> bool {
    disk_queue.map(|q| q < 0.5).unwrap_or(true)
        && cpu_total.map(|c| c < 85.0).unwrap_or(true)
        && avail_mb.map(|a| a > 2048.0).unwrap_or(true)
}

/// ISO string ("2026-08-31T00:19:52.123Z", always 24 chars) -> epoch ms.
/// ONE copy: session, storage and diagnoser each carried this function
/// verbatim (even the comments referenced each other).
pub(crate) fn iso_ms(iso: &str) -> Option<i64> {
    let b = iso.as_bytes();
    if b.len() != 24 {
        return None;
    }
    let num = |r: std::ops::Range<usize>| -> Option<i64> {
        std::str::from_utf8(&b[r]).ok()?.parse().ok()
    };
    let (y, mo, d) = (num(0..4)?, num(5..7)?, num(8..10)?);
    let (h, mi, s) = (num(11..13)?, num(14..16)?, num(17..19)?);
    let ms = num(20..23)?;
    // days from civil (inverse of the algorithm in sampler)
    let (y, mo) = if mo <= 2 { (y - 1, mo + 12) } else { (y, mo) };
    let era = i64::div_euclid(y, 400);
    let yoe = y - era * 400;
    let doy = (153 * (mo - 3) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some(((days * 86_400) + h * 3600 + mi * 60 + s) * 1000 + ms)
}

// ---------------------------------------------------------------------------
// Diagnosis — the simplified, user-facing layer (translated from EngineEvents)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Diagnosis {
    /// Machine key, e.g. "disk_wait"
    pub key: String,
    pub title: String,
    /// Plain-language explanation
    pub simple: String,
    /// Technical cause (for the advanced tab / report)
    pub cause: String,
    /// Recommended fix
    pub fix: String,
    /// "high" | "medium" | "low"
    pub severity: String,
    pub at: String,
}

/// Overall traffic-light status for the session
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Overall {
    Ok,
    Watch,
    Lag,
}

// ---------------------------------------------------------------------------
// UI state — the ONLY thing the frontend consumes. Pushed via events.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UiState {
    pub v: u8,
    pub session: Option<String>,
    pub started_at: Option<String>,
    pub time: String,
    pub game_running: bool,
    /// Is the game window visible (not minimized)? None = not probed yet.
    #[serde(default)]
    pub game_visible: Option<bool>,
    pub overall: Overall,
    pub lag_count: u32,
    /// 0-100 bars for the main tab
    pub bars: Bars,
    /// sparkline history (last ~60 ticks)
    pub history: History,
    /// lag spike markers on the timeline, relative to session start
    pub spikes: Vec<SpikeMark>,
    /// elapsed session seconds
    pub elapsed_sec: u64,
    /// auto-stop limit in seconds, when set
    pub auto_stop_sec: Option<u64>,
    /// live event feed: latest first, capped
    pub feed: Vec<FeedEntry>,
    /// Up to 3 most important active diagnoses
    pub diagnoses: Vec<Diagnosis>,
    pub samples_count: u64,
    /// Emulator profile display name, when detected
    pub emulator: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Bars {
    pub cpu: Option<u8>,
    pub ram: Option<u8>,
    pub gpu: Option<u8>,
    pub disk: Option<u8>,
}

/// Rolling history for sparklines: newest last. 0-100 values.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct History {
    pub cpu: Vec<u8>,
    pub ram: Vec<u8>,
    pub gpu: Vec<u8>,
    pub disk: Vec<u8>,
}

/// A recent engine event translated for the live feed.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeedEntry {
    /// "start" | "end" | "instant"
    pub phase: String,
    /// machine event kind — the UI owns the translation (e.g. "disk_queue")
    pub kind: String,
    pub sev: String,
    /// clock time HH:MM:SS from the sample
    pub clock: String,
}

/// A lag spike marker on the session timeline, relative to session start (ms).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpikeMark {
    pub offset_ms: i64,
    /// machine key: "gpu_activity_cliff" | "spike" | ...
    pub kind: String,
}

/// Session lifecycle for the UI
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SessionStatus {
    Idle,
    Running,
    /// Stopping in progress (flushing files)
    Stopping,
    /// Finished, report ready
    Finished,
}

/// Why a session ended — the UI explains instead of staying silent.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum StopReason {
    /// the user pressed Stop
    Manual,
    /// the auto-stop timer expired
    AutoStop,
    /// GameLoop's process died mid-session — report saved, nothing to watch
    GameLoopClosed,
}

// ---------------------------------------------------------------------------
// Thresholds — computed per machine at session start. Nothing static touches
// different hardware the same way: RAM-bound limits scale with installed RAM,
// disk limits scale with physical disk count. Ratios stay ratios.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Thresholds {
    pub cpu_saturation_pct: f64,
    pub proc_perf_floor_pct: f64,
    pub proc_perf_load_gate: f64,
    pub avail_mem_floor_mb: f64,
    pub hard_faults_per_sec: f64,
    pub disk_queue_len: f64,
    pub disk_busy_pct: f64,
    pub gpu_clock_floor_pct: f64,
    pub gpu_temp_warn_c: f64,
    pub gpu_temp_crit_c: f64,
    pub spike_cpu_drop_pct: f64,
    pub spike_sustained_sec: u32,
}

impl Default for Thresholds {
    fn default() -> Self {
        // ratio-based limits only; the RAM/disk fields are placeholders that
        // `Thresholds::for_machine` overrides at session start.
        Self {
            cpu_saturation_pct: 85.0,
            proc_perf_floor_pct: 70.0,
            proc_perf_load_gate: 50.0,
            avail_mem_floor_mb: 2048.0,
            hard_faults_per_sec: 300.0,
            disk_queue_len: 2.0,
            disk_busy_pct: 90.0,
            gpu_clock_floor_pct: 60.0,
            gpu_temp_warn_c: 85.0,
            gpu_temp_crit_c: 92.0,
            spike_cpu_drop_pct: 15.0,
            spike_sustained_sec: 3,
        }
    }
}

/// Machine profile: what the dynamic thresholds need to know about this PC.
#[derive(Debug, Clone, Copy)]
pub struct MachineProfile {
    /// installed RAM in MB
    pub total_mem_mb: f64,
    /// number of physical disks (spindles/NVMe devices)
    pub disk_count: u32,
}

impl Thresholds {
    /// Dynamic tuning: same behavior on a 4GB office laptop and a 64GB tower.
    /// Ratio fields stay fixed (they're already relative); machine-bound
    /// fields are derived from the actual hardware.
    pub fn for_machine(p: MachineProfile) -> Self {
        // start from the static defaults, override only the machine-bound
        // fields (ratio fields are already relative)
        let base = Self::default();

        // RAM floor: 6% of installed RAM, clamped 1–4 GB.
        // 4GB machine → 1GB (half its RAM free is normal, not a crisis)
        // 32GB machine → ~2GB (matches the diagnosis that found the real bug)
        let avail_mem_floor_mb = (p.total_mem_mb * 0.06).clamp(1024.0, 4096.0);

        // Hard faults: paging storms scale inversely with RAM headroom —
        // smaller machines hit pressure sooner, so the bar sits lower.
        let hard_faults_per_sec = if p.total_mem_mb < 8192.0 {
            200.0
        } else if p.total_mem_mb > 32_768.0 {
            400.0
        } else {
            300.0
        };

        // Disk queue: each physical spindle can legitimately serve ~1 request;
        // the total-device counter can run that many in parallel.
        let disk_queue_len = (p.disk_count.max(1) as f64).clamp(1.0, 6.0);

        Self {
            avail_mem_floor_mb,
            hard_faults_per_sec,
            disk_queue_len,
            ..base
        }
    }
}
