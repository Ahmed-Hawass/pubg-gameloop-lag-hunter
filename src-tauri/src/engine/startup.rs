// startup.rs — startup programs (Windows autostart), read + reversible toggle.
//
// Phase 1 sources: HKCU/HKLM Run, WOW6432Node Run, both Startup folders.
// Deliberately OUT of scope: RunOnce (self-deleting), Task Scheduler,
// services, Store StartupTasks, Group Policy Run (enterprise, read-only).
// The UI states the scope so the list is never mistaken for all of them.
//
// The toggle NEVER deletes: enable/disable rides the StartupApproved
// overlay byte only (02 on, 03 off), exactly like Task Manager. The HKCU
// overlay covers HKLM entries per-user too, so toggling needs no
// elevation, ever. All registry work is in-process winreg (milliseconds,
// like tweaks) — PowerShell has no place here.

use std::path::PathBuf;

/// Where one entry lives (machine keys for the UI contract).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StartupSource {
    UserRun,
    MachineRun,
    Wow32Run,
    UserFolder,
    MachineFolder,
}

impl StartupSource {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            StartupSource::UserRun => "user",
            StartupSource::MachineRun => "machine",
            StartupSource::Wow32Run => "wow32",
            StartupSource::UserFolder => "folder-user",
            StartupSource::MachineFolder => "folder-machine",
        }
    }

    pub(crate) fn from_str(s: &str) -> Option<StartupSource> {
        match s {
            "user" => Some(StartupSource::UserRun),
            "machine" => Some(StartupSource::MachineRun),
            "wow32" => Some(StartupSource::Wow32Run),
            "folder-user" => Some(StartupSource::UserFolder),
            "folder-machine" => Some(StartupSource::MachineFolder),
            _ => None,
        }
    }

    /// StartupApproved overlay variant for this source (Run32 covers the
    /// 32-bit view; StartupFolder covers both shortcut folders).
    fn overlay_variant(self) -> &'static str {
        match self {
            StartupSource::Wow32Run => "Run32",
            StartupSource::UserFolder | StartupSource::MachineFolder => "StartupFolder",
            _ => "Run",
        }
    }
}

/// One startup entry as the UI shows it. Paths never cross the bridge
/// bare: the icon URL rides along resolved, like the top-process rows.
#[derive(Debug, Clone, serde::Serialize)]
pub struct StartupEntry {
    /// stable machine id (`source:name`), the only thing set_enabled accepts
    pub id: String,
    /// display name (registry value name or shortcut stem)
    pub name: String,
    /// overlay says running at next logon
    pub enabled: bool,
    /// admin-locked overlay (01/08/09): shown greyed with its reason,
    /// never flippable by design
    pub locked: bool,
    /// resolved exe for the icon extractor (None = glyph fallback)
    pub exe_path: Option<String>,
    /// paintable icon URL (None = glyph fallback)
    pub icon_url: Option<String>,
}

/// Read every phase-1 source. Fail-soft per source (a missing key is an
/// empty source, never an error): an empty box lists nothing, it never
/// errors. Sorted by name so the UI never reshuffles. Infallible by
/// design (every source degrades to empty), so no error key exists for it.
pub fn startup_list() -> Vec<StartupEntry> {
    let mut out: Vec<StartupEntry> = Vec::new();
    for (source, key) in [
        (
            StartupSource::UserRun,
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\Run",
        ),
        (
            StartupSource::MachineRun,
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\Run",
        ),
        (
            StartupSource::Wow32Run,
            r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Run",
        ),
    ] {
        let hive = if source == StartupSource::UserRun {
            winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER)
        } else {
            winreg::RegKey::predef(winreg::enums::HKEY_LOCAL_MACHINE)
        };
        if let Ok(k) = hive.open_subkey(key) {
            for (name, value) in enum_string_values(&k) {
                let exe = exe_from_command(&value);
                let (enabled, locked) = overlay_state(source, &name);
                out.push(StartupEntry {
                    id: format!("{}:{name}", source.as_str()),
                    name: display_name(&name),
                    enabled,
                    locked,
                    exe_path: exe,
                    icon_url: None,
                });
            }
        }
    }
    out.extend(folder_entries());
    // friendly names from the exes themselves (FileDescription, like Task
    // Manager): a hash-suffixed value name never reaches the UI when the
    // binary names itself. Missing or blank names fall back to the raw
    // value name — displayed, never invented.
    let exes: Vec<String> = out.iter().filter_map(|e| e.exe_path.clone()).collect();
    let friendly = super::display_names::product_names(&exes);
    for entry in &mut out {
        if let Some(exe) = entry.exe_path.as_ref() {
            if let Some(name) = friendly.get(exe) {
                let name = name.trim().to_string();
                if !name.is_empty() {
                    entry.name = name;
                }
            }
        }
    }
    out.sort_by_key(|e| e.name.to_lowercase());
    super::logging::info(&format!("startup list: {} entries", out.len()));
    out
}

