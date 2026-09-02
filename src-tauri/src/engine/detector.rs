// detector.rs — fingerprint matching: raw samples → engine events
// Every "lag story" we diagnosed on real hardware lives here as a rule.

use std::collections::HashMap;

use super::types::{EngineEvent, Phase, Sample, Severity, Thresholds};

/// Stateful detector: feed samples, get events. Hysteresis per condition key.
pub struct Detector {
    th: Thresholds,
    gpu_max_gr: Option<f64>,
    gpu_max_mem: Option<f64>,
    /// active conditions: key -> (since_ms, severity)
    active: HashMap<String, (i64, Severity)>,
    /// last samples for spike logic
    prev_sm: Option<f64>,
    spike_acc: u32,
    /// rolling SM history for the activity gate (true rendering vs idle lobby)
    sm_hist: Vec<f64>,
}

/// The SM average (over ~60s) that separates "real rendering" from a static
/// screen (lobby, result screen). Below it, GPU rules stay silent — a lobby
/// is not a match, and desktop/browser activity is not the game.
const SM_ACTIVITY_FLOOR: f64 = 15.0;

impl Detector {
    pub fn new(th: Thresholds) -> Self {
        Self {
            th,
            gpu_max_gr: None,
            gpu_max_mem: None,
            active: HashMap::new(),
            prev_sm: None,
            spike_acc: 0,
            sm_hist: Vec::new(),
        }
    }

    pub fn set_gpu_max(&mut self, gr: f64, mem: f64) {
        self.gpu_max_gr = Some(gr);
        self.gpu_max_mem = Some(mem);
    }

    /// Feed one sample; returns events emitted by this tick.
    pub fn feed(&mut self, s: &Sample) -> Vec<EngineEvent> {
        let mut evs = Vec::new();
        // activity history: only counts while the window is visible — an
        // invisible window renders nothing meaningful
        if s.game_visible != Some(false) {
            if let Some(sm) = s.gpu.as_ref().and_then(|g| g.sm_pct) {
                self.sm_hist.push(sm);
                let overflow = self.sm_hist.len().saturating_sub(60);
                if overflow > 0 {
                    self.sm_hist.drain(0..overflow);
                }
            }
        }
        let playing = self.playing(s);
        self.check_cpu_saturation(s, &mut evs);
        self.check_throttle(s, &mut evs);
        self.check_memory(s, &mut evs);
        self.check_disk(s, &mut evs);
        self.check_gpu(s, &mut evs, playing);
        self.check_render_stall(s, &mut evs, playing);
        evs
    }

    /// Is the user actually PLAYING? Two gates, both required:
    /// 1. the game window is VISIBLE (None = not probed yet → conservative:
    ///    no GPU cards, because we cannot attribute desktop GPU activity)
    /// 2. sustained rendering activity — SM average over the last ~60 ticks
    ///    is at or above the floor. A lobby/result screen with the window
    ///    open is "alive process, no match".
    fn playing(&self, s: &Sample) -> bool {
        if s.game_visible != Some(true) {
            return false;
        }
        if self.sm_hist.len() < 10 {
            return false; // not enough evidence yet
        }
        let avg = self.sm_hist.iter().sum::<f64>() / self.sm_hist.len() as f64;
        avg >= SM_ACTIVITY_FLOOR
    }

    /// Close all open conditions (session end) and return their "end" events.
    pub fn finish(&mut self, now_iso: &str) -> Vec<EngineEvent> {
        let keys: Vec<String> = self.active.keys().cloned().collect();
        let mut evs = Vec::new();
        for k in keys {
            if let Some((since, _)) = self.active.remove(&k) {
                let dur = (now_ms() - since) as f64 / 1000.0;
                evs.push(EngineEvent {
                    kind: k.clone(),
                    phase: Phase::End,
                    severity: Severity::Ok,
                    t: now_iso.to_string(),
                    duration_sec: Some(dur.max(0.0)),
                    detail: format!("{} ended", k.replace('_', " ")),
                });
            }
        }
        evs
    }

    // ---- condition helpers: hysteresis via active map ----------------------

    fn condition(
        &mut self,
        key: &str,
        sev: Severity,
        active_now: bool,
        detail: String,
        t: &str,
        evs: &mut Vec<EngineEvent>,
    ) {
        let was = self.active.contains_key(key);
        match (active_now, was) {
            (true, false) => {
                self.active.insert(key.to_string(), (now_ms(), sev));
                evs.push(EngineEvent {
                    kind: key.to_string(),
                    phase: Phase::Start,
                    severity: sev,
                    t: t.to_string(),
                    duration_sec: None,
                    detail,
                });
            }
            (false, true) => {
                let (since, _) = self.active.remove(key).unwrap();
                let dur = (now_ms() - since) as f64 / 1000.0;
                evs.push(EngineEvent {
                    kind: key.to_string(),
                    phase: Phase::End,
                    severity: Severity::Ok,
                    t: t.to_string(),
                    duration_sec: Some(dur.max(0.0)),
                    detail,
                });
            }
            _ => {}
        }
    }

