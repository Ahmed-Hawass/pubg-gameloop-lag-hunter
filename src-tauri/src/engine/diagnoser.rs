// diagnoser.rs — engine events → user-facing diagnoses (English, plain language)
// The UI never shows engine jargon; it shows these.

use super::types::{Diagnosis, EngineEvent, Overall, Phase, Sample, Severity, UiState};

/// How recent an event must be to count as live evidence for a card.
/// Was a bare inline `5 * 60 * 1000` — now named, and every window reads it.
const LIVE_WINDOW_MS: i64 = 5 * 60 * 1000;
/// How far back the correlator looks for a cliff that could confirm a wake
/// card. Must be ≥ LIVE_WINDOW_MS (a cliff can age out of the live window
/// while the wake it confirmed is still open — the pairing survives here).
const CORRELATION_WINDOW_MS: i64 = 15 * 60 * 1000;

/// Map an engine event to a diagnosis key.
fn key_for(ev: &EngineEvent, latest: &Sample) -> &'static str {
    match ev.kind.as_str() {
        "disk_queue" | "disk_busy" | "hard_faults" => "disk_wait",
        "cpu_saturation" => "cpu_busy",
        "cpu_throttle" | "spike" => "cpu_throttle",
        "mem_pressure" => "mem_low",
        "gpu_mem_idle" => "gpu_wake",
        "gpu_activity_cliff" => {
            // healthy elsewhere → scene hitch; loaded → gpu busy
            let others_ok = latest.disk_queue.map(|q| q < 0.5).unwrap_or(true)
                && latest.cpu_total.map(|c| c < 85.0).unwrap_or(true);
            if others_ok {
                "scene_hitch"
            } else {
                "gpu_busy"
            }
        }
        "gpu_activity_cliff_loaded" => "gpu_busy",
        "gpu_clock_low" | "gpu_temp" => "gpu_busy",
        _ => "",
    }
}

/// Static copy per diagnosis key: title / simple / cause / fix / severity.
/// One place to edit all user-facing strings.
pub fn diagnosis_copy(
    key: &str,
) -> Option<(
    &'static str,
    &'static str,
    &'static str,
    &'static str,
    &'static str,
)> {
    Some(match key {
        "disk_wait" => (
            "Game is waiting on disk",
            "The game stalls while loading files from disk — this causes heavy lag during hot drops and crowded fights.",
            "Memory pressure forces active paging (hard faults + disk queue)",
            "Increase the pagefile size and give GameLoop more RAM in its settings",
            "high",
        ),
        "cpu_busy" => (
            "CPU maxed out",
            "The processor is running at full capacity — the game needs more cores than available.",
            "CPU saturation",
            "Limit GameLoop cores to physical cores, close background apps (browsers, Discord) before playing",
            "high",
        ),
        "cpu_throttle" => (
            "CPU slowing itself down",
            "The processor is hot and protecting itself by dropping its speed — performance collapses under load.",
            "Thermal or power throttling",
            "Clean the fans, use a cooling pad, keep the charger plugged in",
            "high",
        ),
        "mem_low" => (
            "Running out of memory",
            "RAM is filling up and the game keeps swapping files in and out — each swap is a stutter.",
            "Memory pressure",
            "Close background apps and increase the pagefile (or add more GameLoop RAM)",
            "high",
        ),
        "gpu_wake" => (
            "GPU waking from sleep",
            "The graphics card drops to a power-saving state between scenes and needs a moment to wake up — that moment is a visible hitch.",
            "GPU power-state transition (memory clock)",
            "In the GPU control panel, set power management to 'Prefer maximum performance' for every GameLoop process. If it still appears, the driver is trimming memory clocks in light scenes — common on laptops with hybrid graphics; the effect is usually a brief hitch between scenes, not a persistent problem.",
            "medium",
        ),
        "scene_hitch" => (
            "First-time scene loading",
            "The first time a scene appears (lobby, new map) the system prepares its graphics — one hard hitch, then smooth. Revisiting the same scene is smooth because it is cached.",
            "Shader compile / first asset load (normal for GameLoop)",
            "No permanent fix — it fades as scenes repeat and shrinks with GPU driver updates",
            "low",
        ),
        "gpu_busy" => (
            "GPU at its limit",
            "The graphics card is running at full capacity and frames drop as a result.",
            "GPU bottleneck",
            "Lower the game resolution or graphics quality by one step",
            "medium",
        ),
        _ => return None,
    })
}

