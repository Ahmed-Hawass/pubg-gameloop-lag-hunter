// detector.rs — fingerprint matching: raw samples → engine events
// Every "lag story" we diagnosed on real hardware lives here as a rule.

use std::collections::HashMap;

use super::types::{EngineEvent, Phase, Sample, Severity, Thresholds};

/// Stateful detector: feed samples, get events. Hysteresis per condition key.
pub struct Detector {
    th: Thresholds,
    gpu_max_gr: Option<f64>,
    gpu_max_mem: Option<f64>,
    /// highest mclk actually observed this session — gpu_mem_idle compares
    /// against THIS, not the theoretical max (which some drivers never reach;
    /// comparing against it fired 12 phantom cards per session on a Quadro)
    gpu_observed_max_mclk: Option<f64>,
    /// active conditions: key -> (since_ms, severity)
    active: HashMap<String, (i64, Severity)>,
    /// last samples for spike logic
    prev_sm: Option<f64>,
    spike_acc: u32,
    /// consecutive ticks below the cliff floor (sustained-collapse evidence)
    cliff_acc: u32,
    /// true after this collapse emitted its (single) event — one per cliff
    cliff_fired: bool,
    /// rolling SM history for the activity gate (true rendering vs idle lobby)
    sm_hist: Vec<f64>,
}

/// The SM average (over ~60s) that separates "real rendering" from a static
/// screen (lobby, result screen). Below it, GPU rules stay silent — a lobby
/// is not a match, and desktop/browser activity is not the game.
/// This is the FLOOR for the learned baseline: a game whose rendering sits
/// above it learns its own activity level (e.g. 15-20% on an emulator GPU),
/// so gates don't flicker when a machine's normal sits exactly at a static
/// threshold. Session #1 data: 640/746 ticks in the 14-17% band.
const SM_ACTIVITY_FLOOR: f64 = 15.0;
/// Learned per session once enough visible SM evidence exists: the typical
/// rendering level while playing. Gates compare against max(learned, floor).
const SM_BASELINE_WARMUP_TICKS: usize = 20;
/// The playing gate accepts a healthy SHARE of the learned baseline — during
/// a real stutter the rolling average sags, and a strict-equality gate would
/// silence the engine exactly when it must listen. 60% = clearly active.
const ACTIVITY_GATE_RATIO: f64 = 0.60;
/// A cliff is a RELATIVE collapse: SM under 35% of the learned baseline
/// (hysteresis on the ratio, not absolute numbers tied to one GPU).
const CLIFF_BASELINE_RATIO: f64 = 0.35;
/// How deep a SINGLE low tick must be to count as a cliff by itself.
/// Session #2 ground truth: 8 of the 9 real stutters lasted exactly one
/// 1 Hz tick (SM 15-16 -> 3-5) and a flat 2-tick rule missed them all.
/// BOTH conditions must hold for a lone tick to fire:
/// - relative: under 40% of the learned baseline (real craters landed at
///   20-33%; light-scene dips on high-baseline GPUs hover above it), AND
/// - absolute: under 10% SM (an emulator-GPU "collapse" from 16 to 13 is a
///   light scene, not a crater — no absolute guard and the relative check
///   alone would misfire on machines whose baseline sags naturally).
///
/// The burst-ending pattern (14 of a 16 baseline) fails both checks.
const CLIFF_DEEP_RATIO: f64 = 0.40;
const CLIFF_DEEP_ABS: f64 = 10.0;

