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
// Scope: HKCU writes run directly (no elevation). Ids that need admin go
// through the elevate module (same binary re-run elevated, one UAC prompt
// per flip, verified by the same re-read); a refused prompt is a quiet
// rollback, never a dialog. BIOS-level changes stay read-only checks
// with a deep link, never a button here.

use serde::Serialize;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
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
/// Power plan id: the FIRST elevated tweak. Reads stay unprivileged
/// (powercfg queries need none); writes go through the elevate module.
pub const POWERPLAN_ID: &str = "powerplan";
/// Page file editor id: ONE elevated write carrying the whole Virtual
/// Memory-style request (global automatic flag plus the selected drive's
/// mode and sizes). No per-mode ids: a mode is data, never a new command.
pub const PAGEFILE_SETTINGS_ID: &str = "pagefile-settings";
/// The dialog's own floor ("Minimum allowed: 16 MB" on real Windows —
/// ReactOS sources say 2 MB, the shipping dialog says 16; trust the ship).
pub const PAGEFILE_MIN_MB: u32 = 16;
/// Our stutter floor for page files (diagnosed on real 8GB machines):
/// below this a confirm dialog warns but still allows (user's call).
pub const PAGEFILE_WARN_FLOOR_MB: u32 = 8192;

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
/// NOTE: the two GameBar values are written sequentially (the registry
/// offers no transaction here): if the second write fails, the first
/// stays changed and the result reports verified=false. Callers must
/// treat verified=false as "state unknown, re-read", never as success.
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
/// NOTE: the three mouse values are written sequentially (no registry
/// transaction exists): a mid-way failure leaves a partial state and the
/// result reports verified=false for the caller to re-read.
pub fn set_mouse_accel(value: u32) -> Result<TweakResult, String> {
    if value > 1 {
        return Err("mouse value must be 0 or 1".into());
    }
    let on = value == 1;
    // a read error reads as missing (OS default), like the verify re-read
    // below: the write either verifies or reports verified=false.
    let current = read_dword(MOUSE_SUBKEY, MOUSE_SPEED).ok().flatten();
    if on {
        write_dword(MOUSE_SUBKEY, MOUSE_SPEED, 0)?;
        write_dword(MOUSE_SUBKEY, MOUSE_T1, 0)?;
        write_dword(MOUSE_SUBKEY, MOUSE_T2, 0)?;
    } else {
        delete_value(MOUSE_SUBKEY, MOUSE_SPEED)?;
        delete_value(MOUSE_SUBKEY, MOUSE_T1)?;
        delete_value(MOUSE_SUBKEY, MOUSE_T2)?;
    }
    let r = |name| read_dword(MOUSE_SUBKEY, name).ok().flatten();
    let verified = super::system::mouse_accel_off(r(MOUSE_SPEED), r(MOUSE_T1), r(MOUSE_T2)) == on;
    super::logging::info(&format!("tweak mouse set: on={on} verified={verified}"));
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

/// Dispatch a set by id. Elevated ids run through the elevate module
/// (same binary re-run elevated); everything else writes directly.
/// Unknown ids (and out-of-range values) fail before anything runs.
pub fn set_tweak(id: &str, value: u32) -> Result<TweakResult, String> {
    if super::elevate::is_elevated_id(id) {
        return set_tweak_elevated(id, value);
    }
    set_tweak_direct(id, value)
}

/// Elevated flip: previous-state read (unprivileged powercfg queries need
/// no elevation), UAC spawn, then the SAME verify-by-re-read. Cancellation
/// passes through verbatim for the UI's silent rollback.
///
/// Ownership rule: the PARENT stores the previous plan (settings.json is
/// the USER's file — an elevated child writing it would leave an
/// admin-owned file future unprivileged writes cannot touch). The child
/// touches power schemes only, never settings.
fn set_tweak_elevated(id: &str, value: u32) -> Result<TweakResult, String> {
    if value > 1 {
        return Err(format!("{id} value must be 0 or 1"));
    }
    if id == POWERPLAN_ID {
        return set_tweak_elevated_powerplan(value);
    }
    Err(format!("no elevated setter for {id}"))
}

fn set_tweak_elevated_powerplan(value: u32) -> Result<TweakResult, String> {
    let on = value == 1;
    let active = super::system::power_active_guid();
    let previous = if active.is_empty() {
        None
    } else {
        Some(active)
    };
    if on {
        // remember where OFF returns to (latest intent wins); skipped when
        // already on a performance plan — there is nothing to return to.
        // GUID-first check (names lie across locales); the previous plan
        // is whatever is active now, however the user got there.
        if let Some(ref prev) = previous {
            if !super::system::is_performance_plan("", prev) {
                let prev = prev.clone();
                let _ = super::settings::update(|s| {
                    s.previous_power_guid = Some(prev);
                });
            }
        }
    }
    let code = super::elevate::elevate_self(POWERPLAN_ID, value)?;
    super::elevate::map_exit_code(code)?;
    // verify by re-read, parent side: the child wrote, we confirm. ON
    // means ANY performance plan active (builtin, pre-existing custom, or
    // just created — creation mints fresh GUIDs, so exact matching would
    // lie); OFF means exactly the restore target we chose.
    let verified = if on {
        let (guid, name) = super::system::power_active_scheme();
        super::system::is_performance_plan(&name, &guid)
    } else {
        let stored = super::settings::load().previous_power_guid;
        let list = super::system::power_list_guids();
        super::system::power_active_guid() == power_restore_target(stored.as_deref(), &list)
    };
    if !on && verified {
        // The restore target is consumed by a successful OFF transition;
        // leaving it behind can make a later toggle restore an unrelated,
        // stale scheme.
        let _ = super::settings::update(|s| {
            s.previous_power_guid = None;
        });
    }
    super::logging::info(&format!("tweak powerplan set: on={on} verified={verified}"));
    // previous stays None: TweakResult.previous is a numeric leftover the
    // UI never reads; the real previous plan lives in settings and is
    // resolved at OFF time (it may change between flips).
    Ok(TweakResult {
        id: POWERPLAN_ID.into(),
        previous: None,
        value,
        verified,
    })
}

/// One powercfg call with fixed args (native exe, NO_WINDOW, no shell —
/// the same discipline as the panel opener; PowerShell never enters the
/// write path). Reads need no elevation; writes run elevated (child).
fn powercfg(args: &[&str]) -> Result<String, String> {
    // absolute System32 path (never a bare name): elevated runs must not
    // resolve through any caller-visible search order
    let out = std::process::Command::new(super::system::system32_exe("powercfg.exe"))
        .args(args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .creation_flags(0x0800_0000)
        .output()
        .map_err(|e| format!("powercfg spawn failed: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "powercfg {} exited {}",
            args.join(" "),
            out.status.code().unwrap_or(-1)
        ));
    }
    String::from_utf8(out.stdout).map_err(|_| "powercfg output not UTF-8".into())
}

/// Where OFF returns to: the stored previous plan when it is a real,
/// still-present scheme; otherwise Balanced (present on virtually every
/// machine). Pure: the whole fallback policy in one testable place.
fn power_restore_target(stored: Option<&str>, list: &[String]) -> String {
    match stored {
        Some(g) if !g.is_empty() && list.iter().any(|x| x == g) => g.to_string(),
        _ => super::system::POWER_GUID_BALANCED.to_string(),
    }
}

/// What ON needs: an existing performance plan's guid, or a fresh
/// creation. Pure decision (tested): duplicatescheme mints a NEW guid on
/// every run, so "builtin in list" can never be the presence check — a
/// custom duplicate would re-create forever (live-proven litter).
enum PowerEnableTarget {
    Existing(String),
    Create,
}

fn power_enable_target(list: &[(String, String)]) -> PowerEnableTarget {
    if let Some((g, _)) = list
        .iter()
        .find(|(g, _)| g == super::system::POWER_GUID_HIGH_PERFORMANCE)
    {
        return PowerEnableTarget::Existing(g.clone());
    }
    if let Some((g, _)) = list
        .iter()
        .find(|(g, n)| super::system::is_performance_plan(n, g))
    {
        // a custom High Performance (user or OEM duplicate): activate it,
        // create nothing — its settings are the user's own
        return PowerEnableTarget::Existing(g.clone());
    }
    PowerEnableTarget::Create
}

/// Set the power plan (runs ELEVATED: /setactive and /duplicatescheme
/// need admin). ON = High performance (the builtin when present, an
/// existing custom duplicate when one serves, a single creation only
/// when zero performance plans exist); OFF = the stored previous plan
/// via power_restore_target. Verified by re-reading the active scheme,
/// like every other setter here.
pub fn set_power_plan(value: u32) -> Result<TweakResult, String> {
    if value > 1 {
        return Err("powerplan value must be 0 or 1".into());
    }
    let on = value == 1;
    let target = if on {
        match power_enable_target(&super::system::power_list()) {
            PowerEnableTarget::Existing(g) => g,
            PowerEnableTarget::Create => {
                // the ONLY creation this module ever does, and only when
                // enabling with nothing to enable: parse the minted guid
                // from the command output (it is fresh every run) and
                // activate exactly it
                let created = powercfg(&[
                    "-duplicatescheme",
                    super::system::POWER_GUID_HIGH_PERFORMANCE,
                ])?;
                let guid = super::system::extract_power_guid(&created);
                if guid.is_empty() {
                    return Err("could not read the created plan".into());
                }
                super::logging::info(&format!("powerplan created: {guid}"));
                guid
            }
        }
    } else {
        // the child never touches settings (admin-owned file hazard):
        // the parent stored previous before spawning; here we only read.
        // Settings load is lock-free (committed files only).
        let stored = super::settings::load().previous_power_guid;
        let fresh = super::system::power_list_guids();
        power_restore_target(stored.as_deref(), &fresh)
    };
    powercfg(&["/setactive", &target])?;
    let verified = super::system::power_active_guid() == target;
    super::logging::info(&format!("tweak powerplan set: on={on} verified={verified}"));
    Ok(TweakResult {
        id: POWERPLAN_ID.into(),
        previous: None,
        value,
        verified,
    })
}

/// One apply request for the Virtual Memory-style editor: the global
/// automatic flag plus the selected drive's mode and sizes. Automatic on
/// ignores the drive fields (the dialog greys the list); automatic off
/// applies exactly the selected drive's mode and preserves every other
/// drive byte-for-byte. Sizes stay strings so the DWORD digit rules are
/// checked exactly, never through a lossy number parse.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PagefileRequestMode {
    System,
    Custom,
    Off,
}

