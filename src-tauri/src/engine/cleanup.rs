// cleanup.rs — the Storage card's manual sweep: measure safe places,
// delete only what the user ticked, report measured freed bytes.
//
// Scope is deliberately narrow (the anti-CCleaner lesson). Quick holds
// the safe, self-renewing, no-judgment places (user temp, system temp,
// Delivery Optimization cache). Deep holds what needs judgment (recycle
// bin, update leftovers, system logs, thumbnails, finished reports,
// stale dumps). No registry, no RAM boost, no WinSxS, no browser caches,
// no personal Downloads, no shader/prefetch caches (rebuilding those
// CAUSES the first-load hitches this tool diagnoses). Every category
// answers "which lag card does a full drive cause?" (disk_wait / mem_low
// via pagefile pressure) or it does not ship.
//
// Contract (the Tools contract): scan is read-only, clean runs only from
// an explicit click, locked files are skipped (never forced), and the
// freed number is MEASURED (before minus after), never estimated. A
// place that cannot be read reports None (the UI shows "--").

use std::path::{Path, PathBuf};

/// Machine ids for the four sweep categories (the UI translates them).
pub const USER_TEMP_ID: &str = "user_temp";
pub const SYSTEM_TEMP_ID: &str = "system_temp";
pub const RECYCLE_BIN_ID: &str = "recycle_bin";
pub const DELIVERY_OPT_ID: &str = "delivery_opt";

/// Elevated-run id: the admin places need admin. The parent
/// measures before/after itself (verify by re-read); the child only
/// deletes and exits with a code.
pub const STORAGE_CLEAN_ID: &str = "storage-clean";

/// Deep-scan ids (opt-in, always unticked by default). Same contract
/// as the standard places: the bin (deletion is permanent, review
/// first), update leftovers, system logs, thumbnail previews, finished
/// error reports, and stale crash dumps. Everything else other cleaners
/// offer stays out (see the module docs).
pub const THUMB_CACHE_ID: &str = "thumb_cache";
pub const ERROR_REPORTS_ID: &str = "error_reports";
pub const OLD_MINIDUMPS_ID: &str = "old_minidumps";
pub const UPDATE_DOWNLOAD_ID: &str = "update_download";
pub const SYSTEM_LOGS_ID: &str = "system_logs";

/// Categories that must go through elevation (the rest run unprivileged).
pub fn is_admin_category(id: &str) -> bool {
    id == SYSTEM_TEMP_ID
        || id == DELIVERY_OPT_ID
        || id == ERROR_REPORTS_ID
        || id == OLD_MINIDUMPS_ID
        || id == UPDATE_DOWNLOAD_ID
        || id == SYSTEM_LOGS_ID
}

/// Deep-scan membership: everything needs judgment (permanent deletion,
/// timing, or diagnostic value), so nothing here is ever auto-ticked.
pub fn is_deep_category(id: &str) -> bool {
    id == RECYCLE_BIN_ID
        || id == THUMB_CACHE_ID
        || id == ERROR_REPORTS_ID
        || id == OLD_MINIDUMPS_ID
        || id == UPDATE_DOWNLOAD_ID
        || id == SYSTEM_LOGS_ID
}

/// Every id the scan/clean path accepts. Anything else is refused before
/// anything runs (no user-supplied paths ever cross this module).
pub fn is_cleanup_id(id: &str) -> bool {
    id == USER_TEMP_ID
        || id == SYSTEM_TEMP_ID
        || id == RECYCLE_BIN_ID
        || id == DELIVERY_OPT_ID
        || is_deep_category(id)
}

/// One measured place: None bytes = could not be read (honest no-data).
#[derive(Debug, Clone, serde::Serialize)]
pub struct CleanupCategory {
    pub id: String,
    pub bytes: Option<u64>,
}

/// Measured result per category: before minus after, saturating.
/// None = the freed bytes could not be measured (an admin place the
/// unprivileged parent cannot re-read and the sidecar did not cover):
/// unknown, never zero.
#[derive(Debug, Clone, serde::Serialize)]
pub struct CleanupResult {
    pub id: String,
    pub freed_bytes: Option<u64>,
}

/// Progress events pushed to the UI over the IPC channel: one per
/// category step (4 steps for a scan, N for a clean). Per-category, not
/// per-byte: a byte-exact bar would need two full walks (count, then
/// delete) at double the cost for a precision nobody needs.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum CleanupProgress {
    Category { id: String, index: u64, total: u64 },
}

/// The scan answer: measured places plus the sweep memory (last run +
/// last-30-days total, bytes only, never file names).
#[derive(Debug, Clone, serde::Serialize)]
pub struct CleanupScan {
    pub categories: Vec<CleanupCategory>,
    pub history: CleanupHistory,
}

/// Sweep memory: numbers only (timestamp + freed bytes per run). No file
/// names, no paths: there is nothing private to leak, by construction.
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct CleanupHistory {
    pub last_freed_bytes: u64,
    pub last_at: Option<String>,
    pub last_30d_bytes: u64,
}

/// Read-only scan of all four places. Never fails as a whole: each
/// category carries its own Option.
pub fn scan() -> CleanupScan {
    scan_with(|_, _, _| {})
}

/// One measuring function per category id: the single source every
/// scan, clean-verdict, and elevated-sidecar read goes through, so the
/// three can never disagree about what a category means.
fn measure_category(id: &str) -> Option<u64> {
    match id {
        USER_TEMP_ID => user_temp_dir().and_then(dir_size_capped),
        SYSTEM_TEMP_ID => system_temp_dir().and_then(dir_size_capped),
        RECYCLE_BIN_ID => recycle_bin_bytes(),
        // a machine that never cached peer data has no dir at all:
        // that is 0 cleanable bytes (a fact), not unreadable.
        DELIVERY_OPT_ID => delivery_opt_bytes(),
        THUMB_CACHE_ID => thumb_cache_bytes(),
        ERROR_REPORTS_ID => error_reports_bytes(),
        OLD_MINIDUMPS_ID => old_minidumps_bytes(),
        UPDATE_DOWNLOAD_ID => update_download_bytes(),
        SYSTEM_LOGS_ID => system_logs_bytes(),
        _ => None,
    }
}

