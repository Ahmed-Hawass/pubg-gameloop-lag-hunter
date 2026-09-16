// tweaks.rs — user-initiated WRITES for the Tools tab. Contract per tweak:
// read live, write the explicit requested state, verify by re-reading, audit
// log. Reads stay in system.rs; only writes live here.
//
// Model (matches the mature tweak tools): a switch MIRRORS THE LIVE RESULT
// of its named action ("Turn off X": ON = X is actually off right now, no
// matter who turned it off — us, the user, or the factory). Flips write the
// explicit opposite state; there is no "revert to our backup" for binary
// tweaks. Windows is the single source of truth, so manual changes outside
// the app are picked up by the next fresh read. The backup/restore idea is
// deliberately NOT here: it only earns its place for multi-state tweaks
// (e.g. a power plan, where "off" must mean "the previous plan") and will be
// built with the tweak that needs it — never before.
//
// Architecture rule (applies repo-wide): ANY registry access goes through
// winreg, in-process — never a PowerShell spawn, never string-built scripts.
// A flip is now milliseconds: open key, read/write DWORD, re-read to verify.
// No shell means no quoting traps (the `.'01'` bug class is structurally
// impossible now) and access errors come back as typed Results instead of
// silently empty output lines.
//
// Scope deliberately narrow: HKCU (current user) DWORDs only — no elevation,
// no reboot, no service or policy writes. Anything needing admin or BIOS
// stays a read-only check with a deep link, never a button here.

use serde::Serialize;
use winreg::enums::HKEY_CURRENT_USER;
use winreg::RegKey;

/// Registry home of the background-recording toggle ("Record what
/// happened"): HKCU needs no elevation, takes effect immediately.
const DVR_SUBKEY: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\GameDVR";
const DVR_NAME: &str = "HistoricalCaptureEnabled";

/// Registry home of the Storage Sense on/off toggle ("01" under the
/// StoragePolicy key, the documented value behind the Settings switch).
/// Present on Windows 10 (1709+) and 11; verified live on a real machine.
const SS_SUBKEY: &str =
    r"SOFTWARE\Microsoft\Windows\CurrentVersion\StorageSense\Parameters\StoragePolicy";
const SS_NAME: &str = "01";

/// The tweak ids this module knows. Unknown ids are refused before any
/// registry access (same whitelist discipline as open_windows_panel).
const DVR_ID: &str = "dvr";
const SS_ID: &str = "storagesense";
const GAMEMODE_ID: &str = "gamemode";
const GPUPREF_ID: &str = "gpupref";
const FSO_ID: &str = "fso";
const MOUSE_ID: &str = "mouse";
const WGC_ID: &str = "windowedopt";

/// Registry homes shared with the read side (system.rs): ONE definition
/// per key path — the lightweight tweak_states read and these writes must
/// never drift apart on where a tweak lives.
pub(crate) const GAMEBAR_SUBKEY: &str = r"SOFTWARE\Microsoft\GameBar";
pub(crate) const GAMEMODE_ALLOW: &str = "AllowAutoGameMode";
pub(crate) const GAMEMODE_AUTO: &str = "AutoGameModeEnabled";
pub(crate) const MOUSE_SUBKEY: &str = r"Control Panel\Mouse";
pub(crate) const MOUSE_SPEED: &str = "MouseSpeed";
pub(crate) const MOUSE_T1: &str = "MouseThreshold1";
pub(crate) const MOUSE_T2: &str = "MouseThreshold2";
pub(crate) const LAYERS_SUBKEY: &str =
    r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers";
pub(crate) const FSO_FLAG: &str = "DISABLEDXMAXIMIZEDWINDOWEDMODE";
pub(crate) const GPU_PREF_SUBKEY: &str = r"SOFTWARE\Microsoft\DirectX\UserGpuPreferences";
/// The windowed-games optimization lives in the SAME store (verified
/// live: ON writes `SwapEffectUpgradeEnable=1;`, OFF writes `=0`, never
/// deletes) — one more reason the global DirectX preference store, not
/// GameConfigStore, is where this feature is read and written.
pub(crate) const WGC_SETTINGS_NAME: &str = "DirectXUserGlobalSettings";
pub(crate) const WGC_TOKEN: &str = "SwapEffectUpgradeEnable";
/// the high-performance preference number (matches the Settings UI)
pub(crate) const GPU_PREF_HIGH: u32 = 2;

/// What the UI needs after a write: what was there, what was written, and
/// whether a fresh re-read confirms it. `verified == false` must surface as
/// a failure, never as a silent success (the mature tools do the same: if
/// Windows blocks the change they report the real cause, not a fake green
/// switch).
#[derive(Debug, Clone, Serialize)]
pub struct TweakResult {
    pub id: String,
    pub previous: Option<u32>,
    pub value: u32,
    pub verified: bool,
}