/// A validated request both sides agree on (parent validates with fresh
/// reads before UAC, the child re-validates with its own fresh reads:
/// defense in depth, the child never trusts the parent).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ValidatedPagefileApply {
    pub automatic: bool,
    pub drive: [u8; 2],
    pub mode: PagefileRequestMode,
    pub min_mb: u32,
    pub max_mb: u32,
}

/// Canonical drive id: one ASCII letter plus a colon, uppercased
/// ("c:" and "C:" are the same drive; "C:\\", "C", "" are refused).
fn normalize_drive_id(raw: &str) -> Option<[u8; 2]> {
    let raw = raw.trim().to_uppercase();
    let bytes = raw.as_bytes();
    if bytes.len() == 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        Some([bytes[0], bytes[1]])
    } else {
        None
    }
}

fn drive_id_string(drive: [u8; 2]) -> String {
    String::from_utf8_lossy(&drive).into_owned()
}

fn parse_request_mode(raw: &str) -> Result<PagefileRequestMode, String> {
    match raw.trim() {
        "system" => Ok(PagefileRequestMode::System),
        "custom" => Ok(PagefileRequestMode::Custom),
        "off" => Ok(PagefileRequestMode::Off),
        _ => Err("PF_MODE_INVALID".into()),
    }
}

/// Validate custom sizes the dialog's own way: digits only (the UI
/// filters keystrokes; this is the second gate), at most 10 digits
/// (DWORD range), 16MB floor (the shipping dialog's "Minimum allowed",
/// verified live), maximum >= initial and within free space. Pure:
/// every refusal is a machine key (the UI translates), unit-tested.
/// Free space unknown (None) refuses blind (a write must never guess
/// a bound).
pub fn validate_pagefile_sizes(
    min_raw: &str,
    max_raw: &str,
    free_mb: Option<u64>,
) -> Result<(u32, u32), String> {
    let digits = |s: &str| !s.is_empty() && s.len() <= 10 && s.bytes().all(|b| b.is_ascii_digit());
    if !digits(min_raw) {
        return Err("PF_INITIAL_INVALID".into());
    }
    if !digits(max_raw) {
        return Err("PF_MAX_INVALID".into());
    }
    let free = free_mb.ok_or_else(|| "PF_NO_SPACE".to_string())?;
    let min_mb: u64 = min_raw.parse().unwrap_or(u64::MAX);
    let max_mb: u64 = max_raw.parse().unwrap_or(u64::MAX);
    if min_mb < PAGEFILE_MIN_MB as u64 || min_mb > free {
        return Err("PF_INITIAL_INVALID".into());
    }
    if max_mb < min_mb || max_mb > free {
        return Err("PF_MAX_INVALID".into());
    }
    Ok((min_mb as u32, max_mb as u32))
}

