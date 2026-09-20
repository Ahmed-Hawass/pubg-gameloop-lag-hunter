// elevate.rs — per-action elevation without ever elevating the app.
//
// The app stays unprivileged. A tweak that needs admin runs as the SAME
// binary with a hidden CLI flag, spawned through ShellExecuteW "runas"
// (one UAC prompt per flip, never at launch): the elevated run writes
// ONLY, then exits, while the normal flow re-reads to verify — so the
// verify-by-re-read contract holds unchanged for elevated rows too.
//
// Refusal discipline (agreed, and the codebase's own rule everywhere a
// cancel exists): a denied UAC prompt is a user choice and stays quiet.
// The spawn maps it to the exact string "cancelled" (the same contract
// as the update flow's cancellation), the UI rolls the switch back with
// no dialog, and only a failure AFTER consent surfaces as an error.
//
// Security shape: the flag carries an id plus 0/1 only (visible in task
// managers, nothing sensitive in it), except the page file editor,
// whose whitelisted request shape is [id, 0/1, DRIVE, mode, min, max].
// The id must be whitelisted AND every arg range-checked before anything
// runs, and the SAME validation runs inside the elevated child (defense
// in depth: the child never trusts the parent). No free-form commands
// cross the privilege boundary, ever.

/// Hidden CLI flag: `exe --laghunter-elevated <id> <0|1>`. Checked in
/// main() before the WebView2 probe and the single-instance plugin, so
/// the elevated run is headless: no window, no focus steal, no session.
pub const ELEVATED_ACTION_FLAG: &str = "--laghunter-elevated";

/// Exact refusal signal, parent to UI. Matched verbatim (like the update
/// flow): any message merely CONTAINING it is still a real error.
pub const CANCELLED: &str = "cancelled";

/// Process exit codes of the elevated run: 0 wrote (verification still
/// happens unprivileged, by re-read), 2 refused before touching anything,
/// 3 attempted but failed.
pub const EXIT_OK: i32 = 0;
pub const EXIT_USAGE: i32 = 2;
pub const EXIT_FAILED: i32 = 3;

/// Tweak ids that must go through elevation. Power plan was first;
/// the page file editor joins (HKLM writes): reads stay unprivileged,
/// the whole apply request goes through one UAC prompt.
pub static ELEVATED_IDS: &[&str] = &["powerplan", "pagefile-settings"];

/// Headless reboot flag: `exe --laghunter-reboot`. NOT a tweak (it never
/// enters is_known_id or the dispatch); handled first in the runner.
pub const REBOOT_FLAG: &str = "--laghunter-reboot";

/// True when this id must run elevated. Pure: safe to ask from anywhere,
/// including the UI thread (no registry, no spawn).
pub fn is_elevated_id(id: &str) -> bool {
    ELEVATED_IDS.contains(&id)
}