/// Recent events → FEW, CONFIRMED, root-cause diagnoses.
///
/// Precision rules (learned from real sessions — one disk storm used to show
/// three cards: disk busy + hard faults + CPU sat, all symptoms of one cause):
/// 1. ROOT-CAUSE GROUPING: disk symptoms collapse into one "disk_wait" card
///    that mentions it drags the CPU along.
/// 2. SUSTAINED WINDOW: a card only exists if its condition actually lasted
///    (start..end duration ≥ 3s, or ≥3 instant repeats within 60s). Brief
///    blips live in the Activity feed only — cards mean "confirmed problem".
/// 3. ACTIVE-ONLY: once a condition truly ends and stayed ended, its card
///    goes away (the UI keeps history in the feed and the report).
fn diagnoses_from(events: &[EngineEvent], latest: &Sample, now_iso: &str) -> Vec<Diagnosis> {
    let now_ms = iso_ms(now_iso).unwrap_or(0);

    // pass 1: group events into root-cause buckets with duration evidence
    use std::collections::BTreeMap;
    // bucket → (total_sustained_ms, last_seen_ms, worst_sev)
    let mut buckets: BTreeMap<&'static str, (i64, i64, &'static str)> = BTreeMap::new();
    // open Start events per bucket: start_ms (to pair with the matching End)
    let mut open_starts: BTreeMap<&'static str, i64> = BTreeMap::new();

    for ev in events {
        if ev.severity == Severity::Ok && ev.phase != Phase::End {
            continue;
        }
        let ev_ms = iso_ms(&ev.t).unwrap_or(0);
        if now_ms.saturating_sub(ev_ms) > LIVE_WINDOW_MS {
            continue; // outside the live window
        }
        let key = key_for(ev, latest);
        if key.is_empty() {
            continue;
        }
        let entry = buckets.entry(key).or_insert((0, 0, ""));
        entry.1 = entry.1.max(ev_ms);
        // severity: keep the WORST raw event severity ("crit" > "warn")
        if ev.phase != Phase::End
            && (entry.2.is_empty() || (ev.severity == Severity::Crit && entry.2 != "crit"))
        {
            entry.2 = ev.severity.as_str();
        }
        match ev.phase {
            Phase::Start => {
                open_starts.insert(key, ev_ms);
            }
            Phase::End => {
                // duration comes from the End event itself (authoritative)
                let dur_ms = ev
                    .duration_sec
                    .map(|d| (d * 1000.0) as i64)
                    .unwrap_or_else(|| {
                        // fall back to pairing with the open Start
                        let start = open_starts.get(key).copied().unwrap_or(ev_ms);
                        (ev_ms - start).max(0)
                    });
                entry.0 += dur_ms;
                open_starts.remove(key);
            }
            Phase::Instant => {
                entry.0 += 1000; // each instant counts as ~1s of evidence
            }
        }
    }
    // still-open conditions count time elapsed since their Start (once)
    for (key, start_ms) in &open_starts {
        if let Some(entry) = buckets.get_mut(key) {
            entry.0 += now_ms.saturating_sub(*start_ms).min(LIVE_WINDOW_MS);
        }
    }

    // pass 2: a bucket earns a card only with ≥3s of confirmed evidence
    let mut out: Vec<Diagnosis> = Vec::new();
    // CORRELATION EVIDENCE: did a real activity collapse happen in the live
    // window, and did it happen DURING or AFTER the wake it explains? A
    // cliff from BEFORE the wake started is not evidence for it — the old
    // 15-minute window used to let a stall from 12 minutes prior "confirm"
    // a wake card (false correlation).
    // First: the EARLIEST wake start in the evidence stream (open or closed),
    // so a cliff that precedes every wake cannot ride on any of them.
    let wake_first_start_ms = events
        .iter()
        .filter(|e| e.kind == "gpu_mem_idle" && e.phase == Phase::Start)
        .filter_map(|e| iso_ms(&e.t))
        .min();
    let stall_evidence = events.iter().any(|e| {
        if !e.kind.starts_with("gpu_activity_cliff") {
            return false;
        }
        let Some(ev_ms) = iso_ms(&e.t) else {
            return false;
        };
        if now_ms.saturating_sub(ev_ms) > CORRELATION_WINDOW_MS {
            return false; // too old to matter
        }
        // the cliff must fall inside (or after) a wake window: an earlier
        // collapse explains nothing about a later wake
        match wake_first_start_ms {
            Some(wake_start_ms) => ev_ms >= wake_start_ms,
            None => false, // no wake at all — nothing for a cliff to confirm
        }
    });
    for (key, (sustained_ms, _last, raw_sev)) in &buckets {
        if *sustained_ms < 3000 {
            continue; // blip — feed-worthy, not card-worthy
        }
        // a wake-up story without a measured freeze is an observation, not a
        // confirmed problem — it stays in the feed only
        if *key == "gpu_wake" && !stall_evidence {
            continue;
        }
        // SUBORDINATION: a short CPU spike riding a strong disk storm is a
        // symptom of the storm, not its own problem. One cause, one card.
        if *key == "cpu_busy" {
            let disk_ms = buckets.get("disk_wait").map(|b| b.0).unwrap_or(0);
            if disk_ms >= 5000 && *sustained_ms < 5000 {
                continue;
            }
        }
        if let Some((title, simple, cause, fix, sev_default)) = diagnosis_copy(key) {
            // confirmed cards are always "high" if their worst event was crit,
            // otherwise keep the copy's own weight
            let sev = if *raw_sev == "crit" {
                "high"
            } else {
                sev_default
            };
            out.push(Diagnosis {
                key: key.to_string(),
                title: title.to_string(),
                simple: simple.to_string(),
                cause: cause.to_string(),
                fix: fix.to_string(),
                severity: sev.to_string(),
                at: now_iso.to_string(),
            });
        }
    }

    let order = |s: &str| match s {
        "high" => 0,
        "medium" => 1,
        _ => 2,
    };
    out.sort_by_key(|d| order(&d.severity));
    out
}