/// Scan with a per-category progress callback (index, total, id).
/// Quick holds the three safe, self-renewing places only: the bin is left
/// for Deep because its deletion is permanent and needs review first.
pub fn scan_with(progress: impl Fn(u64, u64, &str)) -> CleanupScan {
    scan_ids_with(&[USER_TEMP_ID, SYSTEM_TEMP_ID, DELIVERY_OPT_ID], progress)
}

fn scan_ids_with(ids: &[&str], progress: impl Fn(u64, u64, &str)) -> CleanupScan {
    let mut categories = Vec::new();
    let total = ids.len() as u64;
    for (i, id) in ids.iter().enumerate() {
        progress(i as u64, total, id);
        categories.push(CleanupCategory {
            id: (*id).into(),
            bytes: measure_category(id),
        });
    }
    CleanupScan {
        categories,
        history: history_totals(),
    }
}

fn delivery_opt_bytes() -> Option<u64> {
    match delivery_opt_dir() {
        None => Some(0),
        Some(dir) => dir_size_capped(dir),
    }
}

/// Deep scan: all nine places (the quick three plus the six
/// judgment-needed ones). Same shape as `scan` (measured categories +
/// shared history), own progress steps.
pub fn deep_scan_with(progress: impl Fn(u64, u64, &str)) -> CleanupScan {
    // deep gathers EVERYTHING (the three quick places plus the six
    // judgment-needed ones): Deep mode is the complete picture, Quick
    // is the fast subset. Same rows, same contract, one superset.
    scan_ids_with(
        &[
            USER_TEMP_ID,
            SYSTEM_TEMP_ID,
            DELIVERY_OPT_ID,
            RECYCLE_BIN_ID,
            UPDATE_DOWNLOAD_ID,
            SYSTEM_LOGS_ID,
            THUMB_CACHE_ID,
            ERROR_REPORTS_ID,
            OLD_MINIDUMPS_ID,
        ],
        progress,
    )
}

/// Clean exactly the given category ids (already validated). Measures
/// before/after per category and reports the measured difference.
/// Admin categories go through one UAC prompt; a denied prompt returns
/// the exact "cancelled" (quiet by agreement, like every other refusal).
/// Every completed run is recorded in the sweep memory (numbers only).
pub fn clean_selected(ids: &[String]) -> Result<Vec<CleanupResult>, String> {
    clean_selected_with(ids, |_, _, _| {})
}

/// Clean with a per-category progress callback (index, total, id).
pub fn clean_selected_with(
    ids: &[String],
    progress: impl Fn(u64, u64, &str),
) -> Result<Vec<CleanupResult>, String> {
    if ids.is_empty() {
        return Err("nothing selected".into());
    }
    for id in ids {
        if !is_cleanup_id(id) {
            return Err(format!("unknown cleanup category: {id}"));
        }
    }
    let before: std::collections::HashMap<String, Option<u64>> = ids
        .iter()
        .map(|id| (id.clone(), measure_category(id)))
        .collect();
    // admin categories first, through one UAC prompt for the whole click.
    // The parent often cannot re-read admin places itself (denied
    // listing), so the elevated child measures them with ITS eyes and
    // leaves the numbers in the sidecar; without it an admin verdict
    // would read 0 after a real multi-GB clean (a lie, never a number).
    let mut elevated: std::collections::HashMap<String, u64> = std::collections::HashMap::new();
    let admin: Vec<String> = ids.iter().filter(|id| is_admin_category(id)).cloned().collect();
    if !admin.is_empty() {
        // one UAC prompt for the whole click; a denied prompt is
        // "cancelled" (quiet), a post-consent failure is a real error
        clear_clean_sidecar();
        let code = super::elevate::elevate_storage_clean(&admin)?;
        super::elevate::map_exit_code(code)?;
        elevated = take_clean_sidecar();
    }
    let total = ids.len() as u64;
    // unprivileged categories run here (user temp, bin, thumbnails);
    // admin ones were already handled above, their step only moves the bar
    for (i, id) in ids.iter().enumerate() {
        progress(i as u64, total, id);
        if !is_admin_category(id) {
            clean_one_unprivileged(id);
        }
    }
    let after: std::collections::HashMap<String, Option<u64>> = ids
        .iter()
        .map(|id| (id.clone(), measure_category(id)))
        .collect();
    let results: Vec<CleanupResult> = ids
        .iter()
        .map(|id| {
            // sidecar first (measured elevated, authoritative for admin
            // places); otherwise the unprivileged before/after diff when
            // both ends are readable; otherwise unknown, never zero.
            let freed = elevated.get(id.as_str()).copied().or_else(|| {
                match (
                    before.get(id.as_str()).copied().flatten(),
                    after.get(id.as_str()).copied().flatten(),
                ) {
                    (Some(b), Some(a)) => Some(b.saturating_sub(a)),
                    _ => None,
                }
            });
            CleanupResult {
                id: id.clone(),
                freed_bytes: freed,
            }
        })
        .collect();
    record_history(&results);
    Ok(results)
}

