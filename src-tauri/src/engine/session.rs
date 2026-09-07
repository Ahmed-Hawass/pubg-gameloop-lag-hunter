// session.rs — the session orchestrator: owns samplers, detector, storage, and pushes UI state.
// The single source of truth. The UI only sends commands: start/stop; everything else is pushed.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use super::detector::Detector;
use super::diagnoser::build_ui_state;
use super::sampler;
use super::storage::SessionWriter;
use super::types::{
    EngineEvent, GpuSample, Sample, SessionStatus, StopReason, Thresholds, UiState,
};

/// Shared session state owned by the engine, locked by commands.
pub struct Engine {
    state: Mutex<SessionInner>,
    running_flag: Arc<AtomicBool>,
    total_mem_mb: std::sync::RwLock<f64>,
    /// consecutive GameLoop probe misses (auto-stop after ~15s of silence)
    gameloop_misses: AtomicU32,
    /// bumped on every start(): guard/timer threads capture it and die as
    /// soon as it's no longer current — no duplicate guards can ever run.
    generation: AtomicU32,
}

struct SessionInner {
    status: SessionStatus,
    /// why the last session ended (cleared on the next start)
    stop_reason: Option<StopReason>,
    writer: Option<SessionWriter>,
    /// rolling window: last ~300 ticks for detector + UI (RAM-bounded)
    samples: Vec<Sample>,
    /// total samples written this session (never reset by the window)
    samples_total: u64,
    events: Vec<EngineEvent>,
    detector: Detector,
    started_at: Option<String>,
    session_id: Option<String>,
    game_running: bool,
    emulator: Option<String>,
    last_ui: Option<UiState>,
    auto_stop_at: Option<Instant>,
    thresholds: Thresholds,
}

impl Default for Engine {
    /// Same as `Engine::new` — thresholds come from the settings store.
    fn default() -> Self {
        Self::new()
    }
}

impl Engine {
    pub fn new() -> Self {
        // SINGLE reader: thresholds come from the unified settings store only.
        // (The old dual-reader layout caused the engine to forget the user's
        // sensitivity after every restart.)
        let settings = super::settings::load();
        Self {
            state: Mutex::new(SessionInner {
                status: SessionStatus::Idle,
                stop_reason: None,
                writer: None,
                samples: Vec::new(),
                samples_total: 0,
                events: Vec::new(),
                detector: Detector::new(settings.thresholds.clone()),
                started_at: None,
                session_id: None,
                game_running: false,
                emulator: None,
                last_ui: None,
                auto_stop_at: None,
                thresholds: settings.thresholds,
            }),
            running_flag: Arc::new(AtomicBool::new(false)),
            total_mem_mb: std::sync::RwLock::new(8_192.0), // refreshed at session start
            gameloop_misses: AtomicU32::new(0),
            generation: AtomicU32::new(0),
        }
    }

    pub fn status(&self) -> SessionStatus {
        self.state.lock().unwrap_or_else(|p| p.into_inner()).status
    }

    /// Why the last session ended (survives until the next start).
    pub fn stop_reason(&self) -> Option<StopReason> {
        self.state
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .stop_reason
    }

    pub fn last_ui(&self) -> Option<UiState> {
        self.state
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .last_ui
            .clone()
    }