/// Validate a whole editor request against a live drive list and the
/// selected drive's fresh free space. Automatic on skips the drive
/// fields entirely (like the dialog's greyed list); anything else is
/// refused with a machine key before any elevation or write.
pub fn validate_pagefile_apply(
    automatic: bool,
    drive_raw: &str,
    mode_raw: &str,
    min_raw: &str,
    max_raw: &str,
    drives: &[String],
    free_mb: Option<u64>,
) -> Result<ValidatedPagefileApply, String> {
    if automatic {
        return Ok(ValidatedPagefileApply {
            automatic: true,
            drive: *b"C:",
            mode: PagefileRequestMode::System,
            min_mb: 0,
            max_mb: 0,
        });
    }
    let drive = normalize_drive_id(drive_raw).ok_or_else(|| "PF_DRIVE_INVALID".to_string())?;
    if !drives.iter().any(|d| d == &drive_id_string(drive)) {
        return Err("PF_DRIVE_INVALID".into());
    }
    let mode = parse_request_mode(mode_raw)?;
    let (min_mb, max_mb) = match mode {
        PagefileRequestMode::Custom => validate_pagefile_sizes(min_raw, max_raw, free_mb)?,
        _ => (0, 0),
    };
    Ok(ValidatedPagefileApply {
        automatic: false,
        drive,
        mode,
        min_mb,
        max_mb,
    })
}