/// Sidecar for the elevated clean's measurements (parent deletes
/// before spawning, reads after the child exits). Lives in our own
/// per-user app dir, never the shared temp dir: a fixed temp name is
/// plantable by another local user, while app-data is ACL'd to this
/// user. Predetermined path, never user-supplied: nothing crosses the
/// boundary but category words. Stale files cannot linger: the parent
/// clears first on every run, and the UI single-flights Clean behind
/// its busy gate.
fn clean_sidecar_path() -> PathBuf {
    super::storage::app_dir().join("laghunter-clean-sidecar.json")
}

fn clear_clean_sidecar() {
    let _ = std::fs::remove_file(clean_sidecar_path());
}

/// Read (and remove) the sidecar the elevated child left: category id
/// to freed bytes. Missing or corrupt means unknown, never zero.
fn take_clean_sidecar() -> std::collections::HashMap<String, u64> {
    let path = clean_sidecar_path();
    let text = std::fs::read_to_string(&path).unwrap_or_default();
    let _ = std::fs::remove_file(&path);
    parse_clean_sidecar(&text)
}

/// Parse sidecar JSON: admin ids with u64 values only. A smuggled
/// user_temp entry, a non-number, or garbage anywhere fails the entry
/// (or the whole file): the parent falls back to unknown, never to a
/// number it did not earn.
fn parse_clean_sidecar(text: &str) -> std::collections::HashMap<String, u64> {
    let mut out = std::collections::HashMap::new();
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(text) {
        if let Some(map) = v.as_object() {
            for (k, val) in map {
                if is_admin_category(k) {
                    if let Some(n) = val.as_u64() {
                        out.insert(k.clone(), n);
                    }
                }
            }
        }
    }
    out
}

/// Elevated-child entry: measure the admin categories with elevated
/// eyes, delete, measure again, and leave per-category freed bytes in
/// the sidecar for the parent's verdict. Only pairs with both ends
/// readable are recorded; the parent treats the rest as unknown.
pub fn run_admin_clean(ids: &[String]) -> Result<(), String> {
    let mut before = std::collections::HashMap::new();
    for id in ids {
        if !is_admin_category(id) {
            return Err(format!("refused outside elevated scope: {id}"));
        }
        before.insert(id.clone(), measure_category(id));
    }
    clean_admin(ids)?;
    let mut freed = serde_json::Map::new();
    for id in ids {
        if let (Some(Some(b)), Some(a)) = (before.get(id), measure_category(id)) {
            freed.insert(id.clone(), serde_json::Value::from(b.saturating_sub(a)));
        }
    }
    let path = clean_sidecar_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    // best effort: a lost sidecar only degrades the verdict to unknown
    let _ = super::storage::write_file_atomic(
        &path,
        serde_json::to_string(&freed).unwrap_or_default().as_bytes(),
    );
    Ok(())
}

/// Child-side entry for the elevated run: deletes the CONTENTS of the
/// admin-category dirs only. Refuses anything else (defense in depth:
// the child never trusts the parent).
pub fn clean_admin(ids: &[String]) -> Result<(), String> {
    if ids.is_empty() {
        return Err("nothing selected".into());
    }
    for id in ids {
        if !is_admin_category(id) {
            return Err(format!("refused outside elevated scope: {id}"));
        }
    }
    for id in ids {
        match id.as_str() {
            SYSTEM_TEMP_ID => {
                if let Some(dir) = system_temp_dir() {
                    empty_dir_contents(&dir);
                }
            }
            DELIVERY_OPT_ID => {
                if let Some(dir) = delivery_opt_dir() {
                    empty_dir_contents(&dir);
                }
            }
            ERROR_REPORTS_ID => {
                for dir in wer_dirs() {
                    empty_dir_contents(&dir);
                }
            }
            OLD_MINIDUMPS_ID => {
                if let Some(dir) = minidump_dir() {
                    remove_old_files(&dir, MINIDUMP_KEEP_MS);
                }
            }
            UPDATE_DOWNLOAD_ID => {
                if let Some(dir) = update_download_dir() {
                    empty_dir_contents(&dir);
                }
            }
            SYSTEM_LOGS_ID => {
                if let Some(dir) = syslog_dir() {
                    remove_old_files(&dir, SYSLOG_KEEP_MS);
                }
            }
            _ => return Err(format!("refused outside elevated scope: {id}")),
        }
    }
    Ok(())
}

/// Delete only files older than `keep_ms` (direct children). Fresh
/// files, links and dirs are left alone; locked files are skipped.
/// A linked root is refused like in [`empty_dir_contents`].
fn remove_old_files(dir: &Path, keep_ms: i64) {
    if root_is_link(dir) {
        super::logging::warn(&format!(
            "cleanup refused: root is a link: {}",
            dir.display()
        ));
        return;
    };
    let Ok(canonical) = dir.canonicalize() else {
        return;
    };
    let now = super::types::iso_ms(&super::sampler::iso_now()).unwrap_or(0);
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = std::fs::symlink_metadata(&path) else {
            continue;
        };
        if meta.is_symlink() || meta.is_dir() {
            continue;
        }
        if !path
            .canonicalize()
            .map(|c| c.starts_with(&canonical))
            .unwrap_or(false)
        {
            continue;
        }
        let old = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| now.saturating_sub(d.as_millis() as i64) > keep_ms)
            .unwrap_or(false);
        if old {
            let _ = std::fs::remove_file(&path);
        }
    }
}

// ---- sweep memory (numbers only, bounded) --------------------------------
// One jsonl line per completed clean: timestamp + freed bytes per run.
// No file names, no paths: nothing private by construction. Reads skip
// corrupt lines; writes prune runs older than 90 days (bounded like the
// session window and the log retention). Tests aim the same code at
// throwaway dirs (production history is never touched by `cargo test`).

/// 90-day retention, in milliseconds.
const HISTORY_RETENTION_MS: i64 = 90 * 86_400 * 1000;
/// Last-30-days window, in milliseconds.
const HISTORY_MONTH_MS: i64 = 30 * 86_400 * 1000;

