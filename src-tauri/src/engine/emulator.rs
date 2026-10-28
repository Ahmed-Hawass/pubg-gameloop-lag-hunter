// emulator.rs - GameLoop integration profiles: one card per client generation.
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
/// as the sampler's matcher - names can never drift apart).
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
/// fail-soft - a probe failure must never fake a version).
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
    /// roots advertised by GameLoop uninstall entries, including custom
    /// InstallLocation values from either registry view.
    pub install_dirs: Vec<String>,
    /// False when a relevant registry source could not be enumerated or read.
    pub registry_read_complete: bool,
    /// games currently running inside the v7 VM (empty = client idle)
    pub running_apps: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum InstallationStatus {
    Installed,
    NotInstalled,
    Unknown,
}

pub fn read_snapshot() -> RegistrySnapshot {
    let hklm = winreg::RegKey::predef(winreg::enums::HKEY_LOCAL_MACHINE);
    let hkcu = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER);

    let views = [
        winreg::enums::KEY_WOW64_32KEY,
        winreg::enums::KEY_WOW64_64KEY,
    ];
    let mut registry_read_complete = true;
    let mut v7_version = None;
    let mut v7_install = None;
    for view in views {
        let key = match hklm
            .open_subkey_with_flags(r"SOFTWARE\Tencent\GameLoop", winreg::enums::KEY_READ | view)
        {
            Ok(key) => key,
            Err(error) => {
                note_registry_error(&mut registry_read_complete, &error);
                continue;
            }
        };
        if v7_version.is_none() {
            match key.get_value::<String, _>("Version") {
                Ok(value) => {
                    v7_version = Some(value.trim().to_string()).filter(|s| !s.is_empty());
                }
                Err(error) => note_registry_error(&mut registry_read_complete, &error),
            }
        }
        if v7_install.is_none() {
            match key.get_value::<String, _>("InstallPath") {
                Ok(value) => {
                    v7_install = Some(value.trim().to_string())
                        .filter(|s| !s.is_empty() && PathBuf::from(s).is_absolute());
                }
                Err(error) => note_registry_error(&mut registry_read_complete, &error),
            }
        }
    }

    let mut v6_installs: Vec<String> = Vec::new();
    for view in views {
        for base in V6.reg_subkey_roots {
            let key = match hklm.open_subkey_with_flags(*base, winreg::enums::KEY_READ | view) {
                Ok(key) => key,
                Err(error) => {
                    note_registry_error(&mut registry_read_complete, &error);
                    continue;
                }
            };
            for sub in key.enum_keys() {
                let sub = match sub {
                    Ok(sub) => sub,
                    Err(error) => {
                        note_registry_error(&mut registry_read_complete, &error);
                        continue;
                    }
                };
                let path = format!("{base}\\{sub}");
                match hklm.open_subkey_with_flags(&path, winreg::enums::KEY_READ | view) {
                    Ok(subkey) => match subkey.get_value::<String, _>("InstallPath") {
                        Ok(install) => {
                            let install = install.trim().to_string();
                            if !install.is_empty()
                                && PathBuf::from(&install).is_absolute()
                                && !v6_installs.iter().any(|p| p.eq_ignore_ascii_case(&install))
                            {
                                v6_installs.push(install);
                            }
                        }
                        Err(error) => note_registry_error(&mut registry_read_complete, &error),
                    },
                    Err(error) => note_registry_error(&mut registry_read_complete, &error),
                }
            }
        }
    }

    // Uninstall entries can reveal custom locations even when the direct
    // Tencent key is absent. Read both registry views and all entries whose
    // product name identifies GameLoop.
    let mut uninstall_dirs = Vec::new();
    let mut install_dirs = Vec::new();
    for root in [&hklm, &hkcu] {
        for view in views {
            read_gameloop_uninstall_entries(
                root,
                view,
                &mut install_dirs,
                &mut uninstall_dirs,
                &mut registry_read_complete,
            );
        }
    }

    let running_apps = read_running_apps(&hkcu);

    RegistrySnapshot {
        v7_version,
        v7_install,
        v6_installs,
        uninstall_dirs,
        install_dirs,
        registry_read_complete,
        running_apps,
    }
}