    /// Start a monitoring session. `auto_stop_secs`: None = manual stop only
    /// (used by the headless `engine_probe` binary; the Tauri command always
    /// sends a bounded value — see MAX_SESSION_SECS in lib.rs).
    /// Returns the session generation (guards/timers use it to self-retire).
    /// Requires GameLoop to be running — the tool measures the game, not the desktop.
    pub fn start(&self, auto_stop_secs: Option<u64>) -> Result<u32, String> {
        let _t = super::logging::timed("session start");
        {
            let st = self.state.lock().unwrap_or_else(|p| p.into_inner());
            if st.status == SessionStatus::Running {
                return Err("SESSION_ALREADY_RUNNING".into());
            }
            // finalize is still flushing files — a start here would race it
            // for the same writer and corrupt the session being written
            if st.status == SessionStatus::Stopping {
                return Err("SESSION_STOPPING".into());
            }
        }

        // GATE: no GameLoop, no scan. The numbers only mean something in-game.
        if sampler::detect_emulator().is_none() {
            super::logging::info("start blocked: game not running in GameLoop");
            return Err("GAMELOOP_NOT_RUNNING".into());
        }

        // machine profile per session → dynamic thresholds. RAM + disk count
        // ride the rig profile's disk cache (instant after first machine run)
        // instead of their own PowerShell round-trips; a missing cache falls
        // back to the documented defaults — the scan never waits on hardware.
        let ps_ok = super::system::powershell_available();
        let (total_mem, disk_count) = match super::system::cached_machine_profile() {
            Some((mem, disks)) => (mem, disks),
            None => {
                if ps_ok {
                    (total_ram_mb(), physical_disk_count())
                } else {
                    (8_192.0, 1)
                }
            }
        };
        super::logging::info(&format!(
            "session starting: ram={total_mem:.0}MB disks={disk_count} powershell={ps_ok}"
        ));
        let profile = super::types::MachineProfile {
            total_mem_mb: total_mem,
            disk_count,
        };
        let thresholds = Thresholds::for_machine(profile);
        if let Ok(mut t) = self.total_mem_mb.write() {
            *t = total_mem;
        }

        let mut st = self.state.lock().unwrap_or_else(|p| p.into_inner());
        // reset per-session state
        st.samples.clear();
        st.samples_total = 0;
        st.events.clear();
        st.stop_reason = None;
        st.thresholds = thresholds.clone();
        st.detector = Detector::new(thresholds);
        st.game_running = true; // gate confirmed it
        st.last_ui = None;
        self.gameloop_misses.store(0, Ordering::SeqCst);
        // invalidate any guard/timer threads from previous sessions
        let gen = self.generation.fetch_add(1, Ordering::SeqCst) + 1;

        let writer = SessionWriter::create()?;
        st.session_id = writer
            .dir()
            .file_name()
            .and_then(|s| s.to_str())
            .map(String::from);
        st.started_at = Some(sampler::iso_now());
        st.writer = Some(writer);
        st.status = SessionStatus::Running;
        st.auto_stop_at = auto_stop_secs.map(|s| Instant::now() + Duration::from_secs(s));

        // GPU max clocks (best effort — logged: a silent miss here is why a
        // gpu_clock_low rule could fire with bogus ratios)
        match sampler::query_gpu_max_clocks() {
            Some((gr, mem)) => {
                super::logging::info(&format!("gpu max clocks: gr={gr}MHz mem={mem}MHz"));
                st.detector.set_gpu_max(gr, mem);
            }
            None => super::logging::info("gpu max clocks unavailable (non-NVIDIA or nvidia-smi missing)"),
        }

        st.emulator = sampler::detect_emulator();

        // first visibility probe BEFORE the first sample lands, so the very
        // first ticks already know whether the window is up (minimized users
        // opening the tool get correct muting from tick zero)
        match sampler::query_game_visible() {
            Some(vis) => {
                super::logging::info(&format!("game window visible at start: {vis}"));
                *LATEST_VISIBLE.lock().unwrap_or_else(|p| p.into_inner()) =
                    Some(Timestamped::fresh(vis, SNAPSHOT_TTLS.visible));
            }
            None => super::logging::info("game window visibility unknown at start (probe returned None)"),
        }

        // ---- spawn streaming sources ----
        // Routes thread callbacks to the global engine instance (set in lib.rs).
        reset_snapshots(); // no evidence survives from a previous session
        let running = Arc::clone(&self.running_flag);
        running.store(true, Ordering::SeqCst);
        {
            let mut slot = FIRST_SAMPLE_AT.lock().unwrap_or_else(|p| p.into_inner());
            *slot = Some(Instant::now());
        }

        match sampler::spawn_typeperf(1, Arc::clone(&self.running_flag), |s| {
            route_on_sample(s);
        }) {
            Ok(()) => super::logging::info("typeperf sampler: spawned"),
            Err(e) => super::logging::error(&format!("typeperf sampler: SPAWN FAILED: {e}")),
        }

        match sampler::spawn_dmon(1, Arc::clone(&self.running_flag), |g| {
            route_on_gpu(g);
        }) {
            Ok(true) => super::logging::info("nvidia-smi dmon sampler: spawned"),
            Ok(false) => super::logging::info("nvidia-smi dmon sampler: unavailable (non-NVIDIA machine)"),
            Err(e) => super::logging::error(&format!("nvidia-smi dmon sampler: SPAWN FAILED: {e}")),
        }

        Ok(gen)
    }

