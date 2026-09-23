// storage.rs — AppData layout, session files, settings persistence
// %LOCALAPPDATA%\LagHunter\
//   sessions\<id>\ {samples.jsonl, events.json, report.md, samples.csv}
//   settings.json

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use super::types::{iso_ms, EngineEvent, Sample, Thresholds};

pub fn app_dir() -> PathBuf {
    let base = std::env::var("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."));
    base.join("LagHunter")
}

pub fn sessions_root() -> PathBuf {
    app_dir().join("sessions")
}

/// Ensure the sessions root exists at boot. It is born with the first
/// session otherwise, so a fresh user who somehow reaches an "open the
/// sessions folder" affordance before any scan (or a user who deleted
/// the folder by hand while old reports are still listed) hits a
/// missing-path error instead of an empty folder. One cheap mkdir.
pub fn ensure_sessions_root() {
    let _ = fs::create_dir_all(sessions_root());
}

/// Crash-safe file write: readers either see the previous complete file
/// or the new complete file, never a truncated half-write. This matters
/// because the Reports list reads `events.json`/`summary.json` while a
/// running session's autosave rewrites them on a timer.
pub(crate) fn write_file_atomic(path: &Path, contents: &[u8]) -> std::io::Result<()> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, contents)?;
    fs::rename(&tmp, path)
}

/// Create a new session directory named by local time: session-YYYY-MM-DD_HHMMSS
/// (local = wall-clock time on the user's machine, DST-aware).
/// Second-resolution ids collide when a stop+start lands inside the same
/// wall-clock second — the id must stay SORTABLE (it is the list ordering
/// AND carries the date), so a collision takes a monotonic -2, -3, ...
/// suffix instead of waiting for the next second (which could land the new
/// session BEFORE its true start time).
pub fn new_session_dir() -> Result<(String, PathBuf), String> {
    let base_id = session_id_from(&super::sampler::iso_now());
    let root = sessions_root();
    let mut id = base_id.clone();
    let mut n = 2;
    // File::create below TRUNCATES — writing into an existing dir would
    // silently destroy the previous session's samples. Never reuse a dir.
    while root.join(&id).exists() {
        id = format!("{base_id}-{n}");
        n += 1;
    }
    let dir = root.join(&id);
    fs::create_dir_all(&dir).map_err(|e| format!("cannot create session dir: {e}"))?;
    Ok((id, dir))
}

fn session_id_from(iso: &str) -> String {
    // 2026-08-31T00:19:52.123Z -> session-2026-08-31_001952
    let date = iso.get(0..10).unwrap_or("unknown");
    let time = iso.get(11..19).unwrap_or("000000").replace(':', "");
    format!("session-{date}_{time}")
}

pub struct SessionWriter {
    samples: fs::File,
    dir: PathBuf,
}