fn read_gameloop_uninstall_entries(
    root: &winreg::RegKey,
    view: u32,
    install_dirs: &mut Vec<String>,
    uninstall_dirs: &mut Vec<String>,
    registry_read_complete: &mut bool,
) {
    let path = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall";
    let key = match root.open_subkey_with_flags(path, winreg::enums::KEY_READ | view) {
        Ok(key) => key,
        Err(error) => {
            note_registry_error(registry_read_complete, &error);
            return;
        }
    };
    for sub in key.enum_keys() {
        let sub = match sub {
            Ok(sub) => sub,
            Err(error) => {
                note_registry_error(registry_read_complete, &error);
                continue;
            }
        };
        let entry = match key.open_subkey_with_flags(&sub, winreg::enums::KEY_READ | view) {
            Ok(entry) => entry,
            Err(error) => {
                note_registry_error(registry_read_complete, &error);
                continue;
            }
        };
        let display_name = match entry.get_value::<String, _>("DisplayName") {
            Ok(name) => name.to_ascii_lowercase(),
            Err(error) => {
                note_registry_error(registry_read_complete, &error);
                String::new()
            }
        };
        if !sub.to_ascii_lowercase().contains("gameloop") && !display_name.contains("gameloop") {
            continue;
        }
        match entry.get_value::<String, _>("InstallLocation") {
            Ok(location) => {
                if let Some(path) = absolute_registry_path(&location) {
                    push_install_root(install_dirs, &path);
                }
            }
            Err(error) => note_registry_error(registry_read_complete, &error),
        }
        match entry.get_value::<String, _>("DisplayIcon") {
            Ok(icon) => {
                if let Some(exe) = display_icon_path(&icon) {
                    if let Some(parent) = exe.parent() {
                        push_install_root(install_dirs, parent);
                        push_install_root(uninstall_dirs, parent);
                    }
                }
            }
            Err(error) => note_registry_error(registry_read_complete, &error),
        }
    }
}

fn note_registry_error(complete: &mut bool, error: &std::io::Error) {
    let missing_key =
        error.kind() == std::io::ErrorKind::NotFound || matches!(error.raw_os_error(), Some(2 | 3));
    if !missing_key {
        *complete = false;
    }
}

fn display_icon_path(icon: &str) -> Option<PathBuf> {
    let value = icon.trim();
    let path = if let Some(rest) = value.strip_prefix('"') {
        let end = rest.find('"')?;
        &rest[..end]
    } else {
        value.split(',').next().unwrap_or(value).trim()
    };
    let path = PathBuf::from(path);
    path.is_absolute().then_some(path)
}

fn absolute_registry_path(path: &str) -> Option<PathBuf> {
    let path = PathBuf::from(path.trim().trim_matches('"'));
    if path.is_absolute() {
        Some(path)
    } else {
        None
    }
}

fn push_install_root(paths: &mut Vec<String>, path: &Path) {
    push_path(paths, path);
    if path
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.eq_ignore_ascii_case("Application"))
    {
        if let Some(parent) = path.parent() {
            push_path(paths, parent);
        }
    }
}

fn push_path(paths: &mut Vec<String>, path: &Path) {
    let value = path.to_string_lossy().to_string();
    if !paths
        .iter()
        .any(|existing| existing.eq_ignore_ascii_case(&value))
    {
        paths.push(value);
    }
}