/// Toggle one entry by id, then re-read and return the fresh truth (the
/// UI paints the verified result, never its own guess). The id must match
/// a freshly enumerated entry: free-form ids can never reach the registry.
pub fn set_startup_enabled(id: &str, enabled: bool) -> Result<Vec<StartupEntry>, String> {
    let (source, name) = parse_entry_id(id).ok_or_else(|| "STARTUP_UNKNOWN_ID".to_string())?;
    let fresh = startup_list();
    let entry = fresh
        .iter()
        .find(|e| e.id == id)
        .ok_or_else(|| "STARTUP_UNKNOWN_ID".to_string())?;
    if entry.locked {
        return Err("STARTUP_LOCKED".to_string());
    }
    write_overlay(source, &name, enabled)?;
    let after = startup_list();
    let verified = after.iter().find(|e| e.id == id);
    match verified {
        Some(e) if e.enabled == enabled && !e.locked => {
            super::logging::info(&format!("startup flip verified: {id} enabled={enabled}"));
            Ok(after)
        }
        _ => {
            super::logging::warn(&format!("startup flip unverified: {id} enabled={enabled}"));
            Err("STARTUP_WRITE_FAILED".to_string())
        }
    }
}

/// Attach resolved icons to a startup list: EVERY row sharing an exe
/// gets the URL (a first-match-only loop here once starved sibling rows
/// of the same program, e.g. Realtek's two Run values, leaving one on
/// the glyph). One summary line per list so a split like that stays
/// diagnosable from the log: how many attached, how many entries had
/// no exe at all, and which paths the extractor refused.
pub fn attach_icons(
    mut entries: Vec<StartupEntry>,
    icons: &std::collections::HashMap<String, String>,
) -> Vec<StartupEntry> {
    let mut attached = 0usize;
    let mut no_exe = 0usize;
    let mut missed: Vec<&str> = Vec::new();
    let total = entries.len();
    for e in &mut entries {
        match e.exe_path.as_deref() {
            None => no_exe += 1,
            Some(path) => match icons.get(path) {
                Some(url) => {
                    e.icon_url = Some(url.clone());
                    attached += 1;
                }
                None => missed.push(path),
            },
        }
    }
    // siblings share paths: dedup so one broken exe logs once, not once
    // per row
    missed.sort_unstable();
    missed.dedup();
    if missed.is_empty() {
        super::logging::info(&format!(
            "startup icons: {attached}/{total} attached ({no_exe} without exe)"
        ));
    } else {
        super::logging::warn(&format!(
            "startup icons: {attached}/{total} attached ({} without exe, extractor missed {}: {})",
            no_exe,
            missed.len(),
            missed.join(", ")
        ));
    }
    entries
}

/// Elevated-child entry for the shield button: delete the machine-wide
/// overlay stamp so the row returns to user control, then the caller
/// runs the normal unprivileged flip (HKCU only). Idempotent: a missing
/// stamp is already unlocked. Bad shapes refuse BEFORE touching HKLM
/// (the same refusal discipline as every elevated entry).
pub fn clear_machine_overlay(scope: &str, name: &str) -> Result<(), String> {
    let source = StartupSource::from_str(scope)
        .ok_or_else(|| format!("startup unlock refused: bad scope {scope}"))?;
    if name.is_empty() || name.len() > 256 {
        return Err("startup unlock refused: bad name".to_string());
    }
    delete_overlay_hklm(source, name)
}