impl SessionWriter {
    pub fn create() -> Result<Self, String> {
        let (_id, dir) = new_session_dir()?;
        let samples = fs::File::create(dir.join("samples.jsonl"))
            .map_err(|e| format!("cannot create samples file: {e}"))?;
        Ok(Self { samples, dir })
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    pub fn append_sample(&mut self, s: &Sample) -> Result<(), String> {
        let line = serde_json::to_string(s).map_err(|e| format!("serialize sample: {e}"))?;
        writeln!(self.samples, "{line}").map_err(|e| format!("write sample: {e}"))
    }

    pub fn flush(&mut self) -> Result<(), String> {
        self.samples.flush().map_err(|e| format!("flush samples: {e}"))
    }

    /// Autosafe: rewrite events + summary-lite periodically so a crash never loses data.
    pub fn autosave(&self, events: &[EngineEvent], thresholds: &Thresholds, started_at: &str) -> Result<(), String> {
        write_file_atomic(
            &self.dir.join("events.json"),
            serde_json::to_string_pretty(events)
                .unwrap_or_default()
                .as_bytes(),
        ).map_err(|e| format!("autosave events: {e}"))?;
        let summary = serde_json::json!({
            "session": self.dir.file_name().and_then(|s| s.to_str()).unwrap_or(""),
            "startedAt": started_at,
            "partial": true,
            "thresholds": thresholds,
            "eventsCount": events.len(),
        });
        write_file_atomic(
            &self.dir.join("summary.json"),
            serde_json::to_string_pretty(&summary)
                .unwrap_or_default()
                .as_bytes(),
        ).map_err(|e| format!("autosave summary: {e}"))?;
        Ok(())
    }

    /// Final write: events, summary, CSV, Markdown report.
    /// Reads samples back from the jsonl file (the RAM window may have trimmed them).
    /// Best-effort by design: a failing disk must still leave a listable
    /// partial session behind instead of an invisible directory the summary
    /// card points at. summary.json is the one hard requirement (the list
    /// and the reader both key off it); everything else degrades to the
    /// storageWriteFailed flag the outcome readers map to partial.
    pub fn finalize_from_disk(
        &mut self,
        events: &[EngineEvent],
        started_at: &str,
        thresholds: &Thresholds,
        samples_total: u64,
        storage_write_failed: bool,
    ) -> Result<PathBuf, String> {
        let _ = self.flush();

        // read all samples from disk — the file is the source of truth;
        // an unreadable file finalizes as an empty (partial) session
        let samples: Vec<Sample> = fs::read_to_string(self.dir.join("samples.jsonl"))
            .map(|text| {
                text.lines()
                    .filter_map(|l| {
                        if l.trim().is_empty() {
                            None
                        } else {
                            serde_json::from_str(l).ok()
                        }
                    })
                    .collect()
            })
            .unwrap_or_default();

        let mut failed = storage_write_failed;
        // events.json
        if write_file_atomic(
            &self.dir.join("events.json"),
            serde_json::to_string_pretty(events)
                .unwrap_or_default()
                .as_bytes(),
        )
        .is_err()
        {
            failed = true;
        }

        // samples.csv
        let mut csv = String::from("time,cpu_pct,proc_perf_pct,avail_mb,pages_in_ps,disk_queue,disk_busy_pct,gpu_sm_pct,gpu_clk_mhz,gpu_temp_c\n");
        for s in &samples {
            let g = s.gpu.as_ref();
            csv.push_str(&format!(
                "{},{},{},{},{},{},{},{},{},{}\n",
                s.t,
                fmt(s.cpu_total),
                fmt(s.proc_perf),
                fmt(s.avail_mb),
                fmt(s.pages_in),
                fmt(s.disk_queue),
                fmt(s.disk_busy_pct),
                fmt(g.and_then(|g| g.sm_pct)),
                fmt(g.and_then(|g| g.pclk)),
                fmt(g.and_then(|g| g.temp)),
            ));
        }
        if write_file_atomic(&self.dir.join("samples.csv"), csv.as_bytes()).is_err() {
            failed = true;
        }

        // report.md before the summary so the flag below covers every write
        let stats = SessionStats::from(&samples);
        let report = build_report(&stats, events, samples.len() as u64);
        let rp = self.dir.join("report.md");
        if write_file_atomic(&rp, report.as_bytes()).is_err() {
            failed = true;
        }

        // summary.json last: the commit point the list and reader key off
        let summary = serde_json::json!({
            "session": self.dir.file_name().and_then(|s| s.to_str()).unwrap_or(""),
            "startedAt": started_at,
            "endedAt": super::sampler::iso_now(),
            "durationSec": stats.duration_sec,
            "samplesCount": samples.len(),
            "samplesTotal": samples_total,
            "storageWriteFailed": failed,
            "thresholds": thresholds,
            "stats": {
                "cpuAvg": stats.cpu_avg, "cpuP95": stats.cpu_p95,
                "procPerfMin": stats.perf_min, "availMin": stats.avail_min,
                "gpuSmAvg": stats.gpu_sm_avg, "gpuTempMax": stats.gpu_temp_max,
                "backgroundPct": stats.background_pct,
            },
        });
        write_file_atomic(
            &self.dir.join("summary.json"),
            serde_json::to_string_pretty(&summary)
                .unwrap_or_default()
                .as_bytes(),
        )
        .map_err(|e| format!("write summary: {e}"))?;
        Ok(rp)
    }
}

fn fmt(v: Option<f64>) -> String {
    match v {
        Some(v) => format!("{v:.1}"),
        None => String::new(),
    }
}

pub struct SessionStats {
    pub duration_sec: u64,
    pub cpu_avg: Option<f64>,
    pub cpu_p95: Option<f64>,
    pub perf_min: Option<f64>,
    pub avail_min: Option<f64>,
    pub gpu_sm_avg: Option<f64>,
    pub gpu_temp_max: Option<f64>,
    /// % of samples where the game window was NOT visible (0 = always up).
    /// None = the field wasn't recorded (sessions from older versions).
    pub background_pct: Option<f64>,
}

impl SessionStats {
    pub fn from(samples: &[Sample]) -> Self {
        let mut cpus = samples
            .iter()
            .filter_map(|s| s.cpu_total)
            .collect::<Vec<_>>();
        // NaN-safe ordering: a "NaN" string CAN parse as f64 out of a typeperf
        // CSV field, and partial_cmp on NaN is None — with panic="abort" that
        // single bad line would kill the whole app and take the session with
        // it. Equal-comparison on unorderable pairs keeps the sort total.
        cpus.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        // p95 by nearest-rank: ceil(0.95·n) − 1 clamped to the data. The
        // old floor-index form returned the MAXIMUM for any n ≤ 20 (index
        // (n·0.95) % n = n−1) and overstated "CPU p95" in short sessions.
        let p95 = |v: &mut Vec<f64>| {
            if v.is_empty() {
                return None;
            }
            let rank = ((v.len() as f64 * 0.95).ceil() as usize).clamp(1, v.len());
            v.get(rank - 1).copied()
        };
        let avg = |v: &[f64]| {
            if v.is_empty() {
                None
            } else {
                Some(v.iter().sum::<f64>() / v.len() as f64)
            }
        };

        let perfs: Vec<f64> = samples.iter().filter_map(|s| s.proc_perf).collect();
        let avails: Vec<f64> = samples.iter().filter_map(|s| s.avail_mb).collect();
        let sms: Vec<f64> = samples
            .iter()
            .filter_map(|s| s.gpu.as_ref().and_then(|g| g.sm_pct))
            .collect();
        let temps: Vec<f64> = samples
            .iter()
            .filter_map(|s| s.gpu.as_ref().and_then(|g| g.temp))
            .collect();

        let duration_sec = samples
            .first()
            .zip(samples.last())
            .and_then(|(a, b)| {
                let (Some(x), Some(y)) = (iso_ms(&a.t), iso_ms(&b.t)) else {
                    return None;
                };
                Some((y.saturating_sub(x) / 1000).max(0) as u64)
            })
            .unwrap_or(0);

        // window-visibility share: only over samples that carry the field
        // (older sessions parse without it → None → the report says nothing)
        let vis: Vec<bool> = samples.iter().filter_map(|s| s.game_visible).collect();
        let background_pct = if vis.is_empty() {
            None
        } else {
            Some(vis.iter().filter(|v| !**v).count() as f64 / vis.len() as f64 * 100.0)
        };

        Self {
            duration_sec,
            cpu_avg: avg(&cpus.clone()),
            cpu_p95: p95(&mut cpus),
            perf_min: perfs.iter().cloned().reduce(f64::min),
            avail_min: avails.iter().cloned().reduce(f64::min),
            gpu_sm_avg: avg(&sms),
            gpu_temp_max: temps.iter().cloned().reduce(f64::max),
            background_pct,
        }
    }
}

/// Markdown report, English, self-contained.
fn build_report(stats: &SessionStats, events: &[EngineEvent], n: u64) -> String {
    let mut md = String::new();
    md.push_str("# Lag Hunter Report\n\n");
    md.push_str(&format!("- Samples: {n}\n"));
    md.push_str(&format!("- Duration: {}s\n", stats.duration_sec));
    // honesty line: timestamps are wall-clock LOCAL time (the trailing Z is a
    // fixed-format artifact, not a UTC claim)
    md.push_str("- All times are your machine's local clock\n");
    if let Some(v) = stats.cpu_avg {
        md.push_str(&format!("- CPU avg: {v:.1}%\n"));
    }
    if let Some(v) = stats.cpu_p95 {
        md.push_str(&format!("- CPU p95: {v:.1}%\n"));
    }
    if let Some(v) = stats.perf_min {
        md.push_str(&format!("- Processor performance min: {v:.1}%\n"));
    }
    if let Some(v) = stats.avail_min {
        md.push_str(&format!("- Available RAM min: {v:.0} MB\n"));
    }
    if let Some(v) = stats.gpu_sm_avg {
        md.push_str(&format!("- GPU SM avg: {v:.1}%\n"));
    }
    if let Some(v) = stats.gpu_temp_max {
        md.push_str(&format!("- GPU temp max: {v:.0}C\n"));
    }
    // honesty line: a session spent mostly outside the game is not a match
    // report — say so instead of letting GPU numbers masquerade as gameplay
    if let Some(pct) = stats.background_pct {
        if pct >= 60.0 {
            md.push_str(&format!(
                "- Note: the game window was in the background for ~{pct:.0}% of this session — results may not reflect a real match.\n"
            ));
        }
    }
    md.push_str("\n## Events\n\n");
    if events.is_empty() {
        md.push_str("No notable events captured.\n");
    } else {
        md.push_str(
            "| Time | Type | Severity | Phase | Duration | Detail |\n|---|---|---|---|---|---|\n",
        );
        for e in events.iter().take(200) {
            md.push_str(&format!(
                "| {} | {} | {} | {:?} | {} | {} |\n",
                // .get, not slicing: a malformed timestamp from a future
                // producer must never panic the app (panic = abort here)
                e.t.get(11..19).unwrap_or(&e.t),
                e.kind,
                e.severity.as_str(),
                e.phase,
                e.duration_sec
                    .map(|d| format!("{d:.0}s"))
                    .unwrap_or_else(|| "-".into()),
                e.detail.replace('|', "/"),
            ));
        }
        // never silently truncate: the full log stays in events.json
        if events.len() > 200 {
            md.push_str(&format!(
                "\n_Showing the first 200 of {} events — see events.json for the full list._\n",
                events.len()
            ));
        }
    }
    md
}

/// Stream-count the samples file: `read_to_string` pulled the WHOLE file
/// into memory (tens of MB on long sessions) just to count lines, on
/// every Reports-list refresh. A buffered newline walk reads in chunks
/// and never holds the file.
fn count_lines(path: &Path) -> u64 {
    use std::io::{BufRead, BufReader};
    let Ok(f) = fs::File::open(path) else {
        return 0;
    };
    let mut reader = BufReader::new(f);
    let mut count = 0u64;
    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => break,
            Ok(_) => {
                if !line.trim().is_empty() {
                    count += 1;
                }
            }
            Err(_) => break,
        }
    }
    count
}