/// Live DWORD read from an HKCU subkey. Ok(None) = value does not exist.
/// Errors (missing KEY, access denied) travel as Err — a probe failure is
/// never silently conflated with "value missing" (that conflation is what
/// the old empty-output PowerShell read got wrong).
fn read_dword(subkey: &str, name: &str) -> Result<Option<u32>, String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu
        .open_subkey(subkey)
        .map_err(|e| format!("cannot open {subkey}: {e}"))?;
    match key.get_value::<u32, _>(name) {
        Ok(v) => Ok(Some(v)),
        // NotFound on the VALUE: the key exists, the value never was set
        Err(ref e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("cannot read {subkey}\\{name}: {e}")),
    }
}

/// Write a DWORD to an HKCU subkey, creating the VALUE if absent (same
/// semantics as the Settings toggle itself). The value is always our own
/// validated constant — never user input.
fn write_dword(subkey: &str, name: &str, value: u32) -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu
        .create_subkey(subkey)
        .map_err(|e| format!("cannot open/create {subkey}: {e}"))?;
    key.set_value(name, &value)
        .map_err(|e| format!("cannot write {subkey}\\{name}: {e}"))
}

/// Write a string value to an HKCU subkey, creating the KEY if absent
/// (same semantics as write_dword: mirrors what Settings itself does).
/// The value is always constructed by our own pure builders — never raw
/// user input.
fn write_string(subkey: &str, name: &str, value: &str) -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu
        .create_subkey(subkey)
        .map_err(|e| format!("cannot open/create {subkey}: {e}"))?;
    let owned = value.to_string();
    key.set_value(name, &owned)
        .map_err(|e| format!("cannot write {subkey}\\{name}: {e}"))
}

/// Delete a registry VALUE, succeeding when there is nothing to delete
/// (idempotent revert: turning a tweak OFF removes our token/value, and
/// "already absent" is the desired end state, not an error). A missing
/// KEY is likewise fine — but callers that must NOT create feature keys
/// a build never had (Storage Sense policy) keep their own refusal first.
/// NOTE: the handle opens with write access — deleting through a
/// read-only handle is os error 5, the same lesson as the SS write path.
fn delete_value(subkey: &str, name: &str) -> Result<(), String> {
    use std::io::ErrorKind::NotFound;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = match hkcu.open_subkey_with_flags(subkey, winreg::enums::KEY_SET_VALUE) {
        Ok(k) => k,
        Err(ref e) if e.kind() == NotFound => return Ok(()),
        Err(e) => return Err(format!("cannot open {subkey}: {e}")),
    };
    match key.delete_value(name) {
        Ok(()) => Ok(()),
        Err(ref e) if e.kind() == NotFound => Ok(()),
        Err(e) => Err(format!("cannot delete {subkey}\\{name}: {e}")),
    }
}

/// Live string read from an HKCU subkey. Ok(None) = key or value does not
/// exist. Other errors travel as Err (same strictness as read_dword: a
/// probe failure is never silently conflated with "value missing").
fn read_string(subkey: &str, name: &str) -> Result<Option<String>, String> {
    use std::io::ErrorKind::NotFound;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = match hkcu.open_subkey(subkey) {
        Ok(k) => k,
        Err(ref e) if e.kind() == NotFound => return Ok(None),
        Err(e) => return Err(format!("cannot open {subkey}: {e}")),
    };
    match key.get_value::<String, _>(name) {
        Ok(v) => Ok(Some(v)),
        Err(ref e) if e.kind() == NotFound => Ok(None),
        Err(e) => Err(format!("cannot read {subkey}\\{name}: {e}")),
    }
}

/// Set background recording to `value` (0 = off, 1 = on) and verify by
/// re-reading. Anything but 0/1 is refused before anything runs.
/// In-process winreg: milliseconds per flip.
pub fn set_dvr(value: u32) -> Result<TweakResult, String> {
    if value > 1 {
        return Err("dvr value must be 0 or 1".into());
    }
    let current = read_dword(DVR_SUBKEY, DVR_NAME)?;
    write_dword(DVR_SUBKEY, DVR_NAME, value)?;
    let verified = read_dword(DVR_SUBKEY, DVR_NAME)? == Some(value);
    super::logging::info(&format!(
        "tweak dvr set: from={} to={value} verified={verified}",
        current.map_or("missing".into(), |v| v.to_string())
    ));
    Ok(TweakResult {
        id: DVR_ID.into(),
        previous: current,
        value,
        verified,
    })
}

