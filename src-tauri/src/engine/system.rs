// system.rs — one-shot, read-only system queries: rig info, top processes,
// environment checks. Nothing here ever modifies the user's machine.

use std::fs;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const NO_WINDOW: u32 = 0x0800_0000;

/// PowerShell runner shared with the tweaks writer (crate-visible so the
/// write path reuses the exact same spawn flags, never its own variant).
/// Bounded: a hung powershell.exe fails after PS_TIMEOUT instead of
/// blocking the caller forever (only the availability probe had a
/// deadline before; every other query waited indefinitely). stderr is
/// captured for the error message only, never shown to the user.
/// PowerShell poll budget (platform-independent bound).
const PS_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);
/// Hardware inventory runs four CIM providers at once and is paid once per
/// machine (then disk-cached): a longer bound than the 15s poll budget.
const PS_INVENTORY_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);
/// Machine key surfaced to the UI when a PowerShell query exceeds its
/// deadline (keys, not sentences: the locales turn this into language).
pub const POWERSHELL_TIMEOUT: &str = "POWERSHELL_TIMEOUT";
/// A PowerShell timeout becomes the machine key above (logged by the caller
/// first, so the log keeps the original detail); any other error passes
/// through untouched.
fn map_ps_timeout(err: String) -> String {
    if err.contains("timed out") {
        POWERSHELL_TIMEOUT.into()
    } else {
        err
    }
}
pub(crate) fn ps(script: &str) -> Result<String, String> {
    ps_with_timeout(script, PS_TIMEOUT)
}
pub(crate) fn ps_with_timeout(
    script: &str,
    timeout: std::time::Duration,
) -> Result<String, String> {
    #[cfg(windows)]
    let mut child = super::sampler::spawn_tracked(
        Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(NO_WINDOW))
        .map_err(|e| format!("powershell spawn failed: {e}"))?;
    #[cfg(not(windows))]
    let mut child = super::sampler::spawn_tracked(
        Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped()))
        .map_err(|e| format!("powershell spawn failed: {e}"))?;
    let deadline = std::time::Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let mut err = String::new();
                if let Some(stderr) = child.stderr.take() {
                    use std::io::Read;
                    let _ = std::io::BufReader::new(stderr).read_to_string(&mut err);
                }
                if !status.success() {
                    let hint: String = err.lines().next().unwrap_or("").trim().chars().take(160).collect();
                    if hint.is_empty() {
                        return Err("powershell exited nonzero".into());
                    }
                    return Err(format!("powershell exited nonzero: {hint}"));
                }
                let mut out = String::new();
                if let Some(stdout) = child.stdout.take() {
                    use std::io::Read;
                    let _ = std::io::BufReader::new(stdout).read_to_string(&mut out);
                }
                return Ok(out);
            }
            Ok(None) => {
                if std::time::Instant::now() >= deadline {
                    let _ = child.kill();
                    return Err("powershell timed out".into());
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            Err(e) => return Err(format!("powershell wait failed: {e}")),
        }
    }
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
        let Ok(mut child) = super::sampler::spawn_tracked(Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", "Write-Output ok"])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .creation_flags(NO_WINDOW))
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
use std::collections::HashMap;

static SYSTEM_CACHE: OnceLock<SystemInfo> = OnceLock::new();
const SYSTEM_CACHE_MAX_AGE: std::time::Duration = std::time::Duration::from_secs(30 * 86_400);
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
    let path = system_cache_path();
    let modified = fs::metadata(&path).ok()?.modified().ok()?;
    if modified.elapsed().ok()? > SYSTEM_CACHE_MAX_AGE {
        super::logging::info("rig profile disk cache expired");
        return None;
    }
    let text = fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

/// Persist the rig profile. Best effort — a failed write only means the next
/// launch pays the query cost again. Atomic like the settings store: a
/// crash mid-write must not leave a half-written cache behind.
fn save_system_cache(info: &SystemInfo) {
    let _ = fs::create_dir_all(super::storage::app_dir());
    if let Ok(body) = serde_json::to_string(info) {
        if let Err(e) = super::storage::write_file_atomic(&system_cache_path(), body.as_bytes()) {
            super::logging::warn(&format!("rig profile cache write failed: {e}"));
        }
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
    if let Some(info) = SYSTEM_CACHE.get() {
        if info.ram_gb <= 0.0 {
            return None;
        }
        return Some((info.ram_gb * 1024.0, info.disks.len().max(1) as u32));
    }
    // first call before the async warm-up: read the disk file once and
    // seed the memory cache with it, so later calls in this run stop
    // paying a file read + JSON parse every time.
    let info = load_system_cache()?;
    if info.ram_gb <= 0.0 {
        return None;
    }
    let out = (info.ram_gb * 1024.0, info.disks.len().max(1) as u32);
    let _ = SYSTEM_CACHE.set(info);
    Some(out)
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
static TOP_PROCESSES_CACHE: TtlCache<TopProcesses> = TtlCache::new();
/// system checks: power plan/pagefile/battery — people don't flip these
/// mid-session; a longer window is fine
static SYSTEM_CHECKS_CACHE: TtlCache<SystemChecks> = TtlCache::new();

/// How long a top-processes snapshot stays fresh.
const TOP_PROCESSES_TTL: std::time::Duration = std::time::Duration::from_secs(10);
/// How long a system-checks read stays fresh.
const SYSTEM_CHECKS_TTL: std::time::Duration = std::time::Duration::from_secs(30);

/// one background refresh in flight at a time per cache: rapid tab flips
/// past the TTL used to spawn an unbounded burst of powershell.exe
/// processes. A skipped spawn just serves the stale copy once more.
static TOP_REFRESHING: AtomicBool = AtomicBool::new(false);
static CHECKS_REFRESHING: AtomicBool = AtomicBool::new(false);
static TOP_QUERY_LOCK: Mutex<()> = Mutex::new(());
static CHECKS_QUERY_LOCK: Mutex<()> = Mutex::new(());

fn query_top_processes_serialized() -> Result<TopProcesses, String> {
    let _guard = TOP_QUERY_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    query_top_processes()
}

fn query_system_checks_serialized() -> Result<SystemChecks, String> {
    let _guard = CHECKS_QUERY_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    query_system_checks()
}
/// top processes with TTL: returns the cached copy immediately when one
/// exists (even stale) and refreshes in the background past the TTL.
pub fn top_processes_cached() -> Result<TopProcesses, String> {
    if let Some(cached) = TOP_PROCESSES_CACHE.get() {
        // stale — serve the copy now, refresh in the background
        if !TOP_PROCESSES_CACHE.fresh_for(TOP_PROCESSES_TTL)
            && TOP_REFRESHING
                .compare_exchange(false, true, Ordering::Relaxed, Ordering::Relaxed)
                .is_ok()
        {
            std::thread::spawn(|| {
                if let Ok(fresh) = query_top_processes_serialized() {
                    TOP_PROCESSES_CACHE.set(fresh);
                }
                TOP_REFRESHING.store(false, Ordering::Relaxed);
            });
        }
        return Ok(cached);
    }
    // first call on this run: pay the cost once, synchronously
    let fresh = query_top_processes_serialized()?;
    TOP_PROCESSES_CACHE.set(fresh.clone());
    Ok(fresh)
}

/// top processes, bypassing the cache: a synchronous fresh read for the
/// manual refresh button (the cached path would return the same numbers
/// the silent poll already shows). Warms the cache so the next silent
/// poll doesn't flash older numbers right after a manual refresh.
pub fn top_processes_fresh() -> Result<TopProcesses, String> {
    let fresh = query_top_processes_serialized()?;
    TOP_PROCESSES_CACHE.set(fresh.clone());
    Ok(fresh)
}

/// System checks with TTL: same stale-while-revalidate pattern.
pub fn system_checks_cached() -> Result<SystemChecks, String> {
    if let Some(cached) = SYSTEM_CHECKS_CACHE.get() {
        if !SYSTEM_CHECKS_CACHE.fresh_for(SYSTEM_CHECKS_TTL)
            && CHECKS_REFRESHING
                .compare_exchange(false, true, Ordering::Relaxed, Ordering::Relaxed)
                .is_ok()
        {
            std::thread::spawn(|| {
                if let Ok(fresh) = query_system_checks_serialized() {
                    SYSTEM_CHECKS_CACHE.set(fresh);
                }
                CHECKS_REFRESHING.store(false, Ordering::Relaxed);
            });
        }
        return Ok(cached);
    }
    let fresh = query_system_checks_serialized()?;
    SYSTEM_CHECKS_CACHE.set(fresh.clone());
    Ok(fresh)
}

/// System checks, bypassing the cache: a synchronous fresh read for the
/// manual refresh button (same contract as top_processes_fresh).
pub fn system_checks_fresh() -> Result<SystemChecks, String> {
    let fresh = query_system_checks_serialized()?;
    SYSTEM_CHECKS_CACHE.set(fresh.clone());
    Ok(fresh)
}

/// Windows directory from the kernel, never the environment: inherited
/// env vars (`windir`, `SystemRoot`) belong to the parent chain, while
/// elevated writes and cleanup roots must resolve against the OS itself.
/// Falls back to `C:\Windows` when unreadable (same fail-soft as every
/// other OS fact here).
pub fn windows_dir() -> std::path::PathBuf {
    #[cfg(windows)]
    {
        let mut buf = vec![0u16; 260];
        let len = unsafe { GetSystemWindowsDirectoryW(buf.as_mut_ptr(), buf.len() as u32) };
        if len > 0 && (len as usize) < buf.len() {
            if let Ok(s) = String::from_utf16(&buf[..len as usize]) {
                if !s.is_empty() {
                    return std::path::PathBuf::from(s);
                }
            }
        }
    }
    std::path::PathBuf::from(r"C:\Windows")
}

/// System32 from the kernel (same source as [`windows_dir`]).
pub fn system32_dir() -> std::path::PathBuf {
    windows_dir().join("System32")
}

/// Absolute path of a Windows tool: bare exe names resolve through the
/// caller-visible search order, so elevated spawns name their binary
/// exactly (a planted file can never preempt System32). Pure join over
/// [`system32_dir`].
pub fn system32_exe(name: &str) -> std::path::PathBuf {
    system32_dir().join(name)
}

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn GetSystemWindowsDirectoryW(buf: *mut u16, size: u32) -> u32;
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
    let checks = tauri::async_runtime::spawn_blocking(query_system_checks_serialized);
    let procs = tauri::async_runtime::spawn_blocking(query_top_processes_serialized);
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
    /// driver version string (Win32_VideoController), shown when present
    pub driver: Option<String>,
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
    pub cpu: CpuInfo,
    pub gpus: Vec<GpuInfo>,
    pub ram: RamInfo,
    pub disks: Vec<DiskInfo>,
    pub display: DisplayInfo,
    pub system: SystemIdentity,
    /// RAM GB kept flat for the machine profile (same number as ram.total_gb)
    pub ram_gb: f64,
    /// can the tool read NVIDIA GPU counters? (false on AMD/Intel-only machines)
    pub gpu_counters: bool,
    /// is PowerShell usable? (false = limited mode: defaults, UTC-ish timestamps,
    /// muted GPU window checks — the UI surfaces this honestly)
    pub powershell_available: bool,
}

/// Processor identity: name plus the spec lines the rig card shows.
/// Anything unreadable is None and renders as "--", never a guess.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CpuInfo {
    pub name: String,
    pub mhz: Option<u32>,
    pub cores: Option<u32>,
    pub threads: Option<u32>,
}

/// Memory: total plus the spec lines (first stick wins — mixed kits are
/// rare, and the total is what sizing decisions use).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RamInfo {
    pub total_gb: f64,
    pub mem_type: Option<String>,
    pub speed_mhz: Option<u32>,
}