    /// The generation this session runs under (matches Engine::generation
    /// while the session it started is still the current one).
    pub fn current_generation(&self) -> u32 {
        self.generation.load(Ordering::SeqCst)
    }

    /// True while `gen` is still the latest start() — guards let old
    /// sessions' threads detect they've been superseded.
    pub fn generation_is_current(&self, gen: u32) -> bool {
        self.generation.load(Ordering::SeqCst) == gen
    }

    /// Stop the session; finalize files and return the report path.
    pub fn stop(&self) -> Result<Option<String>, String> {
        self.stop_with_reason(StopReason::Manual)
    }

    /// Stop with the reason the session ended — the UI explains it instead
    /// of staying silent when GameLoop dies mid-session.
    pub fn stop_with_reason(&self, reason: StopReason) -> Result<Option<String>, String> {
        let _t = super::logging::timed_with("session stop", 3_000);
        super::logging::info(&format!("session stop: reason={reason:?}"));
        {
            let mut st = self.state.lock().unwrap_or_else(|p| p.into_inner());
            if st.status != SessionStatus::Running {
                return Ok(None);
            }
            st.status = SessionStatus::Stopping;
            st.stop_reason = Some(reason);
        }

        self.running_flag.store(false, Ordering::SeqCst);
        std::thread::sleep(Duration::from_millis(600)); // let sources die

        let mut st = self.state.lock().unwrap_or_else(|p| p.into_inner());
        // the 600ms window is uninsured: if a start() slipped in while we slept
        // (status flipped back to Running), our writer is NOT theirs — bail out
        // without touching anything rather than corrupt the new session.
        if st.status != SessionStatus::Stopping {
            return Ok(None);
        }
        // close open conditions
        let now = sampler::iso_now();
        let close_evs = st.detector.finish(&now);
        st.events.extend(close_evs);

        let report = match st.writer.take() {
            Some(mut w) => {
                let events = std::mem::take(&mut st.events);
                let started = st.started_at.clone().unwrap_or_default();
                let th = st.thresholds.clone();
                let total = st.samples_total;
                super::logging::info(&format!(
                    "session stopping: {total} samples, {} events",
                    events.len()
                ));
                let path = w.finalize_from_disk(&events, &started, &th, total);
                match &path {
                    Ok(p) => super::logging::info(&format!("report written: {}", p.display())),
                    Err(e) => super::logging::error(&format!("finalize failed: {e}")),
                }
                st.events = events;
                path.ok().map(|p| p.to_string_lossy().to_string())
            }
            None => None,
        };
        st.status = SessionStatus::Finished;
        Ok(report)
    }