/// Delete one machine overlay value (already elevated at this point).
/// The key opens for WRITING (a read-only handle refuses the delete
/// with os error 5 even as admin: the exact failure the shield button
/// once surfaced). A missing key or value is success (no stamp stamps
/// the row); anything else failing is an honest error the parent
/// surfaces.
#[cfg(windows)]
fn delete_overlay_hklm(source: StartupSource, name: &str) -> Result<(), String> {
    use std::io::ErrorKind::NotFound;
    let path = format!(
        r"SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\{}",
        source.overlay_variant()
    );
    let hklm = winreg::RegKey::predef(winreg::enums::HKEY_LOCAL_MACHINE);
    let key = match hklm.open_subkey_with_flags(path, winreg::enums::KEY_WRITE) {
        Ok(key) => key,
        Err(e) if e.kind() == NotFound => {
            super::logging::info(&format!("startup unlock: no machine overlay for {name}"));
            return Ok(());
        }
        Err(e) => return Err(format!("machine overlay unreadable: {e}")),
    };
    match key.delete_value(name) {
        Ok(()) => {
            super::logging::info(&format!("startup unlocked: {}:{name}", source.as_str()));
            Ok(())
        }
        Err(e) if e.kind() == NotFound => {
            super::logging::info(&format!("startup unlock: no machine stamp for {name}"));
            Ok(())
        }
        Err(e) => Err(format!("machine overlay delete failed: {e}")),
    }
}

#[cfg(not(windows))]
fn delete_overlay_hklm(_source: StartupSource, _name: &str) -> Result<(), String> {
    Err("startup unlock is Windows-only".to_string())
}

/// `source:name`, both halves validated (unknown sources and empty names
/// refuse before touching anything). Crate-visible: the admin-flip
/// command re-guards the id through this same gate.
pub(crate) fn parse_entry_id(id: &str) -> Option<(StartupSource, String)> {
    let (scope, name) = id.split_once(':')?;
    let source = StartupSource::from_str(scope)?;
    if name.is_empty() || name.len() > 256 {
        return None;
    }
    Some((source, name.to_string()))
}

/// Registry string values of one key (name, data), best-effort. UTF-16
/// decoded by hand (pure, pinned by test) instead of trusting one more
/// implicit conversion on the read path.
#[cfg(windows)]
fn enum_string_values(key: &winreg::RegKey) -> Vec<(String, String)> {
    let mut raw = Vec::new();
    for entry in key.enum_values() {
        let Ok((name, value)) = entry else {
            continue;
        };
        raw.push((name, value.bytes));
    }
    decode_string_values(raw)
}

/// Pure half of the read: decode each value, skipping garbage WITHOUT
/// hiding its siblings (one corrupt value once hid the whole key with
/// a `break` here).
fn decode_string_values(raw: Vec<(String, Vec<u8>)>) -> Vec<(String, String)> {
    raw.into_iter()
        .filter_map(|(name, bytes)| decode_reg_sz(&bytes).map(|text| (name, text)))
        .collect()
}

/// UTF-16LE value bytes to String (trailing null trimmed). Pure.
fn decode_reg_sz(bytes: &[u8]) -> Option<String> {
    if bytes.len() % 2 != 0 || bytes.is_empty() {
        return None;
    }
    let wide: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|c| u16::from_le_bytes([c[0], c[1]]))
        .collect();
    let end = wide.iter().position(|&c| c == 0).unwrap_or(wide.len());
    if end == 0 {
        return None;
    }
    String::from_utf16(&wide[..end]).ok()
}

#[cfg(not(windows))]
fn enum_string_values(_key: &winreg::RegKey) -> Vec<(String, String)> {
    Vec::new()
}

/// Value names are arbitrary labels (often vendor-y, sometimes a hash
/// suffix like Edge's): shown verbatim, never invented.
fn display_name(name: &str) -> String {
    name.trim().to_string()
}