/// Primary display: bounds plus refresh and DPI scale. All optional —
/// headless sessions and exotic drivers omit freely.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DisplayInfo {
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub refresh_hz: Option<u32>,
    pub scale_pct: Option<u32>,
}

/// Machine identity for the device-and-system card.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SystemIdentity {
    pub manufacturer: String,
    pub model: String,
    pub os_caption: String,
    pub os_release: String,
    pub directx: String,
}

/// NVIDIA VRAM in MB via nvidia-smi. Win32_VideoController.AdapterRAM is a
/// 32-bit field: anything above 4 GB wraps and lies. nvidia-smi reports the
/// truth; CIM stays as the fallback for non-NVIDIA machines.
fn nvidia_vram_mb() -> Option<f64> {
    #[cfg(windows)]
    let out = super::sampler::output_tracked(Command::new("nvidia-smi")
        .args(["--query-gpu=memory.total", "--format=csv,noheader,nounits"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(NO_WINDOW), std::time::Duration::from_secs(5))
        .ok()?;
    #[cfg(not(windows))]
    return None;
    #[cfg(windows)]
    {
        // multi-GPU machines print one value per line ("8192\n8192"):
        // parsing the whole blob as one number always failed and fell
        // back to the 32-bit CIM field. The primary GPU is the first line.
        let text = String::from_utf8_lossy(&out.stdout);
        text.lines().next()?.trim().parse::<f64>().ok()
    }
}

/// SMBIOS memory-device type codes to marketing names (only the
/// well-documented values — anything else reads as unknown, never a guess).
fn memory_type_name(code: u32) -> Option<&'static str> {
    match code {
        24 => Some("DDR3"),
        26 => Some("DDR4"),
        28 => Some("LPDDR"),
        30 => Some("LPDDR3"),
        31 => Some("LPDDR4"),
        34 => Some("DDR5"),
        35 => Some("LPDDR5"),
        _ => None,
    }
}

/// Primary-display DPI scale from the logon value (96 = 100%).
/// Per-monitor awareness may differ; missing reads as unknown.
fn display_scale_pct() -> Option<u32> {
    let px: u32 = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER)
        .open_subkey(r"Control Panel\Desktop")
        .ok()?
        .get_value("LogPixels")
        .ok()?;
    if px == 0 {
        return None;
    }
    Some((px * 100).div_ceil(96))
}

/// DirectX support level: the D3D12 runtime ships with Windows 10+ as an
/// OS component, so its presence honestly reads as DirectX 12 capable
/// (no feature-level claim is made). File check, microseconds.
fn directx_level() -> &'static str {
    let system32 = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
    if std::path::Path::new(&system32).join("System32").join("d3d12.dll").is_file() {
        "DirectX 12"
    } else {
        "DirectX 11"
    }
}