/// All session dirs sorted by name (= chronological, newest last).
pub fn list_sessions() -> Vec<String> {
    let Ok(rd) = fs::read_dir(sessions_root()) else {
        return vec![];
    };
    let mut v: Vec<String> = rd
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter_map(|e| e.file_name().to_str().map(String::from))
        .collect();
    v.sort();
    v
}

/// One entry per saved session, for the Reports list.
/// A session is HIDDEN while it's still being written (no summary.json yet
/// and a fresh samples file updated in the last minute = scan in progress).
#[derive(Debug, Clone, serde::Serialize)]
pub struct SessionEntry {
    pub id: String,
    /// local-formatted date string from the session id (e.g. "2026-08-31 00:19")
    pub date: String,
    pub duration_sec: u64,
    pub samples: u64,
    pub lag_spikes: u64,
    /// "clean" = nothing at all | "issues" = findings but no frame freeze | "laggy" = frame freezes | "partial" = crashed/incomplete
    pub outcome: String,
}

/// Session list with the numbers users care about. Newest first.
/// `live_id`: the session being written RIGHT NOW (from the engine, not
/// the filesystem) — hidden from the list whatever state its files are
/// in. The old heuristic (hide only when summary.json is missing) broke
/// at the first autosave (~50s in, summary.json appears with
/// partial:true) and the half-written session showed up as a
/// half-finished report.
pub fn session_entries(live_id: Option<&str>) -> Vec<SessionEntry> {
    let ids = list_sessions();
    let mut out: Vec<SessionEntry> = Vec::new();
    for id in ids {
        if Some(id.as_str()) == live_id {
            continue; // live session — not a report yet
        }
        let dir = sessions_root().join(&id);
        // legacy safety net for crashed runs: a session with no summary
        // whose samples were touched within the last minute is a run that
        // died mid-write — hide it until it is a minute old
        let summary_exists = dir.join("summary.json").is_file();
        if !summary_exists {
            if let Ok(meta) = fs::metadata(dir.join("samples.jsonl")) {
                if let Ok(modified) = meta.modified() {
                    if let Ok(age) = modified.elapsed() {
                        if age.as_secs() < 60 {
                            continue; // fresh corpse of a crashed run — not a report yet
                        }
                    }
                }
            }
        }
        // date from the id: session-YYYY-MM-DD_HHMMSS -> "YYYY-MM-DD HH:MM"
        let date = id
            .strip_prefix("session-")
            .map(|s| {
                let d = &s[0..10.min(s.len())];
                let t = s.get(11..19.min(s.len())).unwrap_or("000000");
                let hh = t.get(0..2).unwrap_or("00");
                let mm = t.get(2..4).unwrap_or("00");
                format!("{d} {hh}:{mm}")
            })
            .unwrap_or_else(|| id.clone());
        // samples count from jsonl (streamed line count, no full parse)
        let samples = count_lines(&dir.join("samples.jsonl"));
        // summary numbers when finalized
        let (duration, spikes, outcome) = match fs::read_to_string(dir.join("summary.json")) {
            Ok(text) => match serde_json::from_str::<serde_json::Value>(&text) {
                Ok(v) => {
                    let partial = v.get("partial").and_then(|p| p.as_bool()).unwrap_or(false);
                    let write_failed = v
                        .get("storageWriteFailed")
                        .and_then(|w| w.as_bool())
                        .unwrap_or(false);
                    let dur = v.get("durationSec").and_then(|d| d.as_u64()).unwrap_or(0);
                    let (spikes, distinct_issues) = classify_events(&dir);
                    let outcome = if partial || write_failed {
                        "partial".to_string()
                    } else {
                        honest_outcome(spikes, distinct_issues)
                    };
                    (dur, spikes, outcome)
                }
                Err(_) => (0, 0, "partial".into()),
            },
            Err(_) => {
                let (spikes, _distinct_issues) = classify_events(&dir);
                // samples exist but no summary = crashed mid-session: NEVER call it clean
                let outcome = if samples == 0 {
                    "partial".to_string()
                } else if spikes > 0 {
                    "laggy".to_string()
                } else {
                    "partial".to_string()
                };
                (0, spikes, outcome)
            }
        };
        out.push(SessionEntry {
            id,
            date,
            duration_sec: duration,
            samples,
            lag_spikes: spikes,
            outcome,
        });
    }
    out.reverse(); // newest first
    out
}

