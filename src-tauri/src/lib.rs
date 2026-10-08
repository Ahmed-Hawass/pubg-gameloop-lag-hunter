// lib.rs — Tauri app shell: commands (UI → engine) and events (engine → UI).
// The UI is a dumb display: it sends commands and receives pushes. No logic.

pub mod engine;

use std::time::Duration;

use engine::session::{self, Engine};
use engine::types::{SessionStatus, StopReason, UiState};

#[derive(serde::Serialize, Clone)]
struct StatusPayload {
    status: SessionStatus,
    ui: Option<UiState>,
    /// why the last session ended — the UI explains instead of staying silent
    #[serde(skip_serializing_if = "Option::is_none")]
    stop_reason: Option<StopReason>,
}

/// Hard cap on auto-stop duration: no session may run forever (forgotten scans
/// would keep typeperf + dmon running and writing to disk indefinitely).
const MAX_SESSION_SECS: u64 = 60 * 60; // 1 hour (the longest UI choice)

/// Is PowerShell usable? (UI shows the limited-mode banner when false.)
#[tauri::command]
fn ps_available() -> bool {
    engine::system::powershell_available()
}

/// Idle watcher: polls for GameLoop so the UI's Start button reflects reality.
/// NEVER exits on its own — after a session stops it keeps watching, so the
/// button state can never go stale (the old version died after the first
/// session and left the gate stuck). Spawned ONCE per process: a second
/// invocation (StrictMode double-mount, any re-call) would stack a second
/// never-exiting thread next to the first.
#[tauri::command]
fn watch_gameloop(app: tauri::AppHandle) {
    static SPAWNED: std::sync::Once = std::sync::Once::new();
    SPAWNED.call_once(|| {
        std::thread::spawn(move || {
            use tauri::Emitter;
            let mut last: Option<bool> = None;
            loop {
                let Some(eng) = session::global() else {
                    std::thread::sleep(Duration::from_secs(2));
                    continue;
                };
                // while a session runs, its own probe is the source of truth —
                // skip here, but remember "up" so the next idle check diffs cleanly
                if eng.status() == SessionStatus::Running {
                    last = Some(true);
                    std::thread::sleep(Duration::from_secs(5));
                    continue;
                }
                let up = engine::sampler::detect_emulator().is_some();
                // emit on CHANGE only (and on the very first check)
                if last.is_none() || last != Some(up) {
                    let _ = app.emit("engine://gameloop", up);
                    last = Some(up);
                }
                std::thread::sleep(Duration::from_secs(3));
            }
        });
    });
}

// ---- system tabs (read-only queries) --------------------------------------
// Every command that can take longer than a few milliseconds is ASYNC: Tauri
// runs sync commands on the IPC dispatcher thread — one slow command froze
// the whole window ("Not Responding") on HDD machines. Async commands run on
// the async runtime; the UI stays alive no matter how slow the query.

#[tauri::command]
async fn system_info() -> Result<engine::system::SystemInfo, String> {
    let _t = engine::logging::timed("ipc: system_info");
    engine::system::system_info_async().await
}

#[tauri::command]
async fn top_processes(force: bool) -> Result<engine::system::TopProcesses, String> {
    let _t = engine::logging::timed("ipc: top_processes");
    // first call on a run pays a PowerShell spawn — blocking pool, never the
    // async runtime. force=true (manual refresh button) pays it every time
    // and warms the cache; the silent poll keeps using the cached path.
    if force {
        tauri::async_runtime::spawn_blocking(engine::system::top_processes_fresh)
            .await
            .map_err(|e| format!("top processes task failed: {e}"))?
    } else {
        tauri::async_runtime::spawn_blocking(engine::system::top_processes_cached)
            .await
            .map_err(|e| format!("top processes task failed: {e}"))?
    }
}

#[tauri::command]
async fn system_checks(force: bool) -> Result<engine::system::SystemChecks, String> {
    let _t = engine::logging::timed("ipc: system_checks");
    // same contract as top_processes: force=true (manual refresh button)
    // pays a fresh PowerShell spawn and warms the cache; the silent poll
    // keeps using the cached path.
    if force {
        tauri::async_runtime::spawn_blocking(engine::system::system_checks_fresh)
            .await
            .map_err(|e| format!("system checks task failed: {e}"))?
    } else {
        tauri::async_runtime::spawn_blocking(engine::system::system_checks_cached)
            .await
            .map_err(|e| format!("system checks task failed: {e}"))?
    }
}

