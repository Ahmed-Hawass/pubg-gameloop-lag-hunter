// prockill.rs — end one user app group by PIDs (Top Processes action).
//
// Read-only system.rs stays read-only: this module owns the single write
// the Processes tab performs. Scope is deliberately narrow:
// - whole app groups (every member PID resolves, guards, and terminates
//   alone: killing one worker never ends the app)
// - same-user processes need no elevation prompt; a process owned by
//   admin/system refuses honestly with PROCESS_ACCESS_DENIED and the UI
//   explains instead of elevating silently (no new elevated id).
//
// Safety: every PID re-resolves to its live process name before any
// handle opens (a reused PID must never kill a stranger), and GameLoop +
// our own binaries are refused even if the UI passes them.

/// Machine keys surfaced to the UI (keys, not sentences: the locales own
/// every human word; unknown failures stay technical lines).
pub const PROCESS_NOT_FOUND: &str = "PROCESS_NOT_FOUND";
pub const PROCESS_ACCESS_DENIED: &str = "PROCESS_ACCESS_DENIED";
pub const PROCESS_KILL_FAILED: &str = "PROCESS_KILL_FAILED";
pub const PROCESS_REFUSED: &str = "PROCESS_REFUSED";

/// End a whole app group: every PID resolves, guards, and terminates
/// alone (a reused PID still kills nobody's stranger). Best-effort with
/// one honest answer: a denial anywhere reads access-denied (the group
/// needs admin), any other failure reads kill-failed, vanished members
/// count as done (the goal is them gone, however they left).
pub fn end_processes(pids: &[u32]) -> Result<(), String> {
    use std::collections::HashSet;
    let mut seen = HashSet::new();
    let mut denied = false;
    let mut failed = false;
    let mut attempted = false;
    for &pid in pids {
        if pid == 0 || !seen.insert(pid) {
            continue;
        }
        attempted = true;
        match end_process(pid) {
            Ok(()) => {}
            Err(e) if e == PROCESS_NOT_FOUND => {}
            Err(e) if e == PROCESS_ACCESS_DENIED => denied = true,
            Err(_) => failed = true,
        }
    }
    if !attempted {
        return Err(PROCESS_REFUSED.into());
    }
    if denied {
        return Err(PROCESS_ACCESS_DENIED.into());
    }
    if failed {
        return Err(PROCESS_KILL_FAILED.into());
    }
    Ok(())
}

/// End one process by PID: resolve-then-guard-then-terminate. Returns Ok
/// on a confirmed exit, Err(machine key) otherwise. Every outcome is
/// logged by the caller (lib.rs logs all command failures); the audit
/// line here names name/pid/result with no user paths.
pub fn end_process(pid: u32) -> Result<(), String> {
    if pid == 0 {
        return Err(PROCESS_REFUSED.into());
    }
    #[cfg(not(windows))]
    {
        let _ = pid;
        return Err(PROCESS_KILL_FAILED.into());
    }
    #[cfg(windows)]
    {
        end_process_windows(pid)
    }
}

#[cfg(windows)]
fn end_process_windows(pid: u32) -> Result<(), String> {
    // Open first, ask questions after: the handle pins the process
    // object, so a PID recycled between listing and acting is harmless
    // (every check below reads the opened object itself, never a
    // re-resolved number).
    unsafe {
        let handle = OpenProcess(PROCESS_TERMINATE, 0, pid);
        if handle.is_null() {
            let err = GetLastError();
            if err == ERROR_ACCESS_DENIED {
                super::logging::info(&format!("end process denied: pid={pid}"));
                return Err(PROCESS_ACCESS_DENIED.into());
            }
            return Err(PROCESS_NOT_FOUND.into());
        }
        // identity AND kind from the handle itself: GameLoop, ourselves,
        // non-app kinds, and the shared runtime refuse here no matter
        // what the UI passed (the UI gate is convenience, this is policy).
        let (name, path) = handle_name_and_path(handle);
        let kind_ok = path
            .as_deref()
            .map(|p| {
                super::system::classify_process(
                    None,
                    Some(p),
                    &std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into()),
                )
            })
            .unwrap_or("system")
            == "app";
        let stem = name
            .as_deref()
            .map(|n| n.trim_end_matches(".exe").to_string())
            .unwrap_or_default();
        let refused = name.as_deref().is_some_and(|n| {
            n.trim().is_empty()
                || super::sampler::is_gameloop_process(n)
                || super::sampler::is_self_process(n)
        }) || stem.eq_ignore_ascii_case("msedgewebview2")
            || !kind_ok;
        if refused {
            super::logging::warn(&format!(
                "end process refused (protected): {} pid={pid}",
                name.as_deref().unwrap_or("?")
            ));
            CloseHandle(handle);
            return Err(PROCESS_REFUSED.into());
        }
        let ok = TerminateProcess(handle, 1);
        CloseHandle(handle);
        if ok == 0 {
            let err = GetLastError();
            if err == ERROR_ACCESS_DENIED {
                super::logging::info(&format!("end process denied: pid={pid}"));
                return Err(PROCESS_ACCESS_DENIED.into());
            }
            super::logging::warn(&format!("end process failed: pid={pid} os={err}"));
            return Err(PROCESS_KILL_FAILED.into());
        }
        let wanted = name.unwrap_or_default();
        // verify by re-read: the PID must be gone (or recycled under
        // another name, which also ends this attempt). A lingering
        // same-name PID is a real failure, never ok. Observing only:
        // identity was already pinned by the handle above.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        loop {
            match process_name_of(pid) {
                None => {
                    super::logging::info(&format!("end process ok: {wanted} pid={pid}"));
                    return Ok(());
                }
                Some(now) => {
                    if !now.eq_ignore_ascii_case(&wanted) {
                        super::logging::info(&format!(
                            "end process ok (pid recycled): {wanted} pid={pid}"
                        ));
                        return Ok(());
                    }
                    if std::time::Instant::now() >= deadline {
                        super::logging::warn(&format!("end process still alive: {wanted} pid={pid}"));
                        return Err(PROCESS_KILL_FAILED.into());
                    }
                    std::thread::sleep(std::time::Duration::from_millis(100));
                }
            }
        }
    }
}