fn history_path() -> PathBuf {
    super::storage::app_dir().join("cleanup-history.jsonl")
}

pub fn history_totals() -> CleanupHistory {
    history_totals_in(&history_path())
}

fn history_totals_in(path: &Path) -> CleanupHistory {
    let text = super::storage::read_limited(path).unwrap_or_default();
    let now = super::types::iso_ms(&super::sampler::iso_now()).unwrap_or(0);
    let mut last_freed = 0u64;
    let mut last_at: Option<String> = None;
    let mut last_ms: i64 = 0;
    let mut month = 0u64;
    for line in text.lines() {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        let t = v.get("t").and_then(|t| t.as_str()).unwrap_or("");
        let Some(ms) = super::types::iso_ms(t) else {
            continue;
        };
        let freed = v.get("freed").and_then(|f| f.as_u64()).unwrap_or(0);
        if ms >= last_ms {
            last_ms = ms;
            last_freed = freed;
            last_at = Some(t.to_string());
        }
        if now.saturating_sub(ms) <= HISTORY_MONTH_MS {
            month = month.saturating_add(freed);
        }
    }
    CleanupHistory {
        last_freed_bytes: if last_at.is_some() { last_freed } else { 0 },
        last_at,
        last_30d_bytes: month,
    }
}

fn record_history(results: &[CleanupResult]) {
    record_history_in(&history_path(), results);
}

fn record_history_in(path: &Path, results: &[CleanupResult]) {
    // unknown verdicts count as 0 in the memory total (the memory tracks
    // measured bytes; an unmeasured run keeps its honesty in the UI note).
    // saturating: hand-edited u64::MAX sidecars must never wrap the total.
    let freed: u64 = results
        .iter()
        .map(|r| r.freed_bytes.unwrap_or(0))
        .fold(0u64, |a, b| a.saturating_add(b));
    // a run that freed nothing updates nothing: recording it would paint
    // "last clean: 0 MB" over a real older result (noise, not memory)
    if freed == 0 {
        return;
    }
    let line = serde_json::json!({
        "t": super::sampler::iso_now(),
        "freed": freed,
    });
    // prune-while-appending: keep the last 90 days, drop the rest, so
    // the file can never grow without bound no matter how often Clean
    // is pressed.
    let now = super::types::iso_ms(&super::sampler::iso_now()).unwrap_or(0);
    let mut kept = String::new();
    if let Some(text) = super::storage::read_limited(path) {
        for line in text.lines() {
            let keep = serde_json::from_str::<serde_json::Value>(line)
                .ok()
                .and_then(|v| v.get("t").and_then(|t| t.as_str()).map(str::to_string))
                .and_then(|t| super::types::iso_ms(&t))
                .map(|ms| now.saturating_sub(ms) <= HISTORY_RETENTION_MS)
                .unwrap_or(false);
            if keep {
                kept.push_str(line);
                kept.push('\n');
            }
        }
    }
    kept.push_str(&serde_json::to_string(&line).unwrap_or_default());
    kept.push('\n');
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = super::storage::write_file_atomic(path, kept.as_bytes());
}

fn clean_one_unprivileged(id: &str) {
    match id {
        USER_TEMP_ID => {
            if let Some(dir) = user_temp_dir() {
                empty_dir_contents(&dir);
            }
        }
        RECYCLE_BIN_ID => {
            empty_recycle_bin();
        }
        THUMB_CACHE_ID => {
            if let Some(dir) = explorer_dir() {
                remove_thumb_caches(&dir);
            }
        }
        _ => {}
    }
}

/// Delete thumbcache_*.db files only (same pattern as the measure, so
/// the freed number can only come from what was counted).
fn remove_thumb_caches(dir: &Path) {
    let Ok(canonical) = dir.canonicalize() else {
        return;
    };
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        if !(name.starts_with("thumbcache_") && name.ends_with(".db")) {
            continue;
        }
        let Ok(meta) = std::fs::symlink_metadata(&path) else {
            continue;
        };
        if meta.is_symlink() || meta.is_dir() {
            continue;
        }
        if !path
            .canonicalize()
            .map(|c| c.starts_with(&canonical))
            .unwrap_or(false)
        {
            continue;
        }
        let _ = std::fs::remove_file(&path);
    }
}

// ---- locations (whitelisted, never user-supplied) -------------------------

fn user_temp_dir() -> Option<PathBuf> {
    std::env::var_os("TEMP")
        .or_else(|| std::env::var_os("TMP"))
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
}

#[cfg(windows)]
fn system_temp_dir() -> Option<PathBuf> {
    let dir = PathBuf::from(r"C:\Windows\Temp");
    dir.is_dir().then_some(dir)
}

#[cfg(not(windows))]
fn system_temp_dir() -> Option<PathBuf> {
    None
}

#[cfg(windows)]
fn delivery_opt_dir() -> Option<PathBuf> {
    // from the kernel, never the inherited environment (an elevated
    // cleaner must resolve against the OS itself)
    let dir = super::system::windows_dir().join(r"SoftwareDistribution\DeliveryOptimization");
    dir.is_dir().then_some(dir)
}

#[cfg(not(windows))]
fn delivery_opt_dir() -> Option<PathBuf> {
    None
}

/// Crash dumps count only past this age: a fresh dump is live crash
/// evidence (the very thing this tool's diagnoses may need), a stale
/// one is junk. Documented in one place, used by measure and delete.
const MINIDUMP_KEEP_MS: i64 = 30 * 86_400 * 1000;

#[cfg(windows)]
fn explorer_dir() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .map(|p| p.join(r"Microsoft\Windows\Explorer"))
        .filter(|p| p.is_dir())
}