/// End one app group by PIDs (Processes tab action): instant
/// TerminateProcess per member plus a 2s re-read verify each — blocking
/// pool like every other slow path. A denied member refuses honestly
/// (no silent elevation); only real failures after attempts are logged
/// like every command failure.
#[tauri::command]
async fn end_processes(pids: Vec<u32>) -> Result<(), String> {
    let _t = engine::logging::timed("ipc: end_processes");
    let res = tauri::async_runtime::spawn_blocking(move || engine::prockill::end_processes(&pids))
        .await
        .map_err(|e| format!("end process task failed: {e}"))
        .and_then(|r| r);
    // "cancelled" has no meaning here (no UAC in this path): every Err
    // is a real outcome worth one log line for user reports.
    log_err("end_processes", &res);
    res
}

/// Real program icons for PIDs (Processes tab artwork): one native
/// extraction per unique exe path, cached by path — the poll never
/// extracts, the UI asks only for new PIDs. Misses stay absent (the UI
/// keeps the glyph); small, fast, blocking pool like every probe.
#[tauri::command]
async fn process_icons(pids: Vec<u32>) -> Vec<engine::icons::ProcessIcon> {
    let _t = engine::logging::timed("ipc: process_icons");
    tauri::async_runtime::spawn_blocking(move || engine::icons::process_icons(&pids))
        .await
        .unwrap_or_default()
}

/// The Tools tab's switches, live from the registry (microseconds,
/// in-process — no PowerShell spawn). SYNC by the codebase's own rule:
/// only commands slower than a few milliseconds go async. The full
/// system_checks batch costs 0.5–2s and the Tools page displays none of
/// its rows; this command reads only what the switches mirror.
#[tauri::command]
fn tweak_states() -> engine::system::TweakStates {
    engine::system::query_tweak_states()
}

#[tauri::command]
async fn set_tweak(id: String, value: u32) -> Result<engine::tweaks::TweakResult, String> {
    let _t = engine::logging::timed("ipc: set_tweak");
    // a registry write must never stall the UI: blocking pool like the rest
    let res = tauri::async_runtime::spawn_blocking(move || engine::tweaks::set_tweak(&id, value))
        .await
        .map_err(|e| format!("set tweak task failed: {e}"));
    log_err("set_tweak", &res);
    res?
}

/// The Virtual Memory-style editor's single read: the global automatic
/// flag plus one live state per fixed drive. SYNC like tweak_states
/// (registry + two native calls, microseconds, in-process).
#[tauri::command]
fn pagefile_settings() -> Result<engine::system::PagefileSettings, String> {
    engine::system::pagefile_settings()
}

/// Validate-only entry for the editor's confirm step: the same keys as
/// the write path, plus the pre-write warning ("off" | "small" | null).
/// SYNC (two fresh reads at most, no spawn, no writes).
#[tauri::command]
fn validate_pagefile_settings(
    automatic: bool,
    drive: String,
    mode: String,
    min_mb: String,
    max_mb: String,
) -> Result<Option<String>, String> {
    engine::tweaks::validate_pagefile_settings(automatic, &drive, &mode, &min_mb, &max_mb)
}

/// Apply the editor's request (dedicated command: a mode is data, never
/// a 0/1 tweak). Same blocking-pool + error-log discipline as set_tweak.
#[tauri::command]
async fn apply_pagefile_settings(
    automatic: bool,
    drive: String,
    mode: String,
    min_mb: String,
    max_mb: String,
) -> Result<engine::tweaks::TweakResult, String> {
    let _t = engine::logging::timed("ipc: apply_pagefile_settings");
    let res = tauri::async_runtime::spawn_blocking(move || {
        engine::tweaks::set_pagefile_settings_parent(automatic, &drive, &mode, &min_mb, &max_mb)
    })
    .await
    .map_err(|e| format!("set pagefile task failed: {e}"));
    log_err("apply_pagefile_settings", &res);
    res?
}

