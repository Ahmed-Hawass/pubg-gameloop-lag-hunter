// sampler.rs — collects measurement ticks: CPU/RAM/disk via typeperf, GPU via nvidia-smi
// Portable: every source is optional and fails soft (None) — never crashes the session.

use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;

use super::types::{GpuSample, ProcInfo, Sample};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const NO_WINDOW: u32 = 0x0800_0000; // CREATE_NO_WINDOW

/// Handle for a spawned streaming source. Kill on drop.
struct SpawnedProcess {
    child: Child,
}

impl Drop for SpawnedProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
    }
}

/// typeperf CSV counter names → Sample fields (parsed by header order).
/// Robust to machine prefixes: matches by KNOWN SUFFIX so any host name works.
fn map_counter_key(path: &str) -> Option<&'static str> {
    let p = path.to_ascii_lowercase();
    if p.ends_with("processor information(_total)\\% processor performance") {
        Some("perf")
    } else if p.ends_with("processor(_total)\\% processor time") {
        Some("cpu")
    } else if p.ends_with("memory\\available mbytes") {
        Some("avail")
    } else if p.ends_with("memory\\pages input/sec") {
        Some("pages_in")
    } else if p.ends_with("physicaldisk(_total)\\avg. disk queue length") {
        Some("disk_q")
    } else if p.ends_with("physicaldisk(_total)\\% idle time") {
        Some("disk_idle")
    } else {
        None
    }
}

/// Spawns `typeperf` and calls `emit` with each parsed Sample (CPU/RAM/disk part).
/// Runs on its own thread. Returns immediately.
pub fn spawn_typeperf<F>(interval_sec: u32, running: Arc<AtomicBool>, emit: F) -> Result<(), String>
where
    F: Fn(Sample) + Send + Sync + 'static,
{
    let args: Vec<String> = vec![
        "\\Processor(_Total)\\% Processor Time".into(),
        "\\Processor Information(_Total)\\% Processor Performance".into(),
        "\\Memory\\Available MBytes".into(),
        "\\Memory\\Pages Input/sec".into(),
        "\\PhysicalDisk(_Total)\\Avg. Disk Queue Length".into(),
        "\\PhysicalDisk(_Total)\\% Idle Time".into(),
        "-si".into(),
        interval_sec.to_string(),
        // large sample cap = run until killed
        "-sc".into(),
        "32500".into(),
    ];

    let mut child = Command::new("typeperf")
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(NO_WINDOW) // CREATE_NO_WINDOW
        .spawn()
        .map_err(|e| {
            super::logging::error(&format!("typeperf spawn failed: {e}"));
            format!("typeperf spawn failed: {e}")
        })?;
    let stdout = child.stdout.take().ok_or("no stdout from typeperf")?;

    // the reader thread OWNS the child — kills it on exit (Drop), never before
    thread::spawn(move || {
        let _keep = SpawnedProcess { child };
        eprintln!("[sampler] typeperf reader thread started");
        let reader = BufReader::new(stdout);
        let mut header: Vec<&'static str> = Vec::new();
        let mut line_no: u32 = 0;
        for line in reader.lines() {
            line_no += 1;
            if !running.load(Ordering::Relaxed) {
                eprintln!("[sampler] typeperf reader: running flag went false at line {line_no}");
                break;
            }
            let Ok(line) = line else {
                eprintln!("[sampler] typeperf stream errored at line {line_no}");
                break;
            };
            if line_no <= 3 {
                eprintln!("[sampler] typeperf line {line_no}: {line}");
            }
            let line = line.trim().to_string();
            if line.is_empty() {
                continue;
            }
            // header line: "(PDH-CSV 4.0)","\\HOST\Counter name",...
            if line.starts_with("\"(PDH") {
                header = line
                    .split("\",\"")
                    .skip(1)
                    .filter_map(|p| {
                        let clean = p.trim_matches('"');
                        map_counter_key(clean)
                    })
                    .collect();
                eprintln!("[sampler] typeperf header parsed: {} counters", header.len());
                continue;
            }
            if header.is_empty() {
                continue;
            }
            // data line: "datetime","val1","val2",...
            let parts: Vec<&str> = line.split("\",\"").collect();
            if parts.len() < header.len() + 1 {
                eprintln!("[sampler] typeperf data line dropped (parts={} header={})", parts.len(), header.len());
                continue;
            }
            let values = &parts[1..]; // first element = datetime
            let mut s = Sample {
                t: iso_now(),
                ..Default::default()
            };
            for (i, key) in header.iter().enumerate() {
                let raw = values.get(i).unwrap_or(&"").trim_matches('"');
                let Ok(v) = raw.parse::<f64>() else { continue };
                match *key {
                    "cpu" => s.cpu_total = Some(v),
                    "perf" => s.proc_perf = Some(v),
                    "avail" => s.avail_mb = Some(v),
                    "pages_in" => s.pages_in = Some(v),
                    "disk_q" => s.disk_queue = Some(v),
                    "disk_idle" => s.disk_busy_pct = Some((100.0 - v).max(0.0)),
                    _ => {}
                }
            }
            if s.cpu_total.is_some() || s.avail_mb.is_some() {
                emit(s);
            }
        }
        eprintln!("[sampler] typeperf reader loop ended after {line_no} lines");
        // _keep drops here: typeperf killed after the stream truly ends
    });
    Ok(())
}