/// Headless entry point for the elevated run. Returns a process exit
/// code (never panics out: main() turns it into process::exit).
/// Refusal gates run BEFORE any registry access, so unit tests (and CI)
/// can cover every non-zero path without touching a real registry —
/// the same discipline as the tweaks refusal tests.
///
/// Shapes: `[id, 0|1]` for switches, `[pagefile-settings, 0|1, DRIVE,
/// mode, min, max]` for the page file editor (a mode is data, never a
/// new command shape). Anything else is usage.
pub fn run_elevated_action(args: &[String]) -> i32 {
    super::logging::init_panic_hook();
    if !args.is_empty() && args[0] == super::tweaks::PAGEFILE_SETTINGS_ID {
        if args.len() != 6 {
            super::logging::warn("elevated run refused: bad pagefile-settings arity");
            return EXIT_USAGE;
        }
        let automatic: u32 = match args[1].parse() {
            Ok(v) if v <= 1 => v,
            _ => {
                super::logging::warn("elevated run refused: bad automatic flag");
                return EXIT_USAGE;
            }
        };
        // shapes only here (drive shape, mode word, digit strings); the
        // setter re-validates everything against fresh reads, including
        // drive membership and free space (defense in depth)
        let drive_ok = {
            let b = args[2].as_bytes();
            b.len() == 2 && b[0].is_ascii_alphabetic() && b[1] == b':'
        };
        let mode_ok = ["system", "custom", "off"].contains(&args[3].as_str());
        let digits =
            |s: &str| !s.is_empty() && s.len() <= 10 && s.bytes().all(|b| b.is_ascii_digit());
        if !drive_ok || !mode_ok || !digits(&args[4]) || !digits(&args[5]) {
            super::logging::warn("elevated run refused: bad pagefile-settings shape");
            return EXIT_USAGE;
        }
        let (min_mb, max_mb): (u32, u32) = match (args[4].parse(), args[5].parse()) {
            (Ok(mn), Ok(mx)) => (mn, mx),
            _ => {
                super::logging::warn("elevated run refused: pagefile sizes out of range");
                return EXIT_USAGE;
            }
        };
        return match super::tweaks::set_pagefile_settings(
            automatic == 1,
            &args[2].to_uppercase(),
            &args[3],
            &min_mb.to_string(),
            &max_mb.to_string(),
        ) {
            Ok(r) if r.verified => EXIT_OK,
            Ok(_) => EXIT_FAILED,
            Err(e) => {
                super::logging::warn(&format!("elevated pagefile settings failed: {e}"));
                EXIT_FAILED
            }
        };
    }
    if args.len() != 2 {
        eprintln!("usage: {ELEVATED_ACTION_FLAG} <tweak-id> <0|1>");
        return EXIT_USAGE;
    }
    let (id, value_raw) = (&args[0], &args[1]);
    if !super::tweaks::is_known_id(id) {
        super::logging::warn(&format!("elevated run refused: unknown tweak {id}"));
        return EXIT_USAGE;
    }
    // Every tweak to date is binary 0/1; a multi-state elevated tweak
    // extends this gate with its own range (same as its setter does).
    let value: u32 = match value_raw.parse() {
        Ok(v) if v <= 1 => v,
        _ => {
            super::logging::warn(&format!("elevated run refused: bad value for {id}"));
            return EXIT_USAGE;
        }
    };
    match super::tweaks::set_tweak_direct(id, value) {
        Ok(r) => {
            super::logging::info(&format!(
                "elevated tweak {id} set: value={value} verified={}",
                r.verified
            ));
            if r.verified {
                EXIT_OK
            } else {
                EXIT_FAILED
            }
        }
        Err(e) => {
            super::logging::warn(&format!("elevated tweak {id} failed: {e}"));
            EXIT_FAILED
        }
    }
}

/// Map an elevated run's exit code to the parent-side result. Pure: the
/// UAC prompt itself can never be unit-tested, but every meaning of its
/// outcome is pinned here. Cancellation never arrives as an exit code
/// (a denied prompt fails the SPAWN, see elevate_self); only real
/// failures do.
pub fn map_exit_code(code: u32) -> Result<(), String> {
    if code == 0 {
        Ok(())
    } else {
        Err(format!("elevated write failed (exit {code})"))
    }
}

/// Spawn this same binary elevated for one whitelisted write and wait
/// for it. Returns the child's exit code. A denied UAC prompt is
/// ERROR_CANCELLED (1223): Err("cancelled"), exact, for the UI's silent
/// rollback — never a scary dialog for a deliberate No.
#[cfg(windows)]
pub fn elevate_self(id: &str, value: u32) -> Result<u32, String> {
    if !super::tweaks::is_known_id(id) || value > 1 {
        return Err(format!("elevated request refused before UAC: {id}"));
    }
    let params = format!("{ELEVATED_ACTION_FLAG} {id} {value}");
    let process = spawn_elevated_raw(&params)?;
    // SAFETY: hProcess is ours (NOCLOSEPROCESS); wait, read the code,
    // then close — the only three handle calls this module ever makes.
    unsafe {
        WaitForSingleObject(process, INFINITE);
        let mut code: u32 = 0;
        // the read itself can fail (invalid handle): an unread code
        // must never pass as 0/success — fail loudly instead.
        if GetExitCodeProcess(process, &mut code) == 0 {
            CloseHandle(process);
            return Err("could not read elevated child exit code".into());
        }
        CloseHandle(process);
        Ok(code)
    }
}