/// Storage sweep scan: measures the three quick places (user temp, system
/// temp, delivery cache) plus the sweep memory. Recycle Bin is deep-only
/// because cleaning it is permanent. Read-only.
/// Async: dir walks can take seconds on bloated temp folders — never the
/// IPC thread. Progress rides the channel (one event per category step);
/// the final answer is the command's own return.
#[tauri::command]
async fn storage_scan(
    on_event: tauri::ipc::Channel<engine::cleanup::CleanupProgress>,
) -> engine::cleanup::CleanupScan {
    let _t = engine::logging::timed("ipc: storage_scan");
    match tauri::async_runtime::spawn_blocking(move || {
        engine::cleanup::scan_with(|index, total, id| {
            let _ = on_event.send(engine::cleanup::CleanupProgress::Category {
                id: id.to_string(),
                index,
                total,
            });
        })
    })
    .await
    {
        Ok(scan) => {
            // success line for user reports: measured bytes per place
            // (numbers only, never names or paths)
            let sizes: Vec<String> = scan
                .categories
                .iter()
                .map(|c| {
                    format!(
                        "{}={}",
                        c.id,
                        c.bytes.map(|b| b.to_string()).unwrap_or_else(|| "-".into())
                    )
                })
                .collect();
            engine::logging::info(&format!("storage scan: {}", sizes.join(" ")));
            scan
        }
        Err(e) => {
            engine::logging::warn(&format!("storage_scan task failed: {e}"));
            engine::cleanup::scan()
        }
    }
}

/// Storage deep scan: the three opt-in places (thumbnail previews,
/// finished error reports, stale crash dumps) plus the shared sweep
/// memory. Same shape and contract as storage_scan: read-only, blocking
/// pool, per-category progress over the channel.
#[tauri::command]
async fn storage_deep_scan(
    on_event: tauri::ipc::Channel<engine::cleanup::CleanupProgress>,
) -> engine::cleanup::CleanupScan {
    let _t = engine::logging::timed("ipc: storage_deep_scan");
    match tauri::async_runtime::spawn_blocking(move || {
        engine::cleanup::deep_scan_with(|index, total, id| {
            let _ = on_event.send(engine::cleanup::CleanupProgress::Category {
                id: id.to_string(),
                index,
                total,
            });
        })
    })
    .await
    {
        Ok(scan) => {
            let sizes: Vec<String> = scan
                .categories
                .iter()
                .map(|c| {
                    format!(
                        "{}={}",
                        c.id,
                        c.bytes.map(|b| b.to_string()).unwrap_or_else(|| "-".into())
                    )
                })
                .collect();
            engine::logging::info(&format!("storage deep scan: {}", sizes.join(" ")));
            scan
        }
        Err(e) => {
            engine::logging::warn(&format!("storage_deep_scan task failed: {e}"));
            engine::cleanup::deep_scan_with(|_, _, _| {})
        }
    }
}

/// Storage sweep clean: deletes only the ticked categories and reports
/// measured freed bytes per category. A denied UAC is "cancelled"
/// (quiet, like every other refusal); anything else is logged before it
/// reaches the UI. Progress rides the channel like the scan.
#[tauri::command]
async fn storage_clean(
    categories: Vec<String>,
    on_event: tauri::ipc::Channel<engine::cleanup::CleanupProgress>,
) -> Result<Vec<engine::cleanup::CleanupResult>, String> {
    let _t = engine::logging::timed("ipc: storage_clean");
    let res = tauri::async_runtime::spawn_blocking(move || {
        engine::cleanup::clean_selected_with(&categories, |index, total, id| {
            let _ = on_event.send(engine::cleanup::CleanupProgress::Category {
                id: id.to_string(),
                index,
                total,
            });
        })
    })
    .await
    .map_err(|e| format!("clean task failed: {e}"))
    .and_then(|r| r);
    match &res {
        // success line for user reports: what ran and what it measured
        // (ids + bytes only, never names or paths)
        Ok(results) => {
            // unknown verdicts log as "-" (a 0 here would rewrite history:
            // "freed nothing" is a different fact from "could not measure")
            let freed: Vec<String> = results
                .iter()
                .map(|r| {
                    format!(
                        "{}={}",
                        r.id,
                        r.freed_bytes
                            .map(|b| b.to_string())
                            .unwrap_or_else(|| "-".into())
                    )
                })
                .collect();
            engine::logging::info(&format!("storage clean: {}", freed.join(" ")));
        }
        Err(e) => {
            if e != "cancelled" {
                engine::logging::warn(&format!("ipc storage_clean failed: {e}"));
            }
        }
    }
    res
}

/// Sweep memory read, no scan: the persisted last-run + last-30-days
/// totals for the Tools landing card and the sweep page. A small jsonl
/// read, never a disk walk, so it stays free to call (scanning itself
/// stays user-triggered, like every other measuring read).
#[tauri::command]
fn cleanup_history() -> engine::cleanup::CleanupHistory {
    let _t = engine::logging::timed("ipc: cleanup_history");
    engine::cleanup::history_totals()
}

/// Clock convention read, no scan: whether this machine's clock runs
/// 12-hour (from the OS time format itself, never the app language).
/// A registry read, so the UI calls it once and caches it per launch.
#[tauri::command]
fn clock_hour12() -> bool {
    engine::system::clock_uses_12h()
}