/// Pre-write warning for the confirm step (pure): turning a drive's file
/// off risks out-of-memory crashes, and a maximum below our diagnosed
/// stutter floor gets a warn-but-allow. Anything else applies silently.
pub fn pagefile_warning(mode: PagefileRequestMode, max_mb: u32) -> Option<String> {
    match mode {
        PagefileRequestMode::Off => Some("off".into()),
        PagefileRequestMode::Custom if max_mb < PAGEFILE_WARN_FLOOR_MB => Some("small".into()),
        _ => None,
    }
}

/// Write the desired state (runs ELEVATED, child side): set the global
/// flag, then rewrite ONLY the selected drive's PagingFiles entry
/// (every other drive survives byte-for-byte, including the legacy `?:`
/// marker. Automatic on preserves the entries untouched (the flag takes
/// precedence; fully reversible). Full-value rewrite = delete+recreate
/// at the registry level, which sidesteps the silent in-place-shrink
/// failure Windows is known for. Any failure past validation is the one
/// write key: past this point the request was legitimate, only the
/// machine refused it.
fn write_pagefile_raw(valid: &ValidatedPagefileApply) -> Result<(), String> {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    let hklm = winreg::RegKey::predef(HKEY_LOCAL_MACHINE);
    // SET for the writes plus QUERY for the entries read below: a
    // SET-only handle fails the read with access-denied, which the
    // corruption guard would (correctly, but wrongly here) refuse.
    let key = hklm
        .open_subkey_with_flags(
            r"SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management",
            winreg::enums::KEY_SET_VALUE | winreg::enums::KEY_QUERY_VALUE,
        )
        .map_err(|_| "PF_WRITE_FAILED".to_string())?;
    let previous_auto: u32 = key
        .get_value("AutomaticManagedPagefile")
        .map_err(|_| "PF_WRITE_FAILED".to_string())?;
    if valid.automatic {
        key.set_value("AutomaticManagedPagefile", &(valid.automatic as u32))
            .map_err(|_| "PF_WRITE_FAILED".to_string())?;
        return Ok(());
    }
    let drive = drive_id_string(valid.drive);
    let current: Vec<String> = match key.get_value("PagingFiles") {
        Ok(entries) => entries,
        // missing value = no entries yet (honest empty, not corruption)
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        // present but unreadable (wrong type, ACL weirdness): refuse
        // rather than rebuild the list from nothing and orphan the real
        // files Windows manages
        Err(_) => return Err("PF_WRITE_FAILED".into()),
    };
    let entries = rebuild_pagefile_entries(current, &drive, valid.mode, valid.min_mb, valid.max_mb);
    key.set_value("AutomaticManagedPagefile", &(valid.automatic as u32))
        .map_err(|_| "PF_WRITE_FAILED".to_string())?;
    if key.set_value("PagingFiles", &entries).is_err() {
        let _ = key.set_value("AutomaticManagedPagefile", &previous_auto);
        return Err("PF_WRITE_FAILED".into());
    }
    Ok(())
}

/// Pure list rebuild shared by the writer (and its tests): drop the
/// selected drive's old entries, drop empty lines, preserve everything
/// else byte-for-byte (other drives, the legacy `?:` marker), then add
/// the selected drive's new line — unless off, which just drops.
/// The empty-line drop is the healer: Windows reads "" as the list
/// terminator and stops, so a stale empty amputates every entry after
/// it (a poisoned list reads as off and boots a temporary file); every
/// rewrite cleans it.
fn rebuild_pagefile_entries(
    current: Vec<String>,
    drive: &str,
    mode: PagefileRequestMode,
    min_mb: u32,
    max_mb: u32,
) -> Vec<String> {
    let prefix = format!("{drive}\\").to_uppercase();
    let mut entries: Vec<String> = current
        .into_iter()
        .filter(|e| {
            let first = e.split_whitespace().next();
            match first {
                None => false,
                Some(path) => !path.to_uppercase().starts_with(&prefix),
            }
        })
        .collect();
    match mode {
        // 0 0 is the documented system-managed shape (InitialSize =
        // MaximumSize = 0), explicit where a bare path could misread
        PagefileRequestMode::System => {
            entries.push(format!("{drive}\\pagefile.sys 0 0"));
        }
        PagefileRequestMode::Custom => {
            entries.push(format!("{drive}\\pagefile.sys {min_mb} {max_mb}"));
        }
        // off drops the drive's entry; an empty list with the flag off
        // is Windows' own no-paging-file state
        PagefileRequestMode::Off => {}
    }
    entries
}