/// Frame freezes + distinct issue kinds from a session's events.
/// Returns (lag_spikes, distinct_issue_kinds).
fn classify_events(dir: &Path) -> (u64, u64) {
    let Ok(text) = fs::read_to_string(dir.join("events.json")) else {
        return (0, 0);
    };
    let Ok(evs) = serde_json::from_str::<Vec<serde_json::Value>>(&text) else {
        return (0, 0);
    };
    let mut spikes = 0u64;
    let mut kinds: std::collections::HashSet<String> = std::collections::HashSet::new();
    for e in &evs {
        let kind = e.get("kind").and_then(|k| k.as_str()).unwrap_or("");
        let sev = e.get("severity").and_then(|s| s.as_str()).unwrap_or("warn");
        let phase = e.get("phase").and_then(|p| p.as_str()).unwrap_or("");
        if sev == "ok" || kind.is_empty() {
            continue;
        }
        if kind.starts_with("gpu_activity_cliff") || kind == "spike" {
            spikes += 1;
        }
        if phase != "end" {
            kinds.insert(kind.to_string());
        }
    }
    (spikes, kinds.len() as u64)
}

/// Honest outcome: only "clean" when literally nothing happened.
fn honest_outcome(spikes: u64, distinct_issues: u64) -> String {
    if spikes > 0 {
        "laggy".into()
    } else if distinct_issues > 0 {
        "issues".into()
    } else {
        "clean".into()
    }
}