/// Immediate reboot for applying page file changes (the confirm dialog
/// in Tools is the only caller; a refused UAC stays quiet like every
/// other cancellation).
#[tauri::command]
async fn schedule_reboot() -> Result<(), String> {
    let _t = engine::logging::timed("ipc: schedule_reboot");
    let res = tauri::async_runtime::spawn_blocking(engine::elevate::request_reboot)
        .await
        .map_err(|e| format!("reboot task failed: {e}"));
    log_err("schedule_reboot", &res);
    res?
}

#[tauri::command]
async fn session_start(
    app: tauri::AppHandle,
    auto_stop_secs: Option<u64>,
) -> Result<StatusPayload, String> {
    let _t = engine::logging::timed("ipc: session_start");
    // start() runs PowerShell probes (RAM/disks on cache miss, visibility,
    // gpu clocks) + creates the session files — all blocking, all parked on
    // the blocking pool so the async runtime (and the UI) never stall
    // No explicit duration (headless callers) falls back to the USER's own
    // default from settings — never a second hardcoded number that can
    // drift from the 5-minute default the UI offers.
    let user_default =
        (engine::settings::load().auto_stop_minutes as u64 * 60).clamp(60, MAX_SESSION_SECS);
    let bounded = auto_stop_secs
        .unwrap_or(user_default)
        .clamp(60, MAX_SESSION_SECS);
    let eng = session::init_global();
    let gen = tauri::async_runtime::spawn_blocking(move || {
        // probe BEFORE starting: if the game is already open, the first
        // sample knows it
        eng.probe_emulator();
        eng.start(Some(bounded))
    })
    .await
    .map_err(|e| format!("session start task failed: {e}"))??;
    // emulator probe + liveness guard + window-visibility probe: every ~5s
    // while running. If GameLoop dies mid-session, 3 consecutive misses
    // (~15s) stop the scan. The visibility probe (a transient PowerShell call)
    // runs every OTHER cycle (~10s staleness) — GPU attribution never gets
    // stale enough to misread desktop activity as in-game.
    // Generation-gated: a quick restart spawns a new guard; THIS one notices
    // it's superseded and exits instead of running in parallel with it.
    // Shared starter (engine::session): the headless bins run the same
    // guards instead of a private copy that would rot.
    let app_guard = app.clone();
    session::spawn_session_guards(gen, move || {
        let _ = push_state(&app_guard);
    });
    Ok(current_status(eng))
}

#[tauri::command]
async fn session_stop(app: tauri::AppHandle) -> Result<StatusPayload, String> {
    let _t = engine::logging::timed_with("ipc: session_stop", 3_000);
    // the stop path sleeps 600ms + reads the whole samples file back from
    // disk — genuinely blocking work, parked on the blocking pool so the
    // async runtime never stalls (the UI keeps breathing meanwhile)
    let eng = session::init_global();
    let report = tauri::async_runtime::spawn_blocking(move || eng.stop())
        .await
        .map_err(|e| format!("stop task failed: {e}"))??;
    if report.is_none() && session::init_global().status() == SessionStatus::Finished {
        return Err("SESSION_SAVE_FAILED".into());
    }
    // the report path is intentionally unread here: the UI loads the
    // finished session's report via load_report when the user opens it
    let _ = push_state(&app);
    Ok(current_status(session::init_global()))
}

#[tauri::command]
fn get_state() -> StatusPayload {
    let eng = session::init_global();
    current_status(eng)
}

#[tauri::command]
async fn session_entries() -> Vec<engine::storage::SessionEntry> {
    let _t = engine::logging::timed("ipc: session_entries");
    // hide the live session by the ENGINE's own id — it is the writer,
    // it knows what is being written right now (belt and suspenders over
    // the old file-age heuristic that broke at the first autosave)
    let live = session::init_global().live_session_id();
    // a JoinError here means the blocking task itself panicked — THAT must
    // never surface as a silent "no sessions" list; log it loudly and only
    // then fall back to empty
    match tauri::async_runtime::spawn_blocking(move || {
        engine::storage::session_entries(live.as_deref())
    })
    .await
    {
        Ok(entries) => entries,
        Err(e) => {
            engine::logging::warn(&format!("session_entries task failed: {e}"));
            Vec::new()
        }
    }
}

#[tauri::command]
async fn load_report(id: String) -> Result<engine::storage::FriendlyReport, String> {
    let _t = engine::logging::timed("ipc: load_report");
    let res = tauri::async_runtime::spawn_blocking(move || engine::storage::friendly_report(&id))
        .await
        .map_err(|e| format!("load report task failed: {e}"));
    log_err("load_report", &res);
    res?
}

