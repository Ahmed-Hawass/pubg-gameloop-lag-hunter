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

/// Dispatch a set by id. Unknown ids (and out-of-range values) fail before
/// anything runs.
pub fn set_tweak(id: &str, value: u32) -> Result<TweakResult, String> {
    match id {
        DVR_ID => set_dvr(value),
        SS_ID => set_storage_sense(value),
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
    }

    #[test]
    fn unknown_tweak_refused_without_side_effects() {
        assert!(set_tweak("nope", 0).is_err());
        assert!(set_tweak("", 1).is_err());
        assert!(set_tweak("DVR", 1).is_err()); // case-sensitive, no fuzzy match
        assert!(set_tweak("StorageSense", 0).is_err());
    }
}