/// Overlay state for one entry name: missing overlay = enabled default
/// (Windows runs what has no overlay). The machine-wide overlay wins when
/// present (Task Manager reads the same merge: an HKLM disable holds even
/// when the user overlay says otherwise). Writes stay HKCU-only by design.
fn overlay_state(source: StartupSource, name: &str) -> (bool, bool) {
    merge_overlay_state(
        read_overlay_hkcu(source, name).as_deref(),
        read_overlay_hklm(source, name).as_deref(),
    )
}

/// Pure half of the merge (the registry edges live below): a machine-wide
/// disable holds for every user, so an HKLM overlay saying off locks the
/// row (only an admin clearing it can change that — our HKCU-only writes
/// must never pretend otherwise). Otherwise the user overlay decides.
fn merge_overlay_state(hkcu: Option<&[u8]>, hklm: Option<&[u8]>) -> (bool, bool) {
    match hklm {
        Some([0x02, ..]) | Some([0x06, ..]) | None => state_from_byte(hkcu),
        Some([0x08, ..]) => (true, true),
        _ => (false, true),
    }
}

/// Pure half of the overlay contract (the registry edge lives above):
/// 02/06 enabled, 03 disabled, 01/08/09 admin-locked, anything else
/// locked-disabled (a shape we do not understand is never flippable).
fn state_from_byte(bytes: Option<&[u8]>) -> (bool, bool) {
    match bytes {
        None => (true, false),
        Some([0x02, ..]) | Some([0x06, ..]) => (true, false),
        Some([0x03, ..]) => (false, false),
        Some([0x08, ..]) => (true, true),
        _ => (false, true),
    }
}

#[cfg(windows)]
fn read_overlay_hkcu(source: StartupSource, name: &str) -> Option<Vec<u8>> {
    read_overlay_hive(
        winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER),
        source,
        name,
    )
}

#[cfg(windows)]
fn read_overlay_hklm(source: StartupSource, name: &str) -> Option<Vec<u8>> {
    read_overlay_hive(
        winreg::RegKey::predef(winreg::enums::HKEY_LOCAL_MACHINE),
        source,
        name,
    )
}

#[cfg(windows)]
fn read_overlay_hive(hive: winreg::RegKey, source: StartupSource, name: &str) -> Option<Vec<u8>> {
    let path = format!(
        r"SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\{}",
        source.overlay_variant()
    );
    hive.open_subkey(path)
        .ok()?
        .get_raw_value(name)
        .ok()
        .map(|v| v.bytes)
}

#[cfg(not(windows))]
fn read_overlay_hkcu(_source: StartupSource, _name: &str) -> Option<Vec<u8>> {
    None
}

#[cfg(not(windows))]
fn read_overlay_hklm(_source: StartupSource, _name: &str) -> Option<Vec<u8>> {
    None
}

/// Write the 12-byte overlay marker: status byte plus the disable FILETIME
/// (zeroed on enable, exactly like Task Manager). The key is created on
/// demand under HKCU: toggling never needs elevation.
#[cfg(windows)]
fn write_overlay(source: StartupSource, name: &str, enabled: bool) -> Result<(), String> {
    use winreg::{enums::RegType, RegValue};
    let hkcu = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER);
    let path = format!(
        r"SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\{}",
        source.overlay_variant()
    );
    let (key, _) = hkcu
        .create_subkey(path)
        .map_err(|e| format!("overlay key failed: {e}"))?;
    // raw bytes on purpose: winreg's typed set_value writes Vec<u8> as
    // REG_MULTI_SZ, never REG_BINARY (the overlay would silently stop
    // working while every write "succeeded")
    let mut bytes = if enabled {
        vec![0x02u8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    } else {
        let mut v = vec![0x03u8, 0, 0, 0];
        v.extend_from_slice(&filetime_now());
        v
    };
    bytes.truncate(12);
    key.set_raw_value(
        name,
        &RegValue {
            bytes,
            vtype: RegType::REG_BINARY,
        },
    )
    .map_err(|e| format!("overlay write failed for {name}: {e}"))
}

#[cfg(not(windows))]
fn write_overlay(_source: StartupSource, _name: &str, _enabled: bool) -> Result<(), String> {
    Err("startup toggle is Windows-only".to_string())
}