#[tauri::command]
async fn delete_session(id: String) -> Result<(), String> {
    let _t = engine::logging::timed("ipc: delete_session");
    let res = tauri::async_runtime::spawn_blocking(move || {
        session::init_global().delete_session_guarded(&id)
    })
    .await
    .map_err(|e| format!("delete task failed: {e}"));
    log_err("delete_session", &res);
    res?
}

/// Delete every saved session except the live writer's directory (bulk
/// cleanup). The ENGINE excludes the live session itself — the UI's
/// exclude_id is honored as an EXTRA, but the running session can never be
/// deleted even if the frontend passes nothing or the wrong id (a second
/// lock the frontend can't lose). The engine serializes this against
/// session start, so a session born mid-delete cannot slip into the walk.
#[tauri::command]
async fn delete_all_sessions(exclude_id: Option<String>) -> Result<Vec<String>, String> {
    let _t = engine::logging::timed("ipc: delete_all_sessions");
    let res = tauri::async_runtime::spawn_blocking(move || {
        session::init_global().delete_all_sessions_guarded(exclude_id.as_deref())
    })
    .await
    .map_err(|e| format!("delete-all task failed: {e}"));
    log_err("delete_all_sessions", &res);
    res?
}

/// Log every command failure before it travels back to the UI: a failure
/// the user SAW but the log never recorded is a failure we cannot debug
/// from a user-sent log file (the open_path os-error-2 case shipped for
/// weeks before anyone noticed it was invisible in the log).
fn log_err<T>(cmd: &str, res: &Result<T, String>) {
    if let Err(e) = res {
        engine::logging::warn(&format!("ipc {cmd} failed: {e}"));
    }
}

#[tauri::command]
fn session_folder(id: &str) -> Result<String, String> {
    let res = engine::storage::session_dir(id);
    log_err("session_folder", &res);
    res
}

/// The sessions root itself (the Reports tab's "Open sessions folder").
/// The ENGINE owns the path — the UI never derives it by string surgery
/// on a session path (which assumed a flat layout and would silently
/// open the wrong folder the day the layout nests).
#[tauri::command]
fn sessions_root() -> String {
    engine::storage::sessions_root()
        .to_string_lossy()
        .to_string()
}

#[tauri::command]
async fn open_windows_panel(panel: String) -> Result<(), String> {
    let _t = engine::logging::timed("ipc: open_windows_panel");
    let res =
        tauri::async_runtime::spawn_blocking(move || engine::system::open_windows_panel(&panel))
            .await
            .map_err(|e| format!("open panel task failed: {e}"));
    log_err("open_windows_panel", &res);
    res?
}

#[tauri::command]
fn get_settings() -> engine::settings::Settings {
    let mut s = engine::settings::load();
    // always hand back the bounded value
    s.auto_stop_minutes = engine::settings::clamp_auto_stop(s.auto_stop_minutes);
    s.ui_zoom_pct = engine::settings::clamp_ui_zoom(s.ui_zoom_pct);
    s
}

#[tauri::command]
fn set_language(lang: String) -> Result<String, String> {
    // update() serializes the read-modify-write: concurrent set_* commands
    // used to race on load→mutate→save and lose each other's changes
    engine::settings::update(|s| {
        s.language = engine::settings::normalize_language(&lang);
        s.language.clone()
    })
}

#[tauri::command]
fn set_theme(theme: String) -> Result<String, String> {
    engine::settings::update(|s| {
        s.theme = engine::settings::normalize_theme(&theme);
        s.theme.clone()
    })
}

#[tauri::command]
fn set_sidebar_collapsed(collapsed: bool) -> Result<bool, String> {
    engine::settings::update(|s| {
        s.sidebar_collapsed = collapsed;
        s.sidebar_collapsed
    })
}

#[tauri::command]
fn finish_onboarding() -> Result<(), String> {
    engine::settings::update(|s| {
        s.onboarding_done = true;
    })
}

/// Mark the pre-scan advice ("close background apps") as seen — it shows once
/// EVER, the first time the app confirms the game is running. The dismissal
/// itself is the user's click; this only records it.
#[tauri::command]
fn finish_game_advice() -> Result<(), String> {
    engine::settings::update(|s| {
        s.game_advice_done = true;
    })
}

/// Mark the stay-in-game advice as seen — it shows once EVER, the first time
/// a running session measures the game window in the background.
#[tauri::command]
fn finish_background_advice() -> Result<(), String> {
    engine::settings::update(|s| {
        s.background_advice_done = true;
    })
}