    /// Called by the typeperf thread for each CPU/RAM/disk tick.
    fn on_sample(&self, raw: Sample) {
        let mut st = self.state.lock().unwrap_or_else(|p| p.into_inner());
        if st.status != SessionStatus::Running {
            return;
        }

        // attach the freshest GPU + emulator + window-visibility snapshot —
        // freshness-gated: a snapshot older than SNAPSHOT_TTL is dropped to
        // None instead of being worn as fresh evidence (stale attribution)
        let mut s = raw;
        if let Some(g) = LATEST_GPU
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .as_ref()
            .and_then(|t| t.get())
            .cloned()
        {
            s.gpu = Some(g);
        }
        if let Some(emu) = LATEST_EMU
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .as_ref()
            .and_then(|t| t.get())
            .cloned()
        {
            s.emu = emu;
        }
        if let Some(vis) = LATEST_VISIBLE
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .as_ref()
            .and_then(|t| t.get())
            .copied()
        {
            s.game_visible = Some(vis);
        }

        st.game_running = !s.emu.is_empty();

        // every sample hits disk immediately — the file is the source of truth
        if let Some(w) = st.writer.as_mut() {
            w.append_sample(&s);
        }
        st.samples_total += 1;

        // rolling RAM window: detector needs ~30 recent ticks, UI needs 60 — keep 300 max
        st.samples.push(s.clone());
        let overflow = st.samples.len().saturating_sub(300);
        if overflow > 0 {
            st.samples.drain(0..overflow);
        }

        // first sample arriving is the health signal of the whole pipeline
        if st.samples_total == 1 {
            let slot = FIRST_SAMPLE_AT.lock().unwrap_or_else(|p| p.into_inner());
            if let Some(at) = slot.as_ref() {
                super::logging::perf("pipeline: first sample", at.elapsed().as_millis());
            }
        }

        let evs = st.detector.feed(&s);
        st.events.extend(evs);

        // autosave every ~50 ticks (crash safety for the events file)
        if st.samples_total % 50 == 0 {
            if let Some(w) = st.writer.as_ref() {
                w.autosave(
                    &st.events,
                    &st.thresholds,
                    st.started_at.as_deref().unwrap_or(""),
                );
            }
        }

        self.build_and_cache_ui(&mut st, s);
    }

    fn build_and_cache_ui(&self, st: &mut SessionInner, _latest: Sample) {
        let elapsed_sec: u64 = st
            .started_at
            .as_deref()
            .and_then(|s| {
                let start = iso_ms_pub(s)?;
                let now = iso_ms_pub(&super::sampler::iso_now())?;
                Some((now.saturating_sub(start) / 1000).max(0) as u64)
            })
            .unwrap_or(0);
        let auto_stop_sec: Option<u64> = st
            .auto_stop_at
            .and_then(|at| at.checked_duration_since(Instant::now()))
            .map(|rem| elapsed_sec + rem.as_secs());
        let ui = build_ui_state(super::diagnoser::UiStateInput {
            session: st.session_id.as_deref(),
            started_at: st.started_at.as_deref(),
            samples: &st.samples,
            samples_total: st.samples_total,
            events: &st.events,
            active_count: active_conditions(&st.events),
            game_running: st.game_running,
            emulator: st.emulator.as_deref(),
            total_mem_mb: self.total_mem_mb.read().map(|v| *v).unwrap_or(8_192.0),
            session_secs: elapsed_sec,
            auto_stop_sec,
        });
        st.last_ui = Some(ui);
    }

    /// Called by the dmon thread for each GPU tick.
    fn on_gpu(&self, g: super::types::GpuSample) {
        *LATEST_GPU.lock().unwrap_or_else(|p| p.into_inner()) =
            Some(Timestamped::fresh(g, SNAPSHOT_TTLS.gpu));
    }

    /// Emulator watcher thread body (called every ~5s while running).
    pub fn probe_emulator(&self) {
        if let Ok(procs) = sampler::query_emulator_procs() {
            *LATEST_EMU.lock().unwrap_or_else(|p| p.into_inner()) =
                Some(Timestamped::fresh(procs, SNAPSHOT_TTLS.emu));
        }
    }

    /// Window-visibility probe (called every ~10s from the guard thread).
    pub fn probe_visibility(&self) {
        if let Some(vis) = sampler::query_game_visible() {
            *LATEST_VISIBLE.lock().unwrap_or_else(|p| p.into_inner()) =
                Some(Timestamped::fresh(vis, SNAPSHOT_TTLS.visible));
        }
    }

    /// Auto-stop check, invoked by a low-frequency timer from the Tauri side.
    pub fn tick_auto_stop(&self) -> bool {
        let st = self.state.lock().unwrap_or_else(|p| p.into_inner());
        if st.status == SessionStatus::Running {
            if let Some(at) = st.auto_stop_at {
                if Instant::now() >= at {
                    drop(st);
                    let _ = self.stop_with_reason(StopReason::AutoStop);
                    return true;
                }
            }
        }
        false
    }

    pub fn thresholds(&self) -> Thresholds {
        self.state
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .thresholds
            .clone()
    }

