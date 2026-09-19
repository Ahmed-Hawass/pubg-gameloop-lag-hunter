// system.rs — one-shot, read-only system queries: rig info, top processes,
// environment checks. Nothing here ever modifies the user's machine.

use std::fs;
use std::process::{Command, Stdio};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const NO_WINDOW: u32 = 0x0800_0000;

/// PowerShell runner shared with the tweaks writer (crate-visible so the
/// write path reuses the exact same spawn flags, never its own variant).
pub(crate) fn ps(script: &str) -> Result<String, String> {
    #[cfg(windows)]
    let out = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(NO_WINDOW)
        .output()
        .map_err(|e| format!("powershell spawn failed: {e}"))?;
    #[cfg(not(windows))]
    let out = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .map_err(|e| format!("powershell spawn failed: {e}"))?;
    if !out.status.success() {
        return Err("powershell exited nonzero".into());
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

// ---------------------------------------------------------------------------
// PowerShell availability — the one-shot startup probe.
// Sessions still work without it (typeperf/tasklist/nvidia-smi are native),
// but the PS-backed paths degrade: machine-adaptive thresholds fall back to
// defaults, timestamp correction reverts to UTC, the window-visibility probe
// stays None (GPU rules muted). The UI tells the user instead of staying
// silent about it.
// ---------------------------------------------------------------------------

/// Is PowerShell usable on this machine? Probed ONCE per app run.
/// Conservative: a missing binary, a policy block, or a hang past the
/// deadline all read as unavailable — the banner can appear on a false
/// negative, never stay hidden on a false positive.
pub fn powershell_available() -> bool {
    static AVAILABLE: OnceLock<bool> = OnceLock::new();
    *AVAILABLE.get_or_init(|| {
        let ok = probe_powershell();
        if !ok {
            // one log line for user reports: everything downstream degrades
            // silently by design — this is the only trace of why
            super::logging::info("PowerShell unavailable — limited mode: \
                adaptive thresholds default, timestamps may read UTC, \
                GPU window checks muted");
        }
        ok
    })
}

fn probe_powershell() -> bool {
    #[cfg(windows)]
    {
        use std::io::Read;
        use std::os::windows::process::CommandExt;
        let Ok(mut child) = Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", "Write-Output ok"])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .creation_flags(NO_WINDOW)
            .spawn()
        else {
            return false;
        };
        // bounded wait: a blocked PS must never hang the app startup
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        loop {
            match child.try_wait() {
                Ok(Some(status)) => {
                    if !status.success() {
                        return false;
                    }
                    let mut out = String::new();
                    if let Some(mut s) = child.stdout.take() {
                        let _ = s.read_to_string(&mut out);
                    }
                    return out.trim().eq_ignore_ascii_case("ok");
                }
                Ok(None) => {
                    if std::time::Instant::now() >= deadline {
                        let _ = child.kill();
                        return false;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(100));
                }
                Err(_) => return false,
            }
        }
    }
    #[cfg(not(windows))]
    false
}

// ---------------------------------------------------------------------------
// System info — the "Your rig" tab. Hardware identity doesn't change between
// launches: queried at most once per MACHINE, cached on DISK, instant boots.
//
// The bug this layout fixes: `Get-PhysicalDisk` performs a live hardware
// inventory (SMART probes over every spindle) — 20+ seconds on machines with
// an HDD, EVERY launch. The rig doesn't change between runs, so after the
// first successful query the result is persisted under the app dir and all
// later launches read it in microseconds. The in-memory OnceLock then guards
// within the run itself.
//
// async callers only (see lib.rs): the first-ever query still takes its
// hardware-inventory time — off the UI thread, never freezing the window.
// ---------------------------------------------------------------------------

use std::sync::{Mutex, OnceLock};

static SYSTEM_CACHE: OnceLock<SystemInfo> = OnceLock::new();
/// one query in flight at a time — a second caller waits for the first
/// result instead of racing a second 20s inventory. Held INSIDE the
/// blocking task (see system_info_async): the std Mutex guard lives and
/// dies on the blocking pool thread, never across an await point.
static SYSTEM_QUERY_LOCK: Mutex<()> = Mutex::new(());

/// Where the rig profile lives on disk. Same folder as settings/sessions —
/// `%LOCALAPPDATA%\LagHunter\system-cache.json`.
fn system_cache_path() -> std::path::PathBuf {
    super::storage::app_dir().join("system-cache.json")
}

/// Load the persisted rig profile. `None` when absent/corrupt — callers fall
/// back to a live query. Corrupt = silently ignored (fail-soft, like the
/// settings store).
fn load_system_cache() -> Option<SystemInfo> {
    let text = fs::read_to_string(system_cache_path()).ok()?;
    serde_json::from_str(&text).ok()
}

/// Persist the rig profile. Best effort — a failed write only means the next
/// launch pays the query cost again. Atomic like the settings store: a
/// crash mid-write must not leave a half-written cache behind.
fn save_system_cache(info: &SystemInfo) {
    let _ = fs::create_dir_all(super::storage::app_dir());
    if let Ok(body) = serde_json::to_string(info) {
        let _ = super::storage::write_file_atomic(&system_cache_path(), body.as_bytes());
    }
}

/// Rig info, disk-cached across runs: instant after the first launch on a
/// machine. MUST be called from an async context — the first run pays the
/// PowerShell hardware inventory on the blocking pool (see module notes).
/// The whole first-query path (std lock + live query + cache save) runs
/// INSIDE one blocking task so the lock guard never crosses an await.
pub async fn system_info_async() -> Result<SystemInfo, String> {
    if let Some(cached) = SYSTEM_CACHE.get() {
        return Ok(cached.clone());
    }
    // disk cache: the machine doesn't change between launches
    if let Some(disk) = load_system_cache() {
        let _ = SYSTEM_CACHE.set(disk.clone());
        super::logging::info("rig profile loaded from disk cache");
        return Ok(disk);
    }
    // first run on this machine: one blocking task owns the whole query —
    // callers that race in behind it wait for the task, not a second query
    let started = std::time::Instant::now();
    let info = tauri::async_runtime::spawn_blocking(|| -> Result<SystemInfo, String> {
        // serialize: whoever got here first runs the inventory; the rest
        // find the cache filled when the lock reaches them
        let _serial = SYSTEM_QUERY_LOCK
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        if let Some(cached) = SYSTEM_CACHE.get() {
            return Ok(cached.clone());
        }
        let info = query_system_info()?;
        save_system_cache(&info);
        let _ = SYSTEM_CACHE.set(info.clone());
        Ok(info)
    })
    .await
    .map_err(|e| format!("system info task failed: {e}"))??;
    super::logging::perf("system_info first query", started.elapsed().as_millis());
    Ok(info)
}

/// Machine facts the session needs (RAM MB + physical disk count) straight
/// from the rig cache — no PowerShell round-trip, no hardware inventory.
/// `None` when the cache isn't filled yet (first machine run before the
/// async warm-up completes): the caller falls back to its own probe path.
pub fn cached_machine_profile() -> Option<(f64, u32)> {
    let info = SYSTEM_CACHE
        .get()
        .cloned()
        .or_else(load_system_cache)?;
    // a placeholder/never-filled profile carries ram_gb = 0 — not usable
    if info.ram_gb <= 0.0 {
        return None;
    }
    Some((info.ram_gb * 1024.0, info.disks.len().max(1) as u32))
}

// ---------------------------------------------------------------------------
// TTL caches — tab data goes stale, not obsolete. A fresh read costs a full
// PowerShell spawn (0.5–2 s); a tab switch should never pay it twice inside
// a few seconds. Stale-while-revalidate: serve the cached copy IMMEDIATELY
// if it exists, refresh it in the background when the TTL lapsed.
// ---------------------------------------------------------------------------

struct TtlCache<T> {
    value: Mutex<Option<(T, std::time::Instant)>>,
}

impl<T: Clone> TtlCache<T> {
    const fn new() -> Self {
        Self {
            value: Mutex::new(None),
        }
    }

    /// cached value if present — caller decides whether to also refresh
    fn get(&self) -> Option<T> {
        let guard = self.value.lock().unwrap_or_else(|p| p.into_inner());
        guard.as_ref().map(|(v, _)| v.clone())
    }

    /// store/replace the cached value
    fn set(&self, v: T) {
        let mut guard = self.value.lock().unwrap_or_else(|p| p.into_inner());
        *guard = Some((v, std::time::Instant::now()));
    }

    /// is the cached copy still inside its freshness window?
    fn fresh_for(&self, ttl: std::time::Duration) -> bool {
        let guard = self.value.lock().unwrap_or_else(|p| p.into_inner());
        match guard.as_ref() {
            Some((_, at)) => at.elapsed() < ttl,
            None => false,
        }
    }
}

/// top processes: "who is eating the machine RIGHT NOW" — short TTL, still
// long enough to cover tab-flipping; refresh happens off the click
static TOP_PROCESSES_CACHE: TtlCache<Vec<TopProcess>> = TtlCache::new();
/// system checks: power plan/pagefile/battery — people don't flip these
/// mid-session; a longer window is fine
static SYSTEM_CHECKS_CACHE: TtlCache<SystemChecks> = TtlCache::new();

/// How long a top-processes snapshot stays fresh.
const TOP_PROCESSES_TTL: std::time::Duration = std::time::Duration::from_secs(10);
/// How long a system-checks read stays fresh.
const SYSTEM_CHECKS_TTL: std::time::Duration = std::time::Duration::from_secs(30);

/// top processes with TTL: returns the cached copy immediately when one
/// exists (even stale) and refreshes in the background past the TTL.
pub fn top_processes_cached() -> Result<Vec<TopProcess>, String> {
    if let Some(cached) = TOP_PROCESSES_CACHE.get() {
        if !TOP_PROCESSES_CACHE.fresh_for(TOP_PROCESSES_TTL) {
            // stale — serve the copy now, refresh in the background
            std::thread::spawn(|| {
                if let Ok(fresh) = query_top_processes() {
                    TOP_PROCESSES_CACHE.set(fresh);
                }
            });
        }
        return Ok(cached);
    }
    // first call on this run: pay the cost once, synchronously
    let fresh = query_top_processes()?;
    TOP_PROCESSES_CACHE.set(fresh.clone());
    Ok(fresh)
}

/// top processes, bypassing the cache: a synchronous fresh read for the
/// manual refresh button (the cached path would return the same numbers
/// the silent poll already shows). Warms the cache so the next silent
/// poll doesn't flash older numbers right after a manual refresh.
pub fn top_processes_fresh() -> Result<Vec<TopProcess>, String> {
    let fresh = query_top_processes()?;
    TOP_PROCESSES_CACHE.set(fresh.clone());
    Ok(fresh)
}

/// System checks with TTL: same stale-while-revalidate pattern.
pub fn system_checks_cached() -> Result<SystemChecks, String> {
    if let Some(cached) = SYSTEM_CHECKS_CACHE.get() {
        if !SYSTEM_CHECKS_CACHE.fresh_for(SYSTEM_CHECKS_TTL) {
            std::thread::spawn(|| {
                if let Ok(fresh) = query_system_checks() {
                    SYSTEM_CHECKS_CACHE.set(fresh);
                }
            });
        }
        return Ok(cached);
    }
    let fresh = query_system_checks()?;
    SYSTEM_CHECKS_CACHE.set(fresh.clone());
    Ok(fresh)
}

/// System checks, bypassing the cache: a synchronous fresh read for the
/// manual refresh button (same contract as top_processes_fresh).
pub fn system_checks_fresh() -> Result<SystemChecks, String> {
    let fresh = query_system_checks()?;
    SYSTEM_CHECKS_CACHE.set(fresh.clone());
    Ok(fresh)
}

/// Windows build identity for the boot log, read straight from the registry
/// (no PowerShell spawn, no elevation): `ProductName` + `CurrentBuildNumber`.
/// This is what makes any user-sent log readable on the 10/11 axis — the
/// compatibility story of every feature decision starts at this one line.
pub fn os_identity() -> String {
    let hklm = winreg::RegKey::predef(winreg::enums::HKEY_LOCAL_MACHINE);
    let read = |name: &str| {
        hklm.open_subkey(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion")
            .ok()
            .and_then(|k| k.get_value::<String, _>(name).ok())
            .unwrap_or_default()
    };
    let build = read("CurrentBuildNumber");
    let name = read("ProductName");
    // "Windows 10 Pro" / "Windows 11 Pro" + build. Missing reads degrade to
    // just the build (never an empty string: "os=?" is worse than "os=build")
    let label = if name.is_empty() {
        format!("build={build}")
    } else {
        format!("{name} build={build}")
    };
    if build.is_empty() {
        "unknown".into()
    } else {
        label
    }
}

/// Boot-time warm-up for every engine cache, called ONCE from setup() on a
/// background async task. The OLD code spawned raw threads that ran the
/// PowerShell scripts WITHOUT a blocking pool — the 20s Get-PhysicalDisk
/// inventory froze the UI on HDD machines. Now:
///   * rig profile  — disk-cache hit (instant) or one async query
///   * checks        — refreshed off-thread; the tab reads the cache
///   * top processes — refreshed off-thread
///
/// The one-line rig log it produces answers most support questions:
/// `rig: ram=8192MB disks=2 gpu_counters=true powershell=true os=Windows 11 Pro build=26200`
pub async fn warm_system_caches() {
    let _t = super::logging::timed("startup warm-up");
    let os = os_identity();
    // rig (fills memory + disk cache on first machine run)
    match system_info_async().await {
        Ok(info) => {
            super::logging::info(&format!(
                "rig: ram={:.0}MB disks={} gpu_counters={} powershell={} os={os}",
                info.ram_gb * 1024.0,
                info.disks.len(),
                info.gpu_counters,
                info.powershell_available
            ));
        }
        Err(e) => super::logging::warn(&format!("rig warm-up failed: {e}")),
    }
    // checks + top processes: off-thread refreshes, results land in caches
    let checks = tauri::async_runtime::spawn_blocking(query_system_checks);
    let procs = tauri::async_runtime::spawn_blocking(query_top_processes);
    match checks.await {
        Ok(Ok(c)) => SYSTEM_CHECKS_CACHE.set(c),
        _ => super::logging::warn("system checks warm-up failed"),
    }
    match procs.await {
        Ok(Ok(p)) => TOP_PROCESSES_CACHE.set(p),
        _ => super::logging::warn("top processes warm-up failed"),
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct GpuInfo {
    pub name: String,
    pub vram_gb: Option<f64>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DiskInfo {
    pub name: String,
    pub media: String,
    pub bus: String,
    pub size_gb: f64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SystemInfo {
    pub cpu: String,
    pub gpus: Vec<GpuInfo>,
    pub ram_gb: f64,
    pub disks: Vec<DiskInfo>,
    /// can the tool read NVIDIA GPU counters? (false on AMD/Intel-only machines)
    pub gpu_counters: bool,
    /// is PowerShell usable? (false = limited mode: defaults, UTC-ish timestamps,
    /// muted GPU window checks — the UI surfaces this honestly)
    pub powershell_available: bool,
}

/// NVIDIA VRAM in MB via nvidia-smi. Win32_VideoController.AdapterRAM is a
/// 32-bit field: anything above 4 GB wraps and lies. nvidia-smi reports the
/// truth; CIM stays as the fallback for non-NVIDIA machines.
fn nvidia_vram_mb() -> Option<f64> {
    #[cfg(windows)]
    let out = Command::new("nvidia-smi")
        .args(["--query-gpu=memory.total", "--format=csv,noheader,nounits"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(NO_WINDOW)
        .output()
        .ok()?;
    #[cfg(not(windows))]
    return None;
    #[cfg(windows)]
    {
        let text = String::from_utf8_lossy(&out.stdout);
        text.trim().parse::<f64>().ok()
    }
}

pub fn query_system_info() -> Result<SystemInfo, String> {
    let text = ps(r#"
$cpu = (Get-CimInstance Win32_Processor | Select-Object -First 1).Name
"cpu|$cpu"
Get-CimInstance Win32_VideoController | ForEach-Object { "gpu|$($_.Name)|$([math]::Round($_.AdapterRAM/1GB,1))" }
"ram|$([math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory/1GB,1))"
Get-PhysicalDisk | ForEach-Object { "disk|$($_.FriendlyName)|$($_.MediaType)|$($_.BusType)|$([math]::Round($_.Size/1GB,0))" }
"#)?;
    let mut info = SystemInfo {
        cpu: "Unknown".into(),
        gpus: Vec::new(),
        ram_gb: 0.0,
        disks: Vec::new(),
        gpu_counters: super::sampler::query_gpu_max_clocks().is_some(),
        powershell_available: powershell_available(),
    };
    // truthful VRAM for NVIDIA cards (AdapterRAM lies above 4 GB)
    let nv_vram_mb = nvidia_vram_mb();
    for line in text.lines().map(|l| l.trim()).filter(|l| !l.is_empty()) {
        let mut parts = line.split('|');
        match parts.next() {
            Some("cpu") => info.cpu = parts.next().unwrap_or("Unknown").trim().to_string(),
            Some("gpu") => {
                let name = parts.next().unwrap_or("").trim().to_string();
                let cim_vram = parts.next().and_then(|v| v.trim().parse::<f64>().ok());
                // NVIDIA + a truthful nvidia-smi reading beats the 32-bit cap
                let vram = match (name.to_lowercase().contains("nvidia"), nv_vram_mb) {
                    (true, Some(mb)) => Some(mb / 1024.0),
                    _ => cim_vram,
                };
                info.gpus.push(GpuInfo {
                    name,
                    vram_gb: vram,
                });
            }
            Some("ram") => {
                info.ram_gb = parts
                    .next()
                    .and_then(|v| v.trim().parse().ok())
                    .unwrap_or(0.0);
            }
            Some("disk") => {
                let name = parts.next().unwrap_or("").trim().to_string();
                let media = parts.next().unwrap_or("").trim().to_string();
                let bus = parts.next().unwrap_or("").trim().to_string();
                let size = parts
                    .next()
                    .and_then(|v| v.trim().parse().ok())
                    .unwrap_or(0.0);
                if !name.is_empty() {
                    info.disks.push(DiskInfo {
                        name,
                        media,
                        bus,
                        size_gb: size,
                    });
                }
            }
            _ => {}
        }
    }
    Ok(info)
}

// ---------------------------------------------------------------------------
// Top processes — who is eating the machine (GameLoop excluded: that's the game)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, serde::Serialize)]
pub struct TopProcess {
    pub name: String,
    pub pid: u32,
    /// % of TOTAL CPU (normalized across all logical cores), 1s average
    pub cpu_pct: f64,
    pub ram_mb: f64,
}

pub fn query_top_processes() -> Result<Vec<TopProcess>, String> {
    // ONE PowerShell process: two quick snapshots 400ms apart, top-by-RAM only
    // (60 processes max) — snappy on busy machines, still accurate for the
    // processes that matter. CPU% = delta between the two snapshots.
    let text = ps(r#"
$cores = [Environment]::ProcessorCount
$a = @{}
Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 60 | ForEach-Object { $a[$_.Id] = $_.CPU }
Start-Sleep -Milliseconds 400
Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 60 | ForEach-Object {
  $p = $a[$_.Id]
  if ($null -ne $p -and $null -ne $_.CPU) {
    $pct = [math]::Round((($_.CPU - $p) / 0.4 / $cores) * 100, 1)
    "{0}|{1}|{2}|{3}" -f $_.ProcessName, $_.Id, $pct, [math]::Round($_.WorkingSet64/1MB,0)
  }
}
"#)?;
    let mut out: Vec<TopProcess> = Vec::new();
    for line in text.lines().map(|l| l.trim()).filter(|l| !l.is_empty()) {
        let mut parts = line.split('|');
        let (Some(name), Some(pid), Some(pct), Some(ram)) = (
            parts.next(),
            parts.next().and_then(|p| p.trim().parse().ok()),
            parts.next().and_then(|p| p.trim().parse().ok()),
            parts.next().and_then(|p| p.trim().parse().ok()),
        ) else {
            continue;
        };
        // the game (all GameLoop processes) is never a suspect —
        // and neither is the tool itself
        if super::sampler::is_gameloop_process(name) || super::sampler::is_self_process(name) {
            continue;
        }
        // below 0.5% is noise
        if pct < 0.5 {
            continue;
        }
        out.push(TopProcess {
            name: name.to_string(),
            pid,
            cpu_pct: pct,
            ram_mb: ram,
        });
    }
    out.sort_by(|a, b| {
        b.cpu_pct
            .partial_cmp(&a.cpu_pct)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    out.truncate(12);
    Ok(out)
}

// ---------------------------------------------------------------------------
// System checks — read-only status + "take me there" (no modification, ever)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, serde::Serialize)]
pub struct SystemChecks {
    /// friendly power plan name, e.g. "High performance"
    pub power_name: String,
    /// true = performance-class plan active
    pub power_ok: bool,
    /// "auto" | "manual" | "off"
    pub pagefile_mode: String,
    pub pagefile_mb: u64,
    pub pagefile_ok: bool,
    /// true on laptops (a battery exists)
    pub laptop: bool,
    /// true when plugged in (always true on desktops)
    pub on_ac: bool,
    /// true when CPU virtualization (VT) is enabled in firmware.
    /// GameLoop needs it; disabled = software emulation and CPU saturation.
    /// Unknown reads as enabled (no false alarm on probe failure).
    pub vt_enabled: bool,
    /// true when Game DVR / background recording is on (steals GPU + disk
    /// mid-match). Unknown reads as off (no false alarm on probe failure).
    pub game_dvr_enabled: bool,
    /// true when Storage Sense is on. `None` = the policy key does not
    /// exist on this Windows build (feature unavailable): the row hides,
    /// never shows a dead switch. Documented on Windows 10 (1709+) and 11.
    pub storage_sense: Option<bool>,
}

/// The Tools tab's switches, live from the registry — and ONLY that. The full
/// system_checks batch costs a PowerShell spawn the Tools page never
/// needs (it displays none of those rows); the tweak_states command
/// serves this struct instead — microseconds, in-process.
#[derive(Debug, Clone, serde::Serialize)]
pub struct TweakStates {
    /// true when background recording is armed (same rule as SystemChecks)
    pub game_dvr_enabled: bool,
    /// true when Storage Sense is on; None = policy key missing on this
    /// build (feature unavailable, the row hides)
    pub storage_sense: Option<bool>,
    /// true when Game Mode is on (both toggles read 1; a missing value is
    /// the OS default = on, never a false "off")
    pub game_mode: bool,
    /// per-exe GPU preference over the resolved GameLoop executables
    pub gpu_high_perf: RowState,
    /// per-exe fullscreen-optimizations opt-out over the resolved
    /// GameLoop executables
    pub fso_disabled: RowState,
    /// true when pointer precision is off (all three values zero; anything
    /// missing is the OS default = on, so the switch reads off)
    pub mouse_accel_off: bool,
    /// windowed-games optimization state (Win11+ only); None = unsupported
    /// build (row hides — there is no such Settings toggle to mirror there)
    pub windowed_game_opt: Option<bool>,
    /// High Performance row state: On = a performance-class plan is
    /// active; Off = present or restorable; Hidden = Ultimate active or
    /// S0-only firmware (forcing plans there fights the design)
    pub power_high_perf: RowState,
}

/// Visibility of a Tools row whose availability depends on the machine.
/// The UI translates the reason (keys, not sentences — the engine never
/// ships user-facing text):
/// - On/Off: live switch state, row interactive.
/// - DisabledGameloopNotFound: visible but greyed — GameLoop exes did not
///   resolve, which the user can fix (install/run GameLoop). A row the
///   user can act on must explain itself, never vanish silently.
/// - Hidden: can never work here (unsupported OS/build) — the row is
///   absent entirely. A permanently dead row is clutter, not honesty.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RowState {
    On,
    Off,
    DisabledGameloopNotFound,
    Hidden,
}

/// Windows build number (e.g. 22631), None when unreadable. Same source
/// as the boot-log identity line, factored out so feature gates can ask
/// the OS a yes/no question without parsing a display string.
pub(crate) fn windows_build_number() -> Option<u32> {
    winreg::RegKey::predef(winreg::enums::HKEY_LOCAL_MACHINE)
        .open_subkey(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion")
        .ok()?
        .get_value::<String, _>("CurrentBuildNumber")
        .ok()?
        .trim()
        .parse::<u32>()
        .ok()
}

/// First build shipping per-app GPU preferences (Win10 1803): older
/// builds silently ignore the UserGpuPreferences values, so our
/// verify-by-re-read would report success for a write the OS never
/// honors — a manufactured success. Unreadable build fails OPEN (match
/// current behavior everywhere): only a positively-identified old build
/// hides the row.
pub(crate) const GPU_PREF_MIN_BUILD: u32 = 17134;

pub(crate) fn gpu_pref_supported(build: Option<u32>) -> bool {
    build.map(|b| b >= GPU_PREF_MIN_BUILD).unwrap_or(true)
}

/// First build shipping the windowed-games optimization (Windows 11
/// RTM): older builds have no such Settings toggle, so a row for it
/// would be a dead switch there. Same fail-open contract as the GPU
/// gate above: only a positively-identified old build hides the row.
pub(crate) const WGC_MIN_BUILD: u32 = 22000;

pub(crate) fn windowed_opt_supported(build: Option<u32>) -> bool {
    build.map(|b| b >= WGC_MIN_BUILD).unwrap_or(true)
}

/// Live DWORD read from a registry subkey under a given root, as bool-ish
/// tri-state: Some(value) / None (value missing) — key-open errors also read
/// as None for CHECKS (a probe failure must never fire a false warning;
/// `tweaks.rs` keeps the stricter Err contract for writes).
/// Architecture rule: registry access is winreg, in-process — never a
/// PowerShell script line.
fn reg_dword(root: winreg::HKEY, subkey: &str, name: &str) -> Option<u32> {
    let hk = winreg::RegKey::predef(root);
    let key = hk.open_subkey(subkey).ok()?;
    key.get_value::<u32, _>(name).ok()
}

/// Live string read from a registry subkey — same fail-soft contract as
/// reg_dword above: anything missing or unreadable is None, never an
/// error (a probe failure must never fire a false warning).
fn reg_string(root: winreg::HKEY, subkey: &str, name: &str) -> Option<String> {
    let hk = winreg::RegKey::predef(root);
    let key = hk.open_subkey(subkey).ok()?;
    key.get_value::<String, _>(name).ok()
}

/// Is the Storage Sense policy KEY present on this build? (Availability is
/// the KEY existing, not the value: Windows never deletes this key when
/// the user turns Storage Sense off — it zeroes `01`, verified live.)
fn ss_policy_key_exists() -> bool {
    winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER)
        .open_subkey(r"SOFTWARE\Microsoft\Windows\CurrentVersion\StorageSense\Parameters\StoragePolicy")
        .is_ok()
}

pub fn query_system_checks() -> Result<SystemChecks, String> {
    // ---- registry-sourced checks FIRST, in-process (winreg): the batch
    // below keeps only what genuinely needs a command (powercfg, CIM,
    // disks) — every registry line moved here is one spawn-line less that
    // can break on quoting or locale.
    // The two verdicts below come from query_tweak_states (the SAME
    // derivation the Tools tab's lightweight read uses — one rule, two
    // consumers). The raw reads here exist only for the diagnostic log
    // line naming the exact values behind an armed verdict.
    let states = query_tweak_states();
    let dvr_master = reg_dword(
        winreg::enums::HKEY_CURRENT_USER,
        r"System\GameConfigStore",
        "GameDVR_Enabled",
    );
    let dvr_capture = reg_dword(
        winreg::enums::HKEY_CURRENT_USER,
        r"SOFTWARE\Microsoft\Windows\CurrentVersion\GameDVR",
        "AppCaptureEnabled",
    );
    let dvr_policy = reg_dword(
        winreg::enums::HKEY_LOCAL_MACHINE,
        r"SOFTWARE\Policies\Microsoft\Windows\GameDVR",
        "AllowGameDVR",
    );
    let dvr_historical = reg_dword(
        winreg::enums::HKEY_CURRENT_USER,
        r"SOFTWARE\Microsoft\Windows\CurrentVersion\GameDVR",
        "HistoricalCaptureEnabled",
    );

    // ---- command-sourced checks: ONE PowerShell batch for the rest
    let text = ps(r#"
$scheme = (powercfg /getactivescheme) -join ' '
"power|$scheme"
$cs = Get-CimInstance Win32_ComputerSystem
$pf = Get-CimInstance Win32_PageFileUsage | Select-Object -First 1
if ($cs.AutomaticManagedPagefile) { "pagefile|auto|$($pf.AllocatedBaseSize)" }
elseif ($pf) { "pagefile|manual|$($pf.AllocatedBaseSize)" }
else { "pagefile|off|0" }
$bat = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue
if ($bat) { "battery|$($bat.BatteryStatus)" } else { "battery|none" }
$vt = (Get-CimInstance Win32_Processor | Select-Object -First 1).VirtualizationFirmwareEnabled
"vt|$vt"
"#)?;
    let mut c = SystemChecks {
        power_name: "Unknown".into(),
        power_ok: false,
        pagefile_mode: "off".into(),
        pagefile_mb: 0,
        pagefile_ok: false,
        laptop: false,
        on_ac: true,
        vt_enabled: true,
        game_dvr_enabled: false,
        storage_sense: None,
    };
    for line in text.lines().map(|l| l.trim()).filter(|l| !l.is_empty()) {
        let mut parts = line.split('|');
        match parts.next() {
            Some("power") => {
                let raw = parts.next().unwrap_or("");
                c.power_name = extract_power_name(raw);
                c.power_ok = is_performance_plan(&c.power_name, &extract_power_guid(raw));
            }
            Some("pagefile") => {
                c.pagefile_mode = parts.next().unwrap_or("off").trim().to_string();
                c.pagefile_mb = parts
                    .next()
                    .and_then(|v| v.trim().parse().ok())
                    .unwrap_or(0);
                c.pagefile_ok = pagefile_ok(&c.pagefile_mode, c.pagefile_mb);
            }
            Some("battery") => {
                let b = parts.next().unwrap_or("none").trim();
                c.laptop = b != "none";
                // BatteryStatus 2 = on AC; 1 = discharging
                c.on_ac = !c.laptop || b == "2";
            }
            Some("vt") => {
                // PowerShell prints True/False; empty = probe failed, keep the safe default
                let v = parts.next().unwrap_or("True").trim().to_ascii_lowercase();
                c.vt_enabled = v != "false" && v != "0";
            }
            _ => {}
        }
    }

    // ---- registry-sourced fields (winreg, read before the batch above) ----
    // GameDVR armed = the background toggle is live, unless the machine
    // policy forces it off (same rule the old batch line enforced)
    c.game_dvr_enabled = states.game_dvr_enabled;
    if c.game_dvr_enabled {
        super::logging::info(&format!(
            "dvr armed: master={:?} capture={:?} policy={:?} historical={dvr_historical:?}",
            dvr_master, dvr_capture, dvr_policy
        ));
    }
    // Storage Sense: key missing on this build = feature unavailable -> None:
    // the row hides, never a dead switch. Logged so a user report from any
    // build carries the compatibility story in its own log.
    c.storage_sense = states.storage_sense;
    if c.storage_sense.is_none() {
        super::logging::warn("feature storagesense hidden: policy key missing on this build");
    }
    Ok(c)
}

/// "Power Scheme GUID: xxx  (High performance)" → "High performance"
/// The raw line always carries the GUID (language-independent) plus the
/// localized display name; both are kept so callers can match on either.
fn extract_power_name(raw: &str) -> String {
    let open = raw.rfind('(');
    let close = raw.rfind(')');
    match (open, close) {
        (Some(o), Some(c)) if c > o => raw[o + 1..c].trim().to_string(),
        _ => "Unknown".into(),
    }
}

/// The scheme GUID from the same powercfg line: `...: <guid>  (Name)`.
/// GUIDs are identical on every Windows language — the only reliable
/// signal on an Arabic (or any localized) Windows where the display name
/// comes back translated ("أقصى أداء" etc.).
pub(crate) fn extract_power_guid(raw: &str) -> String {
    // "Power Scheme GUID: e72c17b6-94d2-4509-adfc-8f2302229d1a  (High performance)"
    let after = raw.split(':').next_back().unwrap_or("").trim();
    let guid = after.split_whitespace().next().unwrap_or("");
    if looks_like_guid(guid) {
        guid.to_ascii_lowercase()
    } else {
        String::new()
    }
}

/// Built-in Windows performance-class scheme GUIDs (locale-independent).
/// Ultimate verified against Microsoft's documented duplicatescheme GUID
/// (an earlier revision carried a transposed variant that could never
/// match, so Ultimate machines fell through to name matching).
pub(crate) const POWER_GUID_HIGH_PERFORMANCE: &str = "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c";
const POWER_GUID_ULTIMATE_PERFORMANCE: &str = "e9a42b02-d5df-448d-aa00-03f14749eb61";
/// Balanced is the universal fallback (present on virtually every machine,
// used when a stored previous plan vanished).
pub const POWER_GUID_BALANCED: &str = "381b4222-f694-41f0-9685-ff5bb260df2e";

pub(crate) fn is_performance_plan(name: &str, guid: &str) -> bool {
    // GUID first: exact, language-independent truth for built-in plans.
    if guid == POWER_GUID_HIGH_PERFORMANCE || guid == POWER_GUID_ULTIMATE_PERFORMANCE {
        return true;
    }
    // OEM/custom schemes carry their own GUIDs we can't know — fall back to
    // matching the display name. English + Arabic covered (user base is
    // largely Arabic Windows); other languages fall through to "not matched".
    let n = name.to_lowercase();
    let english = n.contains("high performance")
        || n.contains("ultimate performance")
        || n.contains("performance");
    let arabic = n.contains("أقصى أداء")
        || n.contains("الأداء العالي")
        || n.contains("أداء عالي")
        || n.contains("أقصى الأداء")
        || n.contains("الأداء الأقصى")
        // reported Arabic display name of Ultimate Performance; unverified
        // live (no Arabic Ultimate machine seen yet) — kept because a miss
        // only risks a false warn, never a wrong write
        || n.contains("الأداء المطلق");
    english || arabic
}

/// A powercfg GUID shape check, factored out of extract_power_guid so the
/// plan-list parser shares the exact same rule (one definition, used by
/// the health batch, the Tools read, and their tests).
fn looks_like_guid(s: &str) -> bool {
    s.len() == 36
        && s.as_bytes()[8] == b'-'
        && s.as_bytes()[13] == b'-'
        && s.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

/// All power schemes from `powercfg /list` as (guid, display name) pairs.
/// Names matter: a user-created High Performance duplicate carries a
/// fresh GUID every time, so GUID-only matching can never see it — the
/// name fallback in is_performance_plan is what recognizes it.
pub fn power_list() -> Vec<(String, String)> {
    let out = Command::new("powercfg")
        .arg("/list")
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(NO_WINDOW)
        .output();
    let Ok(out) = out else { return Vec::new() };
    let text = String::from_utf8_lossy(&out.stdout);
    text.lines()
        .filter_map(|line| {
            let guid = extract_power_guid(line);
            if guid.is_empty() {
                return None;
            }
            Some((guid, extract_power_name(line)))
        })
        .collect()
}

/// GUIDs only, for callers that restore by identity (previous-plan
/// fallback must match the exact scheme, never a name twin).
pub fn power_list_guids() -> Vec<String> {
    power_list().into_iter().map(|(g, _)| g).collect()
}

/// Active scheme GUID, same source the health batch parses (kept as a
/// separate call so the Tools read stays independent of the batch).
pub fn power_active_guid() -> String {
    power_active_scheme().0
}

/// Active scheme as (guid, display name): the verify step needs both
/// (performance-class by GUID or by name fallback, like the row read).
pub fn power_active_scheme() -> (String, String) {
    let out = Command::new("powercfg")
        .arg("/getactivescheme")
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(NO_WINDOW)
        .output();
    let Ok(out) = out else {
        return (String::new(), String::new());
    };
    let text = String::from_utf8_lossy(&out.stdout);
    let text = text.into_owned();
    (extract_power_guid(&text), extract_power_name(&text))
}

/// True when the firmware reports S0 Low Power Idle (Modern Standby) as
/// AVAILABLE. Parsed structurally: only the section before the "not
/// available" marker counts (S0 also appears in the unavailable list on
/// S3 machines — live-proven on the dev box). The marker is English-only;
/// on locales where it is absent we assume NOT S0 (show the row; a flip
/// that cannot work fails honestly at verify time instead of hiding a
/// working feature). Powercfg output is native-fast, no PowerShell.
pub fn s0_standby_present() -> bool {
    let out = Command::new("powercfg")
        .arg("/a")
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(NO_WINDOW)
        .output();
    let Ok(out) = out else { return false };
    let text = String::from_utf8_lossy(&out.stdout);
    s0_available_in(&text)
}

fn s0_available_in(powercfg_a: &str) -> bool {
    let lower = powercfg_a.to_ascii_lowercase();
    let available = match lower.find("not available") {
        Some(i) => &lower[..i],
        None => &lower[..],
    };
    available.contains("s0")
}

/// The Tools power row state: On = a performance-class plan is active
/// (built-in GUID, custom duplicate, or name fallback — the dev box
/// itself runs a custom High Performance duplicate); Off = a
/// performance plan exists or the machine can restore one; Hidden =
/// Ultimate already active (nothing above it to offer) or an S0-only
/// machine (forcing plans fights the firmware by design).
pub fn power_row_state(
    active_guid: &str,
    active_name: &str,
    list: &[(String, String)],
    s0: bool,
) -> RowState {
    // Ultimate first: the performance check below would also claim it
    // (by name fallback), but hiding is the honest answer there.
    let ultimate_active = active_guid == POWER_GUID_ULTIMATE_PERFORMANCE
        || active_name.to_ascii_lowercase().contains("ultimate")
        || active_name.contains("الأداء المطلق");
    if ultimate_active {
        return RowState::Hidden;
    }
    if is_performance_plan(active_name, active_guid) {
        return RowState::On;
    }
    // presence = ANY performance-class plan (a duplicate's GUID is fresh
    // every creation, so builtin-only matching would re-create forever —
    // the exact bug that littered duplicate plans).
    let perf_present = list
        .iter()
        .any(|(g, n)| is_performance_plan(n, g));
    if perf_present || !s0 {
        return RowState::Off;
    }
    RowState::Hidden
}

fn pagefile_ok(mode: &str, mb: u64) -> bool {
    match mode {
        // Windows manages it — fine
        "auto" => true,
        // a fixed file below 8GB is the classic stutter cause we diagnosed
        "manual" => mb >= 8192,
        _ => false,
    }
}

/// One fixed drive's page file state, the way the Virtual Memory dialog
/// shows it: system-managed, custom sizes, none, or an entry in a shape
/// this app never writes (shown honestly as unknown, never guessed into
/// another mode). The backend ships these machine keys; the UI translates.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PagefileMode {
    System,
    Custom,
    Off,
    Unknown,
}

/// One row of the drive list: letter, free space, and current mode.
/// Sizes ride along only for custom; free None means that drive's bound
/// is unreadable (a custom write there refuses blind).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct PagefileDriveState {
    pub drive: String,
    pub free_mb: Option<u64>,
    pub mode: PagefileMode,
    pub min_mb: Option<u32>,
    pub max_mb: Option<u32>,
}

/// Everything the Virtual Memory-style editor needs in one read:
/// the global automatic flag plus one state per fixed drive, and whether
/// a page file write is still waiting for a reboot (self-clearing: the
/// uptime clock zeroes on reboot, no writes involved).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct PagefileSettings {
    pub automatic: bool,
    pub drives: Vec<PagefileDriveState>,
    pub pending: bool,
}

/// The raw desired state Windows stores: the AutomaticManagedPagefile
/// flag plus the PagingFiles multi-string. HKLM reads need no elevation.
/// None = unreadable: the editor refuses rather than mirrors a guess.
struct PagefileRaw {
    automatic: bool,
    entries: Vec<String>,
}

fn read_pagefile_raw() -> Option<PagefileRaw> {
    let (automatic, entries) = read_pagefile_flag_and_entries()?;
    Some(PagefileRaw { automatic, entries })
}

/// The flag plus the raw entries for the write side's verifier (tweaks):
/// same read, no second opinion about where the state lives.
pub(crate) fn read_pagefile_flag_and_entries() -> Option<(bool, Vec<String>)> {
    let hklm = winreg::RegKey::predef(winreg::enums::HKEY_LOCAL_MACHINE);
    let mem = hklm
        .open_subkey(r"SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management")
        .ok()?;
    let auto: u32 = mem.get_value("AutomaticManagedPagefile").unwrap_or(0);
    let entries: Vec<String> = mem.get_value("PagingFiles").unwrap_or_default();
    Some((auto == 1, entries))
}

/// Pure half of the per-drive read: first entry addressed to this drive
/// wins (bare or 0 0 = system-managed, min/max = custom, anything else =
/// unknown); a bare legacy `?:\pagefile.sys` marker with no drive of its
/// own reads as system-managed; no entry at all = off. Other drives'
/// entries are never interpreted here, only preserved on write.
pub(crate) fn parse_drive_mode(raw: &[String], drive: &str) -> (PagefileMode, Option<u32>, Option<u32>) {
    let prefix = format!("{drive}\\").to_uppercase();
    let mut marker = false;
    for entry in raw {
        let mut parts = entry.split_whitespace();
        let path = parts.next().unwrap_or("");
        if path == r"?:\pagefile.sys" && parts.next().is_none() {
            marker = true;
            continue;
        }
        if !path.to_uppercase().starts_with(&prefix) {
            continue;
        }
        let rest: Vec<&str> = parts.collect();
        match rest.as_slice() {
            [] => return (PagefileMode::System, None, None),
            [a, b] => match (a.trim().parse::<u32>(), b.trim().parse::<u32>()) {
                (Ok(0), Ok(0)) => return (PagefileMode::System, None, None),
                (Ok(mn), Ok(mx)) => return (PagefileMode::Custom, Some(mn), Some(mx)),
                _ => return (PagefileMode::Unknown, None, None),
            },
            _ => return (PagefileMode::Unknown, None, None),
        }
    }
    if marker {
        return (PagefileMode::System, None, None);
    }
    (PagefileMode::Off, None, None)
}

/// Fixed local drives only (the dialog never offers removable, optical,
/// or network volumes): GetLogicalDrives bitmask filtered by
/// GetDriveTypeW == DRIVE_FIXED. Read-only, no spawn.
#[cfg(windows)]
pub fn fixed_drives() -> Vec<String> {
    use std::os::windows::ffi::OsStrExt;
    let mut drives = Vec::new();
    // SAFETY: no preconditions.
    let mask = unsafe { GetLogicalDrives() };
    for i in 0..26 {
        if mask & (1 << i) == 0 {
            continue;
        }
        let letter = (b'A' + i) as char;
        let root = format!("{letter}:\\");
        let wide: Vec<u16> = std::ffi::OsStr::new(&root)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        // SAFETY: pointer to a live nul-terminated buffer.
        if unsafe { GetDriveTypeW(wide.as_ptr()) } == DRIVE_FIXED {
            drives.push(format!("{letter}:"));
        }
    }
    drives
}

#[cfg(not(windows))]
pub fn fixed_drives() -> Vec<String> {
    Vec::new()
}

#[cfg(windows)]
const DRIVE_FIXED: u32 = 3;

/// The editor's single read: global flag plus one live state per fixed
/// drive. Unreadable registry or zero fixed drives refuses with a machine
/// key (the UI translates); per-drive free space may still be None, which
/// only gates custom writes on that drive.
pub fn pagefile_settings() -> Result<PagefileSettings, String> {
    let raw = read_pagefile_raw().ok_or_else(|| "PF_READ_FAILED".to_string())?;
    let drives = fixed_drives();
    if drives.is_empty() {
        return Err("PF_READ_FAILED".into());
    }
    let states = drives
        .iter()
        .map(|drive| {
            let (mode, min_mb, max_mb) = parse_drive_mode(&raw.entries, drive);
            PagefileDriveState {
                drive: drive.clone(),
                free_mb: drive_free_mb_for(drive),
                mode,
                min_mb,
                max_mb,
            }
        })
        .collect();
    let pending = super::settings::load().pending_restart.as_ref().is_some_and(|p| {
        p.tweak == super::tweaks::PAGEFILE_SETTINGS_ID
            && restart_pending_visible(p.at_uptime_ms, boot_uptime_ms())
    });
    Ok(PagefileSettings {
        automatic: raw.automatic,
        drives: states,
        pending,
    })
}

/// Free megabytes on one drive (GetDiskFreeSpaceExW, read-only,
/// no spawn): the dialog's own upper bound ("Space available" is the
/// TOTAL free number, quota-independent: Raymond Chen's documented
/// gotcha is that the caller-available figure subtracts quotas, so we
/// read the third out-param like the dialog does). None = unreadable (a
/// custom write on that drive refuses blind). A malformed drive id reads
/// unreadable, never as another drive's space.
#[cfg(windows)]
pub fn drive_free_mb_for(drive: &str) -> Option<u64> {
    use std::os::windows::ffi::OsStrExt;
    let drive = drive.to_uppercase();
    let letter = drive.as_bytes().first()?;
    if drive.len() != 2 || !letter.is_ascii_alphabetic() || !drive.ends_with(':') {
        return None;
    }
    let path: Vec<u16> = std::ffi::OsStr::new(&format!("{drive}\\"))
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let mut total_free: u64 = 0;
    // SAFETY: pointer to a stack u64, written once on success.
    let ok = unsafe {
        GetDiskFreeSpaceExW(
            path.as_ptr(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut total_free,
        )
    };
    if ok == 0 {
        return None;
    }
    Some(total_free / 1_048_576)
}

#[cfg(not(windows))]
pub fn drive_free_mb_for(_drive: &str) -> Option<u64> {
    None
}

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn GetDiskFreeSpaceExW(
        dir: *const u16,
        free_to_caller: *mut u64,
        total: *mut u64,
        total_free: *mut u64,
    ) -> i32;
    fn GetLogicalDrives() -> u32;
    fn GetDriveTypeW(root: *const u16) -> u32;
}

/// Milliseconds since boot (GetTickCount64, no spawn): the pending-restart
/// clock. A reboot zeroes it, which is exactly the signal.
#[cfg(windows)]
pub fn boot_uptime_ms() -> u64 {
    // SAFETY: no preconditions.
    unsafe { GetTickCount64() }
}

#[cfg(not(windows))]
pub fn boot_uptime_ms() -> u64 {
    0
}

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn GetTickCount64() -> u64;
}

/// Pending-restart visibility, pure: a change is pending while the clock
/// still reads past the write moment; a reboot zeroes the clock and the
/// note clears itself with zero writes. (49-day wraparound without a
/// reboot clears it early — documented, accepted: a wall clock would
/// break on manual time changes, which is worse.)
pub fn restart_pending_visible(stored_at_ms: u64, now_ms: u64) -> bool {
    now_ms >= stored_at_ms
}

/// Is background recording actually armed? Warn ONLY when the background
/// toggle itself ("Record what happened", HistoricalCaptureEnabled) is on.
/// Rationale, verified on a real Win11 machine: the Captures UI toggle does
/// NOT flip the master keys (GameDVR_Enabled stays 1 = factory default,
/// AppCaptureEnabled stays 1 once created), so warning on those false-alarms
/// on machines the user already fixed via Settings. The machine policy
/// (AllowGameDVR=Some(0)) forces everything off.
fn gamedvr_armed_winreg(historical: Option<u32>, policy: Option<u32>) -> bool {
    if policy == Some(0) {
        return false;
    }
    historical == Some(1)
}

/// Storage Sense tri-state from (key-exists, value): a missing policy KEY
/// means the feature is not on this build (None — the row hides, never a
/// dead switch); a present key is on iff its value is 1 (Windows zeroes
/// it for off, never deletes the key — verified live). ONE definition
/// shared by the full batch and the lightweight tweak read, so the two
/// paths can never disagree on what "on" means.
fn storage_sense_state(exists: bool, value: Option<u32>) -> Option<bool> {
    if !exists {
        None
    } else {
        Some(value == Some(1))
    }
}

/// Game Mode is on iff BOTH master toggles read 1. A missing value is the
/// OS default (on): Settings shows the toggle on for a fresh profile, so
/// a missing key must never read as "off" (that would flip a user's
/// switch off on first sight — the exact false-negative class the DVR
/// rule was written against).
pub(crate) fn game_mode_on(allow: Option<u32>, auto: Option<u32>) -> bool {
    allow.unwrap_or(1) == 1 && auto.unwrap_or(1) == 1
}

/// Parse one `key=value;`-style token string (UserGpuPreferences values)
/// into the named token's number. Sibling tokens (AutoHDR etc.) are
/// ignored, never rejected: we only ever read or replace our own token.
pub(crate) fn parse_pref_token(raw: &str, key: &str) -> Option<u32> {
    raw.split(';').find_map(|tok| {
        let (k, v) = tok.split_once('=')?;
        if k.trim().eq_ignore_ascii_case(key) {
            v.trim().parse::<u32>().ok()
        } else {
            None
        }
    })
}

/// Parse one UserGpuPreferences value ("GpuPreference=2;...") into its
/// preference number.
pub(crate) fn parse_gpu_pref(raw: &str) -> Option<u32> {
    parse_pref_token(raw, "GpuPreference")
}

/// The windowed-games optimization is on iff its token reads exactly 1.
/// Anything else (absent, 0, garbage) is off — the OS default.
pub(crate) fn wgc_opt_on(raw: Option<&str>) -> bool {
    raw.and_then(|r| parse_pref_token(r, super::tweaks::WGC_TOKEN)) == Some(1)
}

/// Build a UserGpuPreferences value with our token set (on) or removed
/// (off). None = nothing remains — the caller deletes the value instead
/// of writing an empty string (matches "revert to Windows decides").
pub(crate) fn with_gpu_pref(raw: Option<&str>, on: bool) -> Option<String> {
    let mut kept: Vec<&str> = raw
        .unwrap_or("")
        .split(';')
        .map(str::trim)
        .filter(|tok| !tok.is_empty())
        .filter(|tok| {
            !tok
                .split_once('=')
                .is_some_and(|(k, _)| k.trim().eq_ignore_ascii_case("GpuPreference"))
        })
        .collect();
    if on {
        kept.push("GpuPreference=2");
    }
    if kept.is_empty() {
        None
    } else {
        Some(kept.join(";") + ";")
    }
}

/// Build a UserGpuPreferences value with the windowed-games token set to
/// 1 (on) or 0 (off), preserving sibling tokens. Unlike the per-exe GPU
/// preference (whose off DELETES the token), off here WRITES `=0`: that
/// is byte-for-byte what the Settings toggle itself does (verified live
/// on Win11 24H2 — off leaves `SwapEffectUpgradeEnable=0;` present, never
/// deletes). Always returns a value: there is always a token to write.
pub(crate) fn with_wgc_token(raw: Option<&str>, on: bool) -> String {
    let mut kept: Vec<&str> = raw
        .unwrap_or("")
        .split(';')
        .map(str::trim)
        .filter(|tok| !tok.is_empty())
        .filter(|tok| {
            !tok
                .split_once('=')
                .is_some_and(|(k, _)| k.trim().eq_ignore_ascii_case(super::tweaks::WGC_TOKEN))
        })
        .collect();
    kept.push(if on {
        "SwapEffectUpgradeEnable=1"
    } else {
        "SwapEffectUpgradeEnable=0"
    });
    kept.join(";") + ";"
}

/// Does one Layers value carry the fullscreen-optimizations opt-out?
/// Whole-token match only: a substring test would false-positive on a
/// hypothetical future flag containing this one as a prefix.
pub(crate) fn fso_has_flag(raw: Option<&str>) -> bool {
    raw.map(|r| {
        r.split_whitespace()
            .any(|tok| tok == super::tweaks::FSO_FLAG)
    })
    .unwrap_or(false)
}

/// Build a Layers value with our flag set (on) or removed (off),
/// preserving every other compatibility flag byte-for-byte in content
/// (whitespace is normalized — these values are machine-written).
/// None = nothing remains — the caller deletes the value instead of
/// leaving a bare "~" behind.
pub(crate) fn fso_with_flag(raw: Option<&str>, on: bool) -> Option<String> {
    let body = raw.unwrap_or("");
    if on {
        if fso_has_flag(Some(body)) {
            return Some(body.to_string());
        }
        let trimmed = body.trim();
        if trimmed.is_empty() {
            return Some(format!("~ {}", super::tweaks::FSO_FLAG));
        }
        let mut out = trimmed.to_string();
        if !out.starts_with('~') {
            out = format!("~ {out}");
        }
        out.push(' ');
        out.push_str(super::tweaks::FSO_FLAG);
        return Some(out);
    }
    let rest: Vec<&str> = body
        .split_whitespace()
        .filter(|tok| *tok != super::tweaks::FSO_FLAG)
        .collect();
    let rest = rest.join(" ");
    let rest = rest.trim();
    if rest.is_empty() || rest == "~" {
        None
    } else {
        Some(rest.to_string())
    }
}

/// Pointer precision is off iff all three values read exactly zero.
/// Anything missing is the OS default (precision on), so the switch
/// reads off — never a false "already off".
pub(crate) fn mouse_accel_off(speed: Option<u32>, t1: Option<u32>, t2: Option<u32>) -> bool {
    speed == Some(0) && t1 == Some(0) && t2 == Some(0)
}

/// All-or-nothing over several executables: an empty list (nothing
/// resolved) hides the row; otherwise ON means EVERY exe carries the
/// state. A partial set reads as OFF so the switch never claims
/// coverage it does not have.
pub(crate) fn unanimous_state(states: &[bool]) -> Option<bool> {
    if states.is_empty() {
        None
    } else {
        Some(states.iter().all(|s| *s))
    }
}

/// GameLoop rendering executables, resolved live (never spawned, never
/// recursed): install roots come from Tencent's own InstallPath values
/// (any component subkey, either registry view) plus the stock location;
/// each root contributes only `<root>\ui\<exe>` and `<root>\<exe>` when
/// the file actually exists. A bounded handful of exists() checks —
/// microseconds, no process enumeration, no PowerShell.
pub(crate) fn gameloop_exe_paths() -> Vec<std::path::PathBuf> {
    const BASES: [&str; 2] = [
        r"SOFTWARE\Tencent\MobileGamePC",
        r"SOFTWARE\WOW6432Node\Tencent\MobileGamePC",
    ];
    const EXES: [&str; 2] = ["aow_exe.exe", "AndroidEmulatorEn.exe"];
    let hklm = winreg::RegKey::predef(winreg::enums::HKEY_LOCAL_MACHINE);
    let mut roots: Vec<std::path::PathBuf> = Vec::new();
    for base in BASES {
        let Ok(key) = hklm.open_subkey(base) else {
            continue;
        };
        // EnumKeys yields per-item Results (infallible constructor):
        // flatten skips unreadable subkeys, fail-soft like every probe
        for sub in key.enum_keys().flatten() {
            let path = format!("{base}\\{sub}");
            if let Ok(subkey) = hklm.open_subkey(&path) {
                if let Ok(install) = subkey.get_value::<String, _>("InstallPath") {
                    let install = install.trim();
                    if !install.is_empty() {
                        let dir = std::path::PathBuf::from(install);
                        roots.push(dir.clone());
                        if let Some(parent) = dir.parent() {
                            roots.push(parent.to_path_buf());
                        }
                    }
                }
            }
        }
    }
    roots.push(std::path::PathBuf::from(
        r"C:\Program Files\TxGameAssistant",
    ));
    let mut out: Vec<std::path::PathBuf> = Vec::new();
    for root in &roots {
        for exe in EXES {
            for cand in [root.join("ui").join(exe), root.join(exe)] {
                // case-insensitive dedup: `UI\aow_exe.exe` and
                // `ui\aow_exe.exe` are the SAME file on Windows, but
                // PathBuf equality is byte-wise — without this the same
                // exe resolves twice (live-proven: exes=4 for 2 files)
                // and every write/verify runs doubled with a lying count
                if cand.is_file() && !contains_case_insensitive(&out, &cand) {
                    out.push(cand);
                }
            }
        }
    }
    out.sort();
    out
}

/// Case-insensitive path membership: Windows paths compare
/// case-insensitively, PathBuf equality does not. Pure and unit-tested
/// (the resolver itself touches the real registry + filesystem).
fn contains_case_insensitive(haystack: &[std::path::PathBuf], needle: &std::path::Path) -> bool {
    let needle = needle.to_string_lossy().to_lowercase();
    haystack
        .iter()
        .any(|p| p.to_string_lossy().to_lowercase() == needle)
}

/// The Tools tab's switches, live from the registry — and ONLY that.
/// Same derivation as the full batch (shared helpers above), so the two
/// paths agree by construction. Silent by design: the diagnostic log
/// lines live on the full-batch path, not on every tab open.
pub fn query_tweak_states() -> TweakStates {
    use winreg::enums::HKEY_CURRENT_USER;
    let dvr_historical = reg_dword(
        HKEY_CURRENT_USER,
        r"SOFTWARE\Microsoft\Windows\CurrentVersion\GameDVR",
        "HistoricalCaptureEnabled",
    );
    let dvr_policy = reg_dword(
        winreg::enums::HKEY_LOCAL_MACHINE,
        r"SOFTWARE\Policies\Microsoft\Windows\GameDVR",
        "AllowGameDVR",
    );
    let ss_exists = ss_policy_key_exists();
    let ss_value = if ss_exists {
        reg_dword(
            HKEY_CURRENT_USER,
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\StorageSense\Parameters\StoragePolicy",
            "01",
        )
    } else {
        None
    };
    let gm_allow = reg_dword(
        HKEY_CURRENT_USER,
        super::tweaks::GAMEBAR_SUBKEY,
        super::tweaks::GAMEMODE_ALLOW,
    );
    let gm_auto = reg_dword(
        HKEY_CURRENT_USER,
        super::tweaks::GAMEBAR_SUBKEY,
        super::tweaks::GAMEMODE_AUTO,
    );
    let mouse_speed = reg_dword(
        HKEY_CURRENT_USER,
        super::tweaks::MOUSE_SUBKEY,
        super::tweaks::MOUSE_SPEED,
    );
    let mouse_t1 = reg_dword(
        HKEY_CURRENT_USER,
        super::tweaks::MOUSE_SUBKEY,
        super::tweaks::MOUSE_T1,
    );
    let mouse_t2 = reg_dword(
        HKEY_CURRENT_USER,
        super::tweaks::MOUSE_SUBKEY,
        super::tweaks::MOUSE_T2,
    );
    // per-exe states over the resolved GameLoop executables. No resolved
    // exes + supported build = DISABLED with an actionable reason (the
    // user can install/run GameLoop); unsupported build = HIDDEN (can
    // never work here — a permanently dead row is clutter). The GPU row
    // additionally requires Win10 1803+: older builds ignore the
    // preference value while our re-read would still "verify", so the
    // write would lie about succeeding.
    let exes = gameloop_exe_paths();
    let gpu_supported = gpu_pref_supported(windows_build_number());
    let gpu_vals: Vec<Option<u32>> = exes
        .iter()
        .map(|p| {
            reg_string(
                HKEY_CURRENT_USER,
                super::tweaks::GPU_PREF_SUBKEY,
                &p.to_string_lossy(),
            )
            .and_then(|raw| parse_gpu_pref(&raw))
        })
        .collect();
    let gpu_on: Vec<bool> = gpu_vals.iter().map(|v| *v == Some(2)).collect();
    let fso_on: Vec<bool> = exes
        .iter()
        .map(|p| {
            fso_has_flag(
                reg_string(
                    HKEY_CURRENT_USER,
                    super::tweaks::LAYERS_SUBKEY,
                    &p.to_string_lossy(),
                )
                .as_deref(),
            )
        })
        .collect();
    let gpu_high_perf = if !gpu_supported {
        RowState::Hidden
    } else {
        match unanimous_state(&gpu_on) {
            Some(true) => RowState::On,
            Some(false) => RowState::Off,
            None => RowState::DisabledGameloopNotFound,
        }
    };
    let fso_disabled = match unanimous_state(&fso_on) {
        Some(true) => RowState::On,
        Some(false) => RowState::Off,
        None => RowState::DisabledGameloopNotFound,
    };
    // windowed-games optimization: same UserGpuPreferences store as the
    // per-app GPU preference (verified live: ON writes
    // `SwapEffectUpgradeEnable=1;`, OFF writes `=0`, never deletes).
    // Win11+ only — older builds have no such toggle to mirror.
    let build = windows_build_number();
    let windowed_game_opt = if !windowed_opt_supported(build) {
        None
    } else {
        Some(wgc_opt_on(
            reg_string(
                HKEY_CURRENT_USER,
                super::tweaks::GPU_PREF_SUBKEY,
                super::tweaks::WGC_SETTINGS_NAME,
            )
            .as_deref(),
        ))
    };
    // power row: three native powercfg reads (each ~tens of ms, NO_WINDOW,
    // fixed args — the batch's 0.5-2s PowerShell cost stays untouched).
    // Active scheme line carries "GUID (Name)": the same parse the health
    // batch uses, so the row and the card can never disagree on what is on.
    let power_active_raw = Command::new("powercfg")
        .arg("/getactivescheme")
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(NO_WINDOW)
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
        .unwrap_or_default();
    let power_active_guid = extract_power_guid(&power_active_raw);
    let power_active_name = extract_power_name(&power_active_raw);
    let power_high_perf = power_row_state(
        &power_active_guid,
        &power_active_name,
        &power_list(),
        s0_standby_present(),
    );
    TweakStates {
        game_dvr_enabled: gamedvr_armed_winreg(dvr_historical, dvr_policy),
        storage_sense: storage_sense_state(ss_exists, ss_value),
        game_mode: game_mode_on(gm_allow, gm_auto),
        gpu_high_perf,
        fso_disabled,
        mouse_accel_off: mouse_accel_off(mouse_speed, mouse_t1, mouse_t2),
        windowed_game_opt,
        power_high_perf,
    }
}

/// Open a Windows settings panel — strictly whitelisted, never a free string.
pub fn open_windows_panel(panel: &str) -> Result<(), String> {
    // control.exe only opens .cpl APPLETS — a standalone exe handed to it
    // fails silently (this exact bug: the Pagefile button launched
    // control.exe with a non-applet and nothing appeared). Each arm
    // therefore builds its OWN command: CPLs go through control.exe,
    // real exes run directly (System32 is always on PATH).
    #[cfg(windows)]
    {
        let mut cmd = match panel {
            "power" => {
                let mut c = Command::new("control.exe");
                c.arg("powercfg.cpl");
                c
            }
            // Advanced tab DIRECTLY (Performance/Virtual memory is one
            // click away): control.exe only opens .cpl applets, and the
            // SystemPropertiesAdvanced.exe shortcut is NOT one, it carries
            // requireAdministrator, so spawning it from this unprivileged
            // app always fails. `sysdm.cpl,,3` is the same dialog on the
            // Advanced tab (verified by screenshot), no elevation needed.
            // History: v1.0.0 used bare sysdm.cpl and worked; v1.2.0 broke
            // the button reaching for the Advanced tab the wrong way.
            "system" => {
                let mut c = Command::new("control.exe");
                c.arg("sysdm.cpl,,3");
                c
            }
            // ms-settings: pages open via explorer (no elevation, read-only
            // destination). The documented Game DVR page (Win10 Game DVR,
            // Win11 Captures): ms-settings:gaming-gamedvr.
            "gaming-captures" => {
                let mut c = Command::new("explorer.exe");
                c.arg("ms-settings:gaming-gamedvr");
                c
            }
            _ => return Err("unknown panel".into()),
        };
        cmd.stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(NO_WINDOW)
            .spawn()
            .map_err(|e| format!("cannot open panel: {e}"))?;
    }
    #[cfg(not(windows))]
    {
        let _ = panel;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn powershell_probe_matches_availability() {
        // the probe itself runs on this machine — availability is whatever it
        // says, and the cached flag must agree with a fresh probe result.
        // (On dev machines PS exists; the point is the two paths agree.)
        assert_eq!(powershell_available(), probe_powershell());
    }

    #[test]
    fn unknown_panel_refused_without_spawning() {
        // the whitelist rejects before any process spawns — safe to assert
        // in CI (no window ever opens). Case-sensitive: no fuzzy match.
        assert!(open_windows_panel("nope").is_err());
        assert!(open_windows_panel("").is_err());
        assert!(open_windows_panel("System").is_err());
        assert!(open_windows_panel("powercfg.cpl").is_err());
    }

    #[test]
    fn power_name_extracted() {        assert_eq!(
            extract_power_name(
                "Power Scheme GUID: e72c17b6-94d2-4509-adfc-8f2302229d1a  (High performance)"
            ),
            "High performance"
        );
        assert_eq!(extract_power_name("garbage"), "Unknown");
    }

    #[test]
    fn power_guid_extracted() {
        assert_eq!(
            extract_power_guid(
                "Power Scheme GUID: e72c17b6-94d2-4509-adfc-8f2302229d1a  (High performance)"
            ),
            "e72c17b6-94d2-4509-adfc-8f2302229d1a"
        );
        // Arabic Windows: same GUID, translated name — GUID must still parse
        assert_eq!(
            extract_power_guid(
                "Power Scheme GUID: 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c  (أقصى أداء)"
            ),
            "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c"
        );
        assert_eq!(extract_power_guid("garbage"), "");
    }

    #[test]
    fn performance_plan_detected() {
        // by display name (English)
        assert!(is_performance_plan("High performance", ""));
        assert!(is_performance_plan("Ultimate Performance", ""));
        assert!(!is_performance_plan("Power saver", ""));
        assert!(!is_performance_plan("Balanced", ""));
        // by GUID — locale-independent truth (Arabic Windows shows the
        // translated name; the GUID is what must match)
        assert!(is_performance_plan(
            "أقصى أداء",
            POWER_GUID_HIGH_PERFORMANCE
        ));
        assert!(is_performance_plan(
            "whatever",
            POWER_GUID_ULTIMATE_PERFORMANCE
        ));
        assert!(!is_performance_plan(
            "",
            "381b4226-f694-41f0-9685-ff5bb260df2e"
        )); // Balanced GUID
            // by Arabic display name (custom OEM schemes carry unknown GUIDs)
        assert!(is_performance_plan("أقصى أداء", ""));
        assert!(is_performance_plan("الأداء العالي", ""));
        assert!(!is_performance_plan("موفر الطاقة", "")); // Power saver (Arabic)
        assert!(!is_performance_plan("متوازن", "")); // Balanced (Arabic)
    }

    #[test]
    fn ultimate_guid_is_microsofts_documented_one() {
        // a transposed variant lived here and could never match, so
        // Ultimate machines fell through to name matching (and Arabic
        // Ultimates to a false warn). Pinned against the documented
        // duplicatescheme GUID.
        assert_eq!(
            POWER_GUID_ULTIMATE_PERFORMANCE,
            "e9a42b02-d5df-448d-aa00-03f14749eb61"
        );
        assert!(is_performance_plan("", POWER_GUID_ULTIMATE_PERFORMANCE));
    }

    #[test]
    fn s0_detected_only_in_the_available_section() {
        // the dev box shape: S3 machine whose UNAVAILABLE list still names
        // S0 — a naive substring would hide the row on a working machine
        let s3 = "The following sleep states are available on this system:\n    Standby (S3)\n    Hibernate\n\nThe following sleep states are not available on this system:\n    Standby (S0 Low Power Idle)\n\tThe system firmware does not support this standby state.\n";
        assert!(!s0_available_in(s3));
        let s0 = "The following sleep states are available on this system:\n    Standby (S0 Low Power Idle) Network Connected\n    Hibernate\n\nThe following sleep states are not available on this system:\n    Standby (S3)\n\tThe system firmware does not support this standby state.\n";
        assert!(s0_available_in(s0));
        assert!(!s0_available_in("garbage"));
        assert!(!s0_available_in(""));
    }

    #[test]
    fn power_row_state_matrix() {
        let high = POWER_GUID_HIGH_PERFORMANCE.to_string();
        let balanced = POWER_GUID_BALANCED.to_string();
        let pair = |g: &str, n: &str| (g.to_string(), n.to_string());
        let list = vec![pair(&balanced, "Balanced"), pair(&high, "High performance")];
        // on High Performance (built-in or custom duplicate by name)
        assert_eq!(
            power_row_state(&high, "High performance", &list, false),
            RowState::On
        );
        assert_eq!(
            power_row_state("e72c17b6-94d2-4509-adfc-8f2302229d1a", "High performance", &list, false),
            RowState::On
        );
        // Ultimate active (GUID or duplicate by name): hide, nothing above it
        assert_eq!(
            power_row_state(POWER_GUID_ULTIMATE_PERFORMANCE, "Ultimate Performance", &list, false),
            RowState::Hidden
        );
        assert_eq!(
            power_row_state("223d3f55-7a5e-4b4f-9518-861f628282ba", "Ultimate Performance", &list, false),
            RowState::Hidden
        );
        // Balanced, performance present or restorable: plain toggle
        assert_eq!(
            power_row_state(&balanced, "Balanced", &list, false),
            RowState::Off
        );
        assert_eq!(
            power_row_state(&balanced, "Balanced", &[pair(&balanced, "Balanced")], false),
            RowState::Off
        );
        // Balanced-only on S0 firmware: hide, forcing fights the design
        assert_eq!(
            power_row_state(&balanced, "Balanced", std::slice::from_ref(&pair(&balanced, "Balanced")), true),
            RowState::Hidden
        );
    }

    #[test]
    fn pagefile_drive_modes_parsed_like_the_dialog() {
        use super::PagefileMode;
        let sys = PagefileMode::System;
        let off = PagefileMode::Off;
        let unknown = PagefileMode::Unknown;
        // bare and 0 0 both mean system-managed on that drive
        assert_eq!(
            parse_drive_mode(&["C:\\pagefile.sys".into()], "C:"),
            (PagefileMode::System, None, None)
        );
        assert_eq!(
            parse_drive_mode(&["C:\\pagefile.sys 0 0".into()], "C:"),
            (sys, None, None)
        );
        // custom sizes ride along
        assert_eq!(
            parse_drive_mode(&["C:\\pagefile.sys 1024 4096".into()], "C:"),
            (PagefileMode::Custom, Some(1024), Some(4096))
        );
        // other drives never decide this one; missing = off
        assert_eq!(
            parse_drive_mode(&["D:\\pagefile.sys 512 1024".into()], "C:"),
            (off, None, None)
        );
        assert_eq!(parse_drive_mode(&[], "C:"), (off, None, None));
        // the legacy no-drive marker reads as system-managed
        assert_eq!(
            parse_drive_mode(&[r"?:\pagefile.sys".into()], "C:"),
            (sys, None, None)
        );
        // an explicit entry beats the marker
        assert_eq!(
            parse_drive_mode(
                &[r"?:\pagefile.sys".into(), "C:\\pagefile.sys 512 2048".into()],
                "C:"
            ),
            (PagefileMode::Custom, Some(512), Some(2048))
        );
        // malformed shapes are unknown, never guessed into another mode
        assert_eq!(
            parse_drive_mode(&["C:\\pagefile.sys 1024".into()], "C:"),
            (unknown, None, None)
        );
        assert_eq!(
            parse_drive_mode(&["C:\\pagefile.sys a b".into()], "C:"),
            (unknown, None, None)
        );
        assert_eq!(
            parse_drive_mode(&["C:\\pagefile.sys 1 2 3".into()], "C:"),
            (unknown, None, None)
        );
        // drive matching is case-insensitive on the letter
        assert_eq!(
            parse_drive_mode(&["c:\\pagefile.sys 16 16".into()], "C:"),
            (PagefileMode::Custom, Some(16), Some(16))
        );
        // garbage lines never match a drive
        assert_eq!(
            parse_drive_mode(&["garbage".into(), "D:\\pagefile.sys 1 2".into()], "C:"),
            (off, None, None)
        );
    }

    #[test]
    fn pagefile_health_rules() {
        assert!(pagefile_ok("auto", 0));
        assert!(pagefile_ok("manual", 16384));
        assert!(!pagefile_ok("manual", 4096)); // the original real-world bug
        assert!(!pagefile_ok("off", 0));
    }

    #[test]
    fn gamedvr_armed_only_on_background_toggle() {
        // the winreg contract: Option<u32> straight from the registry API
        // factory default (toggle missing) = quiet
        assert!(!gamedvr_armed_winreg(None, None));
        // toggle explicitly off = quiet
        assert!(!gamedvr_armed_winreg(Some(0), None));
        // background toggle explicitly on = armed (the real background cost)
        assert!(gamedvr_armed_winreg(Some(1), None));
        // machine policy forces off over everything
        assert!(!gamedvr_armed_winreg(Some(1), Some(0)));
        // policy present and permissive = armed stays
        assert!(gamedvr_armed_winreg(Some(1), Some(1)));
    }

    #[test]
    fn storagesense_field_contract() {
        // the winreg-era contract, now a real shared function (not a
        // test-local closure): key-exists decides visibility, the DWORD
        // value decides the state, and they are never conflated
        // (a key at 0 is a live OFF, a missing key hides the row)
        // key present, value 1 = ON
        assert_eq!(storage_sense_state(true, Some(1)), Some(true));
        // key present, value 0 = OFF (Settings zeroes the value, never
        // deletes the key — verified live)
        assert_eq!(storage_sense_state(true, Some(0)), Some(false));
        // key present, value missing (never touched) = OFF
        assert_eq!(storage_sense_state(true, None), Some(false));
        // key absent on this build = row hides
        assert_eq!(storage_sense_state(false, None), None);
        assert_eq!(storage_sense_state(false, Some(1)), None);
    }

    #[test]
    fn game_mode_on_needs_both_toggles() {
        // the Settings toggle writes the pair together: ON means both
        // read 1, and a missing value is the OS default (on) — never a
        // false "off" that would flip a user's switch on first sight
        assert!(game_mode_on(Some(1), Some(1)));
        assert!(game_mode_on(None, None));
        assert!(game_mode_on(None, Some(1)));
        assert!(game_mode_on(Some(1), None));
        assert!(!game_mode_on(Some(0), Some(1)));
        assert!(!game_mode_on(Some(1), Some(0)));
        assert!(!game_mode_on(Some(0), Some(0)));
    }

    #[test]
    fn gpu_pref_parses_only_its_own_token() {
        assert_eq!(parse_gpu_pref("GpuPreference=2;"), Some(2));
        assert_eq!(parse_gpu_pref("AutoHDREnable=0;GpuPreference=1;"), Some(1));
        assert_eq!(parse_gpu_pref("GpuPreference=0;"), Some(0));
        // sibling tokens alone carry no preference
        assert_eq!(parse_gpu_pref("AutoHDREnable=1;"), None);
        assert_eq!(parse_gpu_pref(""), None);
        // malformed values are dropped, never guessed
        assert_eq!(parse_gpu_pref("GpuPreference=x;"), None);
        assert_eq!(parse_gpu_pref("GpuPreference=;"), None);
        // case-tolerant key (Windows writes it capitalized; be liberal)
        assert_eq!(parse_gpu_pref("gpupreference=2;"), Some(2));
    }

    #[test]
    fn gpu_pref_build_preserves_other_tokens() {
        // ON sets exactly our token, keeping the rest byte-identical
        assert_eq!(
            with_gpu_pref(None, true).as_deref(),
            Some("GpuPreference=2;")
        );
        assert_eq!(
            with_gpu_pref(Some(""), true).as_deref(),
            Some("GpuPreference=2;")
        );
        assert_eq!(
            with_gpu_pref(Some("AutoHDREnable=0;GpuPreference=1;"), true).as_deref(),
            Some("AutoHDREnable=0;GpuPreference=2;")
        );
        assert_eq!(
            with_gpu_pref(Some("GpuPreference=2;"), true).as_deref(),
            Some("GpuPreference=2;")
        );
        // OFF removes only our token; an emptied value means "delete the
        // value" (revert to Windows decides)
        assert_eq!(with_gpu_pref(Some("GpuPreference=2;"), false), None);
        assert_eq!(
            with_gpu_pref(Some("AutoHDREnable=0;GpuPreference=2;"), false).as_deref(),
            Some("AutoHDREnable=0;")
        );
        assert_eq!(with_gpu_pref(None, false), None);
    }

    #[test]
    fn gpu_state_needs_every_exe() {
        // nothing resolved (GameLoop absent) = row hides, never a guess
        assert_eq!(unanimous_state(&[]), None);
        assert_eq!(unanimous_state(&[true]), Some(true));
        assert_eq!(unanimous_state(&[true, true]), Some(true));
        // partial coverage reads as OFF so the switch never claims
        // coverage it does not have
        assert_eq!(unanimous_state(&[true, false]), Some(false));
        assert_eq!(unanimous_state(&[false]), Some(false));
    }

    #[test]
    fn gpu_pref_supported_needs_win10_1803() {
        // per-app GPU preferences arrived in 1803 (build 17134): older
        // builds ignore the value while our re-read would still verify —
        // fail OPEN on unreadable (match current behavior everywhere),
        // hide only on a positively-identified old build
        assert!(gpu_pref_supported(None));
        assert!(!gpu_pref_supported(Some(10240))); // 1507
        assert!(!gpu_pref_supported(Some(17133)));
        assert!(gpu_pref_supported(Some(17134))); // 1803, the floor
        assert!(gpu_pref_supported(Some(22631)));
    }

    #[test]
    fn exe_dedup_ignores_case() {
        // Windows paths compare case-insensitively, PathBuf equality
        // does not: `UI\aow_exe.exe` and `ui\aow_exe.exe` are the same
        // file (live-proven: exes=4 for 2 files), and counting both
        // doubles every write/verify with a lying count
        use std::path::PathBuf;
        let have = vec![PathBuf::from(r"C:\G\ui\aow_exe.exe")];
        assert!(contains_case_insensitive(&have, &PathBuf::from(r"C:\G\UI\AOW_EXE.EXE")));
        assert!(!contains_case_insensitive(&have, &PathBuf::from(r"C:\G\ui\other.exe")));
        assert!(!contains_case_insensitive(&[], &PathBuf::from(r"C:\G\ui\aow_exe.exe")));
    }

    #[test]
    fn fso_flag_matches_whole_tokens() {
        assert!(fso_has_flag(Some("~ DISABLEDXMAXIMIZEDWINDOWEDMODE")));
        assert!(!fso_has_flag(Some("~ HIGHDPIAWARE")));
        assert!(!fso_has_flag(None));
        assert!(!fso_has_flag(Some("")));
    }

    #[test]
    fn fso_build_preserves_other_flags() {
        assert_eq!(
            fso_with_flag(None, true).as_deref(),
            Some("~ DISABLEDXMAXIMIZEDWINDOWEDMODE")
        );
        assert_eq!(
            fso_with_flag(Some("~ HIGHDPIAWARE"), true).as_deref(),
            Some("~ HIGHDPIAWARE DISABLEDXMAXIMIZEDWINDOWEDMODE")
        );
        // already set: byte-identical, no duplicate token
        assert_eq!(
            fso_with_flag(Some("~ DISABLEDXMAXIMIZEDWINDOWEDMODE"), true).as_deref(),
            Some("~ DISABLEDXMAXIMIZEDWINDOWEDMODE")
        );
        // OFF removes only our flag; an emptied value means "delete it"
        assert_eq!(
            fso_with_flag(Some("~ DISABLEDXMAXIMIZEDWINDOWEDMODE"), false),
            None
        );
        assert_eq!(
            fso_with_flag(
                Some("~ HIGHDPIAWARE DISABLEDXMAXIMIZEDWINDOWEDMODE"),
                false
            )
            .as_deref(),
            Some("~ HIGHDPIAWARE")
        );
        assert_eq!(fso_with_flag(None, false), None);
    }

    #[test]
    fn mouse_accel_off_needs_all_three_zero() {
        assert!(mouse_accel_off(Some(0), Some(0), Some(0)));
        // anything missing is the OS default (precision on), so the
        // switch reads off — never a false "already off"
        assert!(!mouse_accel_off(None, None, None));
        assert!(!mouse_accel_off(Some(0), Some(0), Some(6)));
        assert!(!mouse_accel_off(Some(1), Some(6), Some(10)));
    }

    #[test]
    fn windowed_opt_reads_exactly_one() {
        // ON is exactly `=1`; anything else (absent, 0, garbage) is off —
        // the verified-live OFF state is a present `=0`, not absence
        assert!(wgc_opt_on(Some("SwapEffectUpgradeEnable=1;")));
        assert!(!wgc_opt_on(Some("SwapEffectUpgradeEnable=0;")));
        assert!(!wgc_opt_on(None));
        assert!(!wgc_opt_on(Some("")));
        assert!(!wgc_opt_on(Some("GpuPreference=2;")));
    }

    #[test]
    fn windowed_opt_build_writes_zero_on_off() {
        // unlike the per-exe GPU preference (whose off DELETES the token),
        // off here writes `=0`: byte-for-byte what the Settings toggle
        // itself does (verified live — off leaves the value present)
        assert_eq!(
            with_wgc_token(None, true),
            "SwapEffectUpgradeEnable=1;"
        );
        assert_eq!(
            with_wgc_token(Some("SwapEffectUpgradeEnable=0;"), true),
            "SwapEffectUpgradeEnable=1;"
        );
        assert_eq!(
            with_wgc_token(Some("SwapEffectUpgradeEnable=1;"), false),
            "SwapEffectUpgradeEnable=0;"
        );
        assert_eq!(
            with_wgc_token(None, false),
            "SwapEffectUpgradeEnable=0;"
        );
        // sibling tokens survive both directions
        assert_eq!(
            with_wgc_token(Some("GpuPreference=2;"), true),
            "GpuPreference=2;SwapEffectUpgradeEnable=1;"
        );
        assert_eq!(
            with_wgc_token(
                Some("GpuPreference=2;SwapEffectUpgradeEnable=1;"),
                false
            ),
            "GpuPreference=2;SwapEffectUpgradeEnable=0;"
        );
    }

    #[test]
    fn windowed_opt_supported_needs_win11() {
        // the Settings toggle does not exist before Win11 (RTM 22000):
        // unreadable build fails OPEN like every other gate here, only a
        // positively-identified old build hides the row
        assert!(windowed_opt_supported(None));
        assert!(!windowed_opt_supported(Some(19045))); // Win10 22H2
        assert!(!windowed_opt_supported(Some(21999)));
        assert!(windowed_opt_supported(Some(22000))); // Win11 RTM, the floor
        assert!(windowed_opt_supported(Some(26200)));
    }

    #[test]
    fn pref_token_parser_is_generic() {
        // the shared parser behind both GPU and windowed prefs: exact key,
        // tolerant key case, strict value
        assert_eq!(parse_pref_token("SwapEffectUpgradeEnable=1;", "SwapEffectUpgradeEnable"), Some(1));
        assert_eq!(parse_pref_token("swapeffectupgradeenable=0;", "SwapEffectUpgradeEnable"), Some(0));
        assert_eq!(parse_pref_token("GpuPreference=2;", "SwapEffectUpgradeEnable"), None);
        assert_eq!(parse_pref_token("SwapEffectUpgradeEnable=x;", "SwapEffectUpgradeEnable"), None);
        assert_eq!(parse_pref_token("", "SwapEffectUpgradeEnable"), None);
    }
}