pub fn query_system_info() -> Result<SystemInfo, String> {
    let text = ps_with_timeout(
        r#"
$pr = Get-CimInstance Win32_Processor | Select-Object -First 1
"cpu|$($pr.Name)|$($pr.MaxClockSpeed)|$($pr.NumberOfCores)|$($pr.NumberOfLogicalProcessors)"
Get-CimInstance Win32_VideoController | ForEach-Object { "gpu|$($_.Name)|$([math]::Round($_.AdapterRAM/1GB,1))|$($_.DriverVersion)" }
"ram|$([math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory/1GB,1))"
$pm = Get-CimInstance Win32_PhysicalMemory | Select-Object -First 1
"rammod|$($pm.SMBIOSMemoryType)|$($pm.Speed)"
Get-PhysicalDisk | ForEach-Object { "disk|$($_.FriendlyName)|$($_.MediaType)|$($_.BusType)|$([math]::Round($_.Size/1GB,0))" }
$cs = Get-CimInstance Win32_ComputerSystem
"sys|$($cs.Manufacturer)|$($cs.Model)"
$os = Get-CimInstance Win32_OperatingSystem
"os|$($os.Caption)|$($os.BuildNumber)"
Add-Type -AssemblyName System.Windows.Forms
$s = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
"disp|$($s.Width)|$($s.Height)"
$vr = (Get-CimInstance Win32_VideoController | Where-Object { $_.CurrentRefreshRate -gt 0 } | Select-Object -First 1).CurrentRefreshRate
"refr|$vr"
"#,
        PS_INVENTORY_TIMEOUT,
    )
    .map_err(|e| {
        super::logging::warn(&format!("system inventory failed: {e}"));
        map_ps_timeout(e)
    })?;
    let mut info = SystemInfo {
        cpu: CpuInfo {
            name: String::new(),
            mhz: None,
            cores: None,
            threads: None,
        },
        gpus: Vec::new(),
        ram: RamInfo {
            total_gb: 0.0,
            mem_type: None,
            speed_mhz: None,
        },
        disks: Vec::new(),
        display: DisplayInfo {
            width: None,
            height: None,
            refresh_hz: None,
            scale_pct: display_scale_pct(),
        },
        system: SystemIdentity {
            manufacturer: String::new(),
            model: String::new(),
            os_caption: "Windows".into(),
            os_release: String::new(),
            directx: directx_level().into(),
        },
        ram_gb: 0.0,
        gpu_counters: super::sampler::query_gpu_max_clocks().is_some(),
        powershell_available: powershell_available(),
    };
    // truthful VRAM for NVIDIA cards (AdapterRAM lies above 4 GB)
    let nv_vram_mb = nvidia_vram_mb();
    for line in text.lines().map(|l| l.trim()).filter(|l| !l.is_empty()) {
        let mut parts = line.split('|');
        match parts.next() {
            Some("cpu") => {
                info.cpu.name = parts.next().unwrap_or("Unknown").trim().to_string();
                info.cpu.mhz = parts.next().and_then(|v| v.trim().parse().ok());
                info.cpu.cores = parts.next().and_then(|v| v.trim().parse().ok());
                info.cpu.threads = parts.next().and_then(|v| v.trim().parse().ok());
            }
            Some("gpu") => {
                let name = parts.next().unwrap_or("").trim().to_string();
                let cim_vram = parts.next().and_then(|v| v.trim().parse::<f64>().ok());
                let driver = parts
                    .next()
                    .map(|v| v.trim().to_string())
                    .filter(|s| !s.is_empty());
                // NVIDIA + a truthful nvidia-smi reading beats the 32-bit cap
                let vram = match (name.to_lowercase().contains("nvidia"), nv_vram_mb) {
                    (true, Some(mb)) => Some(mb / 1024.0),
                    _ => cim_vram,
                };
                info.gpus.push(GpuInfo {
                    name,
                    vram_gb: vram,
                    driver,
                });
            }
            Some("ram") => {
                let total = parts
                    .next()
                    .and_then(|v| v.trim().parse().ok())
                    .unwrap_or(0.0);
                info.ram.total_gb = total;
                info.ram_gb = total;
            }
            Some("rammod") => {
                info.ram.mem_type = parts
                    .next()
                    .and_then(|v| v.trim().parse::<u32>().ok())
                    .and_then(memory_type_name)
                    .map(str::to_string);
                info.ram.speed_mhz = parts.next().and_then(|v| v.trim().parse().ok());
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
            Some("sys") => {
                let manu = parts.next().unwrap_or("").trim().to_string();
                let model = parts.next().unwrap_or("").trim().to_string();
                if !manu.is_empty() {
                    info.system.manufacturer = manu;
                }
                if !model.is_empty() {
                    info.system.model = model;
                }
            }
            Some("os") => {
                let caption = parts.next().unwrap_or("").trim().to_string();
                if !caption.is_empty() {
                    // "Microsoft Windows 11 Pro" → compact display form
                    info.system.os_caption =
                        caption.strip_prefix("Microsoft ").unwrap_or(&caption).to_string();
                }
                let build = parts.next().unwrap_or("").trim().to_string();
                info.system.os_release = os_release_name(&build);
            }
            Some("disp") => {
                info.display.width = parts.next().and_then(|v| v.trim().parse().ok());
                info.display.height = parts.next().and_then(|v| v.trim().parse().ok());
            }
            Some("refr") => {
                info.display.refresh_hz = parts.next().and_then(|v| v.trim().parse().ok());
            }
            _ => {}
        }
    }
    Ok(info)
}

/// OS release line: marketing DisplayVersion when present (25H2),
/// otherwise the build number (never blank, never guessed).
fn os_release_name(build: &str) -> String {
    let display: Option<String> = winreg::RegKey::predef(winreg::enums::HKEY_LOCAL_MACHINE)
        .open_subkey(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion")
        .ok()
        .and_then(|k| k.get_value::<String, _>("DisplayVersion").ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    match display {
        Some(d) => d,
        None if build.is_empty() => String::new(),
        None => format!("build {build}"),
    }
}

// ---------------------------------------------------------------------------
// Top processes — who is eating the machine (GameLoop excluded: that's the game)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, serde::Serialize)]
pub struct TopProcess {
    pub name: String,
    pub pid: u32,
    /// every live PID in this group (hottest first): End task stops the
    /// whole app, not one worker (a Chromium child alone never ends the
    /// browser). Single-process apps carry exactly one PID.
    pub pids: Vec<u32>,
    /// % of TOTAL CPU (normalized across all logical cores), 1s average
    pub cpu_pct: f64,
    pub ram_mb: f64,
    /// "app" (user software, safe to close before playing) or "system"
    /// (leave running) — decided by classify() below, never guessed
    pub kind: String,
    /// curated display key (e.g. "procPowershell") when the exe is a
    /// known OS staple; the UI translates it, else falls back below
    pub display_key: Option<String>,
    /// ProductName from the exe itself, else the raw process name:
    /// always present, never invented
    pub display_name: String,
}

/// The top-process answer: ranked rows plus honest background totals.
/// Totals accumulate over EVERY non-excluded process (not just the
/// displayed top 12) in the same pass, so the header never understates
/// the background load the truncated list cannot show.
#[derive(Debug, Clone, serde::Serialize)]
pub struct TopProcesses {
    pub processes: Vec<TopProcess>,
    pub total_cpu: f64,
    pub total_ram_mb: f64,
}

/// App vs system, fail-safe toward system: an unidentifiable process is
/// "leave running" guidance, never a close suggestion. Session 0 hosts
/// services; anything under the Windows dir is OS-owned; a missing path
/// (protected processes hide it even from admins) tells us nothing, so
/// it also reads as system. Only a known non-system path earns "app".
pub fn classify_process(session: Option<u32>, path: Option<&str>, windir: &str) -> &'static str {
    if session == Some(0) {
        return "system";
    }
    match path {
        Some(p) if !p.is_empty() => {
            if p.to_ascii_lowercase().starts_with(&windir.to_ascii_lowercase()) {
                "system"
            } else {
                "app"
            }
        }
        _ => "system",
    }
}

/// Group per-process rows by exe stem (case-insensitive): one program,
/// one row. CPU/RAM sum, member PIDs ride hottest-first, the hottest
/// member lends its name/path/display. Kind fails safe: every member
/// must read app, else the group reads system (a shared worker pool is
/// never a close suggestion). Pure: the poll shapes, this math folds.
fn group_by_exe(rows: Vec<(TopProcess, Option<String>)>) -> Vec<(TopProcess, Option<String>)> {
    // acc row + its path + its hottest member CPU (the face follows heat,
    // not arrival order: a late hot worker still lends name and path)
    let mut groups: HashMap<String, (TopProcess, Option<String>, f64)> = HashMap::new();
    for (row, path) in rows {
        let key = row.name.to_ascii_lowercase();
        match groups.get_mut(&key) {
            Some((acc, acc_path, heat)) => {
                acc.cpu_pct += row.cpu_pct;
                acc.ram_mb += row.ram_mb;
                acc.pids.push(row.pid);
                if row.kind != "app" {
                    acc.kind = "system".into();
                }
                if row.cpu_pct > *heat {
                    *heat = row.cpu_pct;
                    acc.pid = row.pid;
                    acc.name = row.name.clone();
                    acc.display_key = row.display_key.clone();
                    acc.display_name = row.display_name.clone();
                    *acc_path = path.clone();
                }
            }
            None => {
                let heat = row.cpu_pct;
                groups.insert(key, (row, path, heat));
            }
        }
    }
    let mut out: Vec<(TopProcess, Option<String>)> = groups
        .into_values()
        .map(|(row, path, _)| (row, path))
        .collect();
    for (row, _) in &mut out {
        // representative (hottest) PID first, the rest ascending: the
        // confirm and the icon read position zero, the kill loops all
        let rep = row.pid;
        row.pids.sort_unstable();
        row.pids.retain(|&p| p != rep);
        row.pids.insert(0, rep);
    }
    out
}

/// Display order: RAM desc. RAM is a level (stable across polls), CPU
/// is a delta (noisy across polls) — ranking by CPU reshuffled the list
/// every refresh while ranking by RAM holds it still. Bounded at 12
/// (bounded everything). Pure.
fn rank_groups(
    mut rows: Vec<(TopProcess, Option<String>)>,
) -> Vec<(TopProcess, Option<String>)> {
    rows.sort_by(|a, b| {
        b.0.ram_mb
            .partial_cmp(&a.0.ram_mb)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    rows.truncate(12);
    rows
}

/// One live process sighting from the native snapshot: identity plus
/// the counters the answer folds. No spawn anywhere in this path.
struct RawProc {
    pid: u32,
    name: String,
    ppid: u32,
    session: Option<u32>,
    path: Option<String>,
    cpu_100ns: u64,
    ram_mb: f64,
}

/// Previous CPU clock per PID (100ns kernel+user) plus when seen: the
/// second point every percentage needs. Pruned to live PIDs each poll,
/// so the map never grows across weeks.
static CPU_PREV: OnceLock<Mutex<HashMap<u32, (u64, std::time::Instant)>>> = OnceLock::new();

fn cpu_prev() -> &'static Mutex<HashMap<u32, (u64, std::time::Instant)>> {
    CPU_PREV.get_or_init(|| Mutex::new(HashMap::new()))
}

/// CPU% from two 100ns clocks over wall seconds on N cores. Zero wall
/// reads zero (same instant sampled twice), a backwards clock saturates
/// to zero — never NaN, never negative. Pure.
fn cpu_percent(prev_100ns: u64, cur_100ns: u64, wall_secs: f64, cores: f64) -> f64 {
    if wall_secs <= 0.0 || cores <= 0.0 {
        return 0.0;
    }
    let delta_secs = cur_100ns.saturating_sub(prev_100ns) as f64 / 10_000_000.0;
    ((delta_secs / wall_secs / cores * 100.0) * 10.0).round() / 10.0
}

/// Native process snapshot: Toolhelp for identity/parentage, then one
/// limited-information handle per PID for times, memory, path, session.
/// Unopenable processes (protected) are absent — same fail-safe as the
/// missing-path rule below (unknown reads as system when classifiable,
/// invisible otherwise). Totals therefore cover the readable set.
#[cfg(windows)]
fn native_snapshot() -> Result<Vec<RawProc>, String> {
    let entries = super::prockill::snapshot_entries();
    if entries.is_empty() {
        return Err("process snapshot failed".into());
    }
    let mut out = Vec::with_capacity(entries.len());
    for e in entries {
        if let Some(raw) = query_one(e) {
            out.push(raw);
        }
    }
    Ok(out)
}

/// Non-Windows builds have no Toolhelp: same failure class as every
/// other Windows-only reader (an honest error, never an empty list
/// pretending the machine is idle).
#[cfg(not(windows))]
fn native_snapshot() -> Result<Vec<RawProc>, String> {
    Err("top processes needs Windows".into())
}

/// One PID's counters through a single limited-information handle.
/// None when unopenable (protected): the caller drops the row.
#[cfg(windows)]
fn query_one(e: super::prockill::ProcEntry) -> Option<RawProc> {
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, e.pid);
        if handle.is_null() {
            return None;
        }
        let mut creation = FILETIME { low: 0, high: 0 };
        let mut exit = FILETIME { low: 0, high: 0 };
        let mut kernel = FILETIME { low: 0, high: 0 };
        let mut user = FILETIME { low: 0, high: 0 };
        let times_ok = GetProcessTimes(
            handle,
            &mut creation,
            &mut exit,
            &mut kernel,
            &mut user,
        ) != 0;
        let mut counters: PROCESS_MEMORY_COUNTERS = std::mem::zeroed();
        counters.cb = std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
        let mem_ok = GetProcessMemoryInfo(
            handle,
            &mut counters,
            counters.cb,
        ) != 0;
        let mut path_buf = vec![0u16; 1024];
        let mut path_len = 1024u32;
        let path = if QueryFullProcessImageNameW(handle, 0, path_buf.as_mut_ptr(), &mut path_len) != 0 {
            String::from_utf16(&path_buf[..path_len as usize]).ok()
        } else {
            None
        };
        CloseHandle(handle);
        if !times_ok || !mem_ok {
            return None;
        }
        let mut session = 0u32;
        let session = if ProcessIdToSessionId(e.pid, &mut session) != 0 {
            Some(session)
        } else {
            None
        };
        let cpu_100ns =
            ((kernel.high as u64) << 32 | kernel.low as u64) + ((user.high as u64) << 32 | user.low as u64);
        Some(RawProc {
            pid: e.pid,
            name: e.name,
            ppid: e.ppid,
            session,
            path,
            cpu_100ns,
            ram_mb: counters.working_set_size as f64 / 1_048_576.0,
        })
    }
}

/// Canonical Win32 spelling (same deliberate allow as the icon
/// structs in icons.rs and SHELLEXECUTEINFOW in elevate.rs).
#[cfg(windows)]
#[allow(clippy::upper_case_acronyms)]
#[repr(C)]
struct FILETIME {
    low: u32,
    high: u32,
}

#[cfg(windows)]
#[repr(C)]
struct PROCESS_MEMORY_COUNTERS {
    cb: u32,
    page_fault_count: u32,
    peak_working_set_size: usize,
    working_set_size: usize,
    quota_peak_paged_pool_usage: usize,
    quota_paged_pool_usage: usize,
    quota_peak_non_paged_pool_usage: usize,
    quota_non_paged_pool_usage: usize,
    pagefile_usage: usize,
    peak_pagefile_usage: usize,
}

#[cfg(windows)]
const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn OpenProcess(desired: u32, inherit: i32, pid: u32) -> *mut core::ffi::c_void;
    fn CloseHandle(handle: *mut core::ffi::c_void) -> i32;
    fn GetProcessTimes(
        handle: *mut core::ffi::c_void,
        creation: *mut FILETIME,
        exit: *mut FILETIME,
        kernel: *mut FILETIME,
        user: *mut FILETIME,
    ) -> i32;
    fn ProcessIdToSessionId(pid: u32, session: *mut u32) -> i32;
    fn QueryFullProcessImageNameW(
        handle: *mut core::ffi::c_void,
        flags: u32,
        name: *mut u16,
        size: *mut u32,
    ) -> i32;
}