/// Current Windows FILETIME (100ns ticks since 1601-01-01), little-endian.
#[cfg(windows)]
fn filetime_now() -> [u8; 8] {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    filetime_from_unix_secs(secs)
}

/// Pure half (testable everywhere): Unix seconds to little-endian FILETIME.
fn filetime_from_unix_secs(secs: u64) -> [u8; 8] {
    // 11644473600 = seconds between 1601-01-01 and 1970-01-01
    (secs.saturating_add(11644473600).saturating_mul(10_000_000)).to_le_bytes()
}

/// Startup-folder shortcuts (*.lnk) from both folders. The overlay name is
/// the file name; the display name is its stem.
fn folder_entries() -> Vec<StartupEntry> {
    let mut out = Vec::new();
    for (source, dir) in startup_folder_dirs() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            if path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_ascii_lowercase())
                != Some("lnk".to_string())
            {
                continue;
            }
            let file_name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            if file_name.is_empty() {
                continue;
            }
            let stem = path
                .file_stem()
                .and_then(|n| n.to_str())
                .unwrap_or(&file_name)
                .to_string();
            let target = std::fs::read(&path).ok().and_then(|b| lnk_target(&b));
            let (enabled, locked) = overlay_state(source, &file_name);
            out.push(StartupEntry {
                id: format!("{}:{file_name}", source.as_str()),
                name: stem,
                enabled,
                locked,
                exe_path: target,
                icon_url: None,
            });
        }
    }
    out
}

fn startup_folder_dirs() -> Vec<(StartupSource, PathBuf)> {
    let mut dirs = Vec::new();
    if let Ok(appdata) = std::env::var("APPDATA") {
        dirs.push((
            StartupSource::UserFolder,
            PathBuf::from(appdata).join(r"Microsoft\Windows\Start Menu\Programs\Startup"),
        ));
    }
    if let Ok(allusers) = std::env::var("PROGRAMDATA") {
        if allusers.is_empty() {
            if let Ok(profile) = std::env::var("ALLUSERSPROFILE") {
                if !profile.is_empty() {
                    dirs.push((
                        StartupSource::MachineFolder,
                        PathBuf::from(profile)
                            .join(r"Microsoft\Windows\Start Menu\Programs\StartUp"),
                    ));
                }
            }
        } else {
            dirs.push((
                StartupSource::MachineFolder,
                PathBuf::from(allusers).join(r"Microsoft\Windows\Start Menu\Programs\StartUp"),
            ));
        }
    }
    dirs
}

/// Minimal .lnk target parser: header signature, then the optional
/// LinkTargetIDList, then LinkInfo LocalBasePath. Every offset is
/// bounds-checked: a corrupt shortcut reads as None, never a panic.
fn lnk_target(bytes: &[u8]) -> Option<String> {
    const HEADER_LEN: usize = 76;
    if bytes.len() < HEADER_LEN {
        return None;
    }
    if bytes[0..4] != [0x4C, 0x00, 0x00, 0x00] {
        return None;
    }
    let flags = u32::from_le_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]);
    let mut off = HEADER_LEN;
    // HasLinkTargetIDList: u16 total size, skip it whole
    if flags & 0x01 != 0 {
        if bytes.len() < off + 2 {
            return None;
        }
        let size = u16::from_le_bytes([bytes[off], bytes[off + 1]]) as usize;
        off = off.checked_add(2)?.checked_add(size)?;
        if bytes.len() < off {
            return None;
        }
    }
    // HasLinkInfo: LinkInfoSize, header, flags, then offsets
    if flags & 0x02 == 0 {
        return None;
    }
    if bytes.len() < off + 28 {
        return None;
    }
    let info_size =
        u32::from_le_bytes([bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]]) as usize;
    if info_size < 28 || bytes.len() < off + info_size {
        return None;
    }
    let info_flags = u32::from_le_bytes([
        bytes[off + 8],
        bytes[off + 9],
        bytes[off + 10],
        bytes[off + 11],
    ]);
    // VolumeIDAndLocalBasePath must be present (bit 0)
    if info_flags & 0x01 == 0 {
        return None;
    }
    let base_off = u32::from_le_bytes([
        bytes[off + 16],
        bytes[off + 17],
        bytes[off + 18],
        bytes[off + 19],
    ]) as usize;
    let start = off.checked_add(base_off)?;
    let rel = bytes.get(start..)?;
    let end = rel.iter().position(|&b| b == 0)?;
    std::str::from_utf8(&rel[..end]).ok().map(|s| s.to_string())
}