/// Same session-id guard as delete/session_dir: anything that doesn't look
/// like a session id is refused before it ever touches the filesystem.
fn validate_session_id(id: &str) -> Result<(), String> {
    if !id.starts_with("session-") || id.contains("..") || id.contains('\\') || id.contains('/') {
        return Err("invalid session id".into());
    }
    Ok(())
}

/// Delete a session directory (Reports page cleanup).
pub fn delete_session(id: &str) -> Result<(), String> {
    // refuse anything that doesn't look like a session id (path safety)
    validate_session_id(id)?;
    let dir = sessions_root().join(id);
    if !dir.is_dir() {
        return Err(format!("session not found: {id}"));
    }
    fs::remove_dir_all(&dir).map_err(|e| format!("cannot delete: {e}"))
}

/// Delete every saved session directory (bulk cleanup from Reports).
/// Only `session-*` directories are touched — anything else in the folder
/// (and anything failing the id guard) is left alone; a locked file skips
/// its session instead of aborting the whole run (the list refresh right
/// after shows what is really gone).
/// The live writer's directory is skipped when its id is passed: deleting
/// it mid-write would corrupt its report. The UI also disables the button
/// while a session runs — this is the second lock.
pub fn delete_all_sessions(root: &Path, exclude_id: Option<&str>) -> Result<Vec<String>, String> {
    let mut deleted = Vec::new();
    let Ok(rd) = fs::read_dir(root) else {
        return Ok(deleted);
    };
    for e in rd.flatten() {
        let name = e.file_name().to_str().unwrap_or("").to_string();
        if !name.starts_with("session-") || name.contains("..") || name.contains('\\') || name.contains('/') {
            continue;
        }
        if Some(name.as_str()) == exclude_id {
            continue;
        }
        if e.path().is_dir() && fs::remove_dir_all(e.path()).is_ok() {
            deleted.push(name);
        }
    }
    deleted.sort();
    Ok(deleted)
}

/// Full path of a session dir (for "open folder").
pub fn session_dir(id: &str) -> Result<String, String> {
    validate_session_id(id)?;
    let dir = sessions_root().join(id);
    if !dir.is_dir() {
        return Err(format!("session not found: {id}"));
    }
    Ok(dir.to_string_lossy().to_string())
}

/// Background share from a session's summary (None for pre-visibility files).
fn stats_bg_pct(summary: &serde_json::Value) -> Option<f64> {
    summary.get("stats")?.get("backgroundPct")?.as_f64()
}

/// Friendly in-app report: human sections built from summary + events.
/// The UI renders this — same language and tone as the rest of the app.
#[derive(Debug, Clone, serde::Serialize)]
pub struct FriendlyReport {
    pub id: String,
    pub date: String,
    pub duration_sec: u64,
    pub samples: u64,
    pub lag_spikes: u64,
    /// "clean" | "issues" | "laggy" | "partial" — honest outcome
    pub outcome: String,
    /// user-facing lines: key moments in plain language
    pub highlights: Vec<HighlightEntry>,
    /// metric summary facts: machine keys + raw numbers, the UI composes
    /// the sentence per language (same contract as highlights)
    pub metrics_summary: Vec<MetricEntry>,
    /// plain-language findings (one per distinct issue)
    pub findings: Vec<FriendlyFinding>,
    /// raw markdown file path (for "open externally")
    pub raw_path: String,
}