#[cfg(windows)]
#[link(name = "psapi")]
extern "system" {
    fn GetProcessMemoryInfo(
        handle: *mut core::ffi::c_void,
        counters: *mut PROCESS_MEMORY_COUNTERS,
        cb: u32,
    ) -> i32;
}

pub fn query_top_processes() -> Result<TopProcesses, String> {
    // Fully native: one Toolhelp pass plus one limited handle per PID.
    // No PowerShell spawn per poll (the old one-second-plus cost center,
    // and the phantom PowerShell row it measured into its own answer).
    // CPU% still needs two points in time, so the previous clocks live
    // in the map below and newcomers read zero on first sighting.
    let raws = native_snapshot().map_err(|e| {
        super::logging::warn(&format!("top processes query failed: {e}"));
        e
    })?;
    let cores = std::thread::available_parallelism()
        .map(|n| n.get() as f64)
        .unwrap_or(1.0);
    let now = std::time::Instant::now();
    let windir = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
    // self-measurement guard (generic on every machine): our own PID
    // plus anything parented to us (WebView hosts and any probe we ever
    // spawn) is the tool's own cost, never user background load.
    // Parentage rides the same snapshot, no second one.
    let own_pid = std::process::id();
    let mut prev = cpu_prev().lock().unwrap_or_else(|p| p.into_inner());
    // prune the dead first so the map never grows across weeks
    let live: std::collections::HashSet<u32> = raws.iter().map(|r| r.pid).collect();
    prev.retain(|pid, _| live.contains(pid));
    // rows travel with their exe path (never leaves the engine: paths can
    // contain the user name) until display names resolve below
    let mut rows: Vec<(TopProcess, Option<String>)> = Vec::new();
    let mut total_cpu = 0.0;
    let mut total_ram_mb = 0.0;
    for raw in raws {
        let pct = match prev.get(&raw.pid) {
            Some((t0, at)) => cpu_percent(*t0, raw.cpu_100ns, (now - *at).as_secs_f64(), cores),
            None => 0.0,
        };
        prev.insert(raw.pid, (raw.cpu_100ns, now));
        // the game (all GameLoop processes) is never a suspect —
        // and neither is the tool itself nor anything it spawned
        if super::sampler::is_gameloop_process(&raw.name)
            || super::sampler::is_self_process(&raw.name)
            || raw.pid == own_pid
            || raw.ppid == own_pid
        {
            continue;
        }
        // background totals accumulate over everything non-excluded
        // (display membership below must never shrink them)
        total_cpu += pct;
        total_ram_mb += raw.ram_mb;
        // the shared WebView2 runtime is OS-owned on every Windows
        // 10/11 (Office, Search, widgets, WebViews): counted in the
        // totals above like everything else, but never a displayed row
        // (ending it would wound the hosts, ours included)
        if raw
            .name
            .trim_end_matches(".exe")
            .eq_ignore_ascii_case("msedgewebview2")
        {
            continue;
        }
        // membership is every app group, idle or not: a quiet browser
        // stays listed with its live (possibly zero) numbers instead of
        // blinking in and out across polls
        rows.push((
            TopProcess {
                kind: classify_process(raw.session, raw.path.as_deref(), &windir).into(),
                display_key: super::display_names::curated_key(&raw.name).map(str::to_string),
                display_name: raw.name.clone(),
                name: raw.name.clone(),
                pid: raw.pid,
                pids: vec![raw.pid],
                cpu_pct: pct,
                ram_mb: raw.ram_mb,
            },
            raw.path.filter(|p| !p.is_empty()),
        ));
    }
    drop(prev);
    // one row per program: same exe stem sums into its hottest member
    // (a browser reads as one Brave, not seven workers). Totals above
    // already counted everything, so grouping only shapes the display.
    let rows = group_by_exe(rows);
    let rows = rank_groups(rows);
    // display names resolve AFTER truncation, for kept rows only: unique
    // paths of non-curated rows, cached across polls — steady state costs
    // zero extra spawns
    let mut want: Vec<String> = Vec::new();
    for (row, path) in &rows {
        if row.display_key.is_none() {
            if let Some(p) = path {
                if !want.contains(p) {
                    want.push(p.clone());
                }
            }
        }
    }
    let resolved = super::display_names::resolve_cached(&want);
    let mut out = Vec::with_capacity(rows.len());
    for (mut row, path) in rows {
        if row.display_key.is_none() {
            // friendly words win; otherwise the trimmed stem (never the
            // vendor boilerplate, never a dotted suffix like ".Root")
            row.display_name = path
                .as_ref()
                .and_then(|p| resolved.get(p))
                .cloned()
                .unwrap_or_else(|| super::display_names::pretty_stem(&row.display_name));
        }
        out.push(row);
    }
    Ok(TopProcesses {
        processes: out,
        total_cpu: (total_cpu * 10.0).round() / 10.0,
        total_ram_mb: (total_ram_mb * 10.0).round() / 10.0,
    })
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
    /// active; Off = present or restorable; HiddenUltimate/HiddenS0 =
    /// Ultimate active or S0-only firmware (forcing plans there fights
    /// the design)
    pub power_high_perf: RowState,
    /// one-time client-update notice: the GameLoop build changed since the
    /// last Tools read (path-keyed GPU/FSO prefs orphan on client updates,
    /// so the user re-flips). The engine persists the new version on the
    /// notifying read — later reads are quiet until the next change.
    pub emulator_updated: bool,
    /// detected GameLoop client version ("7.0.19.05"), "" when unknown
    pub emulator_version: String,
}

