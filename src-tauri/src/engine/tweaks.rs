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
// Scope deliberately narrow: HKCU (current user) DWORDs only — no elevation,
// no reboot, no service or policy writes. Anything needing admin or BIOS
// stays a read-only check with a deep link, never a button here.
//
// Spawn budget: every PowerShell process costs seconds on real machines and
// this path runs on every click, so each flip is TWO spawns maximum — a
// combined probe (availability + current value) then a combined
// write-then-verify that prints what the registry actually holds now.

use serde::Serialize;

/// Registry home of the background-recording toggle ("Record what
/// happened"): HKCU needs no elevation, takes effect immediately.
const DVR_PATH: &str = r"HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\GameDVR";
const DVR_NAME: &str = "HistoricalCaptureEnabled";

/// Registry home of the Storage Sense on/off toggle ("01" under the
/// StoragePolicy key, the documented value behind the Settings switch).
/// Present on Windows 10 (1709+) and 11; verified live on a real machine.
const SS_PATH: &str =
    r"HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\StorageSense\Parameters\StoragePolicy";
const SS_NAME: &str = "01";

/// The tweak ids this module knows. Unknown ids are refused before any
/// process spawns (same whitelist discipline as open_windows_panel).
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

/// Raw toggle text: "1"/"0", or "" when the value does not exist.
fn read_dvr_raw() -> Result<String, String> {
    super::system::ps(&format!(
        "(Get-ItemProperty -Path \"{DVR_PATH}\" -Name \"{DVR_NAME}\" -ErrorAction SilentlyContinue).{DVR_NAME}"
    ))
    .map(|t| t.trim().to_string())
}

/// Parse a raw on/off toggle read ("1"/"0"/""). Generic for every DWORD
/// toggle in this module — DVR and Storage Sense read the same shape.
/// Pure (unit-tested); the live write path is verified by hand on a real
/// machine instead of mutating CI registries.
fn parse_toggle_raw(raw: &str) -> Option<u32> {
    raw.trim().parse().ok()
}

/// Set background recording to `value` (0 = off, 1 = on) and verify by
/// re-reading. Anything but 0/1 is refused before anything runs.
/// TWO spawns total per flip: the initial read, then a combined
/// write-then-verify script that prints what the registry ACTUALLY holds
/// now — the printed line is the verification.
pub fn set_dvr(value: u32) -> Result<TweakResult, String> {
    if value > 1 {
        return Err("dvr value must be 0 or 1".into());
    }
    let current = parse_toggle_raw(&read_dvr_raw()?);
    let fresh = super::system::ps(&format!(
        "New-ItemProperty -Path \"{DVR_PATH}\" -Name \"{DVR_NAME}\" -Value {value} -PropertyType DWORD -Force | Out-Null; \
         (Get-ItemProperty -Path \"{DVR_PATH}\" -Name \"{DVR_NAME}\" -ErrorAction SilentlyContinue).{DVR_NAME}"
    ))
    .map_err(|e| format!("dvr write failed: {e}"))?;
    let verified = fresh.trim() == value.to_string();
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

/// Parse the combined Storage Sense probe line ("exists|<value>" or
/// "missing|"). Pure (unit-tested): availability and the live value travel
/// together in one spawn — the numeric property name MUST stay quoted
/// (`.'01'`): bare `.01` parses as a float and reads empty forever (the
/// from=missing/verified=false bug was exactly this).
fn parse_ss_probe(probe: &str) -> (bool, &str) {
    match probe.trim().split_once('|') {
        Some(("exists", v)) => (true, v),
        // unknown shape = probe failure: treat as unavailable, refuse the
        // write, never guess
        _ => (false, ""),
    }
}

/// Set Storage Sense to `value` (1 = on, 0 = off) and verify by re-reading.
/// Writing is allowed whenever the policy key EXISTS — even at value 0
/// (off), because Windows itself represents "off" as 0, never as a deleted
/// key (verified live: Settings zeroes `01`, it never deletes the key).
/// Only a truly missing key (feature not on this build) refuses, and that
/// case hides the row in the UI anyway; the check stays as a race guard.
/// TWO spawns total per flip (combined probe, then combined write+verify),
/// down from four.
pub fn set_storage_sense(value: u32) -> Result<TweakResult, String> {
    if value > 1 {
        return Err("storagesense value must be 0 or 1".into());
    }
    // combined probe in ONE spawn: Test-Path (a real binary answer, immune
    // to the silent-empty-output trap) + the live value when the key exists
    let probe = super::system::ps(&format!(
        "$k = Test-Path \"{SS_PATH}\"; \
         if ($k) {{ $v = (Get-ItemProperty -Path \"{SS_PATH}\" -Name \"{SS_NAME}\" -ErrorAction SilentlyContinue).'{SS_NAME}'; \"exists|$v\" }} \
         else {{ \"missing|\" }}"
    ))
    .map_err(|e| format!("storagesense probe failed: {e}"))?;
    let (available, raw) = parse_ss_probe(&probe);
    if !available {
        // key truly missing: Storage Sense is not on this build — do not
        // create a policy key a Windows build never had
        super::logging::warn("tweak storagesense refused: policy key missing on this build");
        return Err("Storage Sense is not available on this system".into());
    }
    let current = parse_toggle_raw(raw);
    // combined write + verify: writes, then prints what the registry holds
    let fresh = super::system::ps(&format!(
        "Set-ItemProperty -Path \"{SS_PATH}\" -Name \"{SS_NAME}\" -Value {value} -Type DWord; \
         (Get-ItemProperty -Path \"{SS_PATH}\" -Name \"{SS_NAME}\" -ErrorAction SilentlyContinue).'{SS_NAME}'"
    ))
    .map_err(|e| format!("storagesense write failed: {e}"))?;
    let verified = fresh.trim() == value.to_string();
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

    #[test]
    fn toggle_raw_parsed() {
        assert_eq!(parse_toggle_raw("1"), Some(1));
        assert_eq!(parse_toggle_raw("0"), Some(0));
        assert_eq!(parse_toggle_raw(" 1 "), Some(1));
        assert_eq!(parse_toggle_raw(""), None);
        assert_eq!(parse_toggle_raw("missing"), None);
    }

    #[test]
    fn ss_probe_parsed() {
        // the combined probe's line contract
        assert_eq!(parse_ss_probe("exists|1"), (true, "1"));
        assert_eq!(parse_ss_probe("exists|0"), (true, "0"));
        assert_eq!(parse_ss_probe("exists|"), (true, "")); // key exists, unreadable value
        assert_eq!(parse_ss_probe("missing|"), (false, ""));
        // unknown shape = probe failure = refuse, never guess
        assert_eq!(parse_ss_probe(""), (false, ""));
        assert_eq!(parse_ss_probe("garbage"), (false, ""));
        assert_eq!(parse_ss_probe("exists"), (false, "")); // no separator
    }

    #[test]
    fn dvr_set_rejects_bad_values_without_side_effects() {
        // validation runs before any read or write: no registry touched
        assert!(set_tweak("dvr", 2).is_err());
        assert!(set_tweak("dvr", 99).is_err());
        assert!(set_tweak("storagesense", 2).is_err());
    }

    #[test]
    fn unknown_tweak_refused_without_side_effects() {
        assert!(set_tweak("nope", 0).is_err());
        assert!(set_tweak("", 1).is_err());
        assert!(set_tweak("DVR", 1).is_err()); // case-sensitive, no fuzzy match
    }
}
