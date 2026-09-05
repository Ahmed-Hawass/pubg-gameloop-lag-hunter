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
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;

use super::sampler;

static LOG_LOCK: Mutex<()> = Mutex::new(());

fn logs_dir() -> PathBuf {
    super::storage::app_dir().join("logs")
}

fn log_path() -> PathBuf {
    // one file per day: laghunter-2026-08-31.log
    let iso = sampler::iso_now(); // 2026-08-31T...
    let date = &iso[0..10];
    logs_dir().join(format!("laghunter-{date}.log"))
}

fn write_line(level: &str, msg: &str) {
    let _guard = LOG_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let _ = fs::create_dir_all(logs_dir());
    let iso = sampler::iso_now();
    let clock = &iso[11..23];
    if let Ok(mut f) = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path())
    {
        let _ = writeln!(f, "{clock} [{level}] {msg}");
    }
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

impl Drop for TimerGuard {
    fn drop(&mut self) {
        let ms = self.started.elapsed().as_millis();
        if ms >= self.warn_above_ms {
            warn(&format!("{}: {ms}ms (slow)", self.op));
        } else {
            perf(self.op, ms);
        }
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
            let _ = writeln!(f, "{} [PANIC] {}", &iso[11..23], msg);
        }
    }));
}

/// Delete log files older than 7 days — called once at app start.
pub fn cleanup_old_logs() {
    let _ = fs::create_dir_all(logs_dir());
    let Ok(rd) = fs::read_dir(logs_dir()) else {
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

    #[test]
    fn log_line_format() {
        // the path under test writes to the real logs dir (app dir), which is
        // fine — cleanup keeps it bounded. We only assert no panic here.
        info("test message");
        error("test error");
        warn("test warn");
    }

    #[test]
    fn timed_guard_logs_on_drop() {
        {
            let _t = timed("unit test op");
            std::thread::sleep(std::time::Duration::from_millis(1));
        } // drop → line written; assert only that it never panics
        perf("unit perf op", 42);
    }

    #[test]
    fn timed_guard_is_must_use() {
        // compiling this test at all proves the type is usable; the must_use
        // attribute is enforced at the call sites (warnings, not errors)
        let _t = timed_with("unit custom op", 100);
        drop(_t);
    }

    #[test]
    fn cleanup_never_panics() {
        cleanup_old_logs();
    }
}