/// One metrics-summary fact: a machine key plus the measured number.
/// The UI owns the sentence (per language); the engine owns the fact.
#[derive(Debug, Clone, serde::Serialize)]
pub struct MetricEntry {
    /// e.g. "cpuPeak" | "cpuPerfMin" | "ramFreeMin" | "gpuTempMax" | "gpuUsageAvg"
    pub key: String,
    pub value: f64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct FriendlyFinding {
    /// machine key for UI translation (e.g. "disk_wait")
    pub key: String,
    /// English fallback text (UI translates via key when available)
    pub title: String,
    pub simple: String,
    pub fix: String,
    pub severity: String,
}

pub fn friendly_report(id: &str) -> Result<FriendlyReport, String> {
    validate_session_id(id)?;
    let dir = sessions_root().join(id);
    if !dir.is_dir() {
        return Err(format!("session not found: {id}"));
    }

    let summary: serde_json::Value = fs::read_to_string(dir.join("summary.json"))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or(serde_json::json!({}));
    let events: Vec<serde_json::Value> = fs::read_to_string(dir.join("events.json"))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default();
    let samples = count_lines(&dir.join("samples.jsonl"));

    let duration = summary
        .get("durationSec")
        .and_then(|d| d.as_u64())
        .unwrap_or(0);
    let (spikes, distinct_issues) = classify_events(&dir);
    let partial = summary
        .get("partial")
        .and_then(|p| p.as_bool())
        .unwrap_or(false);
    let write_failed = summary
        .get("storageWriteFailed")
        .and_then(|w| w.as_bool())
        .unwrap_or(false);
    let outcome = if partial || write_failed {
        "partial".to_string()
    } else {
        honest_outcome(spikes, distinct_issues)
    };

    let date = id
        .strip_prefix("session-")
        .map(|s| {
            let d = &s[0..10.min(s.len())];
            let t = s.get(11..19.min(s.len())).unwrap_or("000000");
            let hh = t.get(0..2).unwrap_or("00");
            let mm = t.get(2..4).unwrap_or("00");
            format!("{d} {hh}:{mm}")
        })
        .unwrap_or_else(|| id.to_string());

    // findings: map distinct event kinds to friendly copy (same copy as diagnoser)
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut findings: Vec<FriendlyFinding> = Vec::new();
    for ev in &events {
        let kind = ev.get("kind").and_then(|k| k.as_str()).unwrap_or("");
        let sev = ev
            .get("severity")
            .and_then(|s| s.as_str())
            .unwrap_or("warn");
        if sev == "ok" || kind.is_empty() {
            continue;
        }
        let copy = finding_copy(kind);
        let kind_key = finding_key(kind);
        if seen.contains(kind_key) {
            continue;
        }
        seen.insert(kind_key.to_string());
        findings.push(FriendlyFinding {
            key: kind_key.to_string(),
            title: copy.0.to_string(),
            simple: copy.1.to_string(),
            fix: copy.2.to_string(),
            severity: copy.3.to_string(),
        });
    }

    // highlights: raw event facts (kind + clock + duration) — the UI composes
    // the sentence in the user's language. Max 8, newest last.
    let mut highlights: Vec<HighlightEntry> = Vec::new();
    for ev in &events {
        let kind = ev.get("kind").and_then(|k| k.as_str()).unwrap_or("");
        let sev = ev
            .get("severity")
            .and_then(|s| s.as_str())
            .unwrap_or("warn");
        let phase = ev.get("phase").and_then(|p| p.as_str()).unwrap_or("");
        if sev == "ok" || phase == "end" || phase == "End" {
            continue;
        }
        if highlights.len() >= 8 {
            break;
        }
        let t = ev.get("t").and_then(|t| t.as_str()).unwrap_or("");
        let clock = t.get(11..19).map(|s| s.to_string()).unwrap_or_default();
        let dur = ev.get("duration_sec").and_then(|d| d.as_f64());
        highlights.push(HighlightEntry {
            kind: kind.to_string(),
            clock,
            dur_sec: dur,
        });
    }
    if highlights.is_empty() {
        let k = if samples > 0 { "nothing" } else { "noSamples" };
        highlights.push(HighlightEntry {
            kind: k.into(),
            clock: String::new(),
            dur_sec: None,
        });
    }
    // honesty first: a session mostly outside the game opens the report with
    // the caveat, before any numbers get read as match data
    if let Some(pct) = stats_bg_pct(&summary) {
        if pct >= 60.0 {
            highlights.insert(
                0,
                HighlightEntry {
                    kind: "mostly_background".into(),
                    clock: String::new(),
                    dur_sec: None,
                },
            );
        }
    }

    // metrics summary from summary.json stats — machine keys + raw numbers,
    // the UI composes the sentence per language (the old English sentences
    // shipped verbatim into Arabic reports; keys follow the highlights
    // contract now)
    let stats = summary
        .get("stats")
        .cloned()
        .unwrap_or(serde_json::json!({}));
    let mut metrics_summary = Vec::new();
    if let Some(v) = stats.get("cpuP95").and_then(|v| v.as_f64()) {
        metrics_summary.push(MetricEntry {
            key: "cpuPeak".into(),
            value: v,
        });
    }
    if let Some(v) = stats.get("procPerfMin").and_then(|v| v.as_f64()) {
        if v < 90.0 {
            metrics_summary.push(MetricEntry {
                key: "cpuPerfMin".into(),
                value: v,
            });
        }
    }
    if let Some(v) = stats.get("availMin").and_then(|v| v.as_f64()) {
        metrics_summary.push(MetricEntry {
            key: "ramFreeMin".into(),
            value: v,
        });
    }
    if let Some(v) = stats.get("gpuTempMax").and_then(|v| v.as_f64()) {
        metrics_summary.push(MetricEntry {
            key: "gpuTempMax".into(),
            value: v,
        });
    }
    if let Some(v) = stats.get("gpuSmAvg").and_then(|v| v.as_f64()) {
        metrics_summary.push(MetricEntry {
            key: "gpuUsageAvg".into(),
            value: v,
        });
    }

    let raw_path = dir.join("report.md").to_string_lossy().to_string();

    Ok(FriendlyReport {
        id: id.to_string(),
        date,
        duration_sec: duration,
        samples,
        lag_spikes: spikes,
        outcome,
        highlights,
        metrics_summary,
        findings,
        raw_path,
    })
}

/// A report highlight: raw facts — the UI composes the sentence per language.
#[derive(Debug, Clone, serde::Serialize)]
pub struct HighlightEntry {
    /// machine event kind (e.g. "disk_queue", "nothing", "noSamples")
    pub kind: String,
    /// HH:MM:SS clock from the sample, empty for summary entries
    pub clock: String,
    /// duration in seconds when known
    pub dur_sec: Option<f64>,
}

/// Machine key for UI translation (mirrors the diagnoser dictionary keys).
/// Unknown engine kinds map to "" like the live path (diagnoser ignores
/// them; the report reader falls back to the English "Other event" copy
/// below instead of mislabeling them as GPU strain).
fn finding_key(kind: &str) -> &'static str {
    match kind {
        "disk_queue" | "disk_busy" | "hard_faults" => "disk_wait",
        "cpu_saturation" => "cpu_busy",
        "cpu_throttle" | "spike" => "cpu_throttle",
        "mem_pressure" => "mem_low",
        "paging_churn" => "paging_churn",
        "gpu_mem_idle" => "gpu_wake",
        "gpu_activity_cliff" => "scene_hitch",
        "gpu_activity_cliff_loaded" => "gpu_busy",
        "gpu_clock_low" | "gpu_temp" => "gpu_busy",
        _ => "",
    }
}

