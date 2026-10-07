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
const CURATED: [(&str, &str); 16] = [
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
    // Edge WebView2 runtime: Microsoft's shared renderer on every
    // Windows 10/11 (preinstalled or evergreen). Never a standalone app:
    // its processes belong to their hosts (Office, Search, widgets, our
    // own WebView). A platform rule, not a device list.
    ("msedgewebview2", "procEdgeWebView"),
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

/// ProductName from an exe's own version resource, read natively
/// in-process (GetFileVersionInfo trio, microseconds): the previous
/// PowerShell batch spawned a whole process per poll for a handful of
/// strings (and its own parse could never match, so every name fell
/// back to raw). Paths that fail (protected processes, vanished PIDs)
/// are simply absent from the map — the caller falls back, never retries.
#[cfg(windows)]
pub fn product_names(paths: &[String]) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for p in paths {
        if let Some(name) = friendly_name_of(p) {
            out.insert(p.clone(), name);
        }
    }
    out
}

/// Friendly name from the version resource: FileDescription first (what
/// vendors print: "Brave Browser", "WhatsApp"), ProductName second.
/// Vendor boilerplate ("Microsoft Windows Operating System" on half the
/// OS binaries) reads as missing: it names the vendor, never the
/// program. Empty or missing reads as None, never a guess.
#[cfg(windows)]
fn friendly_name_of(path: &str) -> Option<String> {
    use std::os::windows::ffi::OsStrExt;
    let wide: Vec<u16> = std::ffi::OsStr::new(path)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    unsafe {
        let mut handle = 0u32;
        let size = GetFileVersionInfoSizeW(wide.as_ptr(), &mut handle);
        if size == 0 {
            return None;
        }
        let mut buf = vec![0u8; size as usize];
        if GetFileVersionInfoW(wide.as_ptr(), 0, size, buf.as_mut_ptr() as *mut core::ffi::c_void) == 0 {
            return None;
        }
        let base = buf.as_ptr() as *const core::ffi::c_void;
        // language of the first translation block (the exe's own default)
        let mut trans: *mut u16 = std::ptr::null_mut();
        let mut trans_len = 0u32;
        if VerQueryValueW(
            base,
            translation_query().as_ptr(),
            &mut trans as *mut _ as *mut *mut core::ffi::c_void,
            &mut trans_len,
        ) == 0
            || trans.is_null()
            || trans_len < 4
        {
            return None;
        }
        let lang = *trans;
        let codepage = *trans.add(1);
        for key in ["FileDescription", "ProductName"] {
            let mut val: *mut u16 = std::ptr::null_mut();
            let mut val_len = 0u32;
            if VerQueryValueW(
                base,
                string_query(lang, codepage, key).as_ptr(),
                &mut val as *mut _ as *mut *mut core::ffi::c_void,
                &mut val_len,
            ) != 0
                && !val.is_null()
            {
                let s = read_wide_str(val);
                if !s.trim().is_empty() && !is_vendor_boilerplate(&s) {
                    return Some(s);
                }
            }
        }
        None
    }
}

/// Query for the translation table: wide + NUL-terminated.
#[cfg(windows)]
fn translation_query() -> Vec<u16> {
    "\\VarFileInfo\\Translation\0".encode_utf16().collect()
}

/// Query for one string value in one language: wide + NUL-terminated.
/// Pure (the lang/codepage pair comes from the file itself).
#[cfg(windows)]
fn string_query(lang: u16, codepage: u16, key: &str) -> Vec<u16> {
    format!("\\StringFileInfo\\{lang:04X}{codepage:04X}\\{key}\0")
        .encode_utf16()
        .collect()
}

/// True when a version string names the vendor instead of the program
/// ("Microsoft Windows Operating System" ships on half the OS binaries:
/// showing it on every row explains nothing). Normalized (case, marks,
/// and punctuation stripped), so transliterations cannot sneak past.
/// Pure: new boilerplate extends the list, never a caller.
#[cfg(windows)]
fn is_vendor_boilerplate(s: &str) -> bool {
    let flat: String = s
        .to_ascii_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect();
    matches!(
        flat.as_str(),
        "microsoftwindowsoperatingsystem" | "microsoftwindowsos" | "microsoftcorporation"
    )
}