/// Is a game active inside the v7 VM, given a fresh emulator snapshot?
/// Some(running) only when the snapshot holds v7-family processes (then
/// the VM's own app counter decides - closing the game leaves every
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
        // count without names: SOMETHING runs, just unnamed - never read
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
    /// (the old runtime is per game - the looseness below is history)
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
    let lower: Vec<String> = running
        .iter()
        .map(|n| n.trim_end_matches(".exe").to_ascii_lowercase())
        .collect();
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
    // a LIVE gameloop-ish process no profile matches (a future rename):
    // honest Unknown, never "not running".
    if lower
        .iter()
        .any(|n| UNKNOWN_HINTS.iter().any(|h| n.contains(h)))
    {
        return Detected::Unknown;
    }
    // static install evidence alone (Uninstall entries persist whether
    // the client runs or not) means installed-but-closed - or a past
    // install - so it routes to Absent ("not running"), never Unknown.
    // The exe resolver below still uses these dirs; only the verdict
    // ignores them. A fully renamed future client whose processes shed
    // every known stem would also read Absent here (same action for the
    // user either way: start the game first), and the evidence log line
    // at the start gate keeps that case diagnosable.
    Detected::Absent
}

/// One-line evidence summary for the start gate log: counts plus the
/// matched family and the verdict - never other apps' process names
/// (privacy: the full tasklist must not land in our logs). Pure, so the
/// shapes stay pinned by tests below.
pub fn presence_evidence_summary(
    names: &[String],
    reg: &RegistrySnapshot,
    installation: InstallationStatus,
) -> String {
    let verdict = detect(names, reg);
    let family = match verdict {
        Detected::V6Game => "v6",
        Detected::V7Game { .. } | Detected::V7Idle { .. } => "v7",
        _ => "none",
    };
    format!(
        "emulator evidence: procs={} family={} v7ver={} running_apps={} uninstall={} installation={:?} verdict={:?}",
        names.len(),
        family,
        reg.v7_version.as_deref().unwrap_or("-"),
        reg.running_apps.len(),
        reg.uninstall_dirs.len(),
        installation,
        verdict,
    )
}

/// Classify installation using registry-discovered custom roots and stock
/// roots, requiring a known emulator executable rather than an empty folder.
pub fn installation_status(reg: &RegistrySnapshot) -> InstallationStatus {
    installation_status_with_stock_paths(
        reg,
        V6.stock_paths
            .iter()
            .chain(V7.stock_paths.iter())
            .map(PathBuf::from),
    )
}

fn installation_status_with_stock_paths(
    reg: &RegistrySnapshot,
    stock_paths: impl Iterator<Item = PathBuf>,
) -> InstallationStatus {
    let mut roots = Vec::new();
    for path in reg
        .v7_install
        .iter()
        .chain(reg.v6_installs.iter())
        .chain(reg.install_dirs.iter())
        .chain(reg.uninstall_dirs.iter())
        .map(PathBuf::from)
        .chain(stock_paths)
    {
        if path.is_absolute()
            && !roots.iter().any(|existing: &PathBuf| {
                existing
                    .to_string_lossy()
                    .eq_ignore_ascii_case(&path.to_string_lossy())
            })
        {
            roots.push(path);
        }
    }

    let executables: Vec<&str> = V6
        .exe_names
        .iter()
        .chain(V7.exe_names.iter())
        .copied()
        .collect();
    let mut has_unverified_root = false;
    for root in roots {
        match std::fs::metadata(&root) {
            Ok(metadata) if metadata.is_dir() => {}
            Ok(_) => continue,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => {
                has_unverified_root = true;
                continue;
            }
        }

        has_unverified_root = true;
        let versioned = application_versions(&root);
        for marker in candidate_paths(&[root], &executables, &[versioned]) {
            match std::fs::metadata(marker) {
                Ok(metadata) if metadata.is_file() => return InstallationStatus::Installed,
                Ok(_) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(_) => has_unverified_root = true,
            }
        }
    }

    if has_unverified_root || !reg.registry_read_complete {
        InstallationStatus::Unknown
    } else {
        InstallationStatus::NotInstalled
    }
}