/// True when the desired state holds: the shared verifier for the
/// idempotency skip and the post-write check, so the two can never
/// disagree about what "done" looks like. Unreadable mid-write reads as
/// not-done, never as done.
fn pagefile_matches(valid: &ValidatedPagefileApply) -> bool {
    let Some((automatic, entries)) = super::system::read_pagefile_flag_and_entries() else {
        return false;
    };
    if automatic != valid.automatic {
        return false;
    }
    if valid.automatic {
        return true;
    }
    let (mode, min_mb, max_mb) =
        super::system::parse_drive_mode(&entries, &drive_id_string(valid.drive));
    match valid.mode {
        PagefileRequestMode::System => mode == super::system::PagefileMode::System,
        PagefileRequestMode::Off => mode == super::system::PagefileMode::Off,
        PagefileRequestMode::Custom => {
            mode == super::system::PagefileMode::Custom
                && min_mb == Some(valid.min_mb)
                && max_mb == Some(valid.max_mb)
        }
    }
}

/// Child side of the editor write (runs ELEVATED): re-read the drive
/// list and the selected drive's free space, re-validate the raw request
/// from scratch (defense in depth: the child never trusts the parent),
/// write, verify by re-read. The child never touches settings.json (an
/// admin-owned settings file would lock out future unprivileged
/// writes); pending is marked parent-side.
pub fn set_pagefile_settings(
    automatic: bool,
    drive_raw: &str,
    mode_raw: &str,
    min_raw: &str,
    max_raw: &str,
) -> Result<TweakResult, String> {
    let drives = super::system::fixed_drives();
    if drives.is_empty() {
        return Err("PF_READ_FAILED".into());
    }
    let normalized = normalize_drive_id(drive_raw).ok_or_else(|| "PF_DRIVE_INVALID".to_string())?;
    let free = if automatic {
        None
    } else {
        super::system::drive_free_mb_for(&drive_id_string(normalized))
    };
    let valid = validate_pagefile_apply(
        automatic, drive_raw, mode_raw, min_raw, max_raw, &drives, free,
    )?;
    write_pagefile_raw(&valid)?;
    let verified = pagefile_matches(&valid);
    super::logging::info(&format!(
        "pagefile settings set: automatic={automatic} drive={} verified={verified}",
        drive_id_string(valid.drive)
    ));
    Ok(TweakResult {
        id: PAGEFILE_SETTINGS_ID.into(),
        previous: None,
        value: automatic as u32,
        verified,
    })
}

/// Validate-only entry for the confirm step: the same validation as the
/// write path (keys, never sentences), plus the pre-write warning.
/// Automatic needs no warning: handing sizing back to Windows is the
/// safe, reversible direction.
pub fn validate_pagefile_settings(
    automatic: bool,
    drive_raw: &str,
    mode_raw: &str,
    min_raw: &str,
    max_raw: &str,
) -> Result<Option<String>, String> {
    if automatic {
        return Ok(None);
    }
    let drives = super::system::fixed_drives();
    if drives.is_empty() {
        return Err("PF_READ_FAILED".into());
    }
    let normalized = normalize_drive_id(drive_raw).ok_or_else(|| "PF_DRIVE_INVALID".to_string())?;
    let free = super::system::drive_free_mb_for(&drive_id_string(normalized));
    let valid =
        validate_pagefile_apply(false, drive_raw, mode_raw, min_raw, max_raw, &drives, free)?;
    Ok(pagefile_warning(valid.mode, valid.max_mb))
}

/// Parent side: validate with fresh unprivileged reads, skip the UAC
/// round-trip when the desired state already holds, else elevate (one
/// prompt), mark pending, verify by re-read. Cancellation passes through
/// verbatim for the UI's silent rollback; any other elevation failure is
/// the one write key.
pub fn set_pagefile_settings_parent(
    automatic: bool,
    drive_raw: &str,
    mode_raw: &str,
    min_raw: &str,
    max_raw: &str,
) -> Result<TweakResult, String> {
    let drives = super::system::fixed_drives();
    if drives.is_empty() {
        return Err("PF_READ_FAILED".into());
    }
    let normalized = normalize_drive_id(drive_raw).ok_or_else(|| "PF_DRIVE_INVALID".to_string())?;
    let free = if automatic {
        None
    } else {
        super::system::drive_free_mb_for(&drive_id_string(normalized))
    };
    let valid = validate_pagefile_apply(
        automatic, drive_raw, mode_raw, min_raw, max_raw, &drives, free,
    )?;
    if pagefile_matches(&valid) {
        return Ok(TweakResult {
            id: PAGEFILE_SETTINGS_ID.into(),
            previous: None,
            value: automatic as u32,
            verified: true,
        });
    }
    let mode_raw = match valid.mode {
        PagefileRequestMode::System => "system",
        PagefileRequestMode::Custom => "custom",
        PagefileRequestMode::Off => "off",
    };
    let code = super::elevate::elevate_pagefile_settings(
        valid.automatic,
        &drive_id_string(valid.drive),
        mode_raw,
        valid.min_mb,
        valid.max_mb,
    )?;
    if code != 0 {
        return Err("PF_WRITE_FAILED".into());
    }
    let verified = pagefile_matches(&valid);
    // the pending-reboot badge is for a VERIFIED write only: marking it
    // before the re-read showed a reboot prompt for a write that never
    // landed on the rare verify-after-exit-0 race.
    if verified {
        mark_pending_restart();
    }
    super::logging::info(&format!(
        "pagefile settings set: automatic={automatic} drive={} verified={verified}",
        drive_id_string(valid.drive)
    ));
    Ok(TweakResult {
        id: PAGEFILE_SETTINGS_ID.into(),
        previous: None,
        value: automatic as u32,
        verified,
    })
}

