// logging.rs — the technical log: one rotating file, INFO for operations,
// ERROR always. 7-day retention. This file is for US debugging user reports,
// never shown in the UI.

use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

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
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(log_path()) {
        let _ = writeln!(f, "{clock} [{level}] {msg}");
    }
}

pub fn info(msg: &str) {
    write_line("INFO", msg);
}

pub fn error(msg: &str) {
    write_line("ERROR", msg);
}

/// Delete log files older than 7 days — called once at app start.
pub fn cleanup_old_logs() {
    let _ = fs::create_dir_all(logs_dir());
    let Ok(rd) = fs::read_dir(logs_dir()) else { return };
    let cutoff = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64 - 7 * 86_400)
        .unwrap_or(0);
    for entry in rd.flatten() {
        let Ok(meta) = entry.metadata() else { continue };
        let Ok(modified) = meta.modified() else { continue };
        let Ok(age) = modified.duration_since(std::time::UNIX_EPOCH) else { continue };
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
    }

    #[test]
    fn cleanup_never_panics() {
        cleanup_old_logs();
    }
}