/// Mark a one-shot page card dismissed — it never shows again on this
/// machine. Recorded at dismiss time (the X click itself), never at show
/// time: unlike the advice modals (any click dismisses), a card must
/// survive until the user explicitly closes it. A repeated id is a
/// no-op, never a duplicate row.
#[tauri::command]
fn dismiss_intro_card(id: String) -> Result<(), String> {
    engine::settings::update(|s| {
        engine::settings::note_dismissed_cards(&mut s.dismissed_cards, &id);
    })
}

/// Empty the dismissed intro cards list: every one-shot page card shows
/// again on its next visit. The reset itself is the user's click; this
/// only records it, through the same serialized update as every write.
#[tauri::command]
fn reset_intro_cards() -> Result<(), String> {
    engine::settings::update(|s| {
        s.dismissed_cards.clear();
    })
}

#[tauri::command]
fn set_auto_stop(minutes: u32) -> Result<u32, String> {
    engine::settings::update(|s| {
        s.auto_stop_minutes = engine::settings::clamp_auto_stop(minutes);
        s.auto_stop_minutes
    })
}

/// Persist the UI zoom level in percent. The UI snaps to its own fixed
/// levels before sending; the engine only guards the range and hands
/// the stored value back, like every other set_* command.
#[tauri::command]
fn set_ui_zoom(pct: u32) -> Result<u32, String> {
    engine::settings::update(|s| {
        s.ui_zoom_pct = engine::settings::clamp_ui_zoom(pct);
        s.ui_zoom_pct
    })
}

/// Persist the show-unsupported-rows preference (Tools reveals rows the
/// machine cannot run, greyed with their translated reason).
#[tauri::command]
fn set_show_unsupported(show: bool) -> Result<bool, String> {
    engine::settings::update(|s| {
        s.show_unsupported = show;
        s.show_unsupported
    })
}

// ---- update flow (see engine/update.rs for the scope contract) ----------
// check at boot + manual check from About; download only ever starts from
// an explicit user click; verification against SHA256SUMS is mandatory.

/// Ask GitHub whether a newer release exists. Ok(None) = nothing newer.
/// The IPC thread never blocks — the HTTP call is parked on the blocking
/// pool (GitHub latency, offline machines, proxy timeouts).
#[tauri::command]
async fn check_update() -> Result<Option<engine::update::UpdateInfo>, String> {
    let _t = engine::logging::timed("ipc: check_update");
    let local = engine::VERSION.to_string();
    tauri::async_runtime::spawn_blocking(move || engine::update::check_latest(&local))
        .await
        .map_err(|e| format!("check failed: {e}"))
}

/// Was this version's modal already announced once? (once-per-version rule)
#[tauri::command]
fn update_already_announced(version: String) -> bool {
    engine::settings::load()
        .announced_update_version
        .as_deref()
        .map(|v| v.eq_ignore_ascii_case(&version))
        .unwrap_or(false)
}

/// Mark a version as announced (called when the modal is SHOWN).
#[tauri::command]
fn announce_update(version: String) -> Result<(), String> {
    engine::settings::update(|s| {
        s.announced_update_version = Some(version);
    })
}

/// Download the update to `dest`, streaming progress over `on_event`.
/// The channel carries Progress events; the final result arrives as the
/// command's own return (Ok(path) / Err(reason)) — the UI updates its
/// modal from both.
#[tauri::command]
async fn download_update(
    info: engine::update::UpdateInfo,
    dest: String,
    on_event: tauri::ipc::Channel<engine::update::DownloadEvent>,
) -> Result<String, String> {
    let _t = engine::logging::timed_with("ipc: download_update", 10_000);
    let cancel = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    // register the global cancel handle so app-exit / user-cancel can kill
    // it — refused while another download is live (engine-side single-flight)
    engine::update::register_cancel(cancel.clone())?;
    let info = std::sync::Arc::new(info);
    let res = tauri::async_runtime::spawn_blocking(move || {
        engine::update::download_and_verify(&info, std::path::PathBuf::from(dest), &cancel, {
            let on_event = on_event.clone();
            move |ev| {
                let _ = on_event.send(ev);
            }
        })
    })
    .await
    .map_err(|e| format!("download task failed: {e}"))
    .and_then(|r| r);
    // a non-"cancelled" failure is LOGGED (a cancel is a user choice, not
    // a failure worth a warn line)
    if let Err(e) = &res {
        if e != "cancelled" {
            engine::logging::warn(&format!("ipc download_update failed: {e}"));
        }
    }
    if res.is_err() {
        // cancelled or failed — make sure no partial file survives
        engine::update::cleanup_active_download();
    }
    res
}

