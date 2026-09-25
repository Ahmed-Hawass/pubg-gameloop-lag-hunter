// emulator.rs — GameLoop integration profiles: one card per client generation.
//
// Why profiles, not one list: the v6 (AOW/TxGameAssistant) and v7 (Androws)
// clients differ in process family, registry home, install layout, exe
// names, AND what "the game is running" even means (a per-game process vs
// a RunningAppInfo counter). A flat union list cannot express that last
// difference, so each generation owns its card and detection picks one.
// A future v8 = one more card + golden fixtures, zero new branches in
// the consumers below.
//
// Detection trusts LIVE evidence first (running processes), the registry
// second, and never trusts a version string from a key whose InstallPath
// no longer exists on disk (downgrade leftovers are real: guides teach
// users to churn beta/stable both directions).

use std::path::{Path, PathBuf};

/// One client generation's integration surface.
pub struct EmulatorProfile {
    /// machine id, logged at session start (e.g. "gameloop-v7")
    pub id: &'static str,
    /// process-name family (matched with the sampler's exact-or-prefix rule)
    pub proc_names: &'static [&'static str],
    /// HKLM bases whose SUBKEYS may carry InstallPath (v6 shape)
    pub reg_subkey_roots: &'static [&'static str],
    /// HKLM values holding InstallPath DIRECTLY (v7 shape)
    pub reg_direct_root: Option<&'static str>,
    /// stock install locations, checked with exists()
    pub stock_paths: &'static [&'static str],
    /// render executables for per-exe GPU/FSO rows (unanimous rule)
    pub exe_names: &'static [&'static str],
}

/// v6: AOW engine, TxGameAssistant home, per-game aow_exe runtime.
/// A running aow-family process MEANS the game (the runtime is per game).
pub const V6: EmulatorProfile = EmulatorProfile {
    id: "gameloop-v6",
    proc_names: &["aow_exe", "TBS", "TxGameAssistant", "AndroidEmulatorEn"],
    reg_subkey_roots: &[
        r"SOFTWARE\Tencent\MobileGamePC",
        r"SOFTWARE\WOW6432Node\Tencent\MobileGamePC",
    ],
    reg_direct_root: None,
    stock_paths: &[r"C:\Program Files\TxGameAssistant"],
    exe_names: &["aow_exe.exe", "AndroidEmulatorEn.exe"],
};

/// v7: Androws VM core (VHD images, gfxstream, VBox/Hyper-V backends),
/// GameLoop home, versioned Application\<build> dirs. The emulator runs
/// IDLE with no game (no per-game process exists anymore), so "running"
/// comes from the RunningAppInfo counter, never from process presence.
pub const V7: EmulatorProfile = EmulatorProfile {
    id: "gameloop-v7",
    proc_names: &[
        "GameLoop",
        "GameLoopEmulator",
        "GameLoopAssistant",
        "GameLoopService",
        "GameLoopDldSvr",
        "GLABoxSVC",
        "GLABoxHeadless",
    ],
    reg_subkey_roots: &[],
    reg_direct_root: Some(r"SOFTWARE\Tencent\GameLoop"),
    stock_paths: &[r"C:\Program Files\Tencent\GameLoop"],
    exe_names: &["GameLoopEmulator.exe", "GLABoxHeadless.exe"],
};

/// Union of every known family: the tasklist scan, the visibility probe
/// filter, and the top-process exclusion all share it (ONE list, same rule
/// as the sampler's matcher — names can never drift apart).
pub fn all_proc_names() -> Vec<&'static str> {
    let mut out: Vec<&'static str> = Vec::new();
    for p in V6.proc_names.iter().chain(V7.proc_names.iter()) {
        if !out.contains(p) {
            out.push(p);
        }
    }
    out
}

/// Substring hints of a GameLoop client that matches NO known family
/// (a future rename). Deliberately narrow: CefRendererProcess embeds in
/// unrelated apps, so only GameLoop's own stems count here.
const UNKNOWN_HINTS: [&str; 4] = ["gameloop", "glabox", "androws", "txgameassistant"];