impl Detector {
    pub fn new(th: Thresholds) -> Self {
        Self {
            th,
            gpu_max_gr: None,
            gpu_max_mem: None,
            gpu_observed_max_mclk: None,
            active: HashMap::new(),
            prev_sm: None,
            spike_acc: 0,
            cliff_acc: 0,
            cliff_fired: false,
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
        // the playing gate is decided FIRST, on the PAST history — before
        // this tick's activity enters it. A collapsing tick must not mute
        // the very rule that measures the collapse (feedback loop).
        let playing = self.playing(s);
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
        // track the highest memory clock actually seen while visible — the
        // gpu_mem_idle rule compares against THIS (theoretical maxima are
        // driver fiction on some cards and produced endless phantom cards)
        if s.game_visible != Some(false) {
            if let Some(mclk) = s.gpu.as_ref().and_then(|g| g.mclk) {
                let slot = self.gpu_observed_max_mclk.get_or_insert(0.0);
                if mclk > *slot {
                    *slot = mclk;
                }
            }
        }
        self.check_cpu_saturation(s, &mut evs);
        self.check_throttle(s, &mut evs);
        self.check_memory(s, &mut evs);
        self.check_disk(s, &mut evs);
        self.check_gpu(s, &mut evs, playing);
        self.check_gpu_activity_cliff(s, &mut evs, playing);
        evs
    }

    /// Is the user actually PLAYING? Two gates, both required:
    /// 1. the game window is VISIBLE (None = not probed yet → conservative:
    ///    no GPU cards, because we cannot attribute desktop GPU activity)
    /// 2. sustained rendering activity — recent SM average at a healthy
    ///    share of the learned baseline. A lobby/result screen with the
    ///    window open is "alive process, no match".
    ///
    /// The share (not equality) matters: mid-cliff the average sags while
    /// the learned median holds — a strict avg>=baseline gate would mute
    /// cliff detection halfway through the very stutter we exist to catch.
    fn playing(&self, s: &Sample) -> bool {
        if s.game_visible != Some(true) {
            return false;
        }
        if self.sm_hist.len() < 10 {
            return false; // not enough evidence yet
        }
        let baseline = self.learned_baseline();
        let avg = self.sm_hist.iter().sum::<f64>() / self.sm_hist.len() as f64;
        avg >= baseline * ACTIVITY_GATE_RATIO
    }

    /// The machine's own rendering level: median of visible SM history once
    /// warm (robust to bursts), clamped from below by the static floor.
    fn learned_baseline(&self) -> f64 {
        if self.sm_hist.len() < SM_BASELINE_WARMUP_TICKS {
            return SM_ACTIVITY_FLOOR;
        }
        let mut sorted = self.sm_hist.clone();
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let mid = sorted.len() / 2;
        let median = sorted[mid];
        median.max(SM_ACTIVITY_FLOOR)
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
        let sev = if cpu >= 95.0 {
            Severity::Crit
        } else {
            Severity::Warn
        };
        let detail = if active {
            format!("CPU at {:.0}%", cpu)
        } else {
            String::new()
        };
        self.condition("cpu_saturation", sev, active, detail, &s.t, evs);
    }

    fn check_throttle(&mut self, s: &Sample, evs: &mut Vec<EngineEvent>) {
        let (Some(perf), Some(cpu)) = (s.proc_perf, s.cpu_total) else {
            return;
        };
        let active = perf < self.th.proc_perf_floor_pct && cpu >= self.th.proc_perf_load_gate;
        let detail = if active {
            format!(
                "CPU frequency at {:.0}% of nominal under {:.0}% load",
                perf, cpu
            )
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
        let detail = if active {
            format!("Only {:.0} MB RAM available", avail)
        } else {
            String::new()
        };
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
        let sev = if q >= self.th.disk_queue_len * 2.0 {
            Severity::Crit
        } else {
            Severity::Warn
        };
        let detail = if active {
            format!("Disk queue length {:.1}", q)
        } else {
            String::new()
        };
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
            let sev = if temp >= self.th.gpu_temp_crit_c {
                Severity::Crit
            } else {
                Severity::Warn
            };
            let detail = if active {
                format!("GPU temperature {:.0}C", temp)
            } else {
                String::new()
            };
            self.condition("gpu_temp", sev, active, detail, &s.t, evs);
        }

        // GPU core clock ratio to max (chronic low clock while gaming)
        if let (Some(pclk), Some(max)) = (g.pclk, self.gpu_max_gr) {
            if max > 0.0 {
                let ratio = pclk / max * 100.0;
                let active = ratio < self.th.gpu_clock_floor_pct;
                let sev = if ratio < self.th.gpu_clock_floor_pct / 2.0 {
                    Severity::Crit
                } else {
                    Severity::Warn
                };
                let detail = if active {
                    format!("GPU core at {:.0} MHz ({:.0}% of max)", pclk, ratio)
                } else {
                    String::new()
                };
                self.condition("gpu_clock_low", sev, active, detail, &s.t, evs);
            }
        }

        // GPU memory wake: low mclk while ACTUALLY RENDERING → hitch on
        // transition. The reference clock is the highest mclk OBSERVED this
        // session (fed in feed()), not the theoretical max — drivers on some
        // cards never come near the queried max, and comparing against it
        // produced endless phantom "wake" cards (12 per session on a Quadro
        // M2000M whose mclk sits at ~849 of a nominal 2505).
        // "Actually rendering" = the playing gate (learned baseline) AND a
        // tick at a healthy share of that baseline — a static sm>25 floor
        // would blind the rule on emulator GPUs whose normal is ~16%, while
        // an absolute-free check would let light scenes (menus, 10% of a 50%
        // baseline) masquerade as rendering.
        // Before any mclk was observed (warmup) the rule stays silent — an
        // event with zero reference would be fabricated evidence.
        if let (Some(mclk), Some(max)) = (g.mclk, self.gpu_observed_max_mclk) {
            if max > 0.0 {
                let rendering_now = playing
                    && g
                        .sm_pct
                        .map(|sm| sm >= self.learned_baseline() * ACTIVITY_GATE_RATIO)
                        .unwrap_or(false);
                let active = rendering_now && mclk < max * 0.5;
                let detail = if active {
                    format!("GPU memory clock idle at {:.0} MHz while rendering", mclk)
                } else {
                    String::new()
                };
                self.condition("gpu_mem_idle", Severity::Warn, active, detail, &s.t, evs);
            }
        }
    }

    /// The killer fingerprint — now honest about what it measures: a sharp
    /// drop in GPU activity relative to the machine's own learned baseline.
    /// We do not measure frame time; the event is named for the measurement
    /// (an activity cliff), not for a claim (a "render stall").
    /// Fires when EITHER:
    /// - a lone tick craters under CLIFF_DEEP_RATIO of baseline (session #2:
    ///   8 of 9 real stutters were exactly one 1 Hz tick deep), or
    /// - 2+ consecutive ticks sit under CLIFF_BASELINE_RATIO (shallower but
    ///   sustained — a longer stutter).
    ///
    /// Bursts returning to baseline are NOT cliffs (session #1 false pattern:
    /// 47% burst → 14% baseline — 87% of baseline, nowhere near a cliff).
    fn check_gpu_activity_cliff(&mut self, s: &Sample, evs: &mut Vec<EngineEvent>, playing: bool) {
        let Some(g) = s.gpu.as_ref() else { return };
        // not in real play: reset the running comparison so the return to
        // the game never reads as one giant cliff (idle SM -> live SM)
        if !playing {
            self.prev_sm = None;
            self.cliff_acc = 0;
            self.cliff_fired = false;
            return;
        }
        let Some(sm) = g.sm_pct else {
            self.prev_sm = None;
            self.cliff_acc = 0;
            self.cliff_fired = false;
            return;
        };
        let baseline = self.learned_baseline();
        let cliff_floor = baseline * CLIFF_BASELINE_RATIO;
        let deep_floor = baseline * CLIFF_DEEP_RATIO;
        let prev = self.prev_sm.replace(sm);

        let below_floor = sm < cliff_floor;
        // a lone tick must CRATER (relative AND absolute) to fire alone;
        // a shallower dip needs a second tick to confirm — depth and
        // duration stand in for each other at 1 Hz resolution
        let deep = sm < deep_floor && sm < CLIFF_DEEP_ABS;
        if below_floor {
            let first_or_second = self.cliff_acc < 2;
            let fires_now = deep || self.cliff_acc + 1 >= 2;
            self.cliff_acc += 1;
            // ONE event per cliff: the first qualifying tick emits, later
            // ticks of the same collapse are continuation, not new events
            if first_or_second && fires_now && !self.cliff_fired {
                let others_ok = s.disk_queue.map(|q| q < 0.5).unwrap_or(true)
                    && s.cpu_total.map(|c| c < 85.0).unwrap_or(true)
                    && s.avail_mb.map(|a| a > 2048.0).unwrap_or(true);
                let (kind, detail) = if others_ok {
                    (
                        "gpu_activity_cliff",
                        format!(
                            "GPU activity collapsed: {:.0}% -> {:.0}% (baseline {:.0}%) with healthy CPU/disk/RAM",
                            prev.unwrap_or(baseline), sm, baseline
                        ),
                    )
                } else {
                    (
                        "gpu_activity_cliff_loaded",
                        format!(
                            "GPU activity collapsed under load: {:.0}% -> {:.0}% (baseline {:.0}%)",
                            prev.unwrap_or(baseline), sm, baseline
                        ),
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
                self.cliff_fired = true;
            }
        } else {
            self.cliff_acc = 0;
            self.cliff_fired = false;
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
                        detail: format!(
                            "Sustained perf cliff: {:.0}% for {}s",
                            perf, self.spike_acc
                        ),
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

    /// A visible sample that also carries an mclk (mem-idle warmup).
    fn live_sample_mclk(sm: f64, mclk: f64) -> Sample {
        let mut s = live_sample(sm);
        s.gpu.as_mut().unwrap().mclk = Some(mclk);
        s
    }

    /// Warm the activity gate: 12 visible samples at the given SM level.
    fn warm_playing(d: &mut Detector, sm: f64) {
        for _ in 0..12 {
            d.feed(&live_sample(sm));
        }
    }

    /// Full warmup: enough ticks for the learned baseline (median) to engage.
    fn warm_baseline(d: &mut Detector, sm: f64) {
        for _ in 0..SM_BASELINE_WARMUP_TICKS {
            d.feed(&live_sample(sm));
        }
    }

    #[test]
    fn saturation_and_recovery() {
        let mut d = Detector::new(Thresholds::default());
        let e1 = d.feed(&sample(90.0, 120.0, 20000.0, 0.1, None));
        assert!(e1
            .iter()
            .any(|e| e.kind == "cpu_saturation" && e.phase == Phase::Start));
        let e2 = d.feed(&sample(40.0, 120.0, 20000.0, 0.1, None));
        assert!(e2
            .iter()
            .any(|e| e.kind == "cpu_saturation" && e.phase == Phase::End));
    }

    #[test]
    fn throttle_detect() {
        let mut d = Detector::new(Thresholds::default());
        let e = d.feed(&sample(80.0, 60.0, 20000.0, 0.1, None));
        assert!(e
            .iter()
            .any(|e| e.kind == "cpu_throttle" && e.severity == Severity::Crit));
    }

    #[test]
    fn disk_storm() {
        let mut d = Detector::new(Thresholds::default());
        let mut s = sample(60.0, 119.0, 20000.0, 5.0, None);
        s.pages_in = Some(800.0);
        let e = d.feed(&s);
        assert!(e
            .iter()
            .any(|e| e.kind == "disk_queue" && e.phase == Phase::Start));
        assert!(e.iter().any(|e| e.kind == "hard_faults"));
    }

    // ---- gpu_activity_cliff: relative, honest, session-2-tuned ----------------

    #[test]
    fn cliff_fires_on_sustained_collapse_below_learned_baseline() {
        // session #1's MISSED stutter: baseline 15% (real emulator level),
        // SM collapses to 4-5% for 4-5 seconds. Old rule required prev>40
        // and missed it entirely; the learned-baseline rule must catch it.
        let mut d = Detector::new(Thresholds::default());
        warm_baseline(&mut d, 15.0); // learn: this machine renders at ~15%
        d.cliff_acc = 0;
        d.feed(&live_sample(15.0));
        let e1 = d.feed(&live_sample(5.0)); // deep tick 1 (25-33% of baseline)
        assert!(e1
            .iter()
            .any(|e| e.kind == "gpu_activity_cliff" && e.severity == Severity::Crit));
        let e2 = d.feed(&live_sample(4.0)); // tick 2 — no duplicate event
        assert_eq!(
            e2.iter().filter(|e| e.kind.starts_with("gpu_activity_cliff")).count(),
            0,
            "one cliff = one event, not one per tick"
        );
    }

    #[test]
    fn lone_deep_tick_fires_cliff() {
        // session #2 ground truth: 8 of 9 real stutters lasted exactly ONE
        // 1 Hz tick (SM 15-16 -> 3-5). A single deep crater IS the stutter.
        let mut d = Detector::new(Thresholds::default());
        warm_baseline(&mut d, 16.0);
        d.cliff_acc = 0;
        d.feed(&live_sample(16.0));
        let e = d.feed(&live_sample(4.0)); // 25% of baseline → deep
        assert!(e
            .iter()
            .any(|e| e.kind == "gpu_activity_cliff" && e.severity == Severity::Crit));
    }

    #[test]
    fn shallow_single_tick_waits_for_confirmation() {
        // a dip to 30% of baseline (below floor, NOT deep): one tick alone
        // is not enough — it must confirm with a second tick or recover
        let mut d = Detector::new(Thresholds::default());
        warm_baseline(&mut d, 40.0); // floor = 14, deep = 10
        d.cliff_acc = 0;
        d.feed(&live_sample(40.0));
        let e1 = d.feed(&live_sample(13.0)); // below floor but not deep
        assert!(!e1.iter().any(|e| e.kind.starts_with("gpu_activity_cliff")));
        let e2 = d.feed(&live_sample(13.0)); // second tick → confirmed
        assert!(e2.iter().any(|e| e.kind.starts_with("gpu_activity_cliff")));
    }

    #[test]
    fn burst_then_baseline_is_not_a_cliff() {
        // session #1's FALSE pattern: a 47% burst ends, SM returns to the
        // 14% baseline. The return is NOT a collapse — no cliff may fire.
        let mut d = Detector::new(Thresholds::default());
        warm_baseline(&mut d, 14.0); // the machine's normal
        d.feed(&live_sample(47.0)); // burst (e.g. plane drop)
        let e = d.feed(&live_sample(14.0)); // back to baseline
        assert!(
            !e.iter().any(|e| e.kind.starts_with("gpu_activity_cliff")),
            "a burst ending is the baseline resuming, not a cliff"
        );
    }

    #[test]
    fn shallow_noise_dip_near_floor_is_not_a_cliff() {
        // a dip hovering just under the cliff floor that recovers: sampling
        // noise at 1 Hz — neither deep enough alone nor sustained
        let mut d = Detector::new(Thresholds::default());
        warm_baseline(&mut d, 40.0); // floor = 14, deep = 10
        d.cliff_acc = 0;
        d.feed(&live_sample(40.0));
        let e1 = d.feed(&live_sample(13.5)); // just under floor
        assert!(!e1.iter().any(|e| e.kind.starts_with("gpu_activity_cliff")));
        let e2 = d.feed(&live_sample(40.0)); // recovered immediately
        assert!(!e2.iter().any(|e| e.kind.starts_with("gpu_activity_cliff")));
    }

    #[test]
    fn cliff_under_load_reports_loaded_variant() {
        let mut d = Detector::new(Thresholds::default());
        warm_baseline(&mut d, 40.0);
        d.cliff_acc = 0;
        d.feed(&live_sample(40.0));
        let mut low1 = live_sample(5.0);
        low1.cpu_total = Some(95.0); // CPU saturated → loaded variant
        let e = d.feed(&low1);
        assert!(e
            .iter()
            .any(|e| e.kind == "gpu_activity_cliff_loaded" && e.severity == Severity::Crit));
    }

    // ---- gpu_mem_idle: observed-max reference + warmup ------------------------

    #[test]
    fn gpu_mem_idle_uses_observed_max_not_theoretical() {
        // the Quadro case: theoretical mem max 2505 MHz, but the card's
        // real in-game mclk is ~849-1110. mclk 800 must NOT be "idle" —
        // it's within normal for this card (old rule: 12 phantom cards).
        let mut d = Detector::new(Thresholds::default());
        d.set_gpu_max(1137.0, 2505.0); // theoretical — must be ignored now
        warm_baseline(&mut d, 40.0);
        // observed max becomes 1110 (fed via live samples)
        for _ in 0..3 {
            d.feed(&live_sample_mclk(40.0, 1110.0));
        }
        let e = d.feed(&live_sample_mclk(40.0, 849.0)); // normal in-game clock
        assert!(
            !e.iter().any(|e| e.kind == "gpu_mem_idle"),
            "849 of an observed 1110 is normal, not a wake event"
        );
    }

    #[test]
    fn gpu_mem_idle_fires_on_true_idle_after_warmup() {
        // the REAL wake pattern: card ran at 1110, then dropped to 405
        // (desktop idle level) while rendering — a genuine power-state event
        let mut d = Detector::new(Thresholds::default());
        warm_baseline(&mut d, 40.0);
        for _ in 0..3 {
            d.feed(&live_sample_mclk(40.0, 1110.0));
        }
        let e = d.feed(&live_sample_mclk(40.0, 405.0));
        assert!(e.iter().any(|e| e.kind == "gpu_mem_idle"));
    }

    #[test]
    fn gpu_mem_idle_silent_before_mclk_observed() {
        // warmup: no mclk seen yet → no reference → the rule must stay
        // silent rather than invent evidence from nothing
        let mut d = Detector::new(Thresholds::default());
        warm_baseline(&mut d, 40.0);
        let e = d.feed(&live_sample_mclk(40.0, 300.0));
        assert!(
            !e.iter().any(|e| e.kind == "gpu_mem_idle"),
            "no observed clock yet — silence is the honest answer"
        );
    }

    #[test]
    fn finish_closes_open_conditions() {
        let mut d = Detector::new(Thresholds::default());
        d.feed(&sample(90.0, 120.0, 20000.0, 0.1, None));
        let e = d.finish("2026-08-31T00:01:00.000Z");
        assert!(e
            .iter()
            .any(|e| e.kind == "cpu_saturation" && e.phase == Phase::End));
    }

    // ---- visibility + activity gates (the desktop/lobby phantom fix) ----

    #[test]
    fn minimized_window_mutes_gpu_rules() {
        let mut d = Detector::new(Thresholds::default());
        d.set_gpu_max(1137.0, 2505.0);
        warm_baseline(&mut d, 50.0);
        for _ in 0..3 {
            d.feed(&live_sample_mclk(50.0, 1110.0)); // establish observed max
        }
        let mut bg = live_sample_mclk(50.0, 300.0);
        bg.game_visible = Some(false); // minimized → desktop activity
        let e = d.feed(&bg);
        assert!(
            !e.iter().any(|e| e.kind == "gpu_mem_idle"),
            "a minimized window must never produce GPU-wake cards"
        );
    }

    #[test]
    fn unprobed_visibility_mutes_gpu_rules() {
        let mut d = Detector::new(Thresholds::default());
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
    fn returning_from_minimized_does_not_fire_cliff() {
        let mut d = Detector::new(Thresholds::default());
        // warm up playing, minimize for a while (SM drops to idle), come back
        warm_baseline(&mut d, 50.0);
        let mut bg = live_sample(1.0);
        bg.game_visible = Some(false);
        d.feed(&bg);
        d.feed(&bg);
        // back in the game: SM returns — must NOT read as a "cliff recovery"
        let e = d.feed(&live_sample(50.0));
        assert!(
            !e.iter().any(|e| e.kind.starts_with("gpu_activity_cliff")),
            "baseline resets on pause — the return is not a cliff"
        );
    }

    #[test]
    fn light_scene_below_25pct_sm_does_not_fire_mem_idle() {
        let mut d = Detector::new(Thresholds::default());
        warm_baseline(&mut d, 50.0);
        for _ in 0..3 {
            d.feed(&live_sample_mclk(50.0, 1110.0)); // observed max: 1110
        }
        // one light scene tick with idle clocks and SM 10% — menus territory
        let e = d.feed(&live_sample_mclk(10.0, 405.0));
        assert!(
            !e.iter().any(|e| e.kind == "gpu_mem_idle"),
            "SM under 25% with idle clocks is light-scene driver behavior, not a wake hitch"
        );
    }

    #[test]
    fn learned_baseline_adapts_to_low_smgpu() {
        // an emulator GPU that renders at 16%: after warmup the baseline is
        // 16 (not the static floor 15) and the playing gate accepts it —
        // the machine whose normal sits at the old static threshold
        let mut d = Detector::new(Thresholds::default());
        warm_baseline(&mut d, 16.0);
        // feed one more tick: gate must say "playing" (no GPU mute) — check
        // indirectly: a true mem-idle event (405 vs observed 1110, SM 40)
        // fires only when playing; at 16% baseline the gate must accept it
        for _ in 0..3 {
            d.feed(&live_sample_mclk(16.0, 1110.0));
        }
        let e = d.feed(&live_sample_mclk(16.0, 405.0));
        assert!(
            e.iter().any(|e| e.kind == "gpu_mem_idle"),
            "a 16%-rendering machine is playing; its wake events must count"
        );
    }
}