/// Everything `build_ui_state` needs, bundled — keeps the call site readable
/// and clippy happy (too_many_arguments on the old 11-param form).
pub struct UiStateInput<'a> {
    pub session: Option<&'a str>,
    pub started_at: Option<&'a str>,
    pub samples: &'a [Sample],
    pub samples_total: u64,
    pub events: &'a [EngineEvent],
    pub active_count: usize,
    pub game_running: bool,
    pub emulator: Option<&'a str>,
    pub total_mem_mb: f64,
    pub session_secs: u64,
    pub auto_stop_sec: Option<u64>,
}

/// Build the complete UI state — the only payload the frontend receives.
pub fn build_ui_state(inp: UiStateInput) -> UiState {
    let UiStateInput {
        session,
        started_at,
        samples,
        samples_total,
        events,
        active_count,
        game_running,
        emulator,
        total_mem_mb,
        session_secs,
        auto_stop_sec,
    } = inp;
    let latest = samples.last().cloned().unwrap_or_default();
    let now_iso = super::sampler::iso_now();
    let diagnoses = diagnoses_from(events, &latest, &now_iso);
    let lag_count = events
        .iter()
        .filter(|e| e.kind.starts_with("gpu_activity_cliff") || e.kind == "spike")
        .count() as u32;

    let pct = |v: Option<f64>| -> Option<u8> { v.map(|x| x.clamp(0.0, 100.0) as u8) };
    let bars = super::types::Bars {
        cpu: pct(latest.cpu_total),
        ram: latest
            .avail_mb
            .map(|a| (100.0 - (a / total_mem_mb) * 100.0).clamp(0.0, 100.0) as u8),
        gpu: latest
            .gpu
            .as_ref()
            .and_then(|g| g.sm_pct)
            .map(|v| v.clamp(0.0, 100.0) as u8),
        disk: pct(latest.disk_busy_pct),
    };

    // sparkline history: last 60 ticks of each metric
    let hist_window = samples.iter().rev().take(60).collect::<Vec<_>>();
    let mut history = super::types::History::default();
    for s in hist_window.iter().rev() {
        history
            .cpu
            .push(s.cpu_total.map(|v| v.clamp(0.0, 100.0) as u8).unwrap_or(0));
        let ram = s
            .avail_mb
            .map(|a| (100.0 - (a / total_mem_mb) * 100.0).clamp(0.0, 100.0) as u8)
            .unwrap_or(0);
        history.ram.push(ram);
        let gpu = s
            .gpu
            .as_ref()
            .and_then(|g| g.sm_pct)
            .map(|v| v.clamp(0.0, 100.0) as u8)
            .unwrap_or(0);
        history.gpu.push(gpu);
        history.disk.push(
            s.disk_busy_pct
                .map(|v| v.clamp(0.0, 100.0) as u8)
                .unwrap_or(0),
        );
    }

    // live event feed: recent non-ok events, newest first, max 20
    let feed: Vec<super::types::FeedEntry> = events
        .iter()
        .filter(|e| e.severity != Severity::Ok)
        .rev()
        .take(20)
        .map(|e| super::types::FeedEntry {
            phase: match e.phase {
                Phase::Start => "start".into(),
                Phase::End => "end".into(),
                Phase::Instant => "instant".into(),
            },
            kind: e.kind.clone(),
            sev: e.severity.as_str().to_string(),
            clock: e.t.get(11..19).unwrap_or("").to_string(),
        })
        .collect();

    // spike markers on the timeline, relative to session start
    let start_ms = started_at.and_then(iso_ms);
    let spikes: Vec<super::types::SpikeMark> = events
        .iter()
        .filter(|e| e.kind.starts_with("gpu_activity_cliff") || e.kind == "spike")
        .filter_map(|e| {
            let ev_ms = iso_ms(&e.t)?;
            let start = start_ms?;
            Some(super::types::SpikeMark {
                offset_ms: (ev_ms - start).max(0),
                kind: e.kind.clone(),
            })
        })
        .collect();

    // Overall status: only meaningful while the game is running
    let overall = if game_running {
        if active_count >= 1 || diagnoses.iter().any(|d| d.severity == "high") {
            Overall::Lag
        } else if lag_count > 0 || !diagnoses.is_empty() {
            Overall::Watch
        } else {
            Overall::Ok
        }
    } else if diagnoses.iter().any(|d| d.severity == "high") {
        Overall::Watch
    } else {
        Overall::Ok
    };

    UiState {
        v: 1,
        session: session.map(String::from),
        started_at: started_at.map(String::from),
        time: now_iso,
        game_running,
        game_visible: latest.game_visible,
        overall,
        lag_count,
        bars,
        history,
        spikes,
        elapsed_sec: session_secs,
        auto_stop_sec,
        feed,
        diagnoses: diagnoses.into_iter().take(3).collect(),
        samples_count: samples_total,
        emulator: emulator.map(String::from),
    }
}

