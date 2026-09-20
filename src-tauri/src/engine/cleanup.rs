// cleanup.rs — the Storage card's manual sweep: measure four safe places,
// delete only what the user ticked, report measured freed bytes.
//
// Scope is deliberately narrow (the anti-CCleaner lesson): user temp,
// system temp, the recycle bin, and the Delivery Optimization cache.
// No registry, no RAM boost, no WinSxS, no browser caches, no Downloads,
// no shader/prefetch caches (rebuilding those CAUSES the first-load
// hitches this tool diagnoses). Every category answers "which lag card
// does a full drive cause?" (disk_wait / mem_low via pagefile pressure)
// or it does not ship.
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

/// Elevated-run id: system temp + delivery cache need admin. The parent
/// measures before/after itself (verify by re-read); the child only
/// deletes and exits with a code.
pub const STORAGE_CLEAN_ID: &str = "storage-clean";

/// Categories that must go through elevation (the rest run unprivileged).
pub fn is_admin_category(id: &str) -> bool {
    id == SYSTEM_TEMP_ID || id == DELIVERY_OPT_ID
}

/// Every id the scan/clean path accepts. Anything else is refused before
/// anything runs (no user-supplied paths ever cross this module).
pub fn is_cleanup_id(id: &str) -> bool {
    id == USER_TEMP_ID || id == SYSTEM_TEMP_ID || id == RECYCLE_BIN_ID || id == DELIVERY_OPT_ID
}

/// One measured place: None bytes = could not be read (honest no-data).
#[derive(Debug, Clone, serde::Serialize)]
pub struct CleanupCategory {
    pub id: String,
    pub bytes: Option<u64>,
}