    fn check_cpu_saturation(&mut self, s: &Sample, evs: &mut Vec<EngineEvent>) {
        let Some(cpu) = s.cpu_total else { return };
        let active = cpu >= self.th.cpu_saturation_pct;
        let sev = if cpu >= 95.0 { Severity::Crit } else { Severity::Warn };
        let detail = if active { format!("CPU at {:.0}%", cpu) } else { String::new() };
        self.condition("cpu_saturation", sev, active, detail, &s.t, evs);
    }

    fn check_throttle(&mut self, s: &Sample, evs: &mut Vec<EngineEvent>) {
        let (Some(perf), Some(cpu)) = (s.proc_perf, s.cpu_total) else { return };
        let active = perf < self.th.proc_perf_floor_pct && cpu >= self.th.proc_perf_load_gate;
        let detail = if active {
            format!("CPU frequency at {:.0}% of nominal under {:.0}% load", perf, cpu)
        } else {
            String::new()
        };
        self.condition("cpu_throttle", Severity::Crit, active, detail, &s.t, evs);
    }

    fn check_memory(&mut self, s: &Sample, evs: &mut Vec<EngineEvent>) {
        let Some(avail) = s.avail_mb else { return };
        let active = avail < self.th.avail_mem_floor_mb;
        let sev = if avail < self.th.avail_mem_floor_mb / 2.0 {
            Severity::Crit
        } else {
            Severity::Warn
        };
        let detail = if active { format!("Only {:.0} MB RAM available", avail) } else { String::new() };
        self.condition("mem_pressure", sev, active, detail, &s.t, evs);

        // Hard faults: instant events when spiking
        if let Some(pi) = s.pages_in {
            if pi > self.th.hard_faults_per_sec {
                evs.push(EngineEvent {
                    kind: "hard_faults".into(),
                    phase: Phase::Instant,
                    severity: Severity::Warn,
                    t: s.t.clone(),
                    duration_sec: None,
                    detail: format!("Active pagefile reads: {:.0}/s", pi),
                });
            }
        }
    }

    fn check_disk(&mut self, s: &Sample, evs: &mut Vec<EngineEvent>) {
        let Some(q) = s.disk_queue else { return };
        let active = q >= self.th.disk_queue_len;
        let sev = if q >= self.th.disk_queue_len * 2.0 { Severity::Crit } else { Severity::Warn };
        let detail = if active { format!("Disk queue length {:.1}", q) } else { String::new() };
        self.condition("disk_queue", sev, active, detail, &s.t, evs);

        if let Some(busy) = s.disk_busy_pct {
            if busy >= self.th.disk_busy_pct {
                evs.push(EngineEvent {
                    kind: "disk_busy".into(),
                    phase: Phase::Instant,
                    severity: Severity::Warn,
                    t: s.t.clone(),
                    duration_sec: None,
                    detail: format!("Disk {busy:.0}% busy"),
                });
            }
        }
    }

    fn check_gpu(&mut self, s: &Sample, evs: &mut Vec<EngineEvent>, playing: bool) {
        let Some(g) = s.gpu.as_ref() else { return };

        // GPU rules are only meaningful in real play. Minimized window or a
        // static screen (lobby) → the dGPU's clock drops are driver behavior,
        // not the user's problem — silence instead of phantom cards.
        if !playing {
            return;
        }

        // GPU temp
        if let Some(temp) = g.temp {
            let active = temp >= self.th.gpu_temp_warn_c;
            let sev = if temp >= self.th.gpu_temp_crit_c { Severity::Crit } else { Severity::Warn };
            let detail = if active { format!("GPU temperature {:.0}C", temp) } else { String::new() };
            self.condition("gpu_temp", sev, active, detail, &s.t, evs);
        }

        // GPU core clock ratio to max (chronic low clock while gaming)
        if let (Some(pclk), Some(max)) = (g.pclk, self.gpu_max_gr) {
            if max > 0.0 {
                let ratio = pclk / max * 100.0;
                let active = ratio < self.th.gpu_clock_floor_pct;
                let sev = if ratio < self.th.gpu_clock_floor_pct / 2.0 { Severity::Crit } else { Severity::Warn };
                let detail = if active {
                    format!("GPU core at {:.0} MHz ({:.0}% of max)", pclk, ratio)
                } else {
                    String::new()
                };
                self.condition("gpu_clock_low", sev, active, detail, &s.t, evs);
            }
        }

        // GPU memory wake: low mclk while ACTUALLY RENDERING → hitch on
        // transition. sm > 25% (not 5%): menus and desktop compositing sit
        // under 25% and used to fire this rule endlessly.
        if let (Some(mclk), Some(max)) = (g.mclk, self.gpu_max_mem) {
            if max > 0.0 {
                let active = mclk < max * 0.5
                    && g.sm_pct.map(|sm| sm > 25.0).unwrap_or(false);
                let detail = if active {
                    format!("GPU memory clock idle at {:.0} MHz while rendering", mclk)
                } else {
                    String::new()
                };
                self.condition("gpu_mem_idle", Severity::Warn, active, detail, &s.t, evs);
            }
        }
    }