/// Page file editor variant: same spawn, the whole validated request in
/// the flag args (whitelisted shapes only: 0/1 flag, DRIVE id, mode
/// word, digit sizes, re-validated inside the child against fresh
/// reads, including drive membership and free space).
#[cfg(windows)]
pub fn elevate_pagefile_settings(
    automatic: bool,
    drive: &str,
    mode: &str,
    min_mb: u32,
    max_mb: u32,
) -> Result<u32, String> {
    let auto = u32::from(automatic);
    let drive_ok = {
        let b = drive.as_bytes();
        b.len() == 2 && b[0].is_ascii_alphabetic() && b[1] == b':'
    };
    let digits = |s: &str| !s.is_empty() && s.len() <= 10 && s.bytes().all(|b| b.is_ascii_digit());
    if !drive_ok
        || !["system", "custom", "off"].contains(&mode)
        || !digits(&min_mb.to_string())
        || !digits(&max_mb.to_string())
    {
        return Err(format!(
            "elevated request refused before UAC: {drive} {mode}"
        ));
    }
    let params = format!(
        "{ELEVATED_ACTION_FLAG} {} {auto} {} {mode} {min_mb} {max_mb}",
        super::tweaks::PAGEFILE_SETTINGS_ID,
        drive.to_uppercase()
    );
    let process = spawn_elevated_raw(&params)?;
    unsafe {
        WaitForSingleObject(process, INFINITE);
        let mut code: u32 = 0;
        if GetExitCodeProcess(process, &mut code) == 0 {
            CloseHandle(process);
            return Err("could not read elevated child exit code".into());
        }
        CloseHandle(process);
        Ok(code)
    }
}

/// Reboot request (parent side): spawn ourselves elevated with the
/// reboot flag and return immediately WITHOUT waiting (the machine is
/// going down; waiting on it would wedge the IPC thread). The child
/// runs an immediate shutdown and exits. Cancel maps to exact
/// "cancelled" like every other refusal.
#[cfg(windows)]
pub fn request_reboot() -> Result<(), String> {
    let process = spawn_elevated_raw(REBOOT_FLAG)?;
    // SAFETY: ours to close; the child lives on without it.
    unsafe {
        CloseHandle(process);
    }
    Ok(())
}

/// Shared spawn core: same binary, runas verb, hidden window, no OS
/// error dialogs (we map errors ourselves). Returns the process handle.
#[cfg(windows)]
fn spawn_elevated_raw(params: &str) -> Result<*mut core::ffi::c_void, String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    let exe = std::env::current_exe().map_err(|e| format!("own exe path: {e}"))?;
    let to_wide = |s: &OsStr| {
        s.encode_wide()
            .chain(std::iter::once(0))
            .collect::<Vec<u16>>()
    };
    let verb = to_wide(OsStr::new("runas"));
    let file = to_wide(exe.as_os_str());
    let args_w = to_wide(OsStr::new(params));
    let mut info = SHELLEXECUTEINFOW {
        cb_size: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
        mask: SEE_MASK_NOCLOSEPROCESS | SEE_MASK_FLAG_NO_UI,
        hwnd: std::ptr::null_mut(),
        verb: verb.as_ptr(),
        file: file.as_ptr(),
        params: args_w.as_ptr(),
        dir: std::ptr::null(),
        show: SW_HIDE,
        inst_app: std::ptr::null_mut(),
        id_list: std::ptr::null_mut(),
        class: std::ptr::null(),
        key_class: std::ptr::null_mut(),
        hot_key: 0,
        monitor_or_icon: std::ptr::null_mut(),
        process: std::ptr::null_mut(),
    };
    // SAFETY: ShellExecuteExW only reads the struct and the nul-terminated
    // buffers for the duration of the call; all outlive it on our stack.
    // FLAG_NO_UI suppresses the OS error dialogs — we map errors ourselves.
    let ok = unsafe { ShellExecuteExW(&mut info) };
    if ok == 0 {
        // SAFETY: GetLastError has no preconditions.
        let err = unsafe { GetLastError() };
        if err == ERROR_CANCELLED {
            super::logging::info("elevation refused by the user (quiet by agreement)");
            return Err(CANCELLED.into());
        }
        return Err(format!("elevation spawn failed (os error {err})"));
    }
    Ok(info.process)
}