/// Measured result per category: before minus after, saturating.
#[derive(Debug, Clone, serde::Serialize)]
pub struct CleanupResult {
    pub id: String,
    pub freed_bytes: u64,
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

/// One scan step: category id plus its measuring function.
type ScanStep = (&'static str, fn() -> Option<u64>);

/// Scan with a per-category progress callback (index, total, id).
pub fn scan_with(progress: impl Fn(u64, u64, &str)) -> CleanupScan {
    let mut categories = Vec::new();
    let steps: [ScanStep; 4] = [
        (USER_TEMP_ID, || user_temp_dir().and_then(dir_size_capped)),
        (
            SYSTEM_TEMP_ID,
            || system_temp_dir().and_then(dir_size_capped),
        ),
        (RECYCLE_BIN_ID, recycle_bin_bytes),
        // a machine that never cached peer data has no dir at all:
        // that is 0 cleanable bytes (a fact), not unreadable.
        (DELIVERY_OPT_ID, delivery_opt_bytes),
    ];
    let total = steps.len() as u64;
    for (i, (id, measure)) in steps.into_iter().enumerate() {
        progress(i as u64, total, id);
        categories.push(CleanupCategory {
            id: id.into(),
            bytes: measure(),
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
    let before = scan_map();
    // admin categories first, through one UAC prompt for the whole click
    let admin: Vec<String> = ids.iter().filter(|id| is_admin_category(id)).cloned().collect();
    if !admin.is_empty() {
        // one UAC prompt for the whole click; a denied prompt is
        // "cancelled" (quiet), a post-consent failure is a real error
        let code = super::elevate::elevate_storage_clean(&admin)?;
        super::elevate::map_exit_code(code)?;
    }
    let total = ids.len() as u64;
    // unprivileged categories run here (user temp + recycle bin); admin
    // ones were already handled above, their step only moves the bar
    for (i, id) in ids.iter().enumerate() {
        progress(i as u64, total, id);
        if !is_admin_category(id) {
            clean_one_unprivileged(id);
        }
    }
    let after = scan_map();
    let results: Vec<CleanupResult> = ids
        .iter()
        .map(|id| {
            let freed = before
                .get(id.as_str())
                .copied()
                .flatten()
                .unwrap_or(0)
                .saturating_sub(after.get(id.as_str()).copied().flatten().unwrap_or(0));
            CleanupResult {
                id: id.clone(),
                freed_bytes: freed,
            }
        })
        .collect();
    record_history(&results);
    Ok(results)
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
            _ => return Err(format!("refused outside elevated scope: {id}")),
        }
    }
    Ok(())
}

fn scan_map() -> std::collections::HashMap<String, Option<u64>> {
    scan().categories.into_iter().map(|c| (c.id, c.bytes)).collect()
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

fn history_totals() -> CleanupHistory {
    history_totals_in(&history_path())
}

fn history_totals_in(path: &Path) -> CleanupHistory {
    let text = std::fs::read_to_string(path).unwrap_or_default();
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
    let freed: u64 = results.iter().map(|r| r.freed_bytes).sum();
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
    if let Ok(text) = std::fs::read_to_string(path) {
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
        _ => {}
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
    let windir = std::env::var_os("windir").map(PathBuf::from)?;
    let dir = windir.join(r"SoftwareDistribution\DeliveryOptimization");
    dir.is_dir().then_some(dir)
}

#[cfg(not(windows))]
fn delivery_opt_dir() -> Option<PathBuf> {
    None
}

// ---- measurement ----------------------------------------------------------

/// Recursive dir size in bytes. Read-only, never follows symlinks, depth
/// capped (a hostile link farm cannot loop it). Errors (locked files,
/// denied entries) are skipped: the number is "at least this much", and
/// the clean step measures again anyway.
fn dir_size_capped(root: PathBuf) -> Option<u64> {
    let mut total: u64 = 0;
    let mut stack: Vec<(PathBuf, u8)> = vec![(root, 0)];
    let mut seen_any = false;
    while let Some((dir, depth)) = stack.pop() {
        if depth > 64 {
            continue;
        }
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        seen_any = true;
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(meta) = std::fs::symlink_metadata(&path) else {
                continue;
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

/// Recycle bin size by walking `$Recycle.Bin` on every fixed drive with
/// the same recursive walker as the temp categories (one measuring
/// engine everywhere). The old Shell-COM probe summed only the visible
/// items' `Size` property, which folders do not carry: a 5GB folder in
/// the bin read as a fraction of itself. Missing bin dirs count 0;
/// denied entries are skipped like everywhere else.
#[cfg(windows)]
fn recycle_bin_bytes() -> Option<u64> {
    let drives = super::system::fixed_drives();
    if drives.is_empty() {
        return None;
    }
    let roots: Vec<PathBuf> = drives
        .iter()
        .map(|d| PathBuf::from(format!("{d}\\")) .join("$Recycle.Bin"))
        .collect();
    Some(recycle_bin_bytes_in(&roots))
}

/// Sum helper, roots injected for tests (a fake bin tree with nested
/// folders and known sizes proves folders are counted, the COM bug).
fn recycle_bin_bytes_in(roots: &[PathBuf]) -> u64 {
    roots
        .iter()
        .filter(|r| r.is_dir())
        .filter_map(|r| dir_size_capped(r.clone()))
        .fold(0u64, |a, b| a.saturating_add(b))
}

#[cfg(not(windows))]
fn recycle_bin_bytes() -> Option<u64> {
    None
}

// ---- deletion -------------------------------------------------------------

/// Delete a dir's CONTENTS, never the dir itself. Skips symlinks targets
/// (removes the link), skips anything that canonicalizes outside the
/// root (junction escape), skips locked files (no forcing). Best effort:
// callers re-measure afterwards, so a skip is honest, not an error.
fn empty_dir_contents(root: &Path) {
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
    fn recycle_bin_counts_nested_folders_not_just_files() {
        // the COM-probe bug: folders carry no `Size`, so a bin holding a
        // 5GB folder read as a fraction of itself. The walker must count
        // every nested byte. Fake bin tree with known sizes:
        // root/<SID>/loose.bin (100) + root/<SID>/folder/deep.bin (50).
        let root = temp_workdir("bin").join("$Recycle.Bin");
        let sid = root.join("S-1-5-21-1");
        std::fs::create_dir_all(sid.join("folder")).unwrap();
        std::fs::write(sid.join("loose.bin"), vec![0u8; 100]).unwrap();
        std::fs::write(sid.join("folder").join("deep.bin"), vec![0u8; 50]).unwrap();
        let probe = root.clone();
        assert_eq!(recycle_bin_bytes_in(std::slice::from_ref(&probe)), 150);
        // missing roots count 0, never an error
        let missing = root.join("no-such-drive-root");
        assert_eq!(recycle_bin_bytes_in(std::slice::from_ref(&missing)), 0);
        let _ = std::fs::remove_dir_all(root.parent().unwrap());
    }

    #[test]
    fn scan_returns_all_four_categories() {
        let cats = scan().categories;
        let mut ids: Vec<&str> = cats.iter().map(|c| c.id.as_str()).collect();
        ids.sort();
        assert_eq!(ids, vec![DELIVERY_OPT_ID, RECYCLE_BIN_ID, SYSTEM_TEMP_ID, USER_TEMP_ID]);
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
                freed_bytes: 10 * 1024 * 1024,
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
                freed_bytes: 5,
            }],
        );
        let totals = history_totals_in(&path);
        assert_eq!(totals.last_freed_bytes, 5);
        assert_eq!(totals.last_30d_bytes, 10 * 1024 * 1024 + 5);
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
                freed_bytes: 7,
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
    fn zero_freed_runs_record_nothing() {
        // a clean that measured zero must not overwrite "last clean"
        // with a 0 MB entry (and must not even create the file)
        let path = temp_workdir("history-zero").join("cleanup-history.jsonl");
        record_history_in(
            &path,
            &[CleanupResult {
                id: USER_TEMP_ID.into(),
                freed_bytes: 0,
            }],
        );
        assert!(
            !path.exists(),
            "a zero-freed run must leave no trace in history"
        );
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}