/// Spawns `nvidia-smi dmon` and calls `emit` with each GpuSample.
/// If nvidia-smi is missing, returns Ok(false) → session continues GPU-less.
pub fn spawn_dmon<F>(interval_sec: u32, running: Arc<AtomicBool>, emit: F) -> Result<bool, String>
where
    F: Fn(GpuSample) + Send + Sync + 'static,
{
    // check availability quickly first
    let probe = Command::new("nvidia-smi")
        .arg("--query-gpu=clocks.max.gr")
        .arg("--format=csv,noheader")
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(NO_WINDOW)
        .output();
    let Ok(out) = probe else { return Ok(false) };
    if !out.status.success() {
        return Ok(false);
    }

    // 'u' = utilization: WITHOUT it dmon never emits the sm/mem columns and
    // render-stall / gpu-mem-idle detection silently dies (real-machine bug).
    let mut child = Command::new("nvidia-smi")
        .args(["dmon", "-s", "pcmut", "-d", &interval_sec.to_string()])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(NO_WINDOW)
        .spawn()
        .map_err(|e| format!("nvidia-smi spawn failed: {e}"))?;

    let stdout = child.stdout.take().ok_or("no stdout from dmon")?;

    // the reader thread OWNS the child — kills it on exit (Drop), never before
    thread::spawn(move || {
        let _keep = SpawnedProcess { child };
        let reader = BufReader::new(stdout);
        let mut cols: Vec<String> = Vec::new();
        for line in reader.lines() {
            if !running.load(Ordering::Relaxed) {
                break;
            }
            let Ok(line) = line else { break };
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            // header: "# gpu pwr gtemp mtemp mclk pclk fb bar1 ccpm rxpci txpci sm mem enc dec ..."
            if line.starts_with('#') && cols.is_empty() && line.contains("gpu") {
                cols = line.trim_start_matches('#').split_whitespace().map(String::from).collect();
                continue;
            }
            if line.starts_with('#') || cols.is_empty() {
                continue;
            }
            let vals: Vec<&str> = line.split_whitespace().collect();
            if vals.len() < 3 {
                continue;
            }
            // vals[0] = gpu index; map remaining by cols (cols[0] = "gpu")
            let g = |name: &str| -> Option<f64> {
                let idx = cols.iter().position(|c| c == name)? + 1;
                vals.get(idx).and_then(|v| v.parse::<f64>().ok())
            };
            let sample = GpuSample {
                pclk: g("pclk"),
                mclk: g("mclk"),
                sm_pct: g("sm"),
                mem_pct: g("mem"),
                temp: g("gtemp"),
                pstate: None, // dmon doesn't carry pstate; full pstate from periodic probe
            };
            if sample.sm_pct.is_some() || sample.pclk.is_some() {
                emit(sample);
            }
        }
    });
    Ok(true)
}