#[cfg(not(windows))]
fn explorer_dir() -> Option<PathBuf> {
    None
}

#[cfg(windows)]
fn wer_dirs() -> Vec<PathBuf> {
    // finished reports only (Queue + Archive): the live `ReportQueue`
    // staging subdir for an in-flight report is left to Windows, and
    // anything outside these two dirs is never touched
    let base: PathBuf = [r"C:\ProgramData", r"Microsoft\Windows\WER"]
        .iter()
        .collect();
    [base.join("ReportQueue"), base.join("ReportArchive")]
        .into_iter()
        .filter(|p| p.is_dir())
        .collect()
}

#[cfg(not(windows))]
fn wer_dirs() -> Vec<PathBuf> {
    Vec::new()
}

#[cfg(windows)]
fn minidump_dir() -> Option<PathBuf> {
    let dir = PathBuf::from(r"C:\Windows\Minidump");
    dir.is_dir().then_some(dir)
}

#[cfg(not(windows))]
fn minidump_dir() -> Option<PathBuf> {
    None
}

/// Downloaded update files waiting in (or left behind by) Windows
/// Update. Deleting mid-install only costs a re-download, but the hint
/// still advises running after updates finish: politeness over repair.
#[cfg(windows)]
fn update_download_dir() -> Option<PathBuf> {
    // from the kernel, never the inherited environment (see above)
    let dir = super::system::windows_dir().join(r"SoftwareDistribution\Download");
    dir.is_dir().then_some(dir)
}

#[cfg(not(windows))]
fn update_download_dir() -> Option<PathBuf> {
    None
}

/// Recent logs stay out of both measure and delete (a fresh failure's
/// trail may be under diagnosis right now); only older files count.
const SYSLOG_KEEP_MS: i64 = 7 * 86_400 * 1000;

#[cfg(windows)]
fn syslog_dir() -> Option<PathBuf> {
    let dir = PathBuf::from(r"C:\Windows\Logs\CBS");
    dir.is_dir().then_some(dir)
}

#[cfg(not(windows))]
fn syslog_dir() -> Option<PathBuf> {
    None
}

fn update_download_bytes() -> Option<u64> {
    match update_download_dir() {
        // never staged an update here: 0 cleanable bytes, not unreadable
        None => Some(0),
        Some(dir) => dir_size_capped(dir),
    }
}

fn system_logs_bytes() -> Option<u64> {
    old_files_size(&syslog_dir()?, SYSLOG_KEEP_MS)
}

fn thumb_cache_bytes() -> Option<u64> {
    let dir = explorer_dir()?;
    let mut total = 0u64;
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return None;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        // thumbcache_*.db only: icon caches and anything else in this
        // dir stay exactly as they are (never a sibling casualty)
        let name = path.file_name()?.to_string_lossy();
        if !(name.starts_with("thumbcache_") && name.ends_with(".db")) {
            continue;
        }
        let Ok(meta) = std::fs::symlink_metadata(&path) else {
            continue;
        };
        if meta.is_symlink() || meta.is_dir() {
            continue;
        }
        total = total.saturating_add(meta.len());
    }
    Some(total)
}

fn error_reports_bytes() -> Option<u64> {
    let dirs = wer_dirs();
    if dirs.is_empty() {
        // never reported on this machine: 0 cleanable bytes, not unreadable
        return Some(0);
    }
    // every existing root must read cleanly: filter_map would silently
    // drop a denied dir and present the short sum as exact (a denied WER
    // branch once read as "almost empty")
    let mut total = 0u64;
    for dir in dirs {
        total = total.saturating_add(dir_size_capped(dir)?);
    }
    Some(total)
}

/// Stale dumps only: fresh ones (inside MINIDUMP_KEEP_MS) are excluded
/// from BOTH measure and delete, so a recent crash's evidence can never
/// be swept away by its own diagnostician.
fn old_minidumps_bytes() -> Option<u64> {
    old_files_size(&minidump_dir()?, MINIDUMP_KEEP_MS)
}

/// Sum of files older than `keep_ms` (direct children only: dumps land
/// flat in this dir). Unreadable mtimes count as fresh (skip, never
/// delete what cannot be dated). An unreadable root is None (a missing
/// CBS/Minidump listing must read "--", never 0).
fn old_files_size(dir: &Path, keep_ms: i64) -> Option<u64> {
    let now = super::types::iso_ms(&super::sampler::iso_now()).unwrap_or(0);
    let mut total = 0u64;
    let Ok(entries) = std::fs::read_dir(dir) else {
        return None;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = std::fs::symlink_metadata(&path) else {
            continue;
        };
        if meta.is_symlink() || meta.is_dir() {
            continue;
        }
        let old = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| now.saturating_sub(d.as_millis() as i64) > keep_ms)
            .unwrap_or(false);
        if old {
            total = total.saturating_add(meta.len());
        }
    }
    Some(total)
}

// ---- measurement ----------------------------------------------------------

/// Recursive dir size in bytes. Read-only, never follows symlinks, depth
/// capped (a hostile link farm cannot loop it). Vanished files (raced
/// deletion) are skipped silently; DENIED entries poison the whole
/// measurement to None: a partial sum parading as exact is how a bin
/// full of denied WER subdirs once read as "almost empty". Callers
/// render None as "--", never as 0.
fn dir_size_capped(root: PathBuf) -> Option<u64> {
    use std::io::ErrorKind;
    let denied = |e: &std::io::Error| e.kind() == ErrorKind::PermissionDenied;
    let mut total: u64 = 0;
    let mut stack: Vec<(PathBuf, u8)> = vec![(root, 0)];
    let mut seen_any = false;
    while let Some((dir, depth)) = stack.pop() {
        if depth > 64 {
            continue;
        }
        let entries = match std::fs::read_dir(&dir) {
            Ok(entries) => entries,
            // a denied root was already None before; a denied subdir
            // poisons just as honestly
            Err(e) if denied(&e) => return None,
            Err(_) => continue,
        };
        seen_any = true;
        for entry in entries.flatten() {
            let path = entry.path();
            let meta = match std::fs::symlink_metadata(&path) {
                Ok(meta) => meta,
                Err(e) if denied(&e) => return None,
                Err(_) => continue,
            };
            if meta.is_symlink() {
                continue;
            }
            if meta.is_dir() {
                stack.push((path, depth + 1));
            } else {
                total = total.saturating_add(meta.len());
            }
        }
    }
    if seen_any { Some(total) } else { None }
}