/// Visibility of a Tools row whose availability depends on the machine.
/// The UI translates the reason (keys, not sentences — the engine never
/// ships user-facing text):
/// - On/Off: live switch state, row interactive.
/// - DisabledGameloopNotFound: visible but greyed — GameLoop exes did not
///   resolve, which the user can fix (install/run GameLoop). A row the
///   user can act on must explain itself, never vanish silently.
/// - Hidden: can never work here, cause unknown to the UI — the row is
///   absent entirely (legacy shape; new hides name their cause below).
/// - HiddenOldBuild: needs a newer Windows (windowed needs Win11, the
///   per-exe GPU preference needs 10 1803+).
/// - HiddenS0: S0-only firmware (forcing plans there fights the design).
/// - HiddenUltimate: Ultimate Performance already active (nothing above
///   it to offer).
///
/// A permanently dead row stays hidden by default; the "show
/// unsupported" preference reveals all three Hidden* shapes greyed with
/// their translated reason (never flippable, writes stay refused).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RowState {
    On,
    Off,
    DisabledGameloopNotFound,
    Hidden,
    HiddenOldBuild,
    HiddenS0,
    HiddenUltimate,
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
$pfs = Get-CimInstance Win32_PageFileUsage
$total = ($pfs | Measure-Object -Property AllocatedBaseSize -Sum).Sum
if ($null -eq $total) { $total = 0 }
if ($cs.AutomaticManagedPagefile) { "pagefile|auto|$total" }
elseif ($pfs) { "pagefile|manual|$total" }
else { "pagefile|off|0" }
$bat = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue
if ($bat) { $ac = ($bat.BatteryStatus -contains 2); "battery|yes|$ac" } else { "battery|none|" }
$vt = (Get-CimInstance Win32_Processor | Select-Object -First 1).VirtualizationFirmwareEnabled
"vt|$vt"
"#,
    )
    .map_err(|e| {
        super::logging::warn(&format!("system checks query failed: {e}"));
        map_ps_timeout(e)
    })?;
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
                let present = parts.next().unwrap_or("none").trim();
                c.laptop = present != "none";
                // second field is the pre-computed "any battery on AC"
                // (BatteryStatus 2); computed in PowerShell so multi-battery
                // arrays ("2 2") can never break a string compare here.
                let ac = parts.next().unwrap_or("").trim().to_ascii_lowercase();
                c.on_ac = !c.laptop || ac == "true";
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
    let out = super::sampler::output_tracked(Command::new(system32_exe("powercfg.exe"))
        .arg("/list")
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(NO_WINDOW), std::time::Duration::from_secs(5));
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
    let out = super::sampler::output_tracked(Command::new(system32_exe("powercfg.exe"))
        .arg("/getactivescheme")
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(NO_WINDOW), std::time::Duration::from_secs(5));
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
    let out = super::sampler::output_tracked(Command::new(system32_exe("powercfg.exe"))
        .arg("/a")
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(NO_WINDOW), std::time::Duration::from_secs(5));
    let Ok(out) = out else { return false };
    let text = String::from_utf8_lossy(&out.stdout);
    s0_available_in(&text)
}

