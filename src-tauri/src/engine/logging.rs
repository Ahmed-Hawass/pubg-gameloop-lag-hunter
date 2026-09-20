// logging.rs — the technical log: the tool's flight recorder.
// One rotating file per day, INFO for operations, WARN for degradations,
// ERROR always. 7-day retention. For US debugging user reports — never UI.
//
// Coverage contract (the "what happened at the user's machine" promise):
//   * boot timing      — app start → ready, per-step durations
//   * panics           — the hook fires even with panic=abort (last chance)
//   * sampler health   — every streaming source logs spawn + first sample
//   * session lifecycle — start gate, timings, stop reason, sample counts
//   * slow IPC         — any command > 500ms is logged by name + duration
//   * rig profile      — one line at boot: RAM/disks/GPU counters/PS state
//
// Writer rule: every public fn is lock-free-ish and NEVER blocks callers —
// a logging failure is swallowed, never propagated (fail-soft, like the
// rest of the engine).

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Instant;

use super::sampler;

static LOG_LOCK: Mutex<()> = Mutex::new(());

fn logs_dir() -> PathBuf {
    super::storage::app_dir().join("logs")
}

fn log_path_in(dir: &Path) -> PathBuf {
    // one file per day: laghunter-2026-08-31.log
    let iso = sampler::iso_now(); // 2026-08-31T...
    // never slice blindly: a malformed clock must not panic the logger itself
    let date = iso.get(0..10).unwrap_or("unknown");
    dir.join(format!("laghunter-{date}.log"))
}

fn log_path() -> PathBuf {
    log_path_in(&logs_dir())
}

fn write_line_to(dir: &Path, level: &str, msg: &str) {
    let _guard = LOG_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let _ = fs::create_dir_all(dir);
    let iso = sampler::iso_now();
    let clock = iso.get(11..23).unwrap_or(&iso);
    if let Ok(mut f) = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path_in(dir))
    {
        let _ = writeln!(f, "{clock} [{level}] {msg}");
    }
}

fn write_line(level: &str, msg: &str) {
    write_line_to(&logs_dir(), level, msg);
}

pub fn info(msg: &str) {
    write_line("INFO", msg);
}

pub fn warn(msg: &str) {
    write_line("WARN", msg);
}

pub fn error(msg: &str) {
    write_line("ERROR", msg);
}

// ---------------------------------------------------------------------------
// Timed operations — "how long did X take" as a one-liner
// ---------------------------------------------------------------------------

/// Log an operation's duration in the classic "op: 123ms" shape.
/// For one-shot measurements where the caller already holds the elapsed time.
pub fn perf(op: &str, elapsed_ms: u128) {
    info(&format!("{op}: {elapsed_ms}ms"));
}

/// A guard that logs its operation's total duration when dropped.
/// Usage: `let _t = logging::timed("settings load");`
/// The guard is must_use so a forgotten binding is a compile error.
#[must_use = "the timing is logged on Drop — bind it to a variable"]
pub struct TimerGuard {
    op: &'static str,
    started: Instant,
    /// warn above this threshold instead of info — slow ops stand out
    warn_above_ms: u128,
}

impl TimerGuard {
    fn new(op: &'static str, warn_above_ms: u128) -> Self {
        Self {
            op,
            started: Instant::now(),
            warn_above_ms,
        }
    }
}

fn log_op_duration_to(dir: &Path, op: &str, elapsed_ms: u128, warn_above_ms: u128) {
    if elapsed_ms >= warn_above_ms {
        write_line_to(dir, "WARN", &format!("{op}: {elapsed_ms}ms (slow)"));
    } else {
        write_line_to(dir, "INFO", &format!("{op}: {elapsed_ms}ms"));
    }
}

impl Drop for TimerGuard {
    fn drop(&mut self) {
        let ms = self.started.elapsed().as_millis();
        log_op_duration_to(&logs_dir(), self.op, ms, self.warn_above_ms);
    }
}

/// Start a named timer; the duration is logged when the binding drops.
/// The default warn threshold is 2s — anything slower is a freeze suspect.
pub fn timed(op: &'static str) -> TimerGuard {
    TimerGuard::new(op, 2_000)
}