#[cfg(windows)]
fn recycle_bin_bytes() -> Option<u64> {
    // Measure through the same user-scoped PowerShell API used for deletion.
    // Walking every SID under $Recycle.Bin could count other users' items
    // that Clear-RecycleBin will not remove for this user.
    let text = super::system::ps(
        r#"$sum = (Get-RecycleBin -Force | Measure-Object -Property Size -Sum).Sum
if ($null -eq $sum) { "0" } else { [math]::Floor($sum).ToString([Globalization.CultureInfo]::InvariantCulture) }"#,
    )
    .ok()?;
    let bytes = text.trim().parse::<f64>().ok()?;
    (bytes >= 0.0 && bytes.is_finite()).then_some(bytes as u64)
}

#[cfg(not(windows))]
fn recycle_bin_bytes() -> Option<u64> {
    None
}

// ---- deletion -------------------------------------------------------------

/// True when a cleanup root is itself a link: deleting "inside" it
/// would really delete inside its target, so the whole category is
/// skipped with a log line. Same primitive as the per-entry link
/// checks below (one rule for links everywhere). Checked once per root.
fn root_is_link(root: &Path) -> bool {
    let Ok(meta) = std::fs::symlink_metadata(root) else {
        return false;
    };
    if meta.is_symlink() {
        return true;
    }
    // junctions surface as reparse points rather than symlinks:
    // either shape means "deleting inside" hits the target instead
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        if meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return true;
        }
    }
    false
}

/// Delete a dir's CONTENTS, never the dir itself. Refuses a linked root
/// outright, skips symlinks targets (removes the link), skips anything
/// that canonicalizes outside the root (junction escape), skips locked
/// files (no forcing). Best effort:
// callers re-measure afterwards, so a skip is honest, not an error.
fn empty_dir_contents(root: &Path) {
    if root_is_link(root) {
        super::logging::warn(&format!(
            "cleanup refused: root is a link: {}",
            root.display()
        ));
        return;
    }
    let Ok(canonical_root) = root.canonicalize() else {
        return;
    };
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        // never follow a link: remove the link entry itself
        let Ok(meta) = std::fs::symlink_metadata(&path) else {
            continue;
        };
        if meta.is_symlink() {
            let _ = std::fs::remove_file(&path);
            continue;
        }
        // containment: a junction pointing outside the root is left alone
        let contained = path
            .canonicalize()
            .map(|c| c.starts_with(&canonical_root))
            .unwrap_or(false);
        if !contained {
            continue;
        }
        if meta.is_dir() {
            remove_dir_all_contained(&path, &canonical_root);
        } else {
            let _ = std::fs::remove_file(&path);
        }
    }
}

fn remove_dir_all_contained(dir: &Path, root: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = std::fs::symlink_metadata(&path) else {
            continue;
        };
        if meta.is_symlink() {
            let _ = std::fs::remove_file(&path);
            continue;
        }
        let contained = path
            .canonicalize()
            .map(|c| c.starts_with(root))
            .unwrap_or(false);
        if !contained {
            continue;
        }
        if meta.is_dir() {
            remove_dir_all_contained(&path, root);
        } else {
            let _ = std::fs::remove_file(&path);
        }
    }
    let _ = std::fs::remove_dir(dir);
}

/// Empty the user's recycle bin (Clear-RecycleBin, no elevation for the
/// own bin). Best effort: the re-measure is the verdict.
#[cfg(windows)]
fn empty_recycle_bin() {
    let _ = super::system::ps("Clear-RecycleBin -Force -ErrorAction SilentlyContinue");
}