/// Set Storage Sense to `value` (1 = on, 0 = off) and verify by re-reading.
/// Writing is allowed whenever the policy KEY EXISTS — even at value 0
/// (off), because Windows itself represents "off" as 0, never as a deleted
/// key (verified live: Settings zeroes `01`, it never deletes the key).
/// Only a truly missing key (feature not on this build) refuses, and that
/// case hides the row in the UI anyway; the check stays as a race guard.
pub fn set_storage_sense(value: u32) -> Result<TweakResult, String> {
    if value > 1 {
        return Err("storagesense value must be 0 or 1".into());
    }
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    // availability = the KEY existing (a binary answer from the API, immune
    // to the silent-empty-output trap of the old spawn-based probe).
    // open_subkey is KEY_READ: enough for the availability gate and the
    // current-value read; the WRITE below opens its own handle with
    // write access (os error 5 "Access is denied" is what writing through
    // the read-only handle produced — verified live on Win11).
    let key = hkcu.open_subkey(SS_SUBKEY).map_err(|_| {
        // key truly missing: Storage Sense is not on this build — do not
        // create a policy key a Windows build never had
        super::logging::warn("tweak storagesense refused: policy key missing on this build");
        "Storage Sense is not available on this system".to_string()
    })?;
    let current: Option<u32> = match key.get_value(SS_NAME) {
        Ok(v) => Some(v),
        Err(ref e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(format!("cannot read {SS_SUBKEY}\\{SS_NAME}: {e}")),
    };
    // write handle: open with KEY_SET_VALUE (the KEY exists — create_subkey
    // would also work, but this is the precise least privilege for the job)
    let write_key = hkcu
        .open_subkey_with_flags(SS_SUBKEY, winreg::enums::KEY_SET_VALUE)
        .map_err(|e| format!("cannot open {SS_SUBKEY} for writing: {e}"))?;
    write_key
        .set_value(SS_NAME, &value)
        .map_err(|e| format!("storagesense write failed: {e}"))?;
    let verified = read_dword(SS_SUBKEY, SS_NAME)? == Some(value);
    super::logging::info(&format!(
        "tweak storagesense set: from={} to={value} verified={verified}",
        current.map_or("missing".into(), |v| v.to_string())
    ));
    Ok(TweakResult {
        id: SS_ID.into(),
        previous: current,
        value,
        verified,
    })
}

/// Set Game Mode to `value` (1 = on, 0 = off) on BOTH master toggles and
/// verify by re-reading. Anything but 0/1 is refused before anything runs.
pub fn set_game_mode(value: u32) -> Result<TweakResult, String> {
    if value > 1 {
        return Err("gamemode value must be 0 or 1".into());
    }
    let current = read_dword(GAMEBAR_SUBKEY, GAMEMODE_ALLOW)?;
    write_dword(GAMEBAR_SUBKEY, GAMEMODE_ALLOW, value)?;
    write_dword(GAMEBAR_SUBKEY, GAMEMODE_AUTO, value)?;
    let verified = read_dword(GAMEBAR_SUBKEY, GAMEMODE_ALLOW)? == Some(value)
        && read_dword(GAMEBAR_SUBKEY, GAMEMODE_AUTO)? == Some(value);
    super::logging::info(&format!(
        "tweak gamemode set: from={} to={value} verified={verified}",
        current.map_or("missing".into(), |v| v.to_string())
    ));
    Ok(TweakResult {
        id: GAMEMODE_ID.into(),
        previous: current,
        value,
        verified,
    })
}

/// Set the high-performance GPU preference to `value` (1 = prefer it on
/// every resolved GameLoop exe, 0 = remove our preference) and verify by
/// re-reading. Anything but 0/1 is refused before anything runs. Paths
/// are resolved fresh at write time (never cached from the read): an exe
/// installed between the read and the flip is covered, a removed one is
/// simply skipped by the resolver. Zero resolved exes refuses — writing
/// blind is worse than refusing loudly.
pub fn set_gpu_pref(value: u32) -> Result<TweakResult, String> {
    if value > 1 {
        return Err("gpupref value must be 0 or 1".into());
    }
    // same floor as the read side: pre-1803 builds ignore the preference
    // value while our re-read would still "verify" — a manufactured
    // success. The row hides there; a direct call is refused just as loudly.
    if !super::system::gpu_pref_supported(super::system::windows_build_number()) {
        super::logging::warn("tweak gpupref refused: unsupported Windows build");
        return Err("high-performance GPU preference needs Windows 10 1803 or later".into());
    }
    let on = value == 1;
    let paths = super::system::gameloop_exe_paths();
    if paths.is_empty() {
        super::logging::warn("tweak gpupref refused: no GameLoop executables resolved");
        return Err("GameLoop executables not found".into());
    }
    for p in &paths {
        let name = p.to_string_lossy().to_string();
        let raw = read_string(GPU_PREF_SUBKEY, &name)?;
        match super::system::with_gpu_pref(raw.as_deref(), on) {
            Some(next) => write_string(GPU_PREF_SUBKEY, &name, &next)?,
            None => delete_value(GPU_PREF_SUBKEY, &name)?,
        }
    }
    let mut verified = true;
    for p in &paths {
        let name = p.to_string_lossy().to_string();
        let pref = read_string(GPU_PREF_SUBKEY, &name)?
            .and_then(|raw| super::system::parse_gpu_pref(&raw));
        // on: every exe must read back high-performance; off: none may
        let ok = if on {
            pref == Some(GPU_PREF_HIGH)
        } else {
            pref != Some(GPU_PREF_HIGH)
        };
        verified &= ok;
    }
    super::logging::info(&format!(
        "tweak gpupref set: on={on} exes={} verified={verified}",
        paths.len()
    ));
    Ok(TweakResult {
        id: GPUPREF_ID.into(),
        previous: None, // aggregate write over several exes — no single "before"
        value,
        verified,
    })
}

/// Set fullscreen-optimizations opt-out to `value` (1 = disabled on every
/// resolved GameLoop exe, 0 = flag removed) and verify by re-reading.
/// Anything but 0/1 is refused before anything runs. Other compatibility
/// flags on the same values are preserved byte-for-byte in content; an
/// emptied value is deleted rather than left as a bare "~".
pub fn set_fso(value: u32) -> Result<TweakResult, String> {
    if value > 1 {
        return Err("fso value must be 0 or 1".into());
    }
    let on = value == 1;
    let paths = super::system::gameloop_exe_paths();
    if paths.is_empty() {
        super::logging::warn("tweak fso refused: no GameLoop executables resolved");
        return Err("GameLoop executables not found".into());
    }
    for p in &paths {
        let name = p.to_string_lossy().to_string();
        let raw = read_string(LAYERS_SUBKEY, &name)?;
        match super::system::fso_with_flag(raw.as_deref(), on) {
            Some(next) => write_string(LAYERS_SUBKEY, &name, &next)?,
            None => delete_value(LAYERS_SUBKEY, &name)?,
        }
    }
    let mut verified = true;
    for p in &paths {
        let name = p.to_string_lossy().to_string();
        let has = read_string(LAYERS_SUBKEY, &name)
            .map(|raw| super::system::fso_has_flag(raw.as_deref()))
            .unwrap_or(false);
        verified &= has == on;
    }
    super::logging::info(&format!(
        "tweak fso set: on={on} exes={} verified={verified}",
        paths.len()
    ));
    Ok(TweakResult {
        id: FSO_ID.into(),
        previous: None, // aggregate write over several exes — no single "before"
        value,
        verified,
    })
}

/// Set pointer precision to `value` (1 = off, i.e. 1:1 feel; 0 = Windows
/// defaults) and verify by re-reading. Anything but 0/1 is refused before
/// anything runs. OFF deletes the three values (absent = OS defaults),
/// never writes guesswork numbers.
pub fn set_mouse_accel(value: u32) -> Result<TweakResult, String> {
    if value > 1 {
        return Err("mouse value must be 0 or 1".into());
    }
    let on = value == 1;
    let current = read_dword(MOUSE_SUBKEY, MOUSE_SPEED).unwrap_or(None);
    if on {
        write_dword(MOUSE_SUBKEY, MOUSE_SPEED, 0)?;
        write_dword(MOUSE_SUBKEY, MOUSE_T1, 0)?;
        write_dword(MOUSE_SUBKEY, MOUSE_T2, 0)?;
    } else {
        delete_value(MOUSE_SUBKEY, MOUSE_SPEED)?;
        delete_value(MOUSE_SUBKEY, MOUSE_T1)?;
        delete_value(MOUSE_SUBKEY, MOUSE_T2)?;
    }
    let r = |name| read_dword(MOUSE_SUBKEY, name).unwrap_or(None);
    let verified =
        super::system::mouse_accel_off(r(MOUSE_SPEED), r(MOUSE_T1), r(MOUSE_T2)) == on;
    super::logging::info(&format!(
        "tweak mouse set: on={on} verified={verified}"
    ));
    Ok(TweakResult {
        id: MOUSE_ID.into(),
        previous: current,
        value,
        verified,
    })
}

/// Set windowed-games optimizations to `value` (1 = on, 0 = off) and
/// verify by re-reading. Anything but 0/1 is refused before anything
/// runs. Unlike the per-exe GPU preference (whose off DELETES the
/// token), off here WRITES `=0`: that is byte-for-byte what the Settings
/// toggle itself does (verified live on Win11 24H2), and deleting instead
/// would diverge from OS behavior for no reason. Win11+ only, enforced
/// here as well as in the read path (defense in depth against a
/// compromised/buggy frontend calling the command directly).
pub fn set_windowed_opt(value: u32) -> Result<TweakResult, String> {
    if value > 1 {
        return Err("windowedopt value must be 0 or 1".into());
    }
    if !super::system::windowed_opt_supported(super::system::windows_build_number()) {
        super::logging::warn("tweak windowedopt refused: unsupported Windows build");
        return Err("windowed game optimizations need Windows 11 or later".into());
    }
    let on = value == 1;
    let raw = read_string(GPU_PREF_SUBKEY, WGC_SETTINGS_NAME)
        .ok()
        .flatten();
    let current = raw
        .as_deref()
        .and_then(|r| super::system::parse_pref_token(r, WGC_TOKEN));
    let next = super::system::with_wgc_token(raw.as_deref(), on);
    write_string(GPU_PREF_SUBKEY, WGC_SETTINGS_NAME, &next)?;
    let verified = read_string(GPU_PREF_SUBKEY, WGC_SETTINGS_NAME)
        .ok()
        .flatten()
        .map(|raw| super::system::wgc_opt_on(Some(&raw)))
        .unwrap_or(false)
        == on;
    super::logging::info(&format!(
        "tweak windowedopt set: on={on} verified={verified}"
    ));
    Ok(TweakResult {
        id: WGC_ID.into(),
        previous: current,
        value,
        verified,
    })
}

/// Dispatch a set by id. Unknown ids (and out-of-range values) fail before
/// anything runs.
pub fn set_tweak(id: &str, value: u32) -> Result<TweakResult, String> {
    match id {
        DVR_ID => set_dvr(value),
        SS_ID => set_storage_sense(value),
        GAMEMODE_ID => set_game_mode(value),
        GPUPREF_ID => set_gpu_pref(value),
        FSO_ID => set_fso(value),
        MOUSE_ID => set_mouse_accel(value),
        WGC_ID => set_windowed_opt(value),
        _ => Err("unknown tweak".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // NOTE: read/write paths are REAL registry access (HKCU), so unit tests
    // do not touch them (CI registries stay clean); the write path is
    // verified live on a real machine. What IS unit-testable: the refusal
    // contract — validation must fire before any registry access.

    #[test]
    fn dvr_set_rejects_bad_values_without_side_effects() {
        // validation runs before any registry access: nothing touched
        assert!(set_tweak("dvr", 2).is_err());
        assert!(set_tweak("dvr", 99).is_err());
        assert!(set_tweak("storagesense", 2).is_err());
        assert!(set_tweak("gamemode", 2).is_err());
        assert!(set_tweak("gpupref", 7).is_err());
        assert!(set_tweak("fso", 3).is_err());
        assert!(set_tweak("mouse", 42).is_err());
        assert!(set_tweak("windowedopt", 2).is_err());
    }

    #[test]
    fn unknown_tweak_refused_without_side_effects() {
        assert!(set_tweak("nope", 0).is_err());
        assert!(set_tweak("", 1).is_err());
        assert!(set_tweak("DVR", 1).is_err()); // case-sensitive, no fuzzy match
        assert!(set_tweak("StorageSense", 0).is_err());
    }

    #[test]
    fn every_known_id_dispatches_to_its_own_validator() {
        // an out-of-range value must fail VALIDATION (proving the id
        // reached its own setter), never "unknown tweak" — that exact gap
        // once shipped a row whose every flip failed in the UI, and the
        // bad-value test above could not see it (both paths are Err).
        // No registry access happens: validation fires first, like above.
        for (id, want) in [
            ("dvr", "dvr value must be 0 or 1"),
            ("storagesense", "storagesense value must be 0 or 1"),
            ("gamemode", "gamemode value must be 0 or 1"),
            ("gpupref", "gpupref value must be 0 or 1"),
            ("fso", "fso value must be 0 or 1"),
            ("mouse", "mouse value must be 0 or 1"),
            ("windowedopt", "windowedopt value must be 0 or 1"),
        ] {
            assert_eq!(set_tweak(id, 2).unwrap_err(), want, "id {id} mis-dispatched");
        }
    }
}