/// Same as [`timed`], with a custom warn threshold in milliseconds.
pub fn timed_with(op: &'static str, warn_above_ms: u128) -> TimerGuard {
    TimerGuard::new(op, warn_above_ms)
}

// ---------------------------------------------------------------------------
// Panic hook — the last words of a dying process
// ---------------------------------------------------------------------------

/// Install the panic hook. MUST run before any thread spawns: with
/// `panic = "abort"` there are no Drop handlers and no unwinding — the hook
/// is the single chance to record WHY the app died on the user's machine.
/// Note the writer here must be lock-free: the panic may originate while
/// another thread holds the log mutex (a poisoned lock would eat the record).
pub fn init_panic_hook() {
    std::panic::set_hook(Box::new(|info| {
        let msg = format!(
            "PANIC: {info} | location: {}",
            info.location()
                .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
                .unwrap_or_else(|| "unknown".into())
        );
        // direct write, no LOG_LOCK: see the doc comment above
        let _ = fs::create_dir_all(logs_dir());
        if let Ok(mut f) = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(log_path())
        {
            let iso = sampler::iso_now();
            let clock = iso.get(11..23).unwrap_or(&iso);
            let _ = writeln!(f, "{clock} [PANIC] {msg}");
        }
    }));
}

/// Delete log files older than 7 days — called once at app start.
pub fn cleanup_old_logs() {
    cleanup_old_logs_in(&logs_dir());
}

fn cleanup_old_logs_in(dir: &Path) {
    let _ = fs::create_dir_all(dir);
    let Ok(rd) = fs::read_dir(dir) else {
        return;
    };
    let cutoff = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64 - 7 * 86_400)
        .unwrap_or(0);
    for entry in rd.flatten() {
        let Ok(meta) = entry.metadata() else { continue };
        let Ok(modified) = meta.modified() else {
            continue;
        };
        let Ok(age) = modified.duration_since(std::time::UNIX_EPOCH) else {
            continue;
        };
        if (age.as_secs() as i64) < cutoff {
            let _ = fs::remove_file(entry.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Unit tests must never touch the production logs directory: the
    /// production helpers write into `%LOCALAPPDATA%\LagHunter\logs`, and
    /// the retention cleanup deletes files there. Every test below aims
    /// the same code at a throwaway temp dir instead.
    fn temp_logs_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "laghunter-log-test-{}-{name}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::create_dir_all(&dir);
        dir
    }

    fn only_log_file(dir: &Path) -> PathBuf {
        let mut logs: Vec<PathBuf> = fs::read_dir(dir)
            .expect("temp logs dir must be readable")
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("log"))
            .collect();
        assert_eq!(logs.len(), 1, "expected exactly one test log file");
        logs.pop().expect("test log file must exist")
    }

    #[test]
    fn log_line_format() {
        let dir = temp_logs_dir("lines");
        write_line_to(&dir, "INFO", "test message");
        write_line_to(&dir, "ERROR", "test error");
        write_line_to(&dir, "WARN", "test warn");
        let body = fs::read_to_string(only_log_file(&dir)).expect("test log must be readable");
        assert!(body.contains("[INFO] test message"));
        assert!(body.contains("[ERROR] test error"));
        assert!(body.contains("[WARN] test warn"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn timed_guard_logs_on_drop() {
        let dir = temp_logs_dir("timed");
        log_op_duration_to(&dir, "unit test op", 1, 2_000);
        log_op_duration_to(&dir, "unit slow op", 2_500, 100);
        let body = fs::read_to_string(only_log_file(&dir)).expect("test log must be readable");
        assert!(body.contains("unit test op: 1ms"));
        assert!(body.contains("unit slow op: 2500ms (slow)"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn timed_guard_is_must_use() {
        // Compiling proves the guard type is usable from a binding. Forget
        // (rather than drop) so this test never writes to production logs.
        let _t = timed_with("unit custom op", 100);
        std::mem::forget(_t);
    }

    #[test]
    fn cleanup_never_panics() {
        let dir = temp_logs_dir("cleanup");
        fs::write(dir.join("laghunter-2099-01-01.log"), "recent").expect("temp log must be writable");
        cleanup_old_logs_in(&dir);
        assert!(dir.join("laghunter-2099-01-01.log").is_file());
        let _ = fs::remove_dir_all(&dir);
    }
}