fn s0_available_in(powercfg_a: &str) -> bool {
    let lower = powercfg_a.to_ascii_lowercase();
    // the "not available" marker is English-only: on locales where it is
    // absent we know NOTHING about which section S0 sits in, so the
    // honest answer is NOT S0 (show the row; a flip that cannot work
    // fails at verify time instead of hiding a working feature).
    let Some(i) = lower.find("not available") else {
        return false;
    };
    lower[..i].contains("s0")
}

/// The Tools power row state: On = a performance-class plan is active
/// (built-in GUID, custom duplicate, or name fallback — the dev box
/// itself runs a custom High Performance duplicate); Off = a
/// performance plan exists or the machine can restore one;
/// HiddenUltimate = Ultimate already active (nothing above it to
/// offer), HiddenS0 = an S0-only machine (forcing plans fights the
/// firmware by design).
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
        return RowState::HiddenUltimate;
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
    RowState::HiddenS0
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
    /// installed RAM in MB (None = unreadable): feeds the "N GB
    /// installed" strip and the recommendation below, never a gate
    pub ram_total_mb: Option<u64>,
    /// recommended custom sizes for the installed RAM (None when RAM is
    /// unreadable): a starting point next to the inputs, not a gate —
    /// the 8 GB warn floor still guards the write
    pub recommended_min_mb: Option<u32>,
    pub recommended_max_mb: Option<u32>,
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
    let auto: u32 = mem.get_value("AutomaticManagedPagefile").ok()?;
    let entries: Vec<String> = match mem.get_value("PagingFiles") {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(_) => return None,
    };
    Some((auto == 1, entries))
}