/// Cancel the running download (the modal's cancel button / app exit).
#[tauri::command]
fn cancel_update_download() {
    engine::update::cancel_active();
}

/// Open Explorer with the downloaded file selected (the success state).
#[tauri::command]
async fn open_download_folder(path: String) -> Result<(), String> {
    let _t = engine::logging::timed("ipc: open_download_folder");
    let res =
        tauri::async_runtime::spawn_blocking(move || engine::update::open_folder_selected(&path))
            .await
            .map_err(|e| format!("open folder task failed: {e}"));
    log_err("open_download_folder", &res);
    res?
}

#[tauri::command]
fn open_path(path: &str, app: tauri::AppHandle) -> Result<(), String> {
    // open files/folders with the shell default handler — via the official plugin.
    // NEVER build shell strings ourselves: no cmd /C, no injection surface.
    // Scope: only paths inside our own app-data sessions folder ever reach here
    // (session dirs + report.md files). Everything else is refused.
    // Every refusal/error is LOGGED: the user saw a dialog, the log must show
    // why (a failure that only lives in the UI is a failure we cannot debug
    // from a user-sent log file).
    let res = open_path_inner(path, &app);
    if let Err(e) = &res {
        engine::logging::warn(&format!("open_path '{path}' refused: {e}"));
    }
    res
}

fn open_path_inner(path: &str, app: &tauri::AppHandle) -> Result<(), String> {
    let allowed_root = engine::storage::sessions_root();
    let target = std::path::Path::new(path);
    let canonical = target
        .canonicalize()
        .map_err(|e| format!("path not found: {e}"))?;
    let canonical_root = allowed_root
        .canonicalize()
        .map_err(|e| format!("app data unavailable: {e}"))?;
    if !canonical.starts_with(&canonical_root) {
        return Err("path is outside the app data folder".into());
    }
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_path(canonical.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| format!("cannot open: {e}"))
}

/// App version from the single source of truth (tauri.conf.json → Cargo.toml
/// stays in sync with it via tauri-build). The UI asks us — never hardcodes.
#[tauri::command]
fn get_version() -> String {
    engine::VERSION.to_string()
}

/// Hosts we ever open in the system browser. This is the REAL enforcement
/// (checked here in Rust, before anything reaches the opener plugin) —
/// plugin capabilities only guard the JS-side command path, while this
/// command is invoked from our own frontend anyway. Anything outside
/// these hosts is refused, end of story.
const OPEN_URL_ALLOWED_HOSTS: [&str; 3] = ["github.com", "api.github.com", "paypal.me"];

#[tauri::command]
fn open_url(url: &str, app: tauri::AppHandle) -> Result<(), String> {
    // open external links (repo, support, releases) in the system browser.
    // Enforced allowlist: same hosts the capability file lists, verified on
    // OUR side (Rust) because plugin capabilities only scope the JS command
    // path — a Rust-side opener call is NOT constrained by them.
    // Refusals are logged like every other command failure.
    let res = open_url_inner(url, &app);
    if let Err(e) = &res {
        engine::logging::warn(&format!("open_url '{url}' refused: {e}"));
    }
    res
}

fn open_url_inner(url: &str, app: &tauri::AppHandle) -> Result<(), String> {
    let parsed = url
        .parse::<tauri::Url>()
        .map_err(|_| format!("invalid url: {url}"))?;
    let scheme = parsed.scheme();
    if scheme != "https" || !OPEN_URL_ALLOWED_HOSTS.contains(&parsed.host_str().unwrap_or("")) {
        return Err(format!("url not allowed: {url}"));
    }
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(url.to_string(), None::<&str>)
        .map_err(|e| format!("cannot open url: {e}"))
}

fn current_status(eng: &Engine) -> StatusPayload {
    StatusPayload {
        status: eng.status(),
        ui: eng.last_ui(),
        stop_reason: eng.stop_reason(),
    }
}

fn push_state(app: &tauri::AppHandle) -> Result<(), tauri::Error> {
    let eng = session::init_global();
    let payload = current_status(eng);
    use tauri::Emitter;
    app.emit("engine://state", payload)
}

