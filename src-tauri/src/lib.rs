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
/// session and left the gate stuck).
#[tauri::command]
fn watch_gameloop(app: tauri::AppHandle) {
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
async fn top_processes(force: bool) -> Result<Vec<engine::system::TopProcess>, String> {
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
async fn system_checks() -> Result<engine::system::SystemChecks, String> {
    let _t = engine::logging::timed("ipc: system_checks");
    tauri::async_runtime::spawn_blocking(engine::system::system_checks_cached)
        .await
        .map_err(|e| format!("system checks task failed: {e}"))?
}

#[tauri::command]
async fn gameloop_status() -> Result<bool, String> {
    let _t = engine::logging::timed("ipc: gameloop_status");
    session::init_global();
    // tasklist spawn (~1s, ~5MB transient) — blocking pool
    let up = tauri::async_runtime::spawn_blocking(|| {
        engine::sampler::detect_emulator().is_some()
    })
    .await
    .map_err(|e| format!("gameloop status task failed: {e}"))?;
    Ok(up)
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
    let bounded = auto_stop_secs.unwrap_or(1800).clamp(60, MAX_SESSION_SECS);
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
    let app_guard = app.clone();
    std::thread::spawn(move || {
        let mut cycle: u32 = 0;
        while let Some(e) = session::global() {
            if !e.generation_is_current(gen) || e.status() != SessionStatus::Running {
                break;
            }
            e.probe_emulator();
            if cycle % 2 == 0 {
                e.probe_visibility();
            }
            cycle += 1;
            let alive = e.check_gameloop_alive();
            if !alive {
                let _ = push_state(&app_guard);
                break;
            }
            std::thread::sleep(Duration::from_secs(5));
        }
    });
    // auto-stop timer (same generation gate — only the current session's
    // timer can stop it; orphans exit on their first 1s tick)
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(1));
        let Some(e) = session::global() else { break };
        if !e.generation_is_current(gen) || e.status() != SessionStatus::Running {
            break;
        }
        if e.tick_auto_stop() {
            // stopped: push final state
            let _ = push_state(&app);
            break;
        }
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
    if let Some(_path) = report {
        // report path available via last session query if needed
    }
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
    tauri::async_runtime::spawn_blocking(engine::storage::session_entries)
        .await
        .unwrap_or_default()
}

#[tauri::command]
async fn load_report(id: String) -> Result<engine::storage::FriendlyReport, String> {
    let _t = engine::logging::timed("ipc: load_report");
    tauri::async_runtime::spawn_blocking(move || engine::storage::friendly_report(&id))
        .await
        .map_err(|e| format!("load report task failed: {e}"))?
}

#[tauri::command]
async fn delete_session(id: String) -> Result<(), String> {
    let _t = engine::logging::timed("ipc: delete_session");
    tauri::async_runtime::spawn_blocking(move || engine::storage::delete_session(&id))
        .await
        .map_err(|e| format!("delete task failed: {e}"))?
}

/// Delete every saved session except the live writer's directory (bulk
/// cleanup). The frontend passes the running session's id when one exists
/// and disables the button while running — both locks together.
#[tauri::command]
async fn delete_all_sessions(exclude_id: Option<String>) -> Result<Vec<String>, String> {
    let _t = engine::logging::timed("ipc: delete_all_sessions");
    tauri::async_runtime::spawn_blocking(move || {
        engine::storage::delete_all_sessions(&engine::storage::sessions_root(), exclude_id.as_deref())
    })
    .await
    .map_err(|e| format!("delete-all task failed: {e}"))?
}

#[tauri::command]
fn session_folder(id: &str) -> Result<String, String> {
    engine::storage::session_dir(id)
}

#[tauri::command]
async fn open_windows_panel(panel: String) -> Result<(), String> {
    let _t = engine::logging::timed("ipc: open_windows_panel");
    tauri::async_runtime::spawn_blocking(move || engine::system::open_windows_panel(&panel))
        .await
        .map_err(|e| format!("open panel task failed: {e}"))?
}

#[tauri::command]
fn get_settings() -> engine::settings::Settings {
    let mut s = engine::settings::load();
    // always hand back the bounded value
    s.auto_stop_minutes = engine::settings::clamp_auto_stop(s.auto_stop_minutes);
    s
}

#[tauri::command]
fn set_language(lang: String) -> Result<String, String> {
    let mut s = engine::settings::load();
    s.language = engine::settings::normalize_language(&lang);
    engine::settings::save(&s)?;
    Ok(s.language)
}

#[tauri::command]
fn set_sidebar_collapsed(collapsed: bool) -> Result<bool, String> {
    let mut s = engine::settings::load();
    s.sidebar_collapsed = collapsed;
    engine::settings::save(&s)?;
    Ok(s.sidebar_collapsed)
}

#[tauri::command]
fn finish_onboarding() -> Result<(), String> {
    let mut s = engine::settings::load();
    s.onboarding_done = true;
    engine::settings::save(&s)
}

/// Mark the pre-scan advice ("close background apps") as seen — it shows once
/// EVER, the first time the app confirms the game is running. The dismissal
/// itself is the user's click; this only records it.
#[tauri::command]
fn finish_game_advice() -> Result<(), String> {
    let mut s = engine::settings::load();
    s.game_advice_done = true;
    engine::settings::save(&s)
}

/// Mark the stay-in-game advice as seen — it shows once EVER, the first time
/// a running session measures the game window in the background.
#[tauri::command]
fn finish_background_advice() -> Result<(), String> {
    let mut s = engine::settings::load();
    s.background_advice_done = true;
    engine::settings::save(&s)
}

#[tauri::command]
fn set_auto_stop(minutes: u32) -> Result<u32, String> {
    let mut s = engine::settings::load();
    s.auto_stop_minutes = engine::settings::clamp_auto_stop(minutes);
    engine::settings::save(&s)?;
    Ok(s.auto_stop_minutes)
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
    let mut s = engine::settings::load();
    s.announced_update_version = Some(version);
    engine::settings::save(&s)
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
    // register the global cancel handle so app-exit / user-cancel can kill it
    engine::update::register_cancel(cancel.clone());
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
    .map_err(|e| format!("download task failed: {e}"))?;
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
    tauri::async_runtime::spawn_blocking(move || engine::update::open_folder_selected(&path))
        .await
        .map_err(|e| format!("open folder task failed: {e}"))?
}

#[tauri::command]
fn open_path(path: &str, app: tauri::AppHandle) -> Result<(), String> {
    // open files/folders with the shell default handler — via the official plugin.
    // NEVER build shell strings ourselves: no cmd /C, no injection surface.
    // Scope: only paths inside our own app-data sessions folder ever reach here
    // (session dirs + report.md files). Everything else is refused.
    let allowed_root = engine::storage::sessions_root();
    let target = std::path::Path::new(path);
    let canonical = target
        .canonicalize()
        .map_err(|e| format!("path not found: {e}"))?;
    let canonical_root = allowed_root
        .canonicalize()
        .unwrap_or_else(|_| allowed_root.clone());
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
            get_settings,
            set_language,
            set_sidebar_collapsed,
            finish_onboarding,
            finish_game_advice,
            finish_background_advice,
            gameloop_status,
            ps_available,
            watch_gameloop,
            system_info,
            top_processes,
            system_checks,
            open_windows_panel,
            set_auto_stop,
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

            // fixed-size window: show once, centered — no resize flash possible
            if let Some(win) = _app.get_webview_window("main") {
                let _ = win.center();
                let _ = win.show();
                let _ = win.set_focus();
            }
            engine::logging::perf("window shown", boot.elapsed().as_millis());

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
                engine::logging::info(&format!(
                    "app ready in {}ms",
                    boot.elapsed().as_millis()
                ));
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
