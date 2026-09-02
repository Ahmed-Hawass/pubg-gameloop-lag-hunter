// system.rs — one-shot, read-only system queries: rig info, top processes,
// environment checks. Nothing here ever modifies the user's machine.

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
// System info — the "Your rig" tab. Hardware identity doesn't change between
// launches: queried ONCE per app run, cached in memory, instant tab opens.
// ---------------------------------------------------------------------------

use std::sync::OnceLock;

static SYSTEM_CACHE: OnceLock<SystemInfo> = OnceLock::new();

pub fn system_info_cached() -> Result<SystemInfo, String> {
    if let Some(cached) = SYSTEM_CACHE.get() {
        return Ok(cached.clone());
    }
    let info = query_system_info()?;
    let _ = SYSTEM_CACHE.set(info.clone());
    Ok(info)
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct GpuInfo {
    pub name: String,
    pub vram_gb: Option<f64>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct DiskInfo {
    pub name: String,
    pub media: String,
    pub bus: String,
    pub size_gb: f64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct SystemInfo {
    pub cpu: String,
    pub gpus: Vec<GpuInfo>,
    pub ram_gb: f64,
    pub disks: Vec<DiskInfo>,
    /// can the tool read NVIDIA GPU counters? (false on AMD/Intel-only machines)
    pub gpu_counters: bool,
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
    let text = ps(
        r#"
$cpu = (Get-CimInstance Win32_Processor | Select-Object -First 1).Name
"cpu|$cpu"
Get-CimInstance Win32_VideoController | ForEach-Object { "gpu|$($_.Name)|$([math]::Round($_.AdapterRAM/1GB,1))" }
"ram|$([math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory/1GB,1))"
Get-PhysicalDisk | ForEach-Object { "disk|$($_.FriendlyName)|$($_.MediaType)|$($_.BusType)|$([math]::Round($_.Size/1GB,0))" }
"#,
    )?;
    let mut info = SystemInfo {
        cpu: "Unknown".into(),
        gpus: Vec::new(),
        ram_gb: 0.0,
        disks: Vec::new(),
        gpu_counters: super::sampler::query_gpu_max_clocks().is_some(),
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
                info.gpus.push(GpuInfo { name, vram_gb: vram });
            }
            Some("ram") => {
                info.ram_gb = parts.next().and_then(|v| v.trim().parse().ok()).unwrap_or(0.0);
            }
            Some("disk") => {
                let name = parts.next().unwrap_or("").trim().to_string();
                let media = parts.next().unwrap_or("").trim().to_string();
                let bus = parts.next().unwrap_or("").trim().to_string();
                let size = parts.next().and_then(|v| v.trim().parse().ok()).unwrap_or(0.0);
                if !name.is_empty() {
                    info.disks.push(DiskInfo { name, media, bus, size_gb: size });
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
    let text = ps(
        r#"
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
"#,
    )?;
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
        out.push(TopProcess { name: name.to_string(), pid, cpu_pct: pct, ram_mb: ram });
    }
    out.sort_by(|a, b| b.cpu_pct.partial_cmp(&a.cpu_pct).unwrap_or(std::cmp::Ordering::Equal));
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
}

pub fn query_system_checks() -> Result<SystemChecks, String> {
    let text = ps(
        r#"
$scheme = (powercfg /getactivescheme) -join ' '
"power|$scheme"
$cs = Get-CimInstance Win32_ComputerSystem
$pf = Get-CimInstance Win32_PageFileUsage | Select-Object -First 1
if ($cs.AutomaticManagedPagefile) { "pagefile|auto|$($pf.AllocatedBaseSize)" }
elseif ($pf) { "pagefile|manual|$($pf.AllocatedBaseSize)" }
else { "pagefile|off|0" }
$bat = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue
if ($bat) { "battery|$($bat.BatteryStatus)" } else { "battery|none" }
"#,
    )?;
    let mut c = SystemChecks {
        power_name: "Unknown".into(),
        power_ok: false,
        pagefile_mode: "off".into(),
        pagefile_mb: 0,
        pagefile_ok: false,
        laptop: false,
        on_ac: true,
    };
    for line in text.lines().map(|l| l.trim()).filter(|l| !l.is_empty()) {
        let mut parts = line.split('|');
        match parts.next() {
            Some("power") => {
                let raw = parts.next().unwrap_or("");
                c.power_name = extract_power_name(raw);
                c.power_ok = is_performance_plan(&c.power_name);
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
            _ => {}
        }
    }
    Ok(c)
}

/// "Power Scheme GUID: xxx  (High performance)" → "High performance"
fn extract_power_name(raw: &str) -> String {
    let open = raw.rfind('(');
    let close = raw.rfind(')');
    match (open, close) {
        (Some(o), Some(c)) if c > o => raw[o + 1..c].trim().to_string(),
        _ => "Unknown".into(),
    }
}

fn is_performance_plan(name: &str) -> bool {
    let n = name.to_lowercase();
    n.contains("high performance") || n.contains("ultimate performance") || n.contains("performance")
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

/// Open a Windows settings panel — strictly whitelisted, never a free string.
pub fn open_windows_panel(panel: &str) -> Result<(), String> {
    let applet = match panel {
        "power" => "powercfg.cpl",
        "system" => "sysdm.cpl",
        _ => return Err("unknown panel".into()),
    };
    #[cfg(windows)]
    {
        Command::new("control.exe")
            .arg(applet)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(NO_WINDOW)
            .spawn()
            .map_err(|e| format!("cannot open panel: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn power_name_extracted() {
        assert_eq!(
            extract_power_name("Power Scheme GUID: e72c17b6-94d2-4509-adfc-8f2302229d1a  (High performance)"),
            "High performance"
        );
        assert_eq!(extract_power_name("garbage"), "Unknown");
    }

    #[test]
    fn performance_plan_detected() {
        assert!(is_performance_plan("High performance"));
        assert!(is_performance_plan("Ultimate Performance"));
        assert!(!is_performance_plan("Power saver"));
        assert!(!is_performance_plan("Balanced"));
    }

    #[test]
    fn pagefile_health_rules() {
        assert!(pagefile_ok("auto", 0));
        assert!(pagefile_ok("manual", 16384));
        assert!(!pagefile_ok("manual", 4096)); // the original real-world bug
        assert!(!pagefile_ok("off", 0));
    }
}