/// Does this process name hint at an unrecognized GameLoop build?
/// Pure: the I/O edge (tasklist) lives in the sampler.
pub fn is_unknown_hint(name: &str) -> bool {
    let lower = name.trim_end_matches(".exe").to_ascii_lowercase();
    UNKNOWN_HINTS.iter().any(|h| lower.contains(h))
}

/// Registry evidence, read once per detection (all winreg, in-process,
/// fail-soft — a probe failure must never fake a version).
pub struct RegistrySnapshot {
    /// v7 marketing version, e.g. "7.0.19.05" (None = key missing)
    pub v7_version: Option<String>,
    /// v7 direct InstallPath (None = missing)
    pub v7_install: Option<String>,
    /// v6 subkey InstallPaths (any component subkey, either view)
    pub v6_installs: Vec<String>,
    /// install dirs from Uninstall entries (HKLM + HKCU), version-agnostic:
    /// DisplayIcon points at the live Application dir whatever the build
    pub uninstall_dirs: Vec<String>,
    /// games currently running inside the v7 VM (empty = client idle)
    pub running_apps: Vec<String>,
}

pub fn read_snapshot() -> RegistrySnapshot {
    let hklm = winreg::RegKey::predef(winreg::enums::HKEY_LOCAL_MACHINE);
    let hkcu = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER);

    let v7key = hklm.open_subkey(r"SOFTWARE\Tencent\GameLoop").ok();
    let v7_version = v7key
        .as_ref()
        .and_then(|k| k.get_value::<String, _>("Version").ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let v7_install = v7key
        .as_ref()
        .and_then(|k| k.get_value::<String, _>("InstallPath").ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && PathBuf::from(&s).exists());

    let mut v6_installs = Vec::new();
    for base in V6.reg_subkey_roots {
        let Ok(key) = hklm.open_subkey(*base) else {
            continue;
        };
        for sub in key.enum_keys().flatten() {
            let path = format!("{base}\\{sub}");
            if let Ok(subkey) = hklm.open_subkey(&path) {
                if let Ok(install) = subkey.get_value::<String, _>("InstallPath") {
                    let install = install.trim().to_string();
                    if !install.is_empty() && PathBuf::from(&install).exists() {
                        v6_installs.push(install);
                    }
                }
            }
        }
    }

    // Uninstall entries name the live Application dir for ANY build
    // (DisplayIcon = ...\Application\Uninstall.exe): the one discovery
    // source that needs no per-version knowledge at all.
    let mut uninstall_dirs = Vec::new();
    for root in [&hklm, &hkcu] {
        if let Ok(key) = root.open_subkey(
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\GameLoop",
        ) {
            if let Ok(icon) = key.get_value::<String, _>("DisplayIcon") {
                let dir = PathBuf::from(icon.trim().trim_matches('"'));
                if dir.is_absolute() {
                    if let Some(parent) = dir.parent() {
                        uninstall_dirs.push(parent.to_path_buf().to_string_lossy().to_string());
                        if let Some(grand) = parent.parent() {
                            uninstall_dirs.push(grand.to_path_buf().to_string_lossy().to_string());
                        }
                    }
                }
            }
        }
    }

    let running_apps = read_running_apps(&hkcu);

    RegistrySnapshot {
        v7_version,
        v7_install,
        v6_installs,
        uninstall_dirs,
        running_apps,
    }
}

/// Is a game active inside the v7 VM, given a fresh emulator snapshot?
/// Some(running) only when the snapshot holds v7-family processes (then
/// the VM's own app counter decides — closing the game leaves every
/// process up); None when no v7 process is present, meaning "not a v7
/// world, keep whatever verdict the caller already had" (v6 needs no key).
pub fn v7_game_active(latest: &[super::types::ProcInfo]) -> Option<bool> {
    let v7_present = latest.iter().any(|p| {
        let base = p.name.trim_end_matches(".exe").to_ascii_lowercase();
        V7.proc_names.iter().any(|n| {
            let n = n.to_ascii_lowercase();
            base == n || base.starts_with(n.as_str())
        })
    });
    if !v7_present {
        return None;
    }
    Some(!read_running_apps(&winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER)).is_empty())
}