/// Exe path out of a Run command line: quote-aware tokens accumulate
/// until the joined prefix ends in .exe, so unquoted paths with spaces
/// (`C:\My Tools\app.exe /x`) resolve instead of truncating at the first
/// gap. %VAR% expanded, quotes stripped. Pure and total: garbage reads as
/// None, never a panic, never a half path.
fn exe_from_command(cmd: &str) -> Option<String> {
    let tokens = split_command(cmd);
    if tokens.is_empty() {
        return None;
    }
    let mut candidate = String::new();
    for token in &tokens {
        if !candidate.is_empty() {
            candidate.push(' ');
        }
        candidate.push_str(token);
        let path = expand_env_vars(&candidate);
        let path = path.trim().trim_matches('"').to_string();
        if path.len() > 512 {
            return None;
        }
        if path.to_ascii_lowercase().ends_with(".exe") {
            return Some(path);
        }
    }
    None
}

/// Whitespace split that keeps quoted spans whole (quotes stripped).
fn split_command(cmd: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut cur = String::new();
    let mut in_quotes = false;
    let mut started = false;
    for c in cmd.chars() {
        if c == '"' {
            in_quotes = !in_quotes;
            started = true;
            continue;
        }
        if c.is_whitespace() && !in_quotes {
            if started || !cur.is_empty() {
                tokens.push(std::mem::take(&mut cur));
                started = false;
            }
            continue;
        }
        started = true;
        cur.push(c);
    }
    if started || !cur.is_empty() {
        tokens.push(cur);
    }
    tokens
}

