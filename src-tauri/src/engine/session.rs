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
    EngineEvent, GpuSample, Sample, SessionStatus, StopReason, Thresholds, UiState, iso_ms,
};

/// Shared session state owned by the engine, locked by commands.
pub struct Engine {
    state: Mutex<SessionInner>,
    /// the CURRENT session's running flag. Readers spawned by start() hold
    /// their OWN Arc — this slot only tells stop() WHICH flag to flip (the
    /// current session's), never mutated in place (a `&self` method can't),
    /// replaced via the write lock at each start.
    running_flag: std::sync::RwLock<Arc<AtomicBool>>,
    total_mem_mb: std::sync::RwLock<f64>,
    /// Serializes session-directory creation (start) with bulk deletion:
    /// deletion snapshots the live id BEFORE its background task runs, so
    /// a session starting in that window could otherwise land inside the
    /// deletion walk. Both sides take this guard around the
    /// create-or-delete critical section — in the same order (fs guard,
    /// then state) so the two can never deadlock against each other.
    fs_guard: std::sync::Mutex<()>,
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
            running_flag: std::sync::RwLock::new(Arc::new(AtomicBool::new(false))),
            total_mem_mb: std::sync::RwLock::new(8_192.0), // refreshed at session start
            fs_guard: std::sync::Mutex::new(()),
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

    /// The live session's id, straight from the engine (not the UI): bulk
    /// delete excludes it so a compromised/buggy frontend can never delete
    /// the session currently being written, even if it passes the wrong
    /// exclude id (or none at all).
    pub fn live_session_id(&self) -> Option<String> {
        let st = self.state.lock().unwrap_or_else(|p| p.into_inner());
        match st.status {
            SessionStatus::Running | SessionStatus::Stopping => st.session_id.clone(),
            _ => None,
        }
    }

