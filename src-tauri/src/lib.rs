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

#[tauri::command]
fn session_start(
    app: tauri::AppHandle,
    auto_stop_secs: Option<u64>,
) -> Result<StatusPayload, String> {
    let eng = session::init_global();
    // always bound the session — default 30 min, clamped to [60s, MAX_SESSION_SECS]
    let bounded = auto_stop_secs.unwrap_or(1800).clamp(60, MAX_SESSION_SECS);
    // probe BEFORE starting: if the game is already open, the first sample knows it
    eng.probe_emulator();
    let gen = eng.start(Some(bounded))?;
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

/// Is GameLoop running right now? (UI uses this to gate the Start button.)
#[tauri::command]
fn gameloop_status() -> bool {
    session::init_global();
    engine::sampler::detect_emulator().is_some()
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

#[tauri::command]
fn system_info() -> Result<engine::system::SystemInfo, String> {
    engine::system::system_info_cached()
}

#[tauri::command]
fn top_processes() -> Result<Vec<engine::system::TopProcess>, String> {
    engine::system::top_processes_cached()
}

#[tauri::command]
fn system_checks() -> Result<engine::system::SystemChecks, String> {
    engine::system::system_checks_cached()
}

#[tauri::command]
fn open_windows_panel(panel: &str) -> Result<(), String> {
    engine::system::open_windows_panel(panel)
}

#[tauri::command]
fn session_stop(app: tauri::AppHandle) -> Result<StatusPayload, String> {
    let eng = session::init_global();
    let report = eng.stop()?;
    if let Some(_path) = report {
        // report path available via last session query if needed
    }
    let _ = push_state(&app);
    Ok(current_status(eng))
}

#[tauri::command]
fn get_state() -> StatusPayload {
    let eng = session::init_global();
    current_status(eng)
}

#[tauri::command]
fn session_entries() -> Vec<engine::storage::SessionEntry> {
    engine::storage::session_entries()
}

#[tauri::command]
fn load_report(id: &str) -> Result<engine::storage::FriendlyReport, String> {
    engine::storage::friendly_report(id)
}

#[tauri::command]
fn delete_session(id: &str) -> Result<(), String> {
    engine::storage::delete_session(id)
}

#[tauri::command]
fn session_folder(id: &str) -> Result<String, String> {
    engine::storage::session_dir(id)
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

#[tauri::command]
fn set_auto_stop(minutes: u32) -> Result<u32, String> {
    let mut s = engine::settings::load();
    s.auto_stop_minutes = engine::settings::clamp_auto_stop(minutes);
    engine::settings::save(&s)?;
    Ok(s.auto_stop_minutes)
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
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
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
            session_folder,
            get_settings,
            set_language,
            set_sidebar_collapsed,
            finish_onboarding,
            gameloop_status,
            watch_gameloop,
            system_info,
            top_processes,
            system_checks,
            open_windows_panel,
            set_auto_stop,
            open_path,
            open_url,
            get_version,
        ])
        .on_window_event(|window, event| {
            // graceful exit: a running session finalizes its files before the app dies
            if let tauri::WindowEvent::CloseRequested { .. } = event {
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
            // rotate the technical log once per launch (7-day retention)
            engine::logging::cleanup_old_logs();
            engine::logging::info("app starting");

            // fixed-size window: show once, centered — no resize flash possible
            if let Some(win) = _app.get_webview_window("main") {
                let _ = win.center();
                let _ = win.show();
                let _ = win.set_focus();
            }

            let handle = _app.handle().clone();
            spawn_state_pusher(handle);

            // prefetch the system tabs in the background: rig info, checks,
            // and top processes each cost a PowerShell spawn (0.5–2 s). By
            // the user reaches those tabs, the caches are already warm —
            // first open feels as instant as every later one.
            std::thread::spawn(|| {
                let _ = engine::system::system_info_cached();
                let _ = engine::system::system_checks_cached();
                let _ = engine::system::top_processes_cached();
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
