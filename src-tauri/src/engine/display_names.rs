// display_names.rs — human names for processes: a curated table for the
// stable Windows set, ProductName auto-naming for everything else, raw
// names as the eternal fallback. Three layers, each honest about what
// it knows:
//
//   1. curated: ~15 OS staples that never change (svchost, dwm, ...).
//      The engine emits a machine KEY, the UI translates it (keys, not
//      sentences — same contract as diagnoses).
//   2. ProductName: read from the exe's own version resource (what the
//      vendor calls it: "Google Chrome", "Brave"). Proper nouns stay
//      Latin in every locale, so no translation table can ever rot.
//   3. raw process name: always present, never wrong, just technical.
//
// Resolved per unique PATH (not per row) with a bounded memory cache:
// steady state costs zero spawns. Unknown paths and protected processes
// (no path even for admins) fall through to layer 1 or 3 — a missing
// name is never invented.

use std::collections::HashMap;
use std::sync::Mutex;

/// Curated OS staples: exe stem (lowercase, no extension) to display key.
/// Only processes whose names are stable across Windows builds belong
/// here. User software is NEVER listed (infinite tail) — ProductName
/// names it, raw names back it.
const CURATED: [(&str, &str); 15] = [
    ("powershell", "procPowershell"),
    ("cmd", "procCmd"),
    ("conhost", "procConsoleHost"),
    ("svchost", "procServiceHost"),
    ("csrss", "procCsrss"),
    ("dwm", "procDwm"),
    ("sihost", "procShellHost"),
    ("ctfmon", "procCtfmon"),
    ("explorer", "procExplorer"),
    ("taskhostw", "procTaskHost"),
    ("runtimebroker", "procRuntimeBroker"),
    ("searchhost", "procSearchHost"),
    ("startmenuexperiencehost", "procStartMenu"),
    ("shellexperiencehost", "procShellExperience"),
    ("spoolsv", "procSpooler"),
];

/// Machine key for a process name, if it is a curated staple.
pub fn curated_key(exe_name: &str) -> Option<&'static str> {
    // extension stripped case-insensitively: "PowerShell.EXE" is still
    // powershell (a case-sensitive trim missed exactly this shape)
    let lower = exe_name.to_ascii_lowercase();
    let stem = lower.strip_suffix(".exe").unwrap_or(&lower);
    CURATED
        .iter()
        .find(|(n, _)| *n == stem)
        .map(|(_, key)| *key)
}

/// ProductName from an exe's own version resource, via one PowerShell
/// call for the whole batch (never per row, never in the hot poll loop).
/// Runs through the tracked spawn path (hard deadline, kill-on-close
/// job) like every other probe: a wedged call fails soft, never hangs
/// the tab. Paths that fail (protected processes, vanished PIDs) are
/// simply absent from the map — the caller falls back, never retries.
#[cfg(windows)]
pub fn product_names(paths: &[String]) -> HashMap<String, String> {
    use std::os::windows::process::CommandExt;
    use std::time::Duration;
    const NO_WINDOW: u32 = 0x0800_0000;
    let mut out = HashMap::new();
    if paths.is_empty() {
        return out;
    }
    // NUL-separated paths in, NUL-separated "path|product" pairs out:
    // file names legally contain every other separator, NUL cannot occur.
    let joined = paths.join("\0");
    let script = format!(
        "$ErrorActionPreference='SilentlyContinue';\
         @'\n{joined}\n'@ -split \"`0\" | Where-Object {{ $_ -ne '' }} | ForEach-Object {{\
           $pn = (Get-Item -LiteralPath $_).VersionInfo.ProductName;\
           if ($pn) {{ \"$_`0$pn\" }}\
         }}"
    );
    let mut cmd = std::process::Command::new("powershell.exe");
    cmd.args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .creation_flags(NO_WINDOW);
    let Ok(result) = super::sampler::output_tracked(&mut cmd, Duration::from_secs(10)) else {
        return out;
    };
    if !result.status.success() {
        return out;
    }
    for chunk in String::from_utf8_lossy(&result.stdout).split('\0') {
        if let Some((path, product)) = chunk.split_once('\0') {
            let product = product.trim();
            if !path.trim().is_empty() && !product.is_empty() {
                out.insert(path.trim().to_string(), product.to_string());
            }
        }
    }
    out
}

/// Cache ceiling: paths are stable per machine, but updates rename files —
/// a bounded map that resets instead of growing forever across weeks.
const CACHE_CEILING: usize = 1000;

static NAME_CACHE: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

/// Non-Windows builds never probe (same fail-soft contract as the rest
/// of the engine's Windows-only readers).
#[cfg(not(windows))]
pub fn product_names(_paths: &[String]) -> HashMap<String, String> {
    HashMap::new()
}

/// Resolve display names for paths, using the cache first so steady state
/// costs zero spawns. Returns path -> ProductName for the resolvable ones.
pub fn resolve_cached(paths: &[String]) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let mut missing = Vec::new();
    {
        let mut cache = NAME_CACHE
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        let map = cache.get_or_insert_with(HashMap::new);
        for p in paths {
            if let Some(name) = map.get(p) {
                out.insert(p.clone(), name.clone());
            } else if !missing.contains(p) {
                missing.push(p.clone());
            }
        }
        if !missing.is_empty() {
            let fresh = product_names(&missing);
            if map.len() > CACHE_CEILING {
                map.clear();
            }
            for (p, n) in &fresh {
                map.insert(p.clone(), n.clone());
            }
            out.extend(fresh);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn curated_covers_staples_only() {
        assert_eq!(curated_key("powershell.exe"), Some("procPowershell"));
        assert_eq!(curated_key("PowerShell.EXE"), Some("procPowershell"));
        assert_eq!(curated_key("svchost"), Some("procServiceHost"));
        assert_eq!(curated_key("dwm.exe"), Some("procDwm"));
        // user software is never curated (infinite tail): ProductName territory
        assert_eq!(curated_key("chrome.exe"), None);
        assert_eq!(curated_key("brave.exe"), None);
        assert_eq!(curated_key("code.exe"), None);
        assert_eq!(curated_key("GameLoopEmulator.exe"), None);
        assert_eq!(curated_key("explorer2.exe"), None);
        assert_eq!(curated_key(""), None);
    }

    #[test]
    fn empty_batch_resolves_nothing_without_spawning() {
        // no paths, no process: the guard every caller relies on
        assert!(product_names(&[]).is_empty());
        assert!(resolve_cached(&[]).is_empty());
    }
}