    /// Called by the probe loop: if GameLoop died mid-session, the scan has
    /// nothing left to measure — stop it cleanly and mark the reason.
    pub fn check_gameloop_alive(&self) -> bool {
        let st = self.state.lock().unwrap_or_else(|p| p.into_inner());
        if st.status != SessionStatus::Running {
            return true; // nothing to guard
        }
        // freshness matters: a stale "alive" snapshot would keep the session
        // running on ghost evidence after the probe thread itself died
        let alive = LATEST_EMU
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .as_ref()
            .map(|t| !t.value.is_empty())
            .unwrap_or(false);
        if !alive {
            // first miss → arm the counter; 3 consecutive misses (~15s) → stop
            self.gameloop_misses.fetch_add(1, Ordering::SeqCst)
        } else {
            self.gameloop_misses.store(0, Ordering::SeqCst);
            0
        };
        let misses = self.gameloop_misses.load(Ordering::SeqCst);
        drop(st);
        if misses >= 3 {
            super::logging::error("GameLoop closed mid-session — auto-stopping");
            let _ = self.stop_with_reason(StopReason::GameLoopClosed);
            return false;
        }
        true
    }
}

fn active_conditions(events: &[EngineEvent]) -> usize {
    // count conditions with a Start but no End yet
    use std::collections::HashMap;
    let mut open: HashMap<&str, bool> = HashMap::new();
    for e in events {
        match e.phase {
            super::types::Phase::Start => {
                open.insert(e.kind.as_str(), true);
            }
            super::types::Phase::End => {
                open.insert(e.kind.as_str(), false);
            }
            super::types::Phase::Instant => {}
        }
    }
    open.values().filter(|v| **v).count()
}

/// ISO string -> epoch ms (shared with diagnoser logic)
fn iso_ms_pub(iso: &str) -> Option<i64> {
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
    let (y, mo) = if mo <= 2 { (y - 1, mo + 12) } else { (y, mo) };
    let era = i64::div_euclid(y, 400);
    let yoe = y - era * 400;
    let doy = (153 * (mo - 3) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some(((days * 86_400) + h * 3600 + mi * 60 + s) * 1000 + ms)
}

// lock_ok: kept for future Mutex<T> acquisitions on named fields — the
// pattern used throughout this file is inline unwrap_or_else (same behavior).

/// When the CURRENT session's samplers were spawned — the first-sample log
/// measures pipeline latency from here (spawn → first tick). Reset at every
/// start(): the old OnceLock version was set once per process, so session #2
/// in the same run logged absurd latencies ("first sample: 860383ms").
static FIRST_SAMPLE_AT: Mutex<Option<std::time::Instant>> = Mutex::new(None);

fn total_ram_mb() -> f64 {
    use std::os::windows::process::CommandExt;
    let out = std::process::Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "[math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory/1MB,0)",
        ])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .creation_flags(0x0800_0000)
        .output();
    match out {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout)
            .trim()
            .parse()
            .unwrap_or(8_192.0),
        _ => 8_192.0,
    }
}

/// Physical disk count (spindles/NVMe devices) — feeds the dynamic disk-queue
/// threshold: each device can legitimately serve ~1 parallel request.
fn physical_disk_count() -> u32 {
    use std::os::windows::process::CommandExt;
    let out = std::process::Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "@(Get-PhysicalDisk).Count",
        ])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .creation_flags(0x0800_0000)
        .output();
    match out {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout)
            .trim()
            .parse()
            .unwrap_or(1),
        _ => 1,
    }
}

// ---- process-wide singletons ------------------------------------------------
// LATEST_GPU / LATEST_EMU / LATEST_VISIBLE: freshest snapshots shared between
// sampler threads — each stamped with the moment it was captured, so samples
// never attach evidence older than its source's TTL. LATEST_VISIBLE: None =
// not probed yet (conservative mute). All three are cleared at every start():
// a snapshot from a previous session is not evidence in this one.

