// system.rs — one-shot, read-only system queries: rig info, top processes,
// environment checks. Nothing here ever modifies the user's machine.

use std::fs;
use std::process::{Command, Stdio};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const NO_WINDOW: u32 = 0x0800_0000;

fn ps(script: &str) -> Result<String, String> {
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
/// launch pays the query cost again.
fn save_system_cache(info: &SystemInfo) {
    let _ = fs::create_dir_all(super::storage::app_dir());
    if let Ok(body) = serde_json::to_string(info) {
        let _ = fs::write(system_cache_path(), body);
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

/// Boot-time warm-up for every engine cache, called ONCE from setup() on a
/// background async task. The OLD code spawned raw threads that ran the
/// PowerShell scripts WITHOUT a blocking pool — the 20s Get-PhysicalDisk
/// inventory froze the UI on HDD machines. Now:
///   * rig profile  — disk-cache hit (instant) or one async query
///   * checks        — refreshed off-thread; the tab reads the cache
///   * top processes — refreshed off-thread
///
/// The one-line rig log it produces answers most support questions:
/// `rig: ram=8192MB disks=2 gpu_counters=true powershell=true`
pub async fn warm_system_caches() {
    let _t = super::logging::timed("startup warm-up");
    // rig (fills memory + disk cache on first machine run)
    match system_info_async().await {
        Ok(info) => {
            super::logging::info(&format!(
                "rig: ram={:.0}MB disks={} gpu_counters={} powershell={}",
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
    /// system-drive letter, e.g. "C:"
    pub disk_id: String,
    /// free space on the system drive (GB and percent)
    pub disk_free_gb: f64,
    pub disk_free_pct: f64,
    /// "ok" | "low" | "critical" — graduated copy, warn badge for non-ok.
    /// Unknown reads as "ok" (no false alarm on probe failure).
    pub disk_level: String,
}

pub fn query_system_checks() -> Result<SystemChecks, String> {
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
$dvr1 = (Get-ItemProperty -Path "HKCU:\System\GameConfigStore" -Name "GameDVR_Enabled" -ErrorAction SilentlyContinue).GameDVR_Enabled
$dvr2 = (Get-ItemProperty -Path "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\GameDVR" -Name "AppCaptureEnabled" -ErrorAction SilentlyContinue).AppCaptureEnabled
$dvrpol = (Get-ItemProperty -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows\GameDVR" -Name "AllowGameDVR" -ErrorAction SilentlyContinue).AllowGameDVR
$dvrhist = (Get-ItemProperty -Path "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\GameDVR" -Name "HistoricalCaptureEnabled" -ErrorAction SilentlyContinue).HistoricalCaptureEnabled
"gamedvr|$dvr1|$dvr2|$dvrpol|$dvrhist"
$sys = Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID='" + $env:SystemDrive + "'")
"diskfree|$($sys.DeviceID)|$($sys.FreeSpace)|$($sys.Size)"
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
        disk_id: "C:".into(),
        disk_free_gb: 0.0,
        disk_free_pct: 100.0,
        disk_level: "ok".into(),
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
            Some("gamedvr") => {
                // master | capture | machine policy | background toggle
                // (any may be empty = missing)
                let master = parts.next().unwrap_or("").trim();
                let capture = parts.next().unwrap_or("").trim();
                let policy = parts.next().unwrap_or("").trim();
                let historical = parts.next().unwrap_or("").trim();
                c.game_dvr_enabled = gamedvr_armed(historical, policy);
                if c.game_dvr_enabled {
                    super::logging::info(&format!(
                        "dvr armed: master={master} capture={capture} policy={policy} historical={historical}"
                    ));
                }
            }
            Some("diskfree") => {
                // system-drive free space: id | bytes free | bytes total.
                // Unparsable = probe failed, keep the safe "ok" default.
                let id = parts.next().unwrap_or("").trim();
                let free: Option<f64> = parts.next().and_then(|v| v.trim().parse().ok());
                let total: Option<f64> = parts.next().and_then(|v| v.trim().parse().ok());
                if let (Some(f), Some(t)) = (free, total) {
                    if t > 0.0 && f >= 0.0 {
                        c.disk_id = if id.is_empty() { "C:".into() } else { id.into() };
                        c.disk_free_gb = f / 1_073_741_824.0;
                        c.disk_free_pct = f / t * 100.0;
                        c.disk_level = disk_level(c.disk_free_pct, c.disk_free_gb).into();
                    }
                }
            }
            _ => {}
        }
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
fn extract_power_guid(raw: &str) -> String {
    // "Power Scheme GUID: e72c17b6-94d2-4509-adfc-8f2302229d1a  (High performance)"
    let after = raw.split(':').nth(1).unwrap_or("");
    let guid = after.split_whitespace().next().unwrap_or("");
    let looks_like_guid = guid.len() == 36
        && guid.as_bytes()[8] == b'-'
        && guid.as_bytes()[13] == b'-'
        && guid.chars().all(|c| c.is_ascii_hexdigit() || c == '-');
    if looks_like_guid {
        guid.to_ascii_lowercase()
    } else {
        String::new()
    }
}

/// Built-in Windows performance-class scheme GUIDs (locale-independent).
const POWER_GUID_HIGH_PERFORMANCE: &str = "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c";
const POWER_GUID_ULTIMATE_PERFORMANCE: &str = "e9a42b02-d5df-448d-aa66-1f0f8455410a";

fn is_performance_plan(name: &str, guid: &str) -> bool {
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
        || n.contains("الأداء الأقصى");
    english || arabic
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

/// Registry DWORD truth: 1/true = on. Anything else (0, empty, missing) = off.
fn is_truthy_dword(v: &str) -> bool {
    let t = v.trim().to_ascii_lowercase();
    t == "1" || t == "true"
}

/// Is background recording actually armed? Warn ONLY when the background
/// toggle itself ("Record what happened", HistoricalCaptureEnabled) is on.
/// Rationale, verified on a real Win11 machine: the Captures UI toggle does
/// NOT flip the master keys (GameDVR_Enabled stays 1 = factory default,
/// AppCaptureEnabled stays 1 once created), so warning on those false-alarms
/// on machines the user already fixed via Settings. The machine policy
/// (AllowGameDVR=0) forces everything off.
fn gamedvr_armed(historical: &str, policy: &str) -> bool {
    if policy.trim() == "0" {
        return false;
    }
    is_truthy_dword(historical)
}

/// System-drive free-space level: "ok" | "low" | "critical".
/// Either axis can hurt alone: a tiny percent starves Windows services and
/// updates, a tiny absolute number starves pagefile growth.
fn disk_level(free_pct: f64, free_gb: f64) -> &'static str {
    if free_pct < 10.0 || free_gb < 10.0 {
        "critical"
    } else if free_pct < 15.0 || free_gb < 20.0 {
        "low"
    } else {
        "ok"
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
            // documented Storage page (Win10 + Win11): ms-settings:storagesense
            "storage" => {
                let mut c = Command::new("explorer.exe");
                c.arg("ms-settings:storagesense");
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
    fn pagefile_health_rules() {
        assert!(pagefile_ok("auto", 0));
        assert!(pagefile_ok("manual", 16384));
        assert!(!pagefile_ok("manual", 4096)); // the original real-world bug
        assert!(!pagefile_ok("off", 0));
    }

    #[test]
    fn gamedvr_dword_truth() {
        assert!(is_truthy_dword("1"));
        assert!(!is_truthy_dword("0"));
        assert!(!is_truthy_dword(""));
        assert!(!is_truthy_dword("none"));
    }

    #[test]
    fn gamedvr_armed_only_on_background_toggle() {
        // factory default (toggle missing) = quiet
        assert!(!gamedvr_armed("", ""));
        // toggle explicitly off = quiet
        assert!(!gamedvr_armed("0", ""));
        // background toggle explicitly on = armed (the real background cost)
        assert!(gamedvr_armed("1", ""));
        assert!(gamedvr_armed("true", ""));
        // machine policy forces off over everything
        assert!(!gamedvr_armed("1", "0"));
    }

    #[test]
    fn disk_level_thresholds() {
        assert_eq!(disk_level(20.0, 30.0), "ok");
        assert_eq!(disk_level(12.0, 50.0), "low");
        assert_eq!(disk_level(20.0, 15.0), "low");
        assert_eq!(disk_level(5.0, 100.0), "critical");
        assert_eq!(disk_level(50.0, 5.0), "critical");
    }
}