/// Games currently inside the v7 VM (fail-soft empty).
pub fn read_running_apps(hkcu: &winreg::RegKey) -> Vec<String> {
    let text: String = hkcu
        .open_subkey(r"Software\Tencent\GameLoop\GameLoop")
        .ok()
        .and_then(|k| k.get_value::<String, _>("RunningAppInfo").ok())
        .unwrap_or_default();
    parse_running_apps(&text)
}

/// Pure half of the RunningAppInfo parse (live-proven shape above).
fn parse_running_apps(text: &str) -> Vec<String> {
    let v: serde_json::Value = serde_json::from_str(text).unwrap_or(serde_json::Value::Null);
    let count = v.get("count").and_then(|c| c.as_u64()).unwrap_or(0);
    let names = v
        .get("names")
        .and_then(|n| n.as_str())
        .unwrap_or("")
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>();
    if count > 0 && names.is_empty() {
        // count without names: SOMETHING runs, just unnamed — never read
        // an honest counter as idle
        return vec!["unknown".into()];
    }
    names
}

/// What the live machine looks like, from evidence alone.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Detected {
    /// nothing GameLoop at all: client absent or fully idle-unknown
    Absent,
    /// v6 family running: an aow-family process MEANS the game
    /// (the old runtime is per game — the looseness below is history)
    V6Game,
    /// v7 client running AND at least one game inside the VM
    V7Game { version: Option<String> },
    /// v7 client running, VM idle (no game to measure)
    V7Idle { version: Option<String> },
    /// GameLoop-ish evidence matching no card (a future rename):
    /// never mistaken for "not running", never trusted for writes
    Unknown,
}

/// Pure detection over a process-name list + a registry snapshot.
/// Golden fixtures per generation live in the tests below.
pub fn detect(running: &[String], reg: &RegistrySnapshot) -> Detected {
    let lower: Vec<String> = running.iter().map(|n| {
        n.trim_end_matches(".exe").to_ascii_lowercase()
    }).collect();
    let has_family = |names: &[&str]| {
        names.iter().any(|p| {
            let p = p.to_ascii_lowercase();
            lower.iter().any(|n| n == &p || n.starts_with(p.as_str()))
        })
    };
    // NOTE: mirrors the sampler's exact-or-prefix matcher semantics so the
    // gate and the scan can never disagree on what counts as GameLoop.
    if has_family(V7.proc_names) {
        if reg.running_apps.is_empty() {
            return Detected::V7Idle {
                version: reg.v7_version.clone(),
            };
        }
        return Detected::V7Game {
            version: reg.v7_version.clone(),
        };
    }
    if has_family(V6.proc_names) {
        return Detected::V6Game;
    }
    if lower.iter().any(|n| UNKNOWN_HINTS.iter().any(|h| n.contains(h)))
        || !reg.uninstall_dirs.is_empty()
    {
        return Detected::Unknown;
    }
    Detected::Absent
}

/// Install roots for the exe resolver, strongest evidence first:
/// live Uninstall dirs (any build), v7 direct, v6 subkeys, stocks.
/// All existence-validated — a stale key to a deleted dir contributes
/// nothing (downgrade leftovers are real).
pub fn resolve_roots(reg: &RegistrySnapshot) -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();
    let mut push = |p: PathBuf| {
        if p.is_absolute()
            && !roots.iter().any(|e: &PathBuf| {
                e.to_string_lossy().to_lowercase() == p.to_string_lossy().to_lowercase()
            })
        {
            roots.push(p);
        }
    };
    for d in &reg.uninstall_dirs {
        let dir = PathBuf::from(d);
        if dir.exists() {
            push(dir.clone());
            if let Some(parent) = dir.parent() {
                push(parent.to_path_buf());
            }
        }
    }
    if let Some(install) = &reg.v7_install {
        push(PathBuf::from(install));
    }
    for install in &reg.v6_installs {
        let dir = PathBuf::from(install);
        push(dir.clone());
        if let Some(parent) = dir.parent() {
            push(parent.to_path_buf());
        }
    }
    for stock in V6.stock_paths.iter().chain(V7.stock_paths.iter()) {
        let dir = PathBuf::from(stock);
        if dir.exists() {
            push(dir);
        }
    }
    roots
}