/// %NAME% expansion against the process environment (unknown names stay
/// verbatim and fail the .exe gate below like any other garbage).
fn expand_env_vars(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let tail = &rest[start + 1..];
        match tail.find('%') {
            Some(end) => {
                let name = &tail[..end];
                match std::env::var(name) {
                    Ok(v) => out.push_str(&v),
                    Err(_) => {
                        out.push('%');
                        out.push_str(name);
                        out.push('%');
                    }
                }
                rest = &tail[end + 1..];
            }
            None => {
                out.push_str(&rest[start..]);
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exe_from_command_shapes() {
        assert_eq!(
            exe_from_command(r#""C:\Program Files\App\app.exe" --silent"#),
            Some(r"C:\Program Files\App\app.exe".to_string())
        );
        assert_eq!(
            exe_from_command(r"C:\Tools\app.exe /onboot"),
            Some(r"C:\Tools\app.exe".to_string())
        );
        // unquoted paths with spaces accumulate to the full exe instead
        // of truncating at the first gap (the IDMan shape); a non-exe
        // fragment still reads as nothing
        assert_eq!(
            exe_from_command(r"C:\My Tools\app.exe /x"),
            Some(r"C:\My Tools\app.exe".to_string())
        );
        assert_eq!(exe_from_command(""), None);
        assert_eq!(exe_from_command("   "), None);
        assert_eq!(exe_from_command("not-an-exe"), None);
        assert_eq!(exe_from_command(r"C:\x\y.dll"), None);
        // unbalanced quote still resolves (quotes stripped, never joined
        // with the void)
        assert_eq!(
            exe_from_command(r#""C:\x\app.exe"#),
            Some(r"C:\x\app.exe".to_string())
        );
        // a second exe later in the line never wins over the first
        assert_eq!(
            exe_from_command(r"C:\a\app.exe --config C:\b\other.exe"),
            Some(r"C:\a\app.exe".to_string())
        );
    }

    #[test]
    fn overlay_merge_prefers_machine() {
        // a machine-wide disable locks the row: HKCU writes can never
        // override it, so the UI must grey it instead of failing the flip
        // (the Apoint/CloudflareWARP shape from a real machine)
        assert_eq!(
            merge_overlay_state(Some(&[0x02]), Some(&[0x03])),
            (false, true)
        );
        assert_eq!(merge_overlay_state(None, Some(&[0x03])), (false, true));
        // machine-enabled or absent defers to the user overlay
        assert_eq!(
            merge_overlay_state(Some(&[0x03]), Some(&[0x02])),
            (false, false)
        );
        assert_eq!(merge_overlay_state(None, Some(&[0x06])), (true, false));
        assert_eq!(merge_overlay_state(Some(&[0x03]), None), (false, false));
        assert_eq!(merge_overlay_state(None, None), (true, false));
        // machine-forced on stays on and locked
        assert_eq!(
            merge_overlay_state(Some(&[0x03]), Some(&[0x08])),
            (true, true)
        );
    }

    #[test]
    fn env_expansion_shapes() {
        std::env::set_var("LAGHUNTER_TEST_VAR", r"C:\T");
        assert_eq!(
            expand_env_vars(r"%LAGHUNTER_TEST_VAR%\app.exe"),
            r"C:\T\app.exe".to_string()
        );
        assert_eq!(
            expand_env_vars(r"%DEFINITELY_MISSING_VAR_ZZ%\app.exe"),
            r"%DEFINITELY_MISSING_VAR_ZZ%\app.exe".to_string()
        );
        assert_eq!(expand_env_vars("plain"), "plain".to_string());
        std::env::remove_var("LAGHUNTER_TEST_VAR");
    }

    #[test]
    fn corrupt_values_never_hide_their_siblings() {
        let enc = |s: &str| {
            s.encode_utf16()
                .chain(std::iter::once(0))
                .flat_map(|c| c.to_le_bytes())
                .collect::<Vec<u8>>()
        };
        let out = decode_string_values(vec![
            ("Good1".to_string(), enc(r"C:\A\app.exe")),
            ("Garbage".to_string(), vec![0x41]),
            ("Empty".to_string(), vec![]),
            ("Good2".to_string(), enc(r"C:\B\app.exe")),
        ]);
        // garbage skipped, siblings survive in order
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].0, "Good1");
        assert_eq!(out[1].0, "Good2");
        assert!(decode_string_values(vec![]).is_empty());
    }

    #[test]
    fn reg_sz_decoding() {
        let enc = |s: &str| {
            s.encode_utf16()
                .chain(std::iter::once(0))
                .flat_map(|c| c.to_le_bytes())
                .collect::<Vec<u8>>()
        };
        assert_eq!(
            decode_reg_sz(&enc(r"C:\A\app.exe")),
            Some(r"C:\A\app.exe".to_string())
        );
        assert_eq!(decode_reg_sz(&[]), None);
        assert_eq!(decode_reg_sz(&[0x41]), None);
        assert_eq!(decode_reg_sz(&[0x00, 0x00]), None);
    }

    #[test]
    fn filetime_math() {
        // 1970-01-01T00:00:00Z = 11644473600s after 1601, in 100ns ticks
        assert_eq!(
            filetime_from_unix_secs(0),
            116444736000000000u64.to_le_bytes()
        );
        assert_eq!(filetime_from_unix_secs(u64::MAX), u64::MAX.to_le_bytes());
    }

    #[test]
    fn overlay_first_byte_contract() {
        // mirrors Task Manager: 02/06 on, 03 off, 01/08/09 locked
        assert_eq!(state_from_byte(Some(&[0x02])), (true, false));
        assert_eq!(state_from_byte(Some(&[0x06])), (true, false));
        assert_eq!(state_from_byte(Some(&[0x03])), (false, false));
        assert_eq!(state_from_byte(Some(&[0x08])), (true, true));
        assert_eq!(state_from_byte(Some(&[0x01])), (false, true));
        assert_eq!(state_from_byte(Some(&[0x09])), (false, true));
        assert_eq!(state_from_byte(None), (true, false));
        assert_eq!(state_from_byte(Some(&[])), (false, true));
        assert_eq!(state_from_byte(Some(&[0xFF])), (false, true));
    }

    #[test]
    fn entry_id_parsing() {
        assert!(parse_entry_id("user:Discord").is_some());
        assert!(parse_entry_id("folder-user:App.lnk").is_some());
        assert!(parse_entry_id("nope:Discord").is_none());
        assert!(parse_entry_id("user:").is_none());
        assert!(parse_entry_id("user").is_none());
        assert!(parse_entry_id(&format!("user:{}", "x".repeat(300))).is_none());
    }

    #[test]
    fn attach_icons_reaches_every_sibling() {
        // two Run values, one exe (the Realtek shape): a first-match-only
        // loop left the second row on the glyph. Every row sharing the
        // path must carry the URL.
        let row = |id: &str, exe: Option<&str>| StartupEntry {
            id: id.to_string(),
            name: id.to_string(),
            enabled: false,
            locked: false,
            exe_path: exe.map(|s| s.to_string()),
            icon_url: None,
        };
        let icons: std::collections::HashMap<String, String> =
            [("C:\\A\\app.exe".to_string(), "data:1".to_string())]
                .into_iter()
                .collect();
        let out = attach_icons(
            vec![
                row("machine:First", Some("C:\\A\\app.exe")),
                row("machine:Second", Some("C:\\A\\app.exe")),
                row("machine:Gone", Some("C:\\B\\gone.exe")),
                row("user:Bare", None),
            ],
            &icons,
        );
        assert_eq!(out[0].icon_url.as_deref(), Some("data:1"));
        assert_eq!(out[1].icon_url.as_deref(), Some("data:1"));
        assert_eq!(out[2].icon_url, None);
        assert_eq!(out[3].icon_url, None);
        // an empty map attaches nothing and never panics
        let bare = attach_icons(
            vec![row("user:X", Some("C:\\A\\app.exe"))],
            &Default::default(),
        );
        assert_eq!(bare[0].icon_url, None);
    }

    #[test]
    fn machine_unlock_refuses_bad_shapes_before_hklm() {
        // every refusal happens before any registry access, so these run
        // anywhere with zero side effects (the positive path needs a real
        // elevated Windows and is covered by the elevate arity test)
        assert!(clear_machine_overlay("nope", "X").is_err());
        assert!(clear_machine_overlay("", "X").is_err());
        assert!(clear_machine_overlay("machine", "").is_err());
        assert!(clear_machine_overlay("machine", &"x".repeat(300)).is_err());
        // scope vocabulary itself: every real scope parses, anything else
        // refuses (the registry edge for valid shapes is platform-gated
        // and covered by the elevate arity test, never here)
        for scope in ["user", "machine", "wow32", "folder-user", "folder-machine"] {
            assert!(StartupSource::from_str(scope).is_some());
        }
        assert!(StartupSource::from_str("nope").is_none());
    }

    #[test]
    fn lnk_parser_shapes() {
        // minimal valid link: header + IDList(empty) + LinkInfo with base path
        let mut b = vec![0u8; 76];
        b[0] = 0x4C;
        // flags: HasLinkTargetIDList | HasLinkInfo
        b[20] = 0x03;
        // IDList size 0
        b.extend_from_slice(&[0x00, 0x00]);
        // LinkInfo: size=0x1C, header=0x1C, flags=VolumeIDAndLocalBasePath,
        // volumeIDOffset=0, localBasePathOffset=0x1C
        let base = br"C:\Tools\app.exe";
        let info_size = 28usize + base.len() + 1;
        let mut info = vec![0u8; info_size];
        info[0..4].copy_from_slice(&(info_size as u32).to_le_bytes());
        info[4..8].copy_from_slice(&28u32.to_le_bytes());
        info[8..12].copy_from_slice(&1u32.to_le_bytes());
        info[16..20].copy_from_slice(&28u32.to_le_bytes());
        info[28..28 + base.len()].copy_from_slice(base);
        b.extend_from_slice(&info);
        assert_eq!(lnk_target(&b), Some(r"C:\Tools\app.exe".to_string()));
        // corrupt inputs read as None, never panic
        assert_eq!(lnk_target(&[]), None);
        assert_eq!(lnk_target(&[0u8; 10]), None);
        assert_eq!(lnk_target(&[0x4Du8; 76]), None);
        assert_eq!(lnk_target(&b[..80]), None);
    }
}