/// Record a pending reboot (parent side, after a verified page file
/// write): which tweak plus the uptime clock. Self-clearing on reboot.
fn mark_pending_restart() {
    let _ = super::settings::update(|s| {
        s.pending_restart = Some(super::settings::PendingRestart {
            tweak: PAGEFILE_SETTINGS_ID.into(),
            at_uptime_ms: super::system::boot_uptime_ms(),
        });
    });
}

pub fn set_tweak_direct(id: &str, value: u32) -> Result<TweakResult, String> {
    match id {
        DVR_ID => set_dvr(value),
        SS_ID => set_storage_sense(value),
        GAMEMODE_ID => set_game_mode(value),
        GPUPREF_ID => set_gpu_pref(value),
        FSO_ID => set_fso(value),
        MOUSE_ID => set_mouse_accel(value),
        WGC_ID => set_windowed_opt(value),
        POWERPLAN_ID => set_power_plan(value),
        _ => Err("unknown tweak".into()),
    }
}

/// True for every id the dispatch above knows. The elevated runner gates
/// on this (not on a second list) so the two can never disagree about
/// what exists: an id the engine cannot set is refused before UAC, and
/// elevation adds privilege, never new ids.
pub fn is_known_id(id: &str) -> bool {
    matches!(
        id,
        DVR_ID | SS_ID | GAMEMODE_ID | GPUPREF_ID | FSO_ID | MOUSE_ID | WGC_ID | POWERPLAN_ID
    )
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
        // elevated ids refuse BEFORE any UAC spawn (no prompt in tests)
        assert!(set_tweak("powerplan", 2).is_err());
    }

    #[test]
    fn unknown_tweak_refused_without_side_effects() {
        assert!(set_tweak("nope", 0).is_err());
        assert!(set_tweak("", 1).is_err());
        assert!(set_tweak("DVR", 1).is_err()); // case-sensitive, no fuzzy match
        assert!(set_tweak("StorageSense", 0).is_err());
        // the page file editor left the 0/1 dispatch: its old ids are
        // unknown now (its request rides its own elevated command)
        assert!(set_tweak("pagefile", 1).is_err());
        assert!(set_tweak("pagefile-custom", 1).is_err());
        assert!(set_tweak("pagefile-off", 0).is_err());
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
            ("powerplan", "powerplan value must be 0 or 1"),
        ] {
            assert_eq!(
                set_tweak(id, 2).unwrap_err(),
                want,
                "id {id} mis-dispatched"
            );
        }
    }

    #[test]
    fn power_restore_target_prefers_a_live_previous() {
        let list = vec![
            "381b4222-f694-41f0-9685-ff5bb260df2e".to_string(),
            "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c".to_string(),
        ];
        // stored + present = back to exactly it (even Power saver)
        assert_eq!(
            power_restore_target(Some("381b4222-f694-41f0-9685-ff5bb260df2e"), &list),
            "381b4222-f694-41f0-9685-ff5bb260df2e"
        );
        // stored but vanished, never-stored, and garbage all fall back
        // to Balanced (present on virtually every machine)
        assert_eq!(
            power_restore_target(Some("aaaaaaaa-0000-0000-0000-000000000000"), &list),
            super::super::system::POWER_GUID_BALANCED
        );
        assert_eq!(
            power_restore_target(None, &list),
            super::super::system::POWER_GUID_BALANCED
        );
        assert_eq!(
            power_restore_target(Some("garbage"), &list),
            super::super::system::POWER_GUID_BALANCED
        );
        assert_eq!(
            power_restore_target(Some(""), &list),
            super::super::system::POWER_GUID_BALANCED
        );
    }

    #[test]
    fn power_enable_target_never_duplicates_twice() {
        // the litter bug: duplicatescheme mints a FRESH guid every run, so
        // "builtin in list" as presence check re-created forever. Presence
        // is any performance-class plan; creation happens only at zero.
        let pair = |g: &str, n: &str| (g.to_string(), n.to_string());
        let builtin = super::super::system::POWER_GUID_HIGH_PERFORMANCE;
        let balanced = super::super::system::POWER_GUID_BALANCED;
        // builtin present: use it (no creation)
        let list = vec![
            pair(balanced, "Balanced"),
            pair(builtin, "High performance"),
        ];
        assert!(matches!(
            power_enable_target(&list),
            PowerEnableTarget::Existing(g) if g == builtin
        ));
        // custom duplicate only (the dev-box shape): use IT, create nothing
        let list = vec![
            pair(balanced, "Balanced"),
            pair("e72c17b6-94d2-4509-adfc-8f2302229d1a", "High performance"),
        ];
        assert!(matches!(
            power_enable_target(&list),
            PowerEnableTarget::Existing(g) if g == "e72c17b6-94d2-4509-adfc-8f2302229d1a"
        ));
        // zero performance plans: the single allowed creation
        let list = vec![pair(balanced, "Balanced")];
        assert!(matches!(
            power_enable_target(&list),
            PowerEnableTarget::Create
        ));
        assert!(matches!(
            power_enable_target(&[]),
            PowerEnableTarget::Create
        ));
    }

    #[test]
    fn pagefile_sizes_validate_like_the_dialog_with_keys() {
        // the dialog's own rules: digits only at the keystroke, 10-digit
        // DWORD cap, 16MB floor (the shipping dialog's "Minimum allowed",
        // verified live), max >= min and within free space. Free = 350000MB
        // fixture below (a real drive reading shape). Every refusal is a
        // machine key (the UI translates), never a sentence.
        let free = Some(350000u64);
        assert_eq!(
            validate_pagefile_sizes("1024", "4096", free),
            Ok((1024, 4096))
        );
        assert_eq!(validate_pagefile_sizes("16", "16", free), Ok((16, 16)));
        // 10 digits overflowing u32: refused as out-of-range, never wrapped
        assert_eq!(
            validate_pagefile_sizes("42949672960", "42949672960", free).unwrap_err(),
            "PF_INITIAL_INVALID"
        );
        // non-digits (the UI filters these, this is the second gate)
        assert_eq!(
            validate_pagefile_sizes("1a", "4096", free).unwrap_err(),
            "PF_INITIAL_INVALID"
        );
        assert_eq!(
            validate_pagefile_sizes("", "4096", free).unwrap_err(),
            "PF_INITIAL_INVALID"
        );
        assert_eq!(
            validate_pagefile_sizes("1024", "", free).unwrap_err(),
            "PF_MAX_INVALID"
        );
        assert_eq!(
            validate_pagefile_sizes(" 1024", "4096", free).unwrap_err(),
            "PF_INITIAL_INVALID"
        );
        assert_eq!(
            validate_pagefile_sizes("10.5", "4096", free).unwrap_err(),
            "PF_INITIAL_INVALID"
        );
        assert_eq!(
            validate_pagefile_sizes("-5", "4096", free).unwrap_err(),
            "PF_INITIAL_INVALID"
        );
        // below the 16MB floor (1 and 15 both refuse; 16 passes)
        assert_eq!(
            validate_pagefile_sizes("1", "4096", free).unwrap_err(),
            "PF_INITIAL_INVALID"
        );
        assert_eq!(
            validate_pagefile_sizes("15", "4096", free).unwrap_err(),
            "PF_INITIAL_INVALID"
        );
        assert_eq!(
            validate_pagefile_sizes("0", "0", free).unwrap_err(),
            "PF_INITIAL_INVALID"
        );
        // max below min
        assert_eq!(
            validate_pagefile_sizes("4096", "1024", free).unwrap_err(),
            "PF_MAX_INVALID"
        );
        // beyond free space on either side
        assert_eq!(
            validate_pagefile_sizes("400000", "400000", free).unwrap_err(),
            "PF_INITIAL_INVALID"
        );
        assert_eq!(
            validate_pagefile_sizes("1024", "400000", free).unwrap_err(),
            "PF_MAX_INVALID"
        );
        // unknown free space refuses blind (a bound must never be guessed)
        assert_eq!(
            validate_pagefile_sizes("1024", "4096", None).unwrap_err(),
            "PF_NO_SPACE"
        );
    }

    #[test]
    fn pagefile_apply_validates_drive_and_mode_first() {
        let drives = vec!["C:".to_string(), "D:".to_string()];
        let free = Some(350000u64);
        // automatic ignores the drive fields entirely (greyed list)
        let v = validate_pagefile_apply(true, "???", "bogus", "", "", &drives, None).unwrap();
        assert!(v.automatic);
        // drive ids are canonical: letter + colon, member of the live list
        // (surrounding whitespace trims; the id itself must be exact)
        for bad in ["", "C", "C:\\", "CC:", "1:", "E:"] {
            assert_eq!(
                validate_pagefile_apply(false, bad, "system", "0", "0", &drives, free).unwrap_err(),
                "PF_DRIVE_INVALID",
                "drive {bad:?} must refuse"
            );
        }
        // lowercase is the same drive, not a refusal
        let v = validate_pagefile_apply(false, "c:", "system", "0", "0", &drives, free).unwrap();
        assert!(!v.automatic);
        assert_eq!(v.drive, [b'C', b':']);
        assert_eq!(v.mode, PagefileRequestMode::System);
        // the mode word is closed: only the dialog's three options
        assert_eq!(
            validate_pagefile_apply(false, "C:", "auto", "0", "0", &drives, free).unwrap_err(),
            "PF_MODE_INVALID"
        );
        assert_eq!(
            validate_pagefile_apply(false, "C:", "System", "0", "0", &drives, free).unwrap_err(),
            "PF_MODE_INVALID"
        );
        // system and off carry no sizes (garbage sizes never reach a write)
        let v = validate_pagefile_apply(false, "D:", "off", "zzz", "", &drives, free).unwrap();
        assert_eq!(v.mode, PagefileRequestMode::Off);
        assert_eq!((v.min_mb, v.max_mb), (0, 0));
        // custom validates sizes against the SELECTED drive's free space
        let v =
            validate_pagefile_apply(false, "D:", "custom", "1024", "4096", &drives, free).unwrap();
        assert_eq!((v.min_mb, v.max_mb), (1024, 4096));
        assert_eq!(
            validate_pagefile_apply(false, "D:", "custom", "1024", "4096", &drives, None)
                .unwrap_err(),
            "PF_NO_SPACE"
        );
    }

    #[test]
    fn pagefile_rebuild_heals_and_preserves() {
        use super::PagefileRequestMode;
        // the poisoned list from the live incident: a stale empty first
        // (Windows stops there), then the intended entry — a rewrite
        // drops the empty and keeps the intent, healing the list
        let healed = rebuild_pagefile_entries(
            vec!["".into(), "C:\\pagefile.sys 16384 49152".into()],
            "C:",
            PagefileRequestMode::Custom,
            16384,
            49152,
        );
        assert_eq!(healed, vec!["C:\\pagefile.sys 16384 49152".to_string()]);
        // selected drive replaced, other drives and the legacy marker
        // preserved byte-for-byte, whitespace-only lines dropped too
        let rebuilt = rebuild_pagefile_entries(
            vec![
                "C:\\pagefile.sys 1 2".into(),
                "D:\\pagefile.sys 512 1024".into(),
                r"?:\pagefile.sys".into(),
                "   ".into(),
            ],
            "C:",
            PagefileRequestMode::System,
            0,
            0,
        );
        assert_eq!(
            rebuilt,
            vec![
                "D:\\pagefile.sys 512 1024".to_string(),
                r"?:\pagefile.sys".to_string(),
                "C:\\pagefile.sys 0 0".to_string(),
            ]
        );
        // off only drops, never adds
        let offed = rebuild_pagefile_entries(
            vec!["C:\\pagefile.sys 1 2".into()],
            "C:",
            PagefileRequestMode::Off,
            0,
            0,
        );
        assert!(offed.is_empty());
        // drive matching is letter-scoped: C: never eats D:
        let scoped = rebuild_pagefile_entries(
            vec!["D:\\pagefile.sys 1 2".into()],
            "C:",
            PagefileRequestMode::Off,
            0,
            0,
        );
        assert_eq!(scoped, vec!["D:\\pagefile.sys 1 2".to_string()]);
    }

    #[test]
    fn pagefile_warnings_fire_before_the_write() {
        // off always warns (crash risk is real); small warns but allows
        assert_eq!(
            pagefile_warning(PagefileRequestMode::Off, 0),
            Some("off".into())
        );
        assert_eq!(
            pagefile_warning(PagefileRequestMode::Custom, 4096),
            Some("small".into())
        );
        assert_eq!(pagefile_warning(PagefileRequestMode::Custom, 8192), None);
        assert_eq!(pagefile_warning(PagefileRequestMode::Custom, 16384), None);
        assert_eq!(pagefile_warning(PagefileRequestMode::System, 0), None);
    }

    #[test]
    fn pagefile_pending_visibility() {
        // same boot (clock past the write): pending shows
        assert!(super::super::system::restart_pending_visible(1000, 5000));
        assert!(super::super::system::restart_pending_visible(1000, 1000));
        // reboot zeroes the clock: clears itself with zero writes
        assert!(!super::super::system::restart_pending_visible(5000, 1000));
    }
}