/// Human stem from a raw exe name: the suffix after the first dot is
/// never the program ("WhatsApp.Root" is WhatsApp, "*.x64" is the arch).
/// Dots inside real names are near-nonexistent; the raw name stays the
/// eternal fallback when this yields nothing. Pure.
pub fn pretty_stem(raw: &str) -> String {
    let stem = raw.trim_end_matches(".exe").trim_end_matches(".EXE");
    let head = stem.split('.').next().unwrap_or("").trim();
    if head.is_empty() {
        raw.to_string()
    } else {
        head.to_string()
    }
}

/// Read a NUL-terminated wide string (lossy, never panics on odd data).
#[cfg(windows)]
fn read_wide_str(ptr: *const u16) -> String {
    unsafe {
        let mut len = 0usize;
        while *ptr.add(len) != 0 && len < 4096 {
            len += 1;
        }
        String::from_utf16_lossy(std::slice::from_raw_parts(ptr, len))
    }
}

#[cfg(windows)]
#[link(name = "version")]
extern "system" {
    fn GetFileVersionInfoSizeW(name: *const u16, handle: *mut u32) -> u32;
    fn GetFileVersionInfoW(
        name: *const u16,
        handle: u32,
        len: u32,
        data: *mut core::ffi::c_void,
    ) -> i32;
    fn VerQueryValueW(
        block: *const core::ffi::c_void,
        sub: *const u16,
        buf: *mut *mut core::ffi::c_void,
        len: *mut u32,
    ) -> i32;
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
        // the shared WebView2 runtime is a platform staple, never an app
        assert_eq!(curated_key("msedgewebview2.exe"), Some("procEdgeWebView"));
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

    #[test]
    fn pretty_stem_trims_suffixes_never_meaning() {
        // dotted suffixes are arch/channel tags, never the program
        assert_eq!(pretty_stem("WhatsApp.Root"), "WhatsApp");
        assert_eq!(pretty_stem("WhatsApp.Root.exe"), "WhatsApp");
        // plain stems pass through untouched (no invention)
        assert_eq!(pretty_stem("brave"), "brave");
        assert_eq!(pretty_stem("cargo.exe"), "cargo");
        assert_eq!(pretty_stem("vctip"), "vctip");
        // degenerate input falls back to itself, never blank
        assert_eq!(pretty_stem(""), "");
        assert_eq!(pretty_stem(".exe"), ".exe");
    }

    #[cfg(windows)]
    #[test]
    fn vendor_boilerplate_never_names_a_row() {
        assert!(super::is_vendor_boilerplate(
            "Microsoft® Windows® Operating System"
        ));
        assert!(super::is_vendor_boilerplate(
            "Microsoft Windows Operating System"
        ));
        assert!(super::is_vendor_boilerplate("Microsoft Corporation"));
        assert!(!super::is_vendor_boilerplate("Brave Browser"));
        assert!(!super::is_vendor_boilerplate("Google Chrome"));
        assert!(!super::is_vendor_boilerplate(""));
    }

    #[cfg(windows)]
    #[test]
    fn string_query_names_the_files_own_language() {
        let q: String = super::string_query(0x0409, 0x04E4, "FileDescription")
            .into_iter()
            .take_while(|&c| c != 0)
            .collect::<Vec<u16>>()
            .iter()
            .map(|&c| c as u8 as char)
            .collect();
        assert_eq!(q, "\\StringFileInfo\\040904E4\\FileDescription");
    }

    #[cfg(windows)]
    #[test]
    fn friendly_name_reads_the_files_own_words() {
        // PowerShell's own exe: guaranteed present with a version resource
        // on every Windows (the read is native, no spawn to recurse into).
        let root = super::super::system::windows_dir().to_string_lossy().into_owned();
        let ps = format!(
            r"{root}\System32\WindowsPowerShell\v1.0\powershell.exe",
            root = root.trim_end_matches(['\\', '/'])
        );
        let name = super::friendly_name_of(&ps);
        assert!(name.map(|s| !s.trim().is_empty()).unwrap_or(false));
        // missing files read as unknown, never invented
        assert_eq!(super::friendly_name_of(r"C:\no-such-dir-xyz\nope.exe"), None);
    }
}