/// Candidate exe paths under the roots: the exe itself, the legacy ui\
/// layout, the Application dir, and each versioned Application\<build>
/// subdir (client updates bump the build number — a fixed path would rot
/// every release). Pure over (roots, exes, versioned dir names) so the
/// shape is unit-tested; the filesystem walk stays at the call site.
pub fn candidate_paths(
    roots: &[PathBuf],
    exes: &[&str],
    versioned: &[Vec<String>],
) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    for (root, vers) in roots.iter().zip(
        versioned
            .iter()
            .chain(std::iter::repeat(&vec![]))
            .take(roots.len()),
    ) {
        let mut dirs = vec![root.clone(), root.join("ui"), root.join("Application")];
        for v in vers {
            dirs.push(root.join("Application").join(v));
        }
        for dir in dirs {
            for exe in exes {
                let cand = dir.join(exe);
                if !out.iter().any(|e: &PathBuf| {
                    e.to_string_lossy().to_lowercase() == cand.to_string_lossy().to_lowercase()
                }) {
                    out.push(cand);
                }
            }
        }
    }
    out
}

/// Immediate subdirectories of `<root>\Application` (the versioned build
/// dirs like `7.0.167.0`). Bounded, fail-soft: unreadable means none.
pub fn application_versions(root: &Path) -> Vec<String> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(root.join("Application")) else {
        return out;
    };
    for entry in entries.flatten() {
        if let Ok(ft) = entry.file_type() {
            if ft.is_dir() {
                if let Some(name) = entry.file_name().to_str() {
                    out.push(name.to_string());
                }
            }
        }
    }
    out.sort();
    out
}