/// GameLoop process snapshot via `tasklist` (native, ~5MB transient per call,
/// zero resident cost — unlike spawning a full PowerShell every probe).
/// PUBG Mobile on GameLoop only: the tool's entire identity.
pub fn query_emulator_procs() -> Result<Vec<ProcInfo>, String> {
    let out = Command::new("tasklist")
        .args(["/FO", "CSV", "/NH"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(NO_WINDOW)
        .output()
        .map_err(|e| format!("tasklist spawn failed: {e}"))?;
    if !out.status.success() {
        return Ok(Vec::new());
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let mut procs = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        // CSV: "name","pid","session","sessionnum","mem"
        let mut parts = line.split("\",\"");
        let Some(name_raw) = parts.next() else { continue };
        let name = name_raw.trim_matches('"');
        if !is_gameloop_process(name) {
            continue;
        }
        let pid = parts.next().unwrap_or("").trim_matches('"').parse().ok();
        let _session = parts.next();
        let _sessionnum = parts.next();
        let mem_str = parts.next().unwrap_or("").trim_matches('"').replace(',', "").replace(" K", "").replace('\u{a0}', "");
        let ws_mb = mem_str.parse::<f64>().ok().map(|k| k / 1024.0);
        procs.push(ProcInfo {
            name: name.to_string(),
            pid,
            ws_mb,
            cpu_seconds: None, // tasklist doesn't carry CPU time; not needed for detection
        });
    }
    Ok(procs)
}

/// GameLoop-only process match — the tool exists for PUBG Mobile on GameLoop.
/// aow_exe = the game runtime, TBS = GameLoop's UI engine, TxGameAssistant = launcher,
/// AndroidEmulatorEn = GameLoop's engine host. Public: system.rs uses it to
/// keep all GameLoop processes off the "top processes" suspects list.
pub fn is_gameloop_process(name: &str) -> bool {
    const GAMELOOP_PROCS: [&str; 4] = ["aow_exe", "TBS", "TxGameAssistant", "AndroidEmulatorEn"];
    let base = name.trim_end_matches(".exe");
    GAMELOOP_PROCS.iter().any(|p| {
        p.eq_ignore_ascii_case(base) || base.to_ascii_lowercase().starts_with(&p.to_ascii_lowercase())
    })
}

/// Is this OURSELVES? The tool must never appear as a suspect in its own list.
pub fn is_self_process(name: &str) -> bool {
    name.eq_ignore_ascii_case("pubg-gameloop-lag-hunter") || name.eq_ignore_ascii_case("lag-hunter")
}

/// GameLoop detection: Some("GameLoop") when its processes exist.
pub fn detect_emulator() -> Option<String> {
    let Ok(procs) = query_emulator_procs() else { return None };
    if procs.is_empty() {
        None
    } else {
        Some("GameLoop".into())
    }
}

/// Is any GameLoop window VISIBLE (not minimized)? None = unknown.
///
/// The renderer can be alive while the window sits in the taskbar — and the
/// dGPU drops to idle clocks while the user is on the desktop. Treating that
/// as "in-game" produced phantom GPU-wake cards; GPU rules must be muted
/// while the game is in the background.
///
/// Implementation: the Win32 IsIconic call lives INSIDE powershell.exe via
/// Add-Type — never linked into our binary (the user32 extern-block lesson:
/// hand-linked Win32 crashed webview creation on real machines).
/// Called from the existing probe thread only (~every 10s), so the transient
/// PowerShell cost stays bounded and never touches the 1 Hz sampling path.
#[cfg(windows)]
pub fn query_game_visible() -> Option<bool> {
    use std::os::windows::process::CommandExt;
    const SCRIPT: &str = concat!(
        "$sig = '[DllImport(\"user32.dll\")] public static extern bool IsIconic(IntPtr h);';\n",
        "$t = Add-Type -MemberDefinition $sig -Name Win -Namespace P -PassThru;\n",
        "$vis = $false;\n",
        "foreach ($n in @('aow_exe','TBS','TxGameAssistant','AndroidEmulatorEn')) {\n",
        "  Get-Process -Name \"$n*\" -ErrorAction SilentlyContinue | ForEach-Object {\n",
        "    if ($_.MainWindowHandle -ne 0 -and -not $t::IsIconic([IntPtr]$_.MainWindowHandle)) { $vis = $true }\n",
        "  }\n",
        "}\n",
        "\"visible|$vis\"\n"
    );
    let out = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", SCRIPT])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(NO_WINDOW)
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    for line in text.lines() {
        let mut parts = line.trim().splitn(2, '|');
        if parts.next() == Some("visible") {
            return match parts.next() {
                Some("True") | Some("true") => Some(true),
                Some("False") | Some("false") => Some(false),
                _ => None,
            };
        }
    }
    None
}

#[cfg(not(windows))]
pub fn query_game_visible() -> Option<bool> {
    None
}

/// GPU max clocks (gr, mem) — called once at session start.
pub fn query_gpu_max_clocks() -> Option<(f64, f64)> {
    let out = Command::new("nvidia-smi")
        .args(["--query-gpu=clocks.max.gr,clocks.max.mem", "--format=csv,noheader,nounits"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(NO_WINDOW)
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let mut it = text.trim().split(',');
    let gr = it.next()?.trim().parse().ok()?;
    let mem = it.next()?.trim().parse().ok()?;
    Some((gr, mem))
}

/// ISO-8601 timestamp with milliseconds, local time.
pub fn iso_now() -> String {
    let now = std::time::SystemTime::now();
    let dur = now.duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
    let secs = dur.as_secs();
    let millis = dur.subsec_millis();
    // civil-from-days algorithm (Howard Hinnant) — no chrono dependency
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mth = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if mth <= 2 { y + 1 } else { y };
    format!("{y:04}-{mth:02}-{d:02}T{h:02}:{m:02}:{s:02}.{millis:03}Z")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counter_mapping() {
        assert_eq!(map_counter_key("\\Processor(_Total)\\% Processor Time"), Some("cpu"));
        assert_eq!(map_counter_key("memory\\available mbytes"), Some("avail"));
        assert_eq!(map_counter_key("unknown counter"), None);
    }

    #[test]
    fn iso_now_format() {
        let s = iso_now();
        assert_eq!(s.len(), 24);
        assert!(s.ends_with('Z'));
        assert_eq!(&s[4..5], "-");
        assert_eq!(&s[10..11], "T");
    }

    #[test]
    fn gameloop_names_matched() {
        assert!(is_gameloop_process("aow_exe"));
        assert!(is_gameloop_process("aow_exe.exe"));
        assert!(is_gameloop_process("TBS"));
        assert!(is_gameloop_process("TBS.exe"));
        assert!(is_gameloop_process("TxGameAssistant"));
        assert!(is_gameloop_process("AndroidEmulatorEn"));
        assert!(is_gameloop_process("AndroidEmulatorEn.exe"));
        assert!(!is_gameloop_process("explorer"));
        assert!(!is_gameloop_process("chrome"));
        assert!(!is_gameloop_process("dnplayer")); // other emulators are out of scope
        assert!(!is_gameloop_process("HD-Player"));
    }

    #[test]
    fn self_process_matched() {
        assert!(is_self_process("pubg-gameloop-lag-hunter"));
        assert!(is_self_process("PUBG-GAMELOOP-LAG-HUNTER"));
        assert!(!is_self_process("explorer"));
    }

    #[test]
    fn tasklist_csv_line_parsed() {
        // real CSV format: "name","pid","session","sessionnum","mem usage"
        let line = "\"aow_exe.exe\",\"4280\",\"Console\",\"1\",\"117,000 K\"";
        let mut parts = line.split("\",\"");
        let name = parts.next().unwrap().trim_matches('"');
        assert_eq!(name, "aow_exe.exe");
        assert!(is_gameloop_process(name));
        let pid: u32 = parts.next().unwrap().trim_matches('"').parse().unwrap();
        assert_eq!(pid, 4280);
        // skip session + sessionnum, then mem is the 5th field
        let _session = parts.next();
        let _sessionnum = parts.next();
        let mem = parts.next().unwrap().trim_matches('"').replace(',', "");
        assert!(mem.starts_with("117000"));
    }

    #[test]
    fn tasklist_csv_real_world_lines() {
        // lines captured from a real machine
        for (line, name, mem_start) in [
            ("\"System Idle Process\",\"0\",\"Services\",\"0\",\"8 K\"", "System Idle Process", "8"),
            ("\"Registry\",\"176\",\"Services\",\"0\",\"60,516 K\"", "Registry", "60516"),
        ] {
            let mut parts = line.split("\",\"");
            let n = parts.next().unwrap().trim_matches('"');
            assert_eq!(n, name);
            let _pid = parts.next().unwrap();
            let _s = parts.next();
            let _sn = parts.next();
            let mem = parts.next().unwrap().trim_matches('"').replace(',', "");
            assert!(mem.starts_with(mem_start));
        }
    }
}