    /// Bulk-delete every saved session except the live writer's directory.
    /// Runs under the fs guard so a session starting concurrently can
    /// neither slip into the deletion walk unexcluded nor reuse an id the
    /// walk already snapshotted: start() takes the same guard before it
    /// creates its directory. The UI's exclude_id is honored as an EXTRA,
    /// but the running session can never be deleted even if the frontend
    /// passes nothing or the wrong id.
    pub fn delete_all_sessions_guarded(
        &self,
        exclude_id: Option<&str>,
    ) -> Result<Vec<String>, String> {
        let _fs = self.fs_guard.lock().unwrap_or_else(|p| p.into_inner());
        let live = self.live_session_id();
        let mut excluded = live;
        if excluded.is_none() {
            excluded = exclude_id
                .filter(|id| !id.is_empty())
                .map(str::to_string);
        }
        super::storage::delete_all_sessions(
            &super::storage::sessions_root(),
            excluded.as_deref(),
        )
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

        // RE-CHECK under the SECOND lock: the first check ran before the slow
        // gates above (emulator probe, PowerShell queries), unlocked the whole
        // time — a second start() that slipped through both gates would
        // double-spawn sources and orphan a writer (double-click race).
        //
        // The fs guard is taken BEFORE the state lock (same order as the
        // bulk-delete path): the session directory is born inside this
        // critical section, so no bulk delete can enumerate it mid-birth.
        let _fs_guard = self.fs_guard.lock().unwrap_or_else(|p| p.into_inner());
        let mut st = self.state.lock().unwrap_or_else(|p| p.into_inner());
        if st.status == SessionStatus::Running {
            return Err("SESSION_ALREADY_RUNNING".into());
        }
        if st.status == SessionStatus::Stopping {
            return Err("SESSION_STOPPING".into());
        }
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

        // ---- spawn streaming sources ----
        // Routes thread callbacks to the global engine instance (set in lib.rs).
        // Drop every cross-session snapshot FIRST: a previous session's
        // evidence must never feed this one. The order matters — the probes
        // below run AFTER the wipe so their fresh results survive (the old
        // order stored the visibility probe and then wiped it in the same
        // critical section, discarding the probe's work every time).
        reset_snapshots();
        // the emulator is known-live (the gate above confirmed it) — seed
        // the snapshot so tick zero already knows what it is measuring
        if let Ok(procs) = sampler::query_emulator_procs() {
            if !procs.is_empty() {
                *LATEST_EMU.lock().unwrap_or_else(|p| p.into_inner()) =
                    Some(Timestamped::fresh(procs, SNAPSHOT_TTLS.emu));
            }
        }
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
        // FRESH flag per session (not the shared one): the old stop→start
        // race leaked readers — stop() flips the flag false and sleeps 600ms,
        // but a start() in that window flips the SAME flag back to true
        // before the old 1Hz reader ever observes false, so the old
        // typeperf/dmon pair feeds the new session forever. Per-session
        // flags close that hole: the stopped session's readers hold THEIR
        // Arc, it stays false forever, and the new session's readers get a
        // brand-new one.
        let running = Arc::new(AtomicBool::new(true));
        if let Ok(mut slot) = self.running_flag.write() {
            *slot = Arc::clone(&running);
        }
        {
            let mut slot = FIRST_SAMPLE_AT.lock().unwrap_or_else(|p| p.into_inner());
            *slot = Some(Instant::now());
        }

        match sampler::spawn_typeperf(1, Arc::clone(&running), |s| {
            route_on_sample(s);
        }) {
            Ok(()) => super::logging::info("typeperf sampler: spawned"),
            Err(e) => super::logging::error(&format!("typeperf sampler: SPAWN FAILED: {e}")),
        }

        match sampler::spawn_dmon(1, Arc::clone(&running), |g| {
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

        // flip the CURRENT session's flag (read under the lock — never the
        // same Arc an old session's readers hold)
        if let Ok(current) = self.running_flag.read() {
            current.store(false, Ordering::SeqCst);
        }
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
                let start = iso_ms(s)?;
                let now = iso_ms(&super::sampler::iso_now())?;
                Some((now.saturating_sub(start) / 1000).max(0) as u64)
            })
            .unwrap_or(0);
        let auto_stop_sec: Option<u64> = st
            .auto_stop_at
            .and_then(|at| at.checked_duration_since(Instant::now()))
            .map(|rem| elapsed_sec + rem.as_secs());
        // DIAGNOSIS VIEW WINDOW: the diagnoser only reads the live (5 min)
        // and correlation (15 min) windows — but it used to walk the FULL
        // event history to build its indexes, every tick, under this lock.
        // A sustained paging storm (one instant per second, hours long)
        // grew the per-tick walk without bound. The view below trims to
        // what the windows can still see + one window of slack, WITHOUT
        // touching st.events itself: the full history stays the source of
        // truth for autosave, finalize, and the saved report.
        let view_events = diagnosis_window(&st.events);
        let ui = build_ui_state(super::diagnoser::UiStateInput {
            session: st.session_id.as_deref(),
            started_at: st.started_at.as_deref(),
            samples: &st.samples,
            samples_total: st.samples_total,
            events: &view_events,
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

    /// Called by the probe loop: if GameLoop died mid-session, the scan has
    /// nothing left to measure — stop it cleanly and mark the reason.
    pub fn check_gameloop_alive(&self) -> bool {
        let st = self.state.lock().unwrap_or_else(|p| p.into_inner());
        if st.status != SessionStatus::Running {
            return true; // nothing to guard
        }
        // freshness matters: a stale "alive" snapshot would keep the session
        // running on ghost evidence after the probe thread itself died —
        // the same TTL gate on_sample applies. A snapshot past its TTL
        // reads as a miss, never as alive.
        let alive = LATEST_EMU
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .as_ref()
            .and_then(|t| t.get())
            .is_some_and(|emu| !emu.is_empty());
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
    // diagnoser gates behind correlation evidence (gpu_mem_idle needs a
    // cliff inside its window, paging_churn the same). Counting them made
    // a sustained open wake show a red "Lag" banner with ZERO cards (the
    // correlation gate suppressed the card, the counter still fired) —
    // the exact "red with nothing explaining why" shape the still-open
    // rescue was written to kill. The kinds the correlator can still
    // upgrade to a card pass through: their Start alone is honest signal.
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
    const CORRELATION_GATED: [&str; 2] = ["gpu_mem_idle", "paging_churn"];
    open.values()
        .filter(|v| **v)
        .count()
        - open
            .iter()
            .filter(|(k, v)| **v && CORRELATION_GATED.contains(k))
            .count()
}

/// The diagnoser's view of the event history: everything from the oldest
/// window it can still read backward. The live window is 5 min and the
/// correlation window 15 min (diagnoser.rs owns both), so events older
/// than the correlation window + slack are invisible to every rule — the
/// walk starts after them. STILL-OPEN kinds are exempt: a condition open
/// for 20 minutes has a Start older than any window, but the still-open
/// rescue must keep reading it (the vanishing-card bug the rescue was
/// written for). Their whole history rides along; a storm-open kind is
/// also generating fresh events anyway, so the exemption stays cheap.
fn diagnosis_window(events: &[EngineEvent]) -> Vec<EngineEvent> {
    /// mirrors diagnoser::CORRELATION_WINDOW_MS (the widest lookback) + a
    /// safety slack for a missed tick or a slow clock read
    const VIEW_MS: i64 = 15 * 60 * 1000 + 30 * 1000;
    let now_ms = iso_ms(&super::sampler::iso_now()).unwrap_or(0);
    if now_ms <= VIEW_MS {
        return events.to_vec();
    }
    let cutoff = now_ms - VIEW_MS;
    // kinds whose latest Start has no End after it (still open) — their
    // whole history rides along however old
    let mut open_kinds: std::collections::HashSet<&str> = std::collections::HashSet::new();
    for e in events {
        match e.phase {
            super::types::Phase::Start => {
                open_kinds.insert(e.kind.as_str());
            }
            super::types::Phase::End => {
                open_kinds.remove(e.kind.as_str());
            }
            super::types::Phase::Instant => {}
        }
    }
    events
        .iter()
        .filter(|e| {
            iso_ms(&e.t).unwrap_or(0) >= cutoff || open_kinds.contains(e.kind.as_str())
        })
        .cloned()
        .collect()
}

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

    /// The red-banner-with-zero-cards bug: a correlation-gated condition
    /// (gpu_mem_idle open for minutes) must NOT drive Overall::Lag on its
    /// own — the diagnoser suppresses its card until a cliff confirms it,
    /// so counting it left a red banner with nothing explaining why. The
    /// ungated disk_queue Start below still counts on its own.
    #[test]
    fn correlation_gated_opens_do_not_drive_lag_alone() {
        use super::super::types::{Phase, Severity};
        let gated_only = vec![EngineEvent {
            kind: "gpu_mem_idle".into(),
            phase: Phase::Start,
            severity: Severity::Warn,
            t: "t".into(),
            duration_sec: None,
            detail: String::new(),
        }];
        assert_eq!(active_conditions(&gated_only), 0);
        let with_disk = vec![
            EngineEvent {
                kind: "gpu_mem_idle".into(),
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
        ];
        assert_eq!(active_conditions(&with_disk), 1);
    }

    /// The diagnosis view window: old QUIET-CLOSED history drops out, but
    /// a still-open condition's events ride along however old — the
    /// vanishing-card bug the still-open rescue exists for. (A kind with a
    /// RECENT event keeps everything too: recent = inside the window, and
    /// the kind being open at that point means its older pairs are
    /// pairing-relevant. The exemption is per-KIND, deliberately coarse.)
    #[test]
    fn diagnosis_window_keeps_open_kinds_and_drops_quiet_history() {
        use super::super::types::{Phase, Severity};
        let mk = |kind: &str, phase: Phase, t: &str| EngineEvent {
            kind: kind.into(),
            phase,
            severity: Severity::Warn,
            t: t.into(),
            duration_sec: None,
            detail: String::new(),
        };
        // an old CLOSED storm (04:00-04:01, quiet ever since), a
        // mem_pressure open since 04:50 (still open), now = 05:21 (the
        // view cutoff ≈ 05:05.5). The closed storm's kind has no open
        // condition and no recent event → dropped whole. The open
        // condition's Start (older than every window) must survive.
        let events = vec![
            mk("disk_queue", Phase::Start, "2026-08-31T04:00:00.000Z"),
            mk("disk_queue", Phase::End, "2026-08-31T04:01:00.000Z"),
            mk("mem_pressure", Phase::Start, "2026-08-31T04:50:00.000Z"),
            mk("gpu_mem_idle", Phase::Start, "2026-08-31T05:20:00.000Z"),
        ];
        let view = diagnosis_window(&events);
        assert!(
            view.iter().any(|e| e.kind == "mem_pressure"),
            "the still-open kind's events must ride along however old"
        );
        assert!(
            view.iter().any(|e| e.kind == "gpu_mem_idle"),
            "the fresh event stays"
        );
        // the CLOSED, QUIET, out-of-window disk_queue pair is dropped
        assert!(
            !view.iter().any(|e| e.kind == "disk_queue"),
            "quiet, closed, out-of-window history is dropped"
        );
    }

    /// The double-start race (H2): a first start() must serialize against a
    /// second one that arrives while the first is between the slow gates and
    /// the second lock. We can't run real sessions in tests (they spawn
    /// typeperf), but we can prove the LOCKED re-check itself: set the state
    /// to Running directly and confirm start() refuses at the second gate.
    #[test]
    fn start_refuses_when_running_at_second_gate() {
        let eng = Engine::new();
        {
            let mut st = eng.state.lock().unwrap_or_else(|p| p.into_inner());
            st.status = SessionStatus::Running;
        }
        // start() with the game gate unreachable: detect_emulator() returns
        // None on a machine without GameLoop, so the first gate should
        // already refuse — but if it somehow passed (game running on the
        // CI box), the second-gate re-check must still refuse
        let res = eng.start(Some(60));
        assert!(res.is_err());
        // status must still be Running — nothing was reset
        let st = eng.state.lock().unwrap_or_else(|p| p.into_inner());
        assert!(st.status == SessionStatus::Running);
    }

    /// The reader-leak fix (per-session running flags): a stopped session's
    /// flag can never be resurrected by a new session's start.
    #[test]
    fn per_session_running_flag_not_shared() {
        let eng = Engine::new();
        // simulate session 1: start() installs a fresh flag (true) — the
        // session's readers capture THEIR OWN Arc to it
        let first = Arc::new(AtomicBool::new(true));
        if let Ok(mut slot) = eng.running_flag.write() {
            *slot = Arc::clone(&first);
        }
        // session 1 stops: stop() flips the CURRENT flag (session 1's) false
        if let Ok(current) = eng.running_flag.read() {
            current.store(false, Ordering::SeqCst);
        }
        // a fast restart: start() installs a NEW flag for session 2 — the
        // engine's slot now points at a different Arc
        let second = Arc::new(AtomicBool::new(true));
        if let Ok(mut slot) = eng.running_flag.write() {
            *slot = Arc::clone(&second);
        }
        // THE RACE BEING FIXED: the old (session-1) reader may not have
        // observed the stop yet; with the shared-flag design, session 2's
        // start resurrected it to true and the old reader ran forever. With
        // per-session flags, the old flag STAYS false:
        assert!(!first.load(Ordering::SeqCst), "old session's flag must stay false");
        assert!(second.load(Ordering::SeqCst), "new session's flag is true");
    }
}