/// Headless reboot run (already elevated at this point): immediate
/// shutdown, no countdown. The confirm modal is the countdown's
/// replacement: by the time this runs, the user has deliberately picked
/// "Restart now" twice over (Apply, then the modal), and a background
/// timer the app can neither display nor abort is worse than none.
/// Spawn only; waiting on the shutdown would wedge us.
pub fn run_reboot_action() -> i32 {
    super::logging::init_panic_hook();
    #[cfg(windows)]
    use std::os::windows::process::CommandExt;
    let mut cmd = std::process::Command::new("shutdown");
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000);
    let out = cmd
        .args([
            "/r",
            "/t",
            "0",
            "/c",
            "Lag Hunter: applying your page file change",
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn();
    match out {
        Ok(_) => {
            super::logging::info("reboot started: immediate shutdown");
            EXIT_OK
        }
        Err(e) => {
            super::logging::warn(&format!("reboot failed: {e}"));
            EXIT_FAILED
        }
    }
}

/// Non-Windows stub: elevation is a Windows concept; the module still
/// compiles everywhere so shared logic (gates, mapping) stays testable.
#[cfg(not(windows))]
pub fn elevate_self(id: &str, _value: u32) -> Result<u32, String> {
    let _ = id;
    Err("elevation needs Windows".into())
}

/// Non-Windows stub for the page file editor variant.
#[cfg(not(windows))]
pub fn elevate_pagefile_settings(
    _automatic: bool,
    _drive: &str,
    _mode: &str,
    _min_mb: u32,
    _max_mb: u32,
) -> Result<u32, String> {
    Err("elevation needs Windows".into())
}

/// Non-Windows stub for the reboot request.
#[cfg(not(windows))]
pub fn request_reboot() -> Result<(), String> {
    Err("elevation needs Windows".into())
}

#[cfg(windows)]
const SEE_MASK_NOCLOSEPROCESS: u32 = 0x0000_0040;
#[cfg(windows)]
const SEE_MASK_FLAG_NO_UI: u32 = 0x0000_0400;
#[cfg(windows)]
const SW_HIDE: i32 = 0;
#[cfg(windows)]
const INFINITE: u32 = 0xFFFF_FFFF;
#[cfg(windows)]
const ERROR_CANCELLED: u32 = 1223;

/// SHELLEXECUTEINFOW layout (field order and pointer widths matter;
/// repr(C) pads like the C struct on both 32- and 64-bit). The name keeps
/// the canonical Win32 spelling (hence the deliberate acronym allow).
#[cfg(windows)]
#[allow(clippy::upper_case_acronyms)]
#[repr(C)]
struct SHELLEXECUTEINFOW {
    cb_size: u32,
    mask: u32,
    hwnd: *mut core::ffi::c_void,
    verb: *const u16,
    file: *const u16,
    params: *const u16,
    dir: *const u16,
    show: i32,
    inst_app: *mut core::ffi::c_void,
    id_list: *mut core::ffi::c_void,
    class: *const u16,
    key_class: *mut core::ffi::c_void,
    hot_key: u32,
    monitor_or_icon: *mut core::ffi::c_void,
    process: *mut core::ffi::c_void,
}

// Only THREE bindings beyond main.rs's MessageBoxW, all textbook Win32
// with no linking tricks (the main.rs comment explains what went wrong
// last time someone hand-linked here: advapi32 probing that crashed
// webview creation — these three do no probing, they act).
#[cfg(windows)]
#[link(name = "shell32")]
extern "system" {
    fn ShellExecuteExW(info: *mut SHELLEXECUTEINFOW) -> i32;
}

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn WaitForSingleObject(handle: *mut core::ffi::c_void, millis: u32) -> u32;
    fn GetExitCodeProcess(handle: *mut core::ffi::c_void, code: *mut u32) -> i32;
    fn CloseHandle(handle: *mut core::ffi::c_void) -> i32;
    fn GetLastError() -> u32;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn elevated_action_refuses_bad_shapes_without_side_effects() {
        // every refusal path returns EXIT_USAGE before any registry access
        assert_eq!(run_elevated_action(&[]), EXIT_USAGE);
        assert_eq!(run_elevated_action(&["dvr".into()]), EXIT_USAGE);
        assert_eq!(
            run_elevated_action(&["dvr".into(), "1".into(), "x".into()]),
            EXIT_USAGE
        );
        assert_eq!(run_elevated_action(&["nope".into(), "1".into()]), EXIT_USAGE);
        assert_eq!(run_elevated_action(&["".into(), "1".into()]), EXIT_USAGE);
        assert_eq!(run_elevated_action(&["DVR".into(), "1".into()]), EXIT_USAGE);
        assert_eq!(run_elevated_action(&["dvr".into(), "2".into()]), EXIT_USAGE);
        assert_eq!(run_elevated_action(&["dvr".into(), "x".into()]), EXIT_USAGE);
        assert_eq!(run_elevated_action(&["dvr".into(), "-1".into()]), EXIT_USAGE);
        // editor arity: anything but exactly [id, auto, drive, mode, min,
        // max] is usage (a 2-arg editor call falls into the switch path,
        // where the dispatch has no such arm: honest failure, no effects)
        let ed = |parts: &[&str]| {
            run_elevated_action(&parts.iter().map(|s| s.to_string()).collect::<Vec<_>>())
        };
        assert_eq!(ed(&["pagefile-settings"]), EXIT_USAGE);
        assert_eq!(ed(&["pagefile-settings", "1"]), EXIT_USAGE);
        assert_eq!(ed(&["pagefile-settings", "1", "C:", "system", "0"]), EXIT_USAGE);
        // bad flag, drive, mode, and size shapes: usage, never attempted
        assert_eq!(ed(&["pagefile-settings", "2", "C:", "system", "0", "0"]), EXIT_USAGE);
        assert_eq!(ed(&["pagefile-settings", "x", "C:", "system", "0", "0"]), EXIT_USAGE);
        assert_eq!(ed(&["pagefile-settings", "1", "C", "system", "0", "0"]), EXIT_USAGE);
        assert_eq!(ed(&["pagefile-settings", "1", "C:\\", "system", "0", "0"]), EXIT_USAGE);
        assert_eq!(ed(&["pagefile-settings", "1", "", "system", "0", "0"]), EXIT_USAGE);
        assert_eq!(ed(&["pagefile-settings", "1", "C:", "bogus", "0", "0"]), EXIT_USAGE);
        assert_eq!(ed(&["pagefile-settings", "1", "C:", "System", "0", "0"]), EXIT_USAGE);
        assert_eq!(ed(&["pagefile-settings", "1", "C:", "custom", "a", "b"]), EXIT_USAGE);
        assert_eq!(
            ed(&["pagefile-settings", "1", "C:", "custom", "42949672960", "1"]),
            EXIT_USAGE
        );
        // well-shaped but invalid against live reads (unknown drive here,
        // no fixed drives on non-Windows CI): attempted-and-failed, still
        // no side effects (validation fires before any registry access)
        assert_eq!(
            ed(&["pagefile-settings", "1", "C:", "system", "0", "0"]),
            EXIT_FAILED
        );
        assert_eq!(
            ed(&["pagefile-settings", "0", "Q:", "custom", "1", "2"]),
            EXIT_FAILED
        );
        assert_eq!(
            ed(&["pagefile-settings", "0", "Q:", "custom", "200", "100"]),
            EXIT_FAILED
        );
    }

    #[test]
    fn elevated_gate_routes_only_declared_ids() {
        // power plan was first; the page file editor joins as ONE id (a
        // mode is data, never a new command). Everything else (plus
        // unknown ids) must never take the elevated path by surprise.
        for id in ["powerplan", "pagefile-settings"] {
            assert!(is_elevated_id(id), "{id} must elevate");
        }
        for id in [
            "dvr",
            "storagesense",
            "gamemode",
            "gpupref",
            "fso",
            "mouse",
            "windowedopt",
            "pagefile",
            "pagefile-custom",
            "pagefile-off",
            "reboot",
            "nope",
            "",
        ] {
            assert!(!is_elevated_id(id), "{id} must not elevate yet");
        }
    }

    #[test]
    fn exit_codes_mean_exactly_one_thing() {
        assert!(map_exit_code(0).is_ok());
        assert!(map_exit_code(1).is_err());
        assert!(map_exit_code(3).is_err());
        // cancellation never arrives here (it fails the spawn), but a
        // stray 1223 exit must still read as failure, never success
        assert!(map_exit_code(1223).is_err());
    }

    #[test]
    fn cancelled_signal_is_exact_for_the_silent_contract() {
        // the UI matches this verbatim (like the update flow): any drift
        // turns silent rollbacks into scary dialogs or vice versa
        assert_eq!(CANCELLED, "cancelled");
        assert_eq!(ELEVATED_ACTION_FLAG, "--laghunter-elevated");
    }
}