/// Background pusher: while running, emit state ~1/sec (event = UI update beat).
/// Never exits: global engine may not exist yet at startup (created on first command).
fn spawn_state_pusher(app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        let Some(eng) = session::global() else {
            std::thread::sleep(Duration::from_secs(1));
            continue;
        };
        let status = eng.status();
        if status == SessionStatus::Running {
            let _ = push_state(&app);
            std::thread::sleep(Duration::from_secs(1));
        } else {
            std::thread::sleep(Duration::from_secs(2));
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // the panic hook runs FIRST: with panic="abort" this is the one chance
    // to record why the app died on a user's machine. Installed before any
    // thread exists so nothing can panic before it's armed.
    engine::logging::init_panic_hook();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // native save dialog for the update download (official plugin —
        // never hand-rolled Win32 FFI, per the user32 lesson in sampler.rs)
        .plugin(tauri_plugin_dialog::init())
        // ONE instance only: a second launch focuses the existing window and exits.
        // Two instances would race over the same sessions folder (same-second ids collide).
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            use tauri::Manager;
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.set_focus();
            }
        }))
        .invoke_handler(tauri::generate_handler![
            session_start,
            session_stop,
            get_state,
            session_entries,
            load_report,
            delete_session,
            delete_all_sessions,
            session_folder,
            sessions_root,
            get_settings,
            set_language,
            set_theme,
            set_sidebar_collapsed,
            finish_onboarding,
            finish_game_advice,
            finish_background_advice,
            dismiss_intro_card,
            reset_intro_cards,
            ps_available,
            watch_gameloop,
            system_info,
            top_processes,
            end_processes,
            process_icons,
            system_checks,
            tweak_states,
            set_tweak,
            pagefile_settings,
            validate_pagefile_settings,
            apply_pagefile_settings,
            storage_scan,
            storage_deep_scan,
            storage_clean,
            cleanup_history,
            clock_hour12,
            schedule_reboot,
            open_windows_panel,
            set_auto_stop,
            set_ui_zoom,
            set_show_unsupported,
            open_path,
            open_url,
            get_version,
            check_update,
            update_already_announced,
            announce_update,
            download_update,
            cancel_update_download,
            open_download_folder,
        ])
        .on_window_event(|window, event| {
            // graceful exit: a running session finalizes its files before the app dies
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                // an in-flight update download is cancelled and its partial
                // file removed — nothing half-written outlives the app
                engine::update::cancel_active();
                if let Some(eng) = session::global() {
                    eng.request_shutdown();
                    if eng.status() == engine::types::SessionStatus::Running {
                        let _ = eng.stop();
                    }
                }
                let _ = window; // silence unused in non-windows builds
            }
        })
        .setup(|_app| {
            use tauri::Manager;
            // boot timing: the whole freeze investigation starts here —
            // "app ready in Xms" tells us at a glance whether a machine
            // had a slow launch, before reading anything else
            let boot = std::time::Instant::now();

            // rotate the technical log once per launch (7-day retention)
            engine::logging::cleanup_old_logs();
            engine::logging::info("app starting");
            engine::logging::info(&format!("app version: {}", engine::VERSION));
            // the sessions root is born with the first session otherwise;
            // make sure it exists from boot (cheap mkdir, idempotent)
            engine::storage::ensure_sessions_root();

            // fixed-size window: center it, but do NOT show it yet — the
            // frontend reveals the window itself on first paint (see
            // main.tsx). Showing here would put a dark empty window on
            // screen while the bundle parses and the IPC gates resolve.
            if let Some(win) = _app.get_webview_window("main") {
                let _ = win.center();
                let _ = win.set_focus();
            }
            engine::logging::perf(
                "window centered (show is frontend-driven)",
                boot.elapsed().as_millis(),
            );

            // Safety net for the frontend-driven show: if the UI never
            // reports first paint (a crash before React mounts), the window
            // would stay invisible forever — worse than the old dark void.
            // show() is idempotent, so a late safety net never harms a
            // window the frontend already revealed.
            let guard = _app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(8));
                use tauri::Manager;
                if let Some(win) = guard.get_webview_window("main") {
                    let _ = win.show();
                }
            });

            let handle = _app.handle().clone();
            spawn_state_pusher(handle);

            // Warm the system caches ASYNC (never on the setup thread):
            // rig info on a first machine run pays the PowerShell hardware
            // inventory (Get-PhysicalDisk: 20+s on HDD machines — the original
            // "Not Responding" bug). The async runtime keeps the UI alive
            // while it happens; afterwards the result lives in the disk
            // cache and every later launch reads it in microseconds.
            tauri::async_runtime::spawn(async move {
                engine::system::warm_system_caches().await;
                engine::logging::info(&format!("app ready in {}ms", boot.elapsed().as_millis()));
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