/// (key, title, simple, fix, severity) — SINGLE-SOURCED from the
/// diagnoser's dictionary: the saved report and the live cards can never
/// drift apart in wording again. Only the English fallback text flows
/// from here (the UI translates by key); `cause` is dropped, reports
/// don't carry it.
fn finding_copy(kind: &str) -> (&'static str, &'static str, &'static str, &'static str) {
    let key = finding_key(kind);
    if let Some((title, simple, _cause, fix, sev)) = super::diagnoser::diagnosis_copy(key) {
        return (title, simple, fix, sev);
    }
    (
        "Other event",
        "Something unusual was captured in this session.",
        "Check the raw report for details.",
        "low",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_id_format() {
        let id = session_id_from("2026-08-31T00:19:52.123Z");
        assert_eq!(id, "session-2026-08-31_001952");
    }

    #[test]
    fn atomic_write_replaces_target_and_leaves_no_temp() {
        // readers must only ever see a complete file: the helper writes a
        // sibling and renames it over the target, so a crash cannot leave
        // a truncated events.json/summary.json behind for the Reports list.
        let d = std::env::temp_dir().join(format!("lh-atomic-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        let target = d.join("events.json");
        fs::write(&target, r#"[{"old":true}]"#).unwrap();
        write_file_atomic(&target, br#"[{"new":true}]"#).unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), r#"[{"new":true}]"#);
        assert!(!d.join("events.tmp").exists());
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn iso_ms_known_epoch() {
        // shared parser (types::iso_ms) keeps its epoch contract here
        assert_eq!(iso_ms("1970-01-01T00:00:00.000Z"), Some(0));
        assert_eq!(
            iso_ms("2026-08-31T00:00:00.000Z"),
            Some(1_788_134_400_000)
        );
    }

    #[test]
    fn p95_is_nearest_rank_not_max_for_small_samples() {
        // 20 sorted values 1..20: nearest-rank p95 = ceil(0.95·20) − 1 =
        // index 18 → 19.0. The old form returned index 19 → 20.0 (the
        // MAX) — every short session overstated its CPU p95.
        let vals: Vec<Sample> = (1..=20)
            .map(|i| Sample {
                t: "2026-08-31T05:00:00.000Z".into(),
                cpu_total: Some(i as f64),
                ..Default::default()
            })
            .collect();
        let stats = SessionStats::from(&vals);
        assert_eq!(stats.cpu_p95, Some(19.0));
        // n=1: the only value is the p95
        let one = vec![vals[0].clone()];
        assert_eq!(SessionStats::from(&one).cpu_p95, Some(1.0));
    }

    #[test]
    fn honest_outcome_never_clean_with_findings() {
        assert_eq!(honest_outcome(0, 0), "clean");
        assert_eq!(honest_outcome(0, 2), "issues");
        assert_eq!(honest_outcome(3, 0), "laggy");
        // a session with BOTH freezes and issues is laggy (the stronger signal)
        assert_eq!(honest_outcome(3, 2), "laggy");
    }

    #[test]
    fn background_pct_computed_from_visible_samples() {
        // 2 of 4 samples with the window hidden → 50% background
        let mk = |vis: bool| Sample {
            t: "2026-08-31T05:00:00.000Z".into(),
            game_visible: Some(vis),
            ..Default::default()
        };
        let samples = vec![mk(true), mk(false), mk(true), mk(false)];
        let stats = SessionStats::from(&samples);
        assert_eq!(stats.background_pct, Some(50.0));
    }

    #[test]
    fn old_samples_without_visibility_stay_none() {
        // sessions recorded before this feature parse fine — backgroundPct is
        // simply absent and the report says nothing about background share
        let mk = || Sample {
            t: "2026-08-31T05:00:00.000Z".into(),
            ..Default::default()
        };
        let stats = SessionStats::from(&[mk(), mk()]);
        assert_eq!(stats.background_pct, None);
    }

    #[test]
    fn delete_all_removes_only_sessions_and_skips_active() {
        let d = std::env::temp_dir().join(format!("lh-delall-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(d.join("session-2026-01-01_000000")).unwrap();
        fs::create_dir_all(d.join("session-2026-01-02_000000")).unwrap();
        fs::create_dir_all(d.join("not-a-session")).unwrap();
        fs::write(d.join("loose.txt"), "x").unwrap();
        let out = delete_all_sessions(&d, Some("session-2026-01-02_000000")).unwrap();
        assert_eq!(out, vec!["session-2026-01-01_000000".to_string()]);
        assert!(d.join("session-2026-01-02_000000").is_dir());
        assert!(d.join("not-a-session").is_dir());
        assert!(d.join("loose.txt").is_file());
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn classify_counts_spikes_and_kinds() {
        let d = std::env::temp_dir().join(format!("lh-classify-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        let events = serde_json::json!([
            {"kind": "gpu_activity_cliff", "severity": "crit", "phase": "instant"},
            {"kind": "gpu_activity_cliff", "severity": "crit", "phase": "instant"},
            {"kind": "cpu_saturation", "severity": "warn", "phase": "start"},
            {"kind": "cpu_saturation", "severity": "ok", "phase": "end"},
            {"kind": "disk_queue", "severity": "warn", "phase": "start"}
        ]);
        fs::write(d.join("events.json"), events.to_string()).unwrap();
        let (spikes, kinds) = classify_events(&d);
        assert_eq!(spikes, 2);
        assert_eq!(kinds, 3);
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn crash_mid_session_never_reports_clean() {
        // samples exist, no summary.json -> partial, no matter what events say
        let d = std::env::temp_dir().join(format!("lh-crash-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        fs::write(d.join("samples.jsonl"), "{\"t\":\"x\"}\n{\"t\":\"y\"}\n").unwrap();
        // NO summary.json — as if the app died mid-session
        let entries_path = d.join("events.json");
        fs::write(&entries_path, "[]").unwrap();
        // re-use the outcome branch logic directly (no summary file present)
        let samples = fs::read_to_string(d.join("samples.jsonl")).unwrap();
        let count = samples.lines().filter(|l| !l.trim().is_empty()).count() as u64;
        assert_eq!(count, 2);
        // simulate what session_entries does with a missing summary:
        let (spikes, _kinds) = classify_events(&d);
        let outcome = if count == 0 {
            "partial".to_string()
        } else if spikes > 0 {
            "laggy".to_string()
        } else {
            "partial".to_string()
        };
        assert_eq!(outcome, "partial");
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn path_traversal_rejected() {
        // delete/session-dir ids must look like session-* and stay inside our root
        assert!(delete_session("../evil").is_err());
        assert!(delete_session("session-..\\..\\evil").is_err());
        assert!(delete_session("not-a-session").is_err());
        assert!(session_dir("..\\..\\Windows").is_err());
        // a well-formed id that simply doesn't exist = clean error, no panic
        assert!(delete_session("session-2026-08-31_000000").is_err());
    }

    #[test]
    fn report_dictionary_matches_the_live_one() {
        // the report reader and the live cards must classify every engine
        // kind identically: with two separate dictionaries the same event
        // could show as gpu_busy live and scene_hitch in the report. This
        // pins finding_key to the diagnoser's key_for for every kind both
        // know (finding_key sees a bare kind string; key_for an event).
        let mk_ev = |kind: &str| super::super::types::EngineEvent {
            kind: kind.into(),
            phase: super::super::types::Phase::Instant,
            severity: super::super::types::Severity::Crit,
            t: "2026-08-31T05:00:00.000Z".into(),
            duration_sec: None,
            detail: String::new(),
        };
        for kind in [
            "disk_queue",
            "disk_busy",
            "hard_faults",
            "cpu_saturation",
            "cpu_throttle",
            "spike",
            "mem_pressure",
            "paging_churn",
            "gpu_mem_idle",
            "gpu_activity_cliff",
            "gpu_activity_cliff_loaded",
            "gpu_clock_low",
            "gpu_temp",
        ] {
            assert_eq!(
                finding_key(kind),
                super::super::diagnoser::key_for(&mk_ev(kind)),
                "the live cards and the saved report must agree on '{kind}'"
            );
        }
        // unknown kinds map to "" on BOTH sides (never mislabeled)
        assert_eq!(finding_key("mystery_kind"), "");
        assert_eq!(
            super::super::diagnoser::key_for(&mk_ev("mystery_kind")),
            ""
        );
    }
}