fn iso_ms(iso: &str) -> Option<i64> {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(kind: &str, phase: Phase, sev: Severity, t: &str, dur: Option<f64>) -> EngineEvent {
        EngineEvent {
            kind: kind.into(),
            phase,
            severity: sev,
            t: t.into(),
            duration_sec: dur,
            detail: String::new(),
        }
    }

    #[test]
    fn one_disk_storm_is_one_card_not_three() {
        // the real-world disk storm: queue + hard faults + CPU sat, one cause
        let events = vec![
            ev(
                "disk_queue",
                Phase::Start,
                Severity::Warn,
                "2026-08-31T05:00:00.000Z",
                None,
            ),
            ev(
                "hard_faults",
                Phase::Instant,
                Severity::Warn,
                "2026-08-31T05:00:01.000Z",
                None,
            ),
            ev(
                "hard_faults",
                Phase::Instant,
                Severity::Warn,
                "2026-08-31T05:00:02.000Z",
                None,
            ),
            ev(
                "cpu_saturation",
                Phase::Start,
                Severity::Warn,
                "2026-08-31T05:00:03.000Z",
                None,
            ),
            ev(
                "cpu_saturation",
                Phase::End,
                Severity::Ok,
                "2026-08-31T05:00:05.000Z",
                Some(2.0),
            ),
            ev(
                "disk_queue",
                Phase::End,
                Severity::Ok,
                "2026-08-31T05:00:12.000Z",
                Some(12.0),
            ),
        ];
        let latest = Sample::default();
        let now = "2026-08-31T05:00:13.000Z";
        let d = diagnoses_from(&events, &latest, now);
        assert_eq!(d.len(), 1, "one storm must produce exactly one card");
        assert_eq!(d[0].key, "disk_wait");
        assert_eq!(d[0].severity, "high");
    }

    #[test]
    fn blips_stay_in_feed_not_cards() {
        // a single 1s queue bump: recorded, but NOT card-worthy
        let events = vec![
            ev(
                "disk_queue",
                Phase::Start,
                Severity::Warn,
                "2026-08-31T05:00:00.000Z",
                None,
            ),
            ev(
                "disk_queue",
                Phase::End,
                Severity::Ok,
                "2026-08-31T05:00:01.000Z",
                Some(1.0),
            ),
        ];
        let latest = Sample::default();
        let now = "2026-08-31T05:00:02.000Z";
        let d = diagnoses_from(&events, &latest, now);
        assert!(d.is_empty(), "1s blip must not earn a card");
    }

    #[test]
    fn sustained_throttle_earns_card() {
        let events = vec![
            ev(
                "cpu_throttle",
                Phase::Start,
                Severity::Crit,
                "2026-08-31T05:00:00.000Z",
                None,
            ),
            ev(
                "cpu_throttle",
                Phase::End,
                Severity::Ok,
                "2026-08-31T05:00:08.000Z",
                Some(8.0),
            ),
        ];
        let latest = Sample::default();
        let now = "2026-08-31T05:00:09.000Z";
        let d = diagnoses_from(&events, &latest, now);
        assert_eq!(d.len(), 1);
        assert_eq!(d[0].key, "cpu_throttle");
    }

    #[test]
    fn gpu_wake_without_stall_stays_in_feed() {
        // sustained mem-idle evidence but ZERO measured freezes — the old
        // bug: a "visible hitch" card with no hitch ever recorded
        let events = vec![
            ev(
                "gpu_mem_idle",
                Phase::Start,
                Severity::Warn,
                "2026-08-31T05:00:00.000Z",
                None,
            ),
            ev(
                "gpu_mem_idle",
                Phase::End,
                Severity::Ok,
                "2026-08-31T05:00:20.000Z",
                Some(20.0),
            ),
        ];
        let latest = Sample::default();
        let now = "2026-08-31T05:00:21.000Z";
        let d = diagnoses_from(&events, &latest, now);
        assert!(
            !d.iter().any(|x| x.key == "gpu_wake"),
            "a wake story without a measured freeze is not a confirmed problem"
        );
    }

    #[test]
    fn gpu_wake_with_cliff_earns_card() {
        // same wake evidence, but a GPU activity cliff happened DURING the
        // wake window — correlation confirms the hitch was real
        let events = vec![
            ev(
                "gpu_mem_idle",
                Phase::Start,
                Severity::Warn,
                "2026-08-31T05:00:00.000Z",
                None,
            ),
            ev(
                "gpu_activity_cliff",
                Phase::Instant,
                Severity::Crit,
                "2026-08-31T05:00:05.000Z",
                None,
            ),
            ev(
                "gpu_mem_idle",
                Phase::End,
                Severity::Ok,
                "2026-08-31T05:00:20.000Z",
                Some(20.0),
            ),
        ];
        let latest = Sample::default();
        let now = "2026-08-31T05:00:21.000Z";
        let d = diagnoses_from(&events, &latest, now);
        assert!(
            d.iter().any(|x| x.key == "gpu_wake"),
            "a wake followed by a measured activity cliff is a confirmed hitch"
        );
    }

    #[test]
    fn cliff_before_wake_is_not_evidence_for_it() {
        // the false-correlation bug: a cliff at 04:55 used to "confirm" a
        // wake that only started at 05:00 — an earlier collapse explains
        // nothing about a later wake. The card must NOT appear.
        let events = vec![
            ev(
                "gpu_activity_cliff",
                Phase::Instant,
                Severity::Crit,
                "2026-08-31T05:00:00.000Z", // cliff FIRST
                None,
            ),
            ev(
                "gpu_mem_idle",
                Phase::Start,
                Severity::Warn,
                "2026-08-31T05:00:01.000Z", // wake starts AFTER
                None,
            ),
            ev(
                "gpu_mem_idle",
                Phase::End,
                Severity::Ok,
                "2026-08-31T05:00:20.000Z",
                Some(19.0),
            ),
        ];
        let latest = Sample::default();
        let now = "2026-08-31T05:00:21.000Z";
        let d = diagnoses_from(&events, &latest, now);
        assert!(
            !d.iter().any(|x| x.key == "gpu_wake"),
            "evidence must fall inside the window it explains, not before it"
        );
    }
}