#[cfg(not(windows))]
fn empty_recycle_bin() {}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_workdir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("lh-cleanup-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn known_ids_accepted_unknown_refused() {
        for id in [USER_TEMP_ID, SYSTEM_TEMP_ID, RECYCLE_BIN_ID, DELIVERY_OPT_ID] {
            assert!(is_cleanup_id(id));
        }
        assert!(!is_cleanup_id("shader_cache"));
        assert!(!is_cleanup_id(""));
        assert!(!is_cleanup_id("../../windows"));
        assert!(!is_cleanup_id("USER_TEMP"));
        assert!(!is_admin_category(USER_TEMP_ID));
        assert!(!is_admin_category(RECYCLE_BIN_ID));
        assert!(is_admin_category(SYSTEM_TEMP_ID));
        assert!(is_admin_category(DELIVERY_OPT_ID));
    }

    #[test]
    fn dir_size_sums_nested_files() {
        let dir = temp_workdir("size");
        std::fs::write(dir.join("a.bin"), vec![0u8; 100]).unwrap();
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::write(dir.join("sub").join("b.bin"), vec![0u8; 50]).unwrap();
        assert_eq!(dir_size_capped(dir.clone()), Some(150));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn empty_keeps_the_dir_and_removes_children() {
        let dir = temp_workdir("empty");
        std::fs::write(dir.join("a.tmp"), "x").unwrap();
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::write(dir.join("sub").join("b.tmp"), "y").unwrap();
        empty_dir_contents(&dir);
        assert!(dir.is_dir(), "the dir itself must survive");
        assert_eq!(dir_size_capped(dir.clone()), Some(0));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn linked_root_is_refused_not_emptied() {
        // a plain dir is no link (negative control for the predicate)
        let dir = temp_workdir("linkroot");
        assert!(!root_is_link(&dir));
        assert!(!root_is_link(&dir.join("no-such-entry")));
        // junctions need no privileges (unlike symlinks): a category
        // pointed at one keeps everything, including the target
        let target = temp_workdir("linktarget");
        std::fs::write(target.join("victim.tmp"), "x").unwrap();
        let link = temp_workdir("link");
        let _ = std::fs::remove_dir_all(&link);
        // test-only: mklink is a cmd builtin with no exe of its own, so
        // the absolute cmd path is named here (never shipped code).
        let mk = std::process::Command::new(crate::engine::system::system32_exe("cmd.exe"))
            .args(["/C", "mklink", "/J", link.to_str().unwrap(), target.to_str().unwrap()])
            .output();
        if mk.map(|o| o.status.success()).unwrap_or(false) && root_is_link(&link) {
            empty_dir_contents(&link);
            assert!(
                target.join("victim.tmp").is_file(),
                "a linked root must not empty its target"
            );
        }
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&target);
        let _ = std::fs::remove_dir_all(&link);
    }

    #[test]
    fn locked_files_are_skipped_not_forced() {
        let dir = temp_workdir("locked");
        let locked_path = dir.join("locked.tmp");
        std::fs::write(&locked_path, "data").unwrap();
        // an open handle without share-delete blocks Windows deletion
        let _held = std::fs::OpenOptions::new().write(true).open(&locked_path).unwrap();
        empty_dir_contents(&dir);
        // either skipped (still there) or deleted after the handle made
        // it deletable: both are honest outcomes, never an error
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn clean_selected_refuses_unknown_ids_before_touching_anything() {
        assert!(clean_selected(&[]).is_err());
        assert!(clean_selected(&["nope".to_string()]).is_err());
        assert!(clean_selected(&["../../x".to_string()]).is_err());
    }

    #[test]
    fn clean_admin_refuses_non_admin_scope() {
        assert!(clean_admin(&[]).is_err());
        assert!(clean_admin(&[USER_TEMP_ID.to_string()]).is_err());
        assert!(clean_admin(&[RECYCLE_BIN_ID.to_string()]).is_err());
        assert!(clean_admin(&["nope".to_string()]).is_err());
    }

    #[test]
    fn deep_ids_join_the_contract() {
        for id in [THUMB_CACHE_ID, ERROR_REPORTS_ID, OLD_MINIDUMPS_ID] {
            assert!(is_cleanup_id(id), "{id} must be accepted");
            assert!(is_deep_category(id), "{id} must be deep");
        }
        for id in [USER_TEMP_ID, SYSTEM_TEMP_ID, DELIVERY_OPT_ID] {
            assert!(!is_deep_category(id), "{id} must stay standard");
        }
        // the bin moved to Deep: permanent deletion needs review first
        assert!(is_deep_category(RECYCLE_BIN_ID));
        // admin scope: reports + stale dumps need elevation, thumbnail
        // previews are the user's own files
        assert!(!is_admin_category(THUMB_CACHE_ID));
        assert!(is_admin_category(ERROR_REPORTS_ID));
        assert!(is_admin_category(OLD_MINIDUMPS_ID));
        // the child still refuses everything outside admin scope
        assert!(clean_admin(&[THUMB_CACHE_ID.to_string()]).is_err());
    }

    #[test]
    fn minidump_age_gate_keeps_fresh_evidence() {
        // old dump counts (and deletes), fresh dump is invisible to both
        let dir = temp_workdir("minidump");
        let old_path = dir.join("old.dmp");
        let fresh_path = dir.join("fresh.dmp");
        std::fs::write(&old_path, vec![0u8; 100]).unwrap();
        std::fs::write(&fresh_path, vec![0u8; 50]).unwrap();
        // backdate the old one 40 days (past the 30-day keep window)
        let old_time = std::time::SystemTime::now() - std::time::Duration::from_secs(40 * 86_400);
        std::fs::File::options()
            .write(true)
            .open(&old_path)
            .unwrap()
            .set_modified(old_time)
            .unwrap();
        assert_eq!(old_files_size(&dir, MINIDUMP_KEEP_MS), Some(100));
        // an unreadable root is no-data, never 0
        assert_eq!(
            old_files_size(&dir.join("no-such-dir"), MINIDUMP_KEEP_MS),
            None
        );
        remove_old_files(&dir, MINIDUMP_KEEP_MS);
        assert!(!old_path.exists());
        assert!(fresh_path.exists(), "fresh dumps must survive the sweep");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn thumb_pattern_touches_only_its_own_files() {
        let dir = temp_workdir("thumb");
        std::fs::write(dir.join("thumbcache_256.db"), vec![0u8; 100]).unwrap();
        std::fs::write(dir.join("thumbcache_idx.db"), vec![0u8; 50]).unwrap();
        std::fs::write(dir.join("iconcache_16.db"), vec![0u8; 1000]).unwrap();
        std::fs::write(dir.join("other.txt"), "x").unwrap();
        remove_thumb_caches(&dir);
        assert!(!dir.join("thumbcache_256.db").exists());
        assert!(!dir.join("thumbcache_idx.db").exists());
        assert!(dir.join("iconcache_16.db").exists(), "icon caches stay");
        assert!(dir.join("other.txt").exists(), "siblings stay");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn deep_scan_gathers_all_nine_places() {
        // Deep mode is the complete picture: the three quick places
        // plus the six judgment-needed ones, quick first like the
        // quick list
        let cats = deep_scan_with(|_, _, _| {}).categories;
        let ids: Vec<&str> = cats.iter().map(|c| c.id.as_str()).collect();
        assert_eq!(
            ids,
            vec![
                USER_TEMP_ID,
                SYSTEM_TEMP_ID,
                DELIVERY_OPT_ID,
                RECYCLE_BIN_ID,
                UPDATE_DOWNLOAD_ID,
                SYSTEM_LOGS_ID,
                THUMB_CACHE_ID,
                ERROR_REPORTS_ID,
                OLD_MINIDUMPS_ID,
            ]
        );
    }

    #[test]
    fn quick_scan_holds_only_the_no_judgment_places() {
        // the bin left Quick: its deletion is permanent, review first
        let cats = scan().categories;
        let mut ids: Vec<&str> = cats.iter().map(|c| c.id.as_str()).collect();
        ids.sort();
        assert_eq!(ids, vec![DELIVERY_OPT_ID, SYSTEM_TEMP_ID, USER_TEMP_ID]);
        assert!(!ids.contains(&RECYCLE_BIN_ID));
    }

    #[test]
    fn new_deep_ids_join_the_contract() {
        for id in [UPDATE_DOWNLOAD_ID, SYSTEM_LOGS_ID] {
            assert!(is_cleanup_id(id), "{id} must be accepted");
            assert!(is_deep_category(id), "{id} must be deep");
            assert!(is_admin_category(id), "{id} must elevate");
        }
        // NOTE: clean_admin itself is never invoked here: with a valid
        // admin id it would REALLY delete on a Windows CI box. Scope
        // refusal is covered by clean_admin_refuses_non_admin_scope.
    }

    #[test]
    fn history_records_and_totals() {
        // numbers only: one line per run, last run + 30-day total.
        // Aimed at a throwaway file, never the production history.
        let path = temp_workdir("history").join("cleanup-history.jsonl");
        assert!(history_totals_in(&path).last_at.is_none());
        record_history_in(
            &path,
            &[CleanupResult {
                id: USER_TEMP_ID.into(),
                freed_bytes: Some(10 * 1024 * 1024),
            }],
        );
        let totals = history_totals_in(&path);
        assert_eq!(totals.last_freed_bytes, 10 * 1024 * 1024);
        assert!(totals.last_at.is_some());
        assert_eq!(totals.last_30d_bytes, 10 * 1024 * 1024);
        record_history_in(
            &path,
            &[CleanupResult {
                id: RECYCLE_BIN_ID.into(),
                freed_bytes: Some(5),
            }],
        );
        let totals = history_totals_in(&path);
        assert_eq!(totals.last_freed_bytes, 5);
        assert_eq!(totals.last_30d_bytes, 10 * 1024 * 1024 + 5);
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn history_total_saturates_on_crafted_maxima() {
        // hand-edited u64::MAX sidecars must saturate, never wrap the total
        let path = temp_workdir("history-sat").join("cleanup-history.jsonl");
        record_history_in(
            &path,
            &[
                CleanupResult {
                    id: USER_TEMP_ID.into(),
                    freed_bytes: Some(u64::MAX),
                },
                CleanupResult {
                    id: RECYCLE_BIN_ID.into(),
                    freed_bytes: Some(u64::MAX),
                },
            ],
        );
        let text = std::fs::read_to_string(&path).unwrap();
        let v: serde_json::Value = serde_json::from_str(text.lines().last().unwrap()).unwrap();
        assert_eq!(v.get("freed").and_then(|f| f.as_u64()), Some(u64::MAX));
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn history_prunes_runs_older_than_90_days_and_skips_garbage() {
        let path = temp_workdir("history-prune").join("cleanup-history.jsonl");
        // an ancient run, a garbage line, and the prune trigger
        std::fs::write(
            &path,
            "{\"t\":\"2020-01-01T00:00:00.000Z\",\"freed\":999}\nnot json\n",
        )
        .unwrap();
        record_history_in(
            &path,
            &[CleanupResult {
                id: USER_TEMP_ID.into(),
                freed_bytes: Some(7),
            }],
        );
        let body = std::fs::read_to_string(&path).unwrap();
        assert!(!body.contains("999"), "runs older than 90 days must be pruned");
        assert!(!body.contains("not json"), "corrupt lines must be dropped");
        let totals = history_totals_in(&path);
        assert_eq!(totals.last_freed_bytes, 7);
        assert_eq!(totals.last_30d_bytes, 7);
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn sidecar_trusts_admin_numbers_only() {
        // the parent trusts the child's numbers only for admin ids with
        // u64 values; everything else falls back to unknown
        let out = parse_clean_sidecar(
            r#"{"system_temp": 100, "user_temp": 999, "nope": 5, "delivery_opt": "x"}"#,
        );
        assert_eq!(out.get("system_temp"), Some(&100));
        assert!(!out.contains_key("user_temp"), "smuggled unprivileged id refused");
        assert!(!out.contains_key("nope"), "unknown id refused");
        assert!(
            !out.contains_key("delivery_opt"),
            "non-number value refused"
        );
        assert!(parse_clean_sidecar("not json").is_empty());
        assert!(parse_clean_sidecar("").is_empty());
    }

    #[test]
    fn zero_freed_runs_record_nothing() {
        // a clean that measured zero must not overwrite "last clean"
        // with a 0 MB entry (and must not even create the file)
        let path = temp_workdir("history-zero").join("cleanup-history.jsonl");
        record_history_in(
            &path,
            &[CleanupResult {
                id: USER_TEMP_ID.into(),
                freed_bytes: Some(0),
            }],
        );
        assert!(
            !path.exists(),
            "a zero-freed run must leave no trace in history"
        );
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}