/// Per-source freshness windows, matched to how often each source SPEAKS:
/// a TTL must cover the source's native interval plus slack for one missed
/// cycle — anything tighter starves evidence (a flat 2s TTL against a 10s
/// probe cadence left 85% of ticks visibility-blind in session #2/#3).
///
/// - gpu: dmon emits at 1 Hz; 2s = the reading plus one missed cycle. GPU
///   data is a MEASUREMENT — a stalled dmon means stale numbers, drop them.
/// - emu: the emulator probe runs every ~5s (guard thread cycle); 12s = two
///   full misses tolerated before "game alive" evidence lapses.
/// - visible: the visibility probe runs every ~10s; 30s = generous slack
///   because window state is a rarely-changing FACT, not a 1 Hz measurement
///   — a 10s-old "visible" is still true unless the user just minimized.
const SNAPSHOT_TTLS: SnapshotTtls = SnapshotTtls {
    gpu: Duration::from_secs(2),
    emu: Duration::from_secs(12),
    visible: Duration::from_secs(30),
};

struct SnapshotTtls {
    gpu: Duration,
    emu: Duration,
    visible: Duration,
}

/// A sampler snapshot plus its capture time — freshness is part of the data.
struct Timestamped<T> {
    value: T,
    at: Instant,
    ttl: Duration,
}

impl<T> Timestamped<T> {
    fn fresh(value: T, ttl: Duration) -> Self {
        Self {
            value,
            at: Instant::now(),
            ttl,
        }
    }
    /// Some(value) when inside its TTL, None when stale.
    fn get(&self) -> Option<&T> {
        if self.at.elapsed() <= self.ttl {
            Some(&self.value)
        } else {
            None
        }
    }
}

static LATEST_GPU: Mutex<Option<Timestamped<GpuSample>>> = Mutex::new(None);
static LATEST_EMU: Mutex<Option<Timestamped<Vec<super::types::ProcInfo>>>> = Mutex::new(None);
static LATEST_VISIBLE: Mutex<Option<Timestamped<bool>>> = Mutex::new(None);

/// Drop every cross-session snapshot so a new session starts from zero
/// evidence. Called at every start(): the old bug — session #2 silently
/// inherited session #1's GPU/visibility snapshots (fresh-looking but old).
pub fn reset_snapshots() {
    *LATEST_GPU.lock().unwrap_or_else(|p| p.into_inner()) = None;
    *LATEST_EMU.lock().unwrap_or_else(|p| p.into_inner()) = None;
    *LATEST_VISIBLE.lock().unwrap_or_else(|p| p.into_inner()) = None;
}

/// The global engine instance (created once in lib.rs, leaked).
static GLOBAL_ENGINE: std::sync::OnceLock<&'static Engine> = std::sync::OnceLock::new();

pub fn init_global() -> &'static Engine {
    GLOBAL_ENGINE.get_or_init(|| Box::leak(Box::new(Engine::new())))
}

pub fn global() -> Option<&'static Engine> {
    GLOBAL_ENGINE.get().copied()
}

/// Wire the sampler-thread closure to the global engine.
pub fn route_on_sample(s: Sample) {
    if let Some(e) = global() {
        e.on_sample_via_global(s);
    }
}

pub fn route_on_gpu(g: GpuSample) {
    if let Some(e) = global() {
        e.on_gpu(g);
    }
}

impl Engine {
    fn on_sample_via_global(&self, s: Sample) {
        self.on_sample(s);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn active_conditions_counted() {
        use super::super::types::{Phase, Severity};
        let evs = vec![
            EngineEvent {
                kind: "cpu_saturation".into(),
                phase: Phase::Start,
                severity: Severity::Warn,
                t: "t".into(),
                duration_sec: None,
                detail: String::new(),
            },
            EngineEvent {
                kind: "disk_queue".into(),
                phase: Phase::Start,
                severity: Severity::Warn,
                t: "t".into(),
                duration_sec: None,
                detail: String::new(),
            },
            EngineEvent {
                kind: "cpu_saturation".into(),
                phase: Phase::End,
                severity: Severity::Ok,
                t: "t".into(),
                duration_sec: Some(2.0),
                detail: String::new(),
            },
        ];
        assert_eq!(active_conditions(&evs), 1);
    }
}