/// Install roots for the exe resolver, strongest evidence first:
/// live Uninstall dirs (any build), v7 direct, v6 subkeys, stocks.
/// All existence-validated - a stale key to a deleted dir contributes
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
    for d in &reg.install_dirs {
        let dir = PathBuf::from(d);
        if dir.exists() {
            push(dir.clone());
            if let Some(parent) = dir.parent() {
                push(parent.to_path_buf());
            }
        }
    }
    if let Some(install) = &reg.v7_install {
        let dir = PathBuf::from(install);
        if dir.exists() {
            push(dir);
        }
    }
    for install in &reg.v6_installs {
        let dir = PathBuf::from(install);
        if dir.exists() {
            push(dir.clone());
            if let Some(parent) = dir.parent() {
                push(parent.to_path_buf());
            }
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
/// subdir (client updates bump the build number - a fixed path would rot
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
pub fn version_notice(last_seen: Option<&str>, current: Option<&str>) -> (bool, String) {
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
            install_dirs: Vec::new(),
            registry_read_complete: true,
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
            &reg(
                Some("7.0.19.05"),
                None,
                vec![],
                vec![],
                vec!["com.tencent.ig"],
            ),
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
        // is for live processes with stems we never knew
        let d = detect(&["TencentGameLoopNext.exe".into()], &empty_reg());
        assert_eq!(d, Detected::Unknown);
    }

    #[test]
    fn detect_installed_but_closed_is_absent_not_unknown() {
        // static install evidence persists whether the client runs or
        // not: alone (no live gameloop-ish process) it means
        // installed-but-closed, so the honest verdict is Absent ("start
        // the game first"), never Unknown. Live evidence proved this on
        // a real machine: update windows kill every family process while
        // Uninstall entries stay put.
        let d = detect(
            &["explorer.exe".into()],
            &reg(None, None, vec![], vec![r"C:\GL8"], vec![]),
        );
        assert_eq!(d, Detected::Absent);
    }

    #[test]
    fn installation_requires_a_known_emulator_file() {
        let (root, cleanup) = temp_install_dir();
        std::fs::create_dir_all(root.join("Application").join("7.0.1"))
            .expect("create versioned application path");
        std::fs::write(
            root.join("Application")
                .join("7.0.1")
                .join("GameLoopEmulator.exe"),
            [],
        )
        .expect("create emulator marker");
        let custom = reg(None, None, vec![], vec![], vec![]);
        let mut custom = custom;
        custom.install_dirs.push(root.to_string_lossy().to_string());
        assert_eq!(installation_status(&custom), InstallationStatus::Installed);
        std::fs::remove_dir_all(cleanup).expect("remove test install directory");
    }

    #[test]
    fn existing_but_unverified_custom_location_is_unknown() {
        let (root, cleanup) = temp_install_dir();
        let mut custom = empty_reg();
        custom.install_dirs.push(root.to_string_lossy().to_string());
        assert_eq!(installation_status(&custom), InstallationStatus::Unknown);
        std::fs::remove_dir_all(cleanup).expect("remove test install directory");
    }

    #[test]
    fn display_icon_yields_only_the_game_loop_install_roots() {
        let icon = display_icon_path(r#""D:\Games\Tencent\GameLoop\Application\Uninstall.exe",0"#)
            .expect("quoted display icon path");
        let mut roots = Vec::new();
        push_install_root(&mut roots, icon.parent().expect("application directory"));
        assert_eq!(
            roots,
            vec![
                r"D:\Games\Tencent\GameLoop\Application".to_string(),
                r"D:\Games\Tencent\GameLoop".to_string()
            ]
        );
        assert!(display_icon_path(r#"D:\Games\GameLoop\Uninstall.exe,0"#).is_some());
        assert!(display_icon_path(r#""relative\Uninstall.exe",0"#).is_none());
    }

    #[test]
    fn stale_registry_location_and_clean_machine_are_not_installed() {
        let stale = reg(
            None,
            None,
            vec![],
            vec![r"C:\definitely-not-here-zzz"],
            vec![],
        );
        assert_eq!(
            installation_status(&stale),
            InstallationStatus::NotInstalled
        );
        assert_eq!(
            installation_status(&empty_reg()),
            InstallationStatus::NotInstalled
        );
    }

    #[test]
    fn unreadable_registry_sources_make_install_status_unknown() {
        let mut incomplete = empty_reg();
        incomplete.registry_read_complete = false;
        assert_eq!(
            installation_status_with_stock_paths(&incomplete, std::iter::empty()),
            InstallationStatus::Unknown
        );
    }

    #[test]
    fn stock_location_requires_a_known_emulator_file() {
        let (stock_path, cleanup) = temp_install_dir();
        std::fs::write(stock_path.join("GameLoopEmulator.exe"), [])
            .expect("create emulator marker");
        assert_eq!(
            installation_status_with_stock_paths(&empty_reg(), std::iter::once(stock_path),),
            InstallationStatus::Installed
        );
        std::fs::remove_dir_all(cleanup).expect("remove test install directory");
        assert_eq!(
            installation_status_with_stock_paths(
                &empty_reg(),
                std::iter::once(PathBuf::from(r"C:\definitely-not-here-zzz\GameLoop")),
            ),
            InstallationStatus::NotInstalled
        );
    }

    fn temp_install_dir() -> (PathBuf, PathBuf) {
        let path = std::env::temp_dir().join(format!(
            "laghunter-gameloop-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock after epoch")
                .as_nanos()
        ));
        std::fs::create_dir_all(&path).expect("create test install directory");
        (path.clone(), path)
    }

    #[test]
    fn presence_evidence_names_counts_never_processes() {
        // the gate log must answer "what did you see" without leaking
        // other apps: counts plus the matched family, full stop
        let line = presence_evidence_summary(
            &["GameLoop.exe".into(), "explorer.exe".into()],
            &reg(
                Some("7.0.167.0"),
                None,
                vec![],
                vec![r"C:\GL"],
                vec!["com.tencent.ig"],
            ),
            InstallationStatus::Installed,
        );
        assert!(line.contains("procs=2"), "{line}");
        assert!(line.contains("family=v7"), "{line}");
        assert!(line.contains("v7ver=7.0.167.0"), "{line}");
        assert!(line.contains("running_apps=1"), "{line}");
        assert!(line.contains("uninstall=1"), "{line}");
        assert!(!line.contains("explorer"), "{line}");
        // and the closed machine reads as absent with its evidence intact
        let closed = presence_evidence_summary(
            &["explorer.exe".into()],
            &reg(None, None, vec![], vec![r"C:\GL"], vec![]),
            InstallationStatus::Installed,
        );
        assert!(closed.contains("verdict=Absent"), "{closed}");
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
        assert_eq!(
            version_notice(None, Some("7.0.19.05")),
            (false, "7.0.19.05".into())
        );
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
        assert_eq!(
            version_notice(Some("7.0.19.05"), None),
            (false, String::new())
        );
        assert_eq!(version_notice(None, None), (false, String::new()));
    }

    #[test]
    fn candidates_cover_legacy_and_versioned_layouts() {
        let roots = vec![PathBuf::from(r"C:\G")];
        let out = candidate_paths(&roots, &["a.exe"], &[vec!["7.0.167.0".into()]]);
        let names: Vec<String> = out
            .iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect();
        assert!(names.iter().any(|p| p.ends_with(r"C:\G\a.exe")));
        assert!(names.iter().any(|p| p.ends_with(r"C:\G\ui\a.exe")));
        assert!(names.iter().any(|p| p.ends_with(r"C:\G\Application\a.exe")));
        assert!(names
            .iter()
            .any(|p| p.ends_with(r"C:\G\Application\7.0.167.0\a.exe")));
        // case-insensitive dedup across layouts
        let dup = candidate_paths(
            &[PathBuf::from(r"C:\G"), PathBuf::from(r"c:\g")],
            &["a.exe"],
            &[vec![], vec![]],
        );
        assert_eq!(dup.len(), 3); // root, ui, Application - not doubled
    }
}