/// Pure version-change rule for the post-update re-flip notice:
/// (notify_once, current_version_string). First sighting stores silently
/// (fresh installs must never nag); unknown stays silent too.
pub fn version_notice(
    last_seen: Option<&str>,
    current: Option<&str>,
) -> (bool, String) {
    match (last_seen, current) {
        (Some(seen), Some(cur)) if seen != cur => (true, cur.to_string()),
        (_, Some(cur)) => (false, cur.to_string()),
        _ => (false, String::new()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reg(
        v7_version: Option<&str>,
        v7_install: Option<&str>,
        v6_installs: Vec<&str>,
        uninstall_dirs: Vec<&str>,
        running_apps: Vec<&str>,
    ) -> RegistrySnapshot {
        RegistrySnapshot {
            v7_version: v7_version.map(str::to_string),
            v7_install: v7_install.map(str::to_string),
            v6_installs: v6_installs.iter().map(|s| s.to_string()).collect(),
            uninstall_dirs: uninstall_dirs.iter().map(|s| s.to_string()).collect(),
            running_apps: running_apps.iter().map(|s| s.to_string()).collect(),
        }
    }

    fn empty_reg() -> RegistrySnapshot {
        reg(None, None, vec![], vec![], vec![])
    }

    #[test]
    fn detect_v7_game_with_version() {
        let d = detect(
            &["GameLoop.exe".into(), "GLABoxHeadless.exe".into()],
            &reg(Some("7.0.19.05"), None, vec![], vec![], vec!["com.tencent.ig"]),
        );
        assert_eq!(
            d,
            Detected::V7Game {
                version: Some("7.0.19.05".into())
            }
        );
    }

    #[test]
    fn detect_v7_idle_without_games() {
        // the new-world trap the old gate would miss: emulator up, no game
        let d = detect(
            &["GameLoopEmulator.exe".into()],
            &reg(Some("7.0.19.05"), None, vec![], vec![], vec![]),
        );
        assert_eq!(
            d,
            Detected::V7Idle {
                version: Some("7.0.19.05".into())
            }
        );
    }

    #[test]
    fn detect_v6_game_by_process_presence() {
        // old semantics preserved verbatim: an aow-family process IS the game
        let d = detect(&["aow_exe.exe".into()], &empty_reg());
        assert_eq!(d, Detected::V6Game);
        let d = detect(&["TxGameAssistant.exe".into()], &empty_reg());
        assert_eq!(d, Detected::V6Game);
    }

    #[test]
    fn detect_absent_on_clean_machine() {
        let d = detect(&["explorer.exe".into(), "chrome.exe".into()], &empty_reg());
        assert_eq!(d, Detected::Absent);
        let d = detect(&[], &empty_reg());
        assert_eq!(d, Detected::Absent);
    }

    #[test]
    fn detect_unknown_future_rename() {
        // a family rename keeps its stem as a prefix ("GameLoopNextGen"
        // still matches the v7 prefix rule, by design): the unknown path
        // is for stems we never knew, matched mid-string or via an
        // installed-but-unrecognized layout
        let d = detect(&["TencentGameLoopNext.exe".into()], &empty_reg());
        assert_eq!(d, Detected::Unknown);
        // ...and an installed-but-unrecognized layout counts too
        let d = detect(
            &["explorer.exe".into()],
            &reg(None, None, vec![], vec![r"C:\GL8"], vec![]),
        );
        assert_eq!(d, Detected::Unknown);
    }

    #[test]
    fn detect_v7_wins_over_v6_leftovers() {
        // side-by-side / downgrade leftovers: the live v7 client decides
        let d = detect(
            &["GameLoop.exe".into(), "aow_exe.exe".into()],
            &reg(Some("7.0.19"), None, vec![], vec![], vec!["com.tencent.ig"]),
        );
        assert!(matches!(d, Detected::V7Game { .. }));
    }

    #[test]
    fn unknown_hints_are_narrow() {
        assert!(is_unknown_hint("GameLoopFuture.exe"));
        assert!(is_unknown_hint("GLABoxNext.exe"));
        assert!(is_unknown_hint("AndrowsVM.exe"));
        // unrelated apps must never trip the unknown path (QQ chat,
        // CEF hosts embedded in other apps, plain browsers)
        assert!(!is_unknown_hint("QQ.exe"));
        assert!(!is_unknown_hint("CefRendererProcess.exe"));
        assert!(!is_unknown_hint("chrome.exe"));
        assert!(!is_unknown_hint("explorer.exe"));
    }

    #[test]
    fn running_apps_parse_counts() {
        assert_eq!(
            parse_running_apps(r#"{"count":1,"names":"com.tencent.ig"}"#),
            vec!["com.tencent.ig".to_string()]
        );
        assert!(parse_running_apps(r#"{"count":0,"names":""}"#).is_empty());
        // count without names still counts: never read a counter as idle
        assert_eq!(parse_running_apps(r#"{"count":2,"names":""}"#).len(), 1);
        assert!(parse_running_apps("garbage").is_empty());
        assert!(parse_running_apps("").is_empty());
    }

    #[test]
    fn version_notice_rules() {
        // first sighting stores silently (fresh installs never nag)
        assert_eq!(version_notice(None, Some("7.0.19.05")), (false, "7.0.19.05".into()));
        // same version: quiet
        assert_eq!(
            version_notice(Some("7.0.19.05"), Some("7.0.19.05")),
            (false, "7.0.19.05".into())
        );
        // changed: notify once with the new version
        assert_eq!(
            version_notice(Some("7.0.16.0"), Some("7.0.19.05")),
            (true, "7.0.19.05".into())
        );
        // unknown stays silent (nothing to name)
        assert_eq!(version_notice(Some("7.0.19.05"), None), (false, String::new()));
        assert_eq!(version_notice(None, None), (false, String::new()));
    }

    #[test]
    fn candidates_cover_legacy_and_versioned_layouts() {
        let roots = vec![PathBuf::from(r"C:\G")];
        let out = candidate_paths(&roots, &["a.exe"], &[vec!["7.0.167.0".into()]]);
        let names: Vec<String> =
            out.iter().map(|p| p.to_string_lossy().to_string()).collect();
        assert!(names.iter().any(|p| p.ends_with(r"C:\G\a.exe")));
        assert!(names.iter().any(|p| p.ends_with(r"C:\G\ui\a.exe")));
        assert!(names.iter().any(|p| p.ends_with(r"C:\G\Application\a.exe")));
        assert!(names.iter().any(|p| p.ends_with(r"C:\G\Application\7.0.167.0\a.exe")));
        // case-insensitive dedup across layouts
        let dup = candidate_paths(
            &[PathBuf::from(r"C:\G"), PathBuf::from(r"c:\g")],
            &["a.exe"],
            &[vec![], vec![]],
        );
        assert_eq!(dup.len(), 3); // root, ui, Application — not doubled
    }
}