/// Pure half of the per-drive read: first entry addressed to this drive
/// wins (bare or 0 0 = system-managed, min/max = custom, anything else =
/// unknown); a bare legacy `?:\pagefile.sys` marker with no drive of its
/// own reads as system-managed; no entry at all = off. Other drives'
/// entries are never interpreted here, only preserved on write.
/// Strict like Windows on one point: an empty line ENDS the list (that is
/// what "" means in a REG_MULTI_SZ), it is never skipped — a poisoned
/// list reads as off, which is exactly what Windows activates.
pub(crate) fn parse_drive_mode(raw: &[String], drive: &str) -> (PagefileMode, Option<u32>, Option<u32>) {
    let prefix = format!("{drive}\\").to_uppercase();
    let mut marker = false;
    for entry in raw {
        if entry.trim().is_empty() {
            return (PagefileMode::Off, None, None);
        }
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
    let ram_mb = ram_total_mb();
    let (rec_min, rec_max) = ram_mb
        .and_then(recommended_pagefile_mb)
        .unzip();
    Ok(PagefileSettings {
        automatic: raw.automatic,
        drives: states,
        pending,
        ram_total_mb: ram_mb,
        recommended_min_mb: rec_min,
        recommended_max_mb: rec_max,
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

/// Installed RAM in MB (GlobalMemoryStatusExW, read-only, no spawn):
/// feeds the recommendation below. None = unreadable, never zero
/// masquerading as a 0 MB machine.
#[cfg(windows)]
pub fn ram_total_mb() -> Option<u64> {
    // SAFETY: dwLength set, stack struct, written once on success.
    unsafe {
        let mut mem = MemoryStatusEx {
            dw_length: 64,
            dw_memory_load: 0,
            ull_total_phys: 0,
            ull_avail_phys: 0,
            ull_total_page_file: 0,
            ull_avail_page_file: 0,
            ull_total_virtual: 0,
            ull_avail_virtual: 0,
            ull_avail_extended_virtual: 0,
        };
        if GlobalMemoryStatusExW(&mut mem) == 0 {
            return None;
        }
        if mem.ull_total_phys == 0 {
            return None;
        }
        Some(mem.ull_total_phys / 1_048_576)
    }
}

#[cfg(not(windows))]
pub fn ram_total_mb() -> Option<u64> {
    None
}

/// Recommended custom page file sizes for installed RAM: half of RAM
/// initial, one-and-a-half maximum (32 GB installs read 16,384–49,152).
/// Pure starting point for the inputs, never a gate. None on unknown
/// RAM instead of recommending for a machine that reported nothing.
pub fn recommended_pagefile_mb(ram_mb: u64) -> Option<(u32, u32)> {
    if ram_mb == 0 {
        return None;
    }
    let min = ram_mb / 2;
    let max = ram_mb.saturating_mul(3) / 2;
    Some((
        min.min(u32::MAX as u64) as u32,
        max.min(u32::MAX as u64) as u32,
    ))
}

/// Does this machine's clock run 12-hour? Read from the OS time format
/// itself (HKCU Control Panel International), never guessed from the
/// app language: an Arabic UI on a 24-hour machine must read 24-hour.
/// Unreadable (or non-Windows) means 24-hour, today's behavior exactly.
pub fn clock_uses_12h() -> bool {
    #[cfg(windows)]
    {
        let hkcu = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER);
        let key = match hkcu.open_subkey("Control Panel\\International") {
            Ok(k) => k,
            Err(_) => return false,
        };
        for name in ["sTimeFormat", "sShortTime"] {
            let raw: Result<String, _> = key.get_value(name);
            if let Ok(fmt) = raw {
                return s_time_format_is_12h(&fmt);
            }
        }
        false
    }
    #[cfg(not(windows))]
    {
        false
    }
}

/// Pure 12/24 verdict over one sTimeFormat-style pattern: an uppercase
/// H anywhere outside quoted literals is the 24-hour marker, a
/// lowercase h the 12-hour one (genuine formats carry exactly one
/// family: "h:mm tt" versus "HH:mm"). Quoted literals ('o''clock')
/// never decide; an empty or marker-less pattern reads 24-hour.
fn s_time_format_is_12h(fmt: &str) -> bool {
    // strip single-quoted literals first ('' is an escaped quote that
    // stays inside the literal): only live markers ever decide
    let mut bare = String::with_capacity(fmt.len());
    let mut chars = fmt.chars();
    let mut in_literal = false;
    while let Some(c) = chars.next() {
        if c == '\'' {
            if in_literal && chars.clone().next() == Some('\'') {
                chars.next();
            } else {
                in_literal = !in_literal;
            }
            continue;
        }
        if !in_literal {
            bare.push(c);
        }
    }
    if bare.contains('H') {
        return false;
    }
    bare.contains('h')
}

#[cfg(windows)]
#[repr(C)]
/// Mirrors the Win32 MEMORYSTATUSEX layout (renamed for Rust naming rules).
struct MemoryStatusEx {
    dw_length: u32,
    dw_memory_load: u32,
    ull_total_phys: u64,
    ull_avail_phys: u64,
    ull_total_page_file: u64,
    ull_avail_page_file: u64,
    ull_total_virtual: u64,
    ull_avail_virtual: u64,
    ull_avail_extended_virtual: u64,
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
    // kernel32 exports this one undecorated (no W suffix in the SDK
    // import lib or the DLL itself), so the Rust name keeps the W
    // convention while the link name matches the real export.
    #[link_name = "GlobalMemoryStatusEx"]
    fn GlobalMemoryStatusExW(mem: *mut MemoryStatusEx) -> i32;
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

/// GameLoop rendering executables, resolved live across BOTH client
/// generations (never spawned, never recursed): roots come from the
/// emulator snapshot — Uninstall dirs (any build), the v7 direct value,
/// v6 subkey values, then stock locations — crossed with legacy `ui\`,
/// `Application\`, and versioned `Application\<build>\` layouts (client
/// updates bump the build number; a fixed path would rot every release).
/// Each candidate contributes only when the file actually exists: a
/// bounded handful of exists() checks — microseconds, no process
/// enumeration, no PowerShell.
pub(crate) fn gameloop_exe_paths() -> Vec<std::path::PathBuf> {
    use super::emulator;
    let reg = emulator::read_snapshot();
    let roots = emulator::resolve_roots(&reg);
    let exes: Vec<&str> = emulator::V6
        .exe_names
        .iter()
        .chain(emulator::V7.exe_names.iter())
        .copied()
        .collect::<Vec<_>>();
    let versioned: Vec<Vec<String>> =
        roots.iter().map(|r| emulator::application_versions(r)).collect();
    let mut out: Vec<std::path::PathBuf> = Vec::new();
    for cand in emulator::candidate_paths(&roots, &exes, &versioned) {
        // case-insensitive dedup: `UI\aow_exe.exe` and
        // `ui\aow_exe.exe` are the SAME file on Windows, but
        // PathBuf equality is byte-wise — without this the same
        // exe resolves twice (live-proven: exes=4 for 2 files)
        // and every write/verify runs doubled with a lying count
        if cand.is_file() && !contains_case_insensitive(&out, &cand) {
            out.push(cand);
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
    // user can install/run GameLoop); unsupported build = HiddenOldBuild (can
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
        RowState::HiddenOldBuild
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
    let power_active_raw = super::sampler::output_tracked(Command::new(system32_exe("powercfg.exe"))
        .arg("/getactivescheme")
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(NO_WINDOW), std::time::Duration::from_secs(5))
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
    // GameLoop client-update notice (point 6 of the v7 study): GPU/FSO
    // prefs are path-keyed, so a client update orphans them silently.
    // First sighting stores quietly (fresh installs never nag); a change
    // fires once and persists on this read — the UI shows one dialog.
    let (emulator_updated, emulator_version) = {
        let current = super::emulator::read_snapshot().v7_version;
        let stored = current.as_ref().and_then(|_| {
            super::settings::load()
                .last_seen_gameloop_version
        });
        let (fire, version) =
            super::emulator::version_notice(stored.as_deref(), current.as_deref());
        if fire || (stored.is_none() && current.is_some()) {
            let _ = super::settings::update(|s| {
                s.last_seen_gameloop_version = current.clone();
            });
        }
        (fire, version)
    };
    TweakStates {
        game_dvr_enabled: gamedvr_armed_winreg(dvr_historical, dvr_policy),
        storage_sense: storage_sense_state(ss_exists, ss_value),
        game_mode: game_mode_on(gm_allow, gm_auto),
        gpu_high_perf,
        fso_disabled,
        mouse_accel_off: mouse_accel_off(mouse_speed, mouse_t1, mouse_t2),
        windowed_game_opt,
        power_high_perf,
        emulator_updated,
        emulator_version,
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
    fn recommended_pagefile_is_half_to_one_and_a_half_ram() {
        // the worked example behind the UI line (32 GB installs read
        // 16,384–49,152 MB next to the inputs)
        assert_eq!(recommended_pagefile_mb(32768), Some((16384, 49152)));
        assert_eq!(recommended_pagefile_mb(16384), Some((8192, 24576)));
        assert_eq!(recommended_pagefile_mb(8192), Some((4096, 12288)));
        // unknown RAM recommends nothing, never zeros
        assert_eq!(recommended_pagefile_mb(0), None);
        // saturating, never wrapping, on absurd inputs
        let (mn, mx) = recommended_pagefile_mb(u64::MAX).unwrap();
        assert!(mx >= mn);
    }

    #[test]
    fn s_time_format_reads_12h_only_from_live_markers() {
        // the dev machine's own shape plus the stock variants
        assert!(s_time_format_is_12h("h:mm:ss tt"));
        assert!(s_time_format_is_12h("h:mm tt"));
        assert!(s_time_format_is_12h("hh:mm tt"));
        assert!(!s_time_format_is_12h("HH:mm:ss"));
        assert!(!s_time_format_is_12h("H:mm"));
        assert!(!s_time_format_is_12h("HH:mm"));
        // quoted literals never decide, however shouty
        assert!(s_time_format_is_12h("h:mm 'H'"));
        assert!(!s_time_format_is_12h("'h' HH:mm"));
        // escaped quote stays inside its literal: the H:mm rides along
        assert!(!s_time_format_is_12h("'don''t' H:mm"));
        // empty or marker-less reads 24-hour (today's behavior exactly)
        assert!(!s_time_format_is_12h(""));
        assert!(!s_time_format_is_12h("mm:ss tt"));
    }

    #[test]
    fn memory_type_names_cover_common_modules() {
        // live-proven DDR3 on the dev machine, plus the modern standards
        assert_eq!(memory_type_name(24), Some("DDR3"));
        assert_eq!(memory_type_name(26), Some("DDR4"));
        assert_eq!(memory_type_name(34), Some("DDR5"));
        assert_eq!(memory_type_name(31), Some("LPDDR4"));
        // unknown codes read as unknown, never a guessed generation
        assert_eq!(memory_type_name(0), None);
        assert_eq!(memory_type_name(99), None);
    }

    #[test]
    fn os_release_prefers_marketing_name() {
        // DisplayVersion comes from the real registry here: either way the
        // result is never blank and never invented
        let named = os_release_name("22631");
        assert!(!named.is_empty());
        assert!(named.contains("build") || named.chars().any(|c| c == 'H'));
    }

    #[test]
    fn directx_level_is_one_of_two() {
        assert!(matches!(directx_level(), "DirectX 12" | "DirectX 11"));
    }

    #[test]
    fn live_system_info_shapes() {
        // runs everywhere Windows (CI included): the extended inventory
        // must parse on any machine — core identity never blank, RAM
        // consistent between the flat legacy field and the new struct.
        let info = match query_system_info() {
            Ok(info) => info,
            Err(e) => {
                assert_eq!(e, POWERSHELL_TIMEOUT);
                return;
            }
        };
        assert!(!info.cpu.name.is_empty());
        assert!(info.ram.total_gb > 0.0);
        assert_eq!(info.ram_gb, info.ram.total_gb);
        assert!(matches!(info.system.directx.as_str(), "DirectX 12" | "DirectX 11"));
    }

    #[test]
    fn classify_process_fails_safe_toward_system() {
        let win = r"C:\Windows";
        // services and OS-owned paths: leave running
        assert_eq!(classify_process(Some(0), None, win), "system");
        assert_eq!(
            classify_process(Some(1), Some(r"C:\Windows\System32\dwm.exe"), win),
            "system"
        );
        // case-insensitive drive prefix
        assert_eq!(
            classify_process(Some(1), Some(r"c:\windows\explorer.exe"), win),
            "system"
        );
        // protected processes hide their path: unknown reads as system,
        // never a close suggestion
        assert_eq!(classify_process(Some(1), None, win), "system");
        assert_eq!(classify_process(Some(1), Some(""), win), "system");
        assert_eq!(classify_process(None, None, win), "system");
        // only a known non-system path earns the app label
        assert_eq!(
            classify_process(Some(1), Some(r"C:\Program Files\BraveSoftware\brave.exe"), win),
            "app"
        );
        assert_eq!(
            classify_process(None, Some(r"D:\games\game.exe"), win),
            "app"
        );
    }

    fn grouped_row(name: &str, pid: u32, cpu: f64, ram: f64, kind: &str) -> (TopProcess, Option<String>) {
        (
            TopProcess {
                name: name.into(),
                pid,
                pids: vec![pid],
                cpu_pct: cpu,
                ram_mb: ram,
                kind: kind.into(),
                display_key: None,
                display_name: name.into(),
            },
            None,
        )
    }

    #[test]
    fn group_by_exe_sums_one_program_into_one_row() {
        let rows = vec![
            grouped_row("brave", 10, 2.0, 100.0, "app"),
            grouped_row("BRAVE", 11, 26.4, 64.0, "app"),
            grouped_row("chrome", 20, 1.0, 50.0, "app"),
        ];
        let mut out = group_by_exe(rows);
        out.sort_by(|a, b| a.0.name.cmp(&b.0.name));
        assert_eq!(out.len(), 2);
        let brave = &out[0].0;
        // sums, hottest member lends pid and face, its PID rides first
        assert!((brave.cpu_pct - 28.4).abs() < 1e-9);
        assert!((brave.ram_mb - 164.0).abs() < 1e-9);
        assert_eq!(brave.pid, 11);
        assert_eq!(brave.pids, vec![11, 10]);
        assert_eq!(brave.kind, "app");
        assert_eq!(out[1].0.pids, vec![20]);
    }

    #[test]
    fn group_kind_fails_safe_on_any_system_member() {
        let rows = vec![
            grouped_row("svchost", 30, 1.0, 10.0, "system"),
            grouped_row("svchost", 31, 5.0, 20.0, "app"),
        ];
        let out = group_by_exe(rows);
        assert_eq!(out.len(), 1);
        // a shared worker pool is never a close suggestion
        assert_eq!(out[0].0.kind, "system");
        assert_eq!(out[0].0.pids.len(), 2);
    }

    #[test]
    fn cpu_percent_needs_two_points_and_stays_honest() {
        // 1 CPU-second on 4 cores over 1 wall second = 25%
        assert_eq!(cpu_percent(0, 10_000_000, 1.0, 4.0), 25.0);
        // one decimal like the old sampler math (33.333 -> 33.3)
        assert_eq!(cpu_percent(0, 10_000_000, 1.0, 3.0), 33.3);
        // same instant twice reads zero, never NaN
        assert_eq!(cpu_percent(5, 5, 0.0, 4.0), 0.0);
        // a backwards clock saturates to zero, never negative
        assert_eq!(cpu_percent(20_000_000, 10_000_000, 1.0, 4.0), 0.0);
        // degenerate cores read zero, never infinite
        assert_eq!(cpu_percent(0, 10_000_000, 1.0, 0.0), 0.0);
    }

    #[cfg(windows)]
    #[test]
    fn native_snapshot_lists_the_test_itself() {
        // the enumerator must see its own process with identity intact
        // (name non-empty, memory positive, session known)
        let me = std::process::id();
        let hit = native_snapshot()
            .expect("snapshot runs on this machine")
            .into_iter()
            .find(|r| r.pid == me)
            .expect("own PID enumerated");
        assert!(!hit.name.is_empty());
        assert!(hit.ram_mb > 0.0);
        assert!(hit.session.is_some());
        assert!(hit.cpu_100ns > 0);
    }

    #[test]
    fn rank_groups_holds_ram_order_and_bounds() {
        // hot-but-light sorts below idle-but-heavy: levels hold still,
        // deltas would reshuffle every poll
        let rows = vec![
            grouped_row("hot", 1, 90.0, 10.0, "app"),
            grouped_row("idle", 2, 0.0, 900.0, "app"),
            grouped_row("mid", 3, 5.0, 100.0, "app"),
        ];
        let out = rank_groups(rows);
        assert_eq!(out[0].0.name, "idle");
        assert_eq!(out[1].0.name, "mid");
        assert_eq!(out[2].0.name, "hot");
        // zero-CPU members keep their seat (membership is not gated)
        assert_eq!(out[0].0.cpu_pct, 0.0);
    }

    #[test]
    fn system_exe_paths_come_from_the_os_itself() {
        // absolute, kernel-resolved, never through any search order
        let p = system32_exe("powercfg.exe");
        assert_eq!(p.file_name().and_then(|s| s.to_str()), Some("powercfg.exe"));
        let parent = p.parent().expect("system tool has a parent dir");
        assert_eq!(
            parent.file_name().and_then(|s| s.to_str()).map(|s| s.to_ascii_lowercase()),
            Some("system32".to_string())
        );
        assert!(windows_dir().is_absolute());
    }

    #[test]
    fn ps_timeout_maps_to_machine_key() {
        assert_eq!(
            map_ps_timeout("powershell timed out".into()),
            POWERSHELL_TIMEOUT
        );
        assert_eq!(
            map_ps_timeout("powershell spawn failed: boom".into()),
            "powershell spawn failed: boom"
        );
    }

    #[test]
    fn powershell_probe_matches_availability() {
        // the probe itself runs on this machine — availability is whatever it
        // says, and the cached flag must agree with a fresh probe result.
        // (On dev machines PS exists; the point is the two paths agree.)
        assert_eq!(powershell_available(), probe_powershell());
    }

    #[test]
    fn live_resolver_stays_consistent() {
        // runs everywhere (CI included): with no GameLoop installed the
        // resolver returns nothing without touching anything scary; on a
        // real install every resolved path exists and is unique. Either
        // way the all-or-nothing row contract below holds.
        let paths = gameloop_exe_paths();
        for p in &paths {
            assert!(p.is_file(), "resolved non-file: {}", p.display());
        }
        let mut seen = Vec::new();
        for p in &paths {
            let n = p.to_string_lossy().to_lowercase();
            assert!(!seen.contains(&n), "duplicate resolved exe");
            seen.push(n);
        }
        // on a v7 machine the new home resolves (live-proven 7.0.19.05)
        let reg = super::super::emulator::read_snapshot();
        if reg.v7_install.is_some() {
            assert!(
                !paths.is_empty(),
                "v7 installed but no renderer exe resolved"
            );
        }
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
        // non-English output with no marker: S0 may sit in the unavailable
        // section in another language — unknown means NOT S0 (show the row)
        assert!(!s0_available_in("Standby (S0 Low Power Idle)"));
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
            RowState::HiddenUltimate
        );
        assert_eq!(
            power_row_state("223d3f55-7a5e-4b4f-9518-861f628282ba", "Ultimate Performance", &list, false),
            RowState::HiddenUltimate
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
            RowState::HiddenS0
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
        // an empty line ENDS the list (REG_MULTI_SZ terminator semantics,
        // exactly like Windows): a valid entry after it is invisible, so
        // the drive reads as off — never as the entry Windows will not
        // activate
        assert_eq!(
            parse_drive_mode(&["".into(), "C:\\pagefile.sys 1024 4096".into()], "C:"),
            (off, None, None)
        );
        // ...while an entry before the terminator still counts
        assert_eq!(
            parse_drive_mode(&["C:\\pagefile.sys 1024 4096".into(), "".into()], "C:"),
            (PagefileMode::Custom, Some(1024), Some(4096))
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