    /// The killer fingerprint: SM drops hard while everything else is fine → hitch.
    fn check_render_stall(&mut self, s: &Sample, evs: &mut Vec<EngineEvent>, playing: bool) {
        let Some(g) = s.gpu.as_ref() else { return };
        // not in real play: reset the baseline so the return to the game
        // never reads as one giant stall (idle SM -> live SM comparison)
        if !playing {
            self.prev_sm = None;
            return;
        }
        let Some(sm) = g.sm_pct else {
            self.prev_sm = None;
            return;
        };
        let prev = self.prev_sm.replace(sm);

        if let (Some(prev), true) = (prev, sm < 15.0) {
            if prev > 40.0 {
                let others_ok = s.disk_queue.map(|q| q < 0.5).unwrap_or(true)
                    && s.cpu_total.map(|c| c < 85.0).unwrap_or(true)
                    && s.avail_mb.map(|a| a > 2048.0).unwrap_or(true);
                let (kind, detail) = if others_ok {
                    (
                        "render_stall",
                        format!("Render stalled: SM {:.0}% -> {:.0}% with healthy CPU/disk/RAM", prev, sm),
                    )
                } else {
                    (
                        "render_stall_loaded",
                        format!("Render stalled under load: SM {:.0}% -> {:.0}%", prev, sm),
                    )
                };
                evs.push(EngineEvent {
                    kind: kind.into(),
                    phase: Phase::Instant,
                    severity: Severity::Crit,
                    t: s.t.clone(),
                    duration_sec: None,
                    detail,
                });
            }
        }

        // sustained proc-perf drop accumulator (CPU perf cliff)
        if let (Some(perf), Some(cpu)) = (s.proc_perf, s.cpu_total) {
            if cpu >= self.th.proc_perf_load_gate && perf < (100.0 - self.th.spike_cpu_drop_pct) {
                self.spike_acc += 1;
                if self.spike_acc == self.th.spike_sustained_sec {
                    evs.push(EngineEvent {
                        kind: "spike".into(),
                        phase: Phase::Instant,
                        severity: Severity::Crit,
                        t: s.t.clone(),
                        duration_sec: None,
                        detail: format!("Sustained perf cliff: {:.0}% for {}s", perf, self.spike_acc),
                    });
                }
            } else {
                self.spike_acc = 0;
            }
        }
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(cpu: f64, perf: f64, avail: f64, q: f64, sm: Option<f64>) -> Sample {
        Sample {
            t: "2026-08-31T00:00:00.000Z".into(),
            cpu_total: Some(cpu),
            proc_perf: Some(perf),
            avail_mb: Some(avail),
            pages_in: None,
            disk_queue: Some(q),
            disk_busy_pct: Some(5.0),
            gpu: sm.map(|v| super::super::types::GpuSample {
                sm_pct: Some(v),
                ..Default::default()
            }),
            emu: vec![],
            game_visible: None,
        }
    }

    /// A sample from a VISIBLE window (the only state where GPU rules run).
    fn live_sample(sm: f64) -> Sample {
        let mut s = sample(50.0, 119.0, 20000.0, 0.0, Some(sm));
        s.game_visible = Some(true);
        s
    }

    /// Warm the activity gate: 12 visible samples at the given SM level.
    fn warm_playing(d: &mut Detector, sm: f64) {
        for _ in 0..12 {
            d.feed(&live_sample(sm));
        }
    }

    #[test]
    fn saturation_and_recovery() {
        let mut d = Detector::new(Thresholds::default());
        let e1 = d.feed(&sample(90.0, 120.0, 20000.0, 0.1, None));
        assert!(e1.iter().any(|e| e.kind == "cpu_saturation" && e.phase == Phase::Start));
        let e2 = d.feed(&sample(40.0, 120.0, 20000.0, 0.1, None));
        assert!(e2.iter().any(|e| e.kind == "cpu_saturation" && e.phase == Phase::End));
    }

    #[test]
    fn throttle_detect() {
        let mut d = Detector::new(Thresholds::default());
        let e = d.feed(&sample(80.0, 60.0, 20000.0, 0.1, None));
        assert!(e.iter().any(|e| e.kind == "cpu_throttle" && e.severity == Severity::Crit));
    }

    #[test]
    fn disk_storm() {
        let mut d = Detector::new(Thresholds::default());
        let mut s = sample(60.0, 119.0, 20000.0, 5.0, None);
        s.pages_in = Some(800.0);
        let e = d.feed(&s);
        assert!(e.iter().any(|e| e.kind == "disk_queue" && e.phase == Phase::Start));
        assert!(e.iter().any(|e| e.kind == "hard_faults"));
    }

    #[test]
    fn render_stall_hitch() {
        let mut d = Detector::new(Thresholds::default());
        warm_playing(&mut d, 52.0);
        let e = d.feed(&live_sample(2.0));
        assert!(e.iter().any(|e| e.kind == "render_stall" && e.severity == Severity::Crit));
    }

    #[test]
    fn gpu_mem_idle() {
        let mut d = Detector::new(Thresholds::default());
        d.set_gpu_max(1137.0, 2505.0);
        warm_playing(&mut d, 35.0);
        let mut s = live_sample(30.0);
        s.gpu.as_mut().unwrap().mclk = Some(800.0);
        let e = d.feed(&s);
        assert!(e.iter().any(|e| e.kind == "gpu_mem_idle"));
    }

    #[test]
    fn finish_closes_open_conditions() {
        let mut d = Detector::new(Thresholds::default());
        d.feed(&sample(90.0, 120.0, 20000.0, 0.1, None));
        let e = d.finish("2026-08-31T00:01:00.000Z");
        assert!(e.iter().any(|e| e.kind == "cpu_saturation" && e.phase == Phase::End));
    }

    // ---- visibility + activity gates (the desktop/lobby phantom fix) ----

    #[test]
    fn minimized_window_mutes_gpu_rules() {
        let mut d = Detector::new(Thresholds::default());
        d.set_gpu_max(1137.0, 2505.0);
        // fully warmed-up playing state, then the window gets minimized
        warm_playing(&mut d, 50.0);
        let mut bg = live_sample(50.0);
        bg.game_visible = Some(false); // minimized → desktop activity
        bg.gpu.as_mut().unwrap().mclk = Some(300.0); // deep idle → wake pattern
        let e = d.feed(&bg);
        assert!(
            !e.iter().any(|e| e.kind == "gpu_mem_idle"),
            "a minimized window must never produce GPU-wake cards"
        );
    }

    #[test]
    fn unprobed_visibility_mutes_gpu_rules() {
        let mut d = Detector::new(Thresholds::default());
        d.set_gpu_max(1137.0, 2505.0);
        // game_visible = None (probe not back yet) → conservative silence
        let mut s = sample(40.0, 119.0, 20000.0, 0.0, Some(30.0));
        s.game_visible = None;
        s.gpu.as_mut().unwrap().mclk = Some(300.0);
        let e = d.feed(&s);
        assert!(!e.iter().any(|e| e.kind == "gpu_mem_idle"));
    }

    #[test]
    fn static_screen_mutes_gpu_rules() {
        let mut d = Detector::new(Thresholds::default());
        d.set_gpu_max(1137.0, 2505.0);
        // window visible but SM average below the floor → lobby/result screen
        warm_playing(&mut d, 3.0);
        let mut s = live_sample(3.0);
        s.gpu.as_mut().unwrap().mclk = Some(300.0);
        let e = d.feed(&s);
        assert!(
            !e.iter().any(|e| e.kind == "gpu_mem_idle"),
            "a lobby (open window, no rendering) is not a match"
        );
    }

    #[test]
    fn returning_from_minimized_does_not_fire_render_stall() {
        let mut d = Detector::new(Thresholds::default());
        // warm up playing, minimize for a while (SM drops to idle), come back
        warm_playing(&mut d, 50.0);
        let mut bg = live_sample(1.0);
        bg.game_visible = Some(false);
        d.feed(&bg);
        d.feed(&bg);
        // back in the game: SM returns — must NOT read as a "stall recovery"
        let e = d.feed(&live_sample(50.0));
        assert!(
            !e.iter().any(|e| e.kind.starts_with("render_stall")),
            "baseline resets on pause — the return is not a stall"
        );
    }

    #[test]
    fn light_scene_below_25pct_sm_does_not_fire_mem_idle() {
        let mut d = Detector::new(Thresholds::default());
        d.set_gpu_max(1137.0, 2505.0);
        // genuinely playing (SM avg high), but one light scene tick with
        // idle clocks and SM 10% — menus/desktop compositing territory
        warm_playing(&mut d, 50.0);
        let mut s = live_sample(10.0);
        s.gpu.as_mut().unwrap().mclk = Some(300.0);
        let e = d.feed(&s);
        assert!(
            !e.iter().any(|e| e.kind == "gpu_mem_idle"),
            "SM under 25% with idle clocks is light-scene driver behavior, not a wake hitch"
        );
    }
}
