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
// managers, nothing sensitive in it), the id must be whitelisted AND the
// value range-checked before anything runs, and the SAME validation runs
// inside the elevated child (defense in depth: the child never trusts
// the parent). No free-form commands cross the privilege boundary, ever.

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

/// Tweak ids that must go through elevation. EMPTY until the first
/// elevated tweak lands (power plan): the routing below is the landing
/// pad, not dead code — is_elevated_id decides per flip.
pub static ELEVATED_IDS: &[&str] = &[];

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
pub fn run_elevated_action(args: &[String]) -> i32 {
    super::logging::init_panic_hook();
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
    match super::tweaks::set_tweak(id, value) {
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
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    if !super::tweaks::is_known_id(id) || value > 1 {
        return Err(format!("elevated request refused before UAC: {id}"));
    }
    let exe = std::env::current_exe().map_err(|e| format!("own exe path: {e}"))?;
    let params = format!("{ELEVATED_ACTION_FLAG} {id} {value}");
    let to_wide = |s: &OsStr| {
        s.encode_wide()
            .chain(std::iter::once(0))
            .collect::<Vec<u16>>()
    };
    let verb = to_wide(OsStr::new("runas"));
    let file = to_wide(exe.as_os_str());
    let args_w = to_wide(OsStr::new(&params));
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
    // SAFETY: hProcess is ours (NOCLOSEPROCESS); wait, read the code,
    // then close — the only three handle calls this module ever makes.
    unsafe {
        WaitForSingleObject(info.process, INFINITE);
        let mut code: u32 = 0;
        GetExitCodeProcess(info.process, &mut code);
        CloseHandle(info.process);
        Ok(code)
    }
}

/// Non-Windows stub: elevation is a Windows concept; the module still
/// compiles everywhere so shared logic (gates, mapping) stays testable.
#[cfg(not(windows))]
pub fn elevate_self(id: &str, _value: u32) -> Result<u32, String> {
    let _ = id;
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
    }

    #[test]
    fn elevated_gate_is_empty_until_the_first_elevated_tweak() {
        // the landing pad answers, but routes nothing yet: no current id
        // may take the elevated path by surprise (power plan is first)
        for id in [
            "dvr",
            "storagesense",
            "gamemode",
            "gpupref",
            "fso",
            "mouse",
            "windowedopt",
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