/// File name + full path of an opened process object (never by PID:
/// the handle is the identity here).
#[cfg(windows)]
fn handle_name_and_path(handle: *mut core::ffi::c_void) -> (Option<String>, Option<String>) {
    unsafe {
        let mut size = 1024u32;
        let mut buf = vec![0u16; size as usize];
        if QueryFullProcessImageNameW(handle, 0, buf.as_mut_ptr(), &mut size) == 0 {
            return (None, None);
        }
        let Ok(path) = String::from_utf16(&buf[..size as usize]) else {
            return (None, None);
        };
        let name = path.rsplit(['\\', '/']).next().map(str::to_string);
        (name, Some(path))
    }
}

/// Live process name for a PID via one Toolhelp snapshot (no spawn, no
/// PowerShell: an instant action must not pay a process spawn).
#[cfg(windows)]
fn process_name_of(pid: u32) -> Option<String> {
    snapshot_entries()
        .into_iter()
        .find(|e| e.pid == pid)
        .map(|e| e.name)
}

#[cfg(windows)]
const PROCESS_TERMINATE: u32 = 0x0001;
#[cfg(windows)]
const TH32CS_SNAPPROCESS: u32 = 0x0000_0002;
#[cfg(windows)]
const ERROR_ACCESS_DENIED: u32 = 5;

/// One Toolhelp pass: every live process with its parent and stem.
/// The single native enumeration other readers share (top processes use
/// it directly; guards use the views below). No spawn, ever.
pub struct ProcEntry {
    pub pid: u32,
    pub ppid: u32,
    pub name: String,
}

#[cfg(windows)]
pub fn snapshot_entries() -> Vec<ProcEntry> {
    let mut out = Vec::new();
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap.is_null() || snap as isize == -1 {
            return out;
        }
        let mut entry = PROCESSENTRY32W {
            dw_size: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..std::mem::zeroed()
        };
        if Process32FirstW(snap, &mut entry) == 0 {
            CloseHandle(snap);
            return out;
        }
        loop {
            let len = entry
                .sz_exe_file
                .iter()
                .position(|&c| c == 0)
                .unwrap_or(entry.sz_exe_file.len());
            out.push(ProcEntry {
                pid: entry.th32_process_id,
                ppid: entry.th32_parent_process_id,
                name: String::from_utf16_lossy(&entry.sz_exe_file[..len]),
            });
            if Process32NextW(snap, &mut entry) == 0 {
                break;
            }
        }
        CloseHandle(snap);
    }
    out
}

#[cfg(not(windows))]
pub fn snapshot_entries() -> Vec<ProcEntry> {
    Vec::new()
}

#[cfg(windows)]
#[repr(C)]
struct PROCESSENTRY32W {
    dw_size: u32,
    cnt_usage: u32,
    th32_process_id: u32,
    th32_default_heap_id: usize,
    th32_module_id: u32,
    cnt_threads: u32,
    th32_parent_process_id: u32,
    pc_pri_class_base: i32,
    dw_flags: u32,
    sz_exe_file: [u16; 260],
}

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn OpenProcess(desired: u32, inherit: i32, pid: u32) -> *mut core::ffi::c_void;
    fn TerminateProcess(handle: *mut core::ffi::c_void, code: u32) -> i32;
    fn CloseHandle(handle: *mut core::ffi::c_void) -> i32;
    fn GetLastError() -> u32;
    fn CreateToolhelp32Snapshot(flags: u32, pid: u32) -> *mut core::ffi::c_void;
    fn Process32FirstW(snap: *mut core::ffi::c_void, entry: *mut PROCESSENTRY32W) -> i32;
    fn Process32NextW(snap: *mut core::ffi::c_void, entry: *mut PROCESSENTRY32W) -> i32;
    fn QueryFullProcessImageNameW(
        handle: *mut core::ffi::c_void,
        flags: u32,
        name: *mut u16,
        size: *mut u32,
    ) -> i32;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn machine_keys_are_exact_for_the_locale_table() {
        assert_eq!(PROCESS_NOT_FOUND, "PROCESS_NOT_FOUND");
        assert_eq!(PROCESS_ACCESS_DENIED, "PROCESS_ACCESS_DENIED");
        assert_eq!(PROCESS_KILL_FAILED, "PROCESS_KILL_FAILED");
        assert_eq!(PROCESS_REFUSED, "PROCESS_REFUSED");
    }

    #[test]
    fn zero_pid_refuses_without_touching_the_os() {
        assert_eq!(end_process(0).unwrap_err(), PROCESS_REFUSED);
    }

    #[cfg(windows)]
    #[test]
    fn own_pid_refuses_through_the_handle_path() {
        // the test runner itself: openable, but our own binary is never
        // a target (exercises the handle-first guard with zero risk)
        assert_eq!(
            end_process(std::process::id()).unwrap_err(),
            PROCESS_REFUSED
        );
    }

    #[test]
    fn group_kill_refuses_empty_and_zero_only_lists() {
        assert_eq!(end_processes(&[]).unwrap_err(), PROCESS_REFUSED);
        assert_eq!(end_processes(&[0, 0]).unwrap_err(), PROCESS_REFUSED);
    }
}
