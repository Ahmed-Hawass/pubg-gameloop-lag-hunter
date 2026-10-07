// sampler.rs — collects measurement ticks: CPU/RAM/disk via typeperf, GPU via nvidia-smi
// Portable: every source is optional and fails soft (None) — never crashes the session.

use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use super::types::{GpuSample, ProcInfo, Sample};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const NO_WINDOW: u32 = 0x0800_0000; // CREATE_NO_WINDOW

/// A Windows Job Object with JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: every child
/// assigned to it dies the moment OUR process goes away — including a hard
/// abort (panic = "abort" leaves no chance for Drop handlers). This is the
/// only mechanism that reliably reaps typeperf/dmon/powershell orphans.
/// The handle is intentionally leaked for the process lifetime.
#[cfg(windows)]
fn child_job() -> &'static windows_sys_job::Job {
    use std::sync::OnceLock;
    static JOB: OnceLock<windows_sys_job::Job> = OnceLock::new();
    JOB.get_or_init(windows_sys_job::Job::create)
}

/// Minimal Kill-On-Close Job Object wrapper — no external crates, raw FFI.
#[cfg(windows)]
mod windows_sys_job {
    #[repr(C)]
    struct IoCounters {
        read_op: u64,
        write_op: u64,
        other_op: u64,
        read_bytes: u64,
        write_bytes: u64,
        other_bytes: u64,
    }

    #[repr(C)]
    struct BasicLimitInformation {
        per_process_user_time_limit: i64,
        per_job_user_time_limit: i64,
        minimum_working_set_size: usize,
        maximum_working_set_size: usize,
        active_process_limit: u32,
        /// JOB_OBJECT_LIMIT_* flags — KILL_ON_JOB_CLOSE lives here
        limit_flags: u32,
        affinity: usize,
        priority_class: u32,
        scheduling_class: u32,
    }

    #[repr(C)]
    struct ExtendedLimitInformation {
        basic: BasicLimitInformation,
        io_info: IoCounters,
        process_memory_limit: usize,
        job_memory_limit: usize,
        peak_process_memory_used: usize,
        peak_job_memory_used: usize,
    }

    const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION: i32 = 9;
    const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: u32 = 0x2000;

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateJobObjectA(
            lpJobAttributes: *mut core::ffi::c_void,
            lpName: *const u8,
        ) -> *mut core::ffi::c_void;
        fn SetInformationJobObject(
            hJob: *mut core::ffi::c_void,
            job_info_class: i32,
            lpJobObjectInformation: *mut core::ffi::c_void,
            cbJobObjectInformationLength: u32,
        ) -> i32;
        fn AssignProcessToJobObject(
            hJob: *mut core::ffi::c_void,
            hProcess: *mut core::ffi::c_void,
        ) -> i32;
    }

    pub struct Job {
        handle: *mut core::ffi::c_void,
    }

    // SAFETY: the raw handle is only used for kernel32 calls; the Job lives
    // forever (leaked in OnceLock) and every method takes &self.
    unsafe impl Send for Job {}
    unsafe impl Sync for Job {}

    impl Job {
        /// Create the job with KILL_ON_JOB_CLOSE; failure returns a no-op
        /// job (handle null) — children then behave exactly as before this
        /// fix existed (fail soft, never crashes the session).
        pub fn create() -> Self {
            unsafe {
                let handle = CreateJobObjectA(std::ptr::null_mut(), std::ptr::null());
                if handle.is_null() {
                    return Job {
                        handle: std::ptr::null_mut(),
                    };
                }
                let mut info: ExtendedLimitInformation =
                    std::mem::MaybeUninit::zeroed().assume_init();
                // the ONE limit that matters: when our process handle is
                // gone (even via abort), the kernel reaps every child.
                info.basic.limit_flags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                let _ = SetInformationJobObject(
                    handle,
                    JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
                    (&mut info as *mut ExtendedLimitInformation).cast(),
                    std::mem::size_of::<ExtendedLimitInformation>() as u32,
                );
                Job { handle }
            }
        }

        /// Attach a spawned child to the job. No-op on failure — best effort.
        pub fn assign(&self, child: &std::process::Child) {
            if self.handle.is_null() {
                return;
            }
            use std::os::windows::io::AsRawHandle;
            unsafe {
                let _ = AssignProcessToJobObject(self.handle, child.as_raw_handle().cast());
            }
        }
    }
}

/// Spawn a long-lived child inside the kill-on-close job (Windows) or a
/// plain spawn elsewhere. Every streaming source goes through this so an
/// app abort can never leak typeperf/dmon/powershell processes.
pub(crate) fn spawn_tracked(cmd: &mut Command) -> std::io::Result<std::process::Child> {
    let child = cmd.spawn()?;
    #[cfg(windows)]
    child_job().assign(&child);
    Ok(child)
}

/// Run a short-lived child inside the kill-on-close job with a hard deadline.
/// All probe commands use this path so a wedged Windows utility cannot block
/// a session forever or outlive the app.
pub(crate) fn output_tracked(
    cmd: &mut Command,
    timeout: Duration,
) -> std::io::Result<std::process::Output> {
    let mut child = spawn_tracked(cmd)?;
    let deadline = std::time::Instant::now() + timeout;
    loop {
        match child.try_wait()? {
            Some(_) => return child.wait_with_output(),
            None if std::time::Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(std::io::Error::new(
                    std::io::ErrorKind::TimedOut,
                    "child process timed out",
                ));
            }
            None => thread::sleep(Duration::from_millis(50)),
        }
    }
}

/// Handle for a spawned streaming source. Kill on drop.
struct SpawnedProcess {
    child: Child,
}

impl Drop for SpawnedProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
    }
}

/// Watchdog for a streaming source: the reader thread only notices
/// `running == false` when a LINE arrives — a silent emitter (typeperf
/// wedged on corrupted counters, a Get-Counter loop parked in its catch
/// branch) emits nothing, the reader blocks on `lines()` forever, and the
/// child outlives every stop/start cycle until app exit (one orphan per
/// session). This thread polls the flag every 2s and kills the child BY
/// PID the moment the session stops: the blocked reader's stream then
/// ends, it unwinds, and its own SpawnedProcess drop becomes a harmless
/// second kill of an already-dead process.
///
/// The kill is `taskkill /PID <id> /T /F` (no handle games on std's
/// single-owner Child; taskkill is native, needs no elevation for our own
/// children, and /T covers any grand-children typeperf itself spawned).
fn spawn_source_watchdog(pid: u32, running: Arc<AtomicBool>) {
    #[cfg(windows)]
    thread::spawn(move || {
        loop {
            if !running.load(Ordering::Relaxed) {
                break;
            }
            thread::sleep(Duration::from_secs(2));
        }
        // the session ended: reap the child even if its stream is silent
        let _ = Command::new(super::system::system32_exe("taskkill.exe"))
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(NO_WINDOW)
            .status();
    });
    #[cfg(not(windows))]
    let _ = (pid, running);
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

/// The English counter paths we ask PDH for. On a localized Windows the
/// English names still resolve via PdhAddEnglishCounter/typeperf's own
/// English-counter handling — EXCEPT on some builds where typeperf
/// resolves counter paths against the localized set and fails outright.
const COUNTER_PATHS: [&str; 6] = [
    "\\Processor(_Total)\\% Processor Time",
    "\\Processor Information(_Total)\\% Processor Performance",
    "\\Memory\\Available MBytes",
    "\\Memory\\Pages Input/sec",
    "\\PhysicalDisk(_Total)\\Avg. Disk Queue Length",
    "\\PhysicalDisk(_Total)\\% Idle Time",
];

/// One-shot probe: does `typeperf` accept the English counter paths on this
/// machine? On Arabic (and other localized) Windows the counter names in
/// PDH are translated and typeperf may reject the English strings — the
/// session would then run CPU/RAM/disk-blind with zero samples and no error.
/// Cost: one typeperf process that exits by itself in ~1-2s. Cached.
pub fn english_counters_work() -> bool {
    use std::sync::atomic::{AtomicU8, Ordering};
    // 0 = unknown, 1 = yes, 2 = no
    static ANSWER: AtomicU8 = AtomicU8::new(0);
    match ANSWER.load(Ordering::Relaxed) {
        1 => return true,
        2 => return false,
        _ => {}
    }
    let ok = {
        let out = output_tracked(
            Command::new(super::system::system32_exe("typeperf.exe"))
            .args([
                COUNTER_PATHS[0],
                "-si",
                "1",
                "-sc",
                "1", // one sample then exit
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .creation_flags(NO_WINDOW),
            Duration::from_secs(5),
        );
        match out {
            Ok(o) => {
                // exit 0 = the path resolved; nonzero = "cannot find counter"
                o.status.success()
            }
            Err(_) => false,
        }
    };
    // if typeperf itself is missing entirely, treat as "English works" —
    // the spawn_typeperf path will log its own failure as before.
    ANSWER.store(if ok { 1 } else { 2 }, Ordering::Relaxed);
    ok
}

/// Spawns `typeperf` and calls `emit` with each parsed Sample (CPU/RAM/disk part).
/// Runs on its own thread. Returns immediately.
/// On localized Windows where typeperf rejects the English counter paths,
/// falls back to a PowerShell PDH emitter (PdhAddEnglishCounter) that prints
/// the same CSV shape — locale-proof sampling either way.
pub fn spawn_typeperf<F>(interval_sec: u32, running: Arc<AtomicBool>, emit: F) -> Result<(), String>
where
    F: Fn(Sample) + Send + Sync + 'static,
{
    if english_counters_work() {
        spawn_typeperf_native(interval_sec, running, emit)
    } else {
        super::logging::info(
            "typeperf rejected English counters (localized Windows) — using PDH emitter",
        );
        spawn_pdh_emitter(interval_sec, running, emit)
    }
}

/// PowerShell Get-Counter fallback. The cmdlet resolves counter paths via
/// the English (locale-independent) PDH API internally, so it accepts the
/// English paths on any Windows display language — exactly what typeperf
/// sometimes refuses on localized builds. The loop prints one CSV line per
/// tick in the fixed COUNTER_PATHS order; values map by position.
/// Verified against the raw PdhGetFormattedCounterValue P/Invoke route,
/// which dies with 0xC0000135 inside Add-Type-compiled assemblies on
/// real machines — Get-Counter is the supported surface.
fn spawn_pdh_emitter<F>(interval_sec: u32, running: Arc<AtomicBool>, emit: F) -> Result<(), String>
where
    F: Fn(Sample) + Send + Sync + 'static,
{
    let script = format!(
        r#"
$paths = @(
  '\Processor(_Total)\% Processor Time',
  '\Processor Information(_Total)\% Processor Performance',
  '\Memory\Available MBytes',
  '\Memory\Pages Input/sec',
  '\PhysicalDisk(_Total)\Avg. Disk Queue Length',
  '\PhysicalDisk(_Total)\% Idle Time'
)
while ($true) {{
  try {{
    $c = Get-Counter -Counter $paths -SampleInterval {interval_sec} -MaxSamples 1 -ErrorAction Stop
    ($c.CounterSamples | ForEach-Object {{ $_.Path + '=' + $_.CookedValue }}) -join ','
  }} catch {{
    Start-Sleep -Seconds {interval_sec}
  }}
}}
"#
    );
    let mut child = spawn_tracked(
        Command::new(super::system::powershell_exe())
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .creation_flags(NO_WINDOW),
    )
    .map_err(|e| {
        super::logging::error(&format!("pdh emitter spawn failed: {e}"));
        format!("pdh emitter spawn failed: {e}")
    })?;
    let stdout = child.stdout.take().ok_or("no stdout from pdh emitter")?;
    // reap this child even if its stream goes silent mid-session (the
    // watchdog polls the flag and taskkills by PID — see its doc comment)
    spawn_source_watchdog(child.id(), Arc::clone(&running));

    thread::spawn(move || {
        let _keep = SpawnedProcess { child };
        super::logging::info("pdh emitter reader thread started");
        let reader = BufReader::new(stdout);
        // path suffix → our key (robust to the \\HOST prefix Get-Counter
        // adds). Deliberately NOT shared with map_counter_key: that one
        // matches FULL paths (typeperf CSV headers carry them verbatim),
        // this one matches SUFFIXES (Get-Counter lines carry \\HOST\path
        // prefixes of varying length). Same key vocabulary, different
        // matching contract — merging them would silently change which
        // strings each reader accepts.
        let key_of = |path: &str| -> Option<&'static str> {
            let p = path.to_ascii_lowercase();
            if p.ends_with("% processor performance") {
                Some("perf")
            } else if p.ends_with("% processor time") {
                Some("cpu")
            } else if p.ends_with("available mbytes") {
                Some("avail")
            } else if p.ends_with("pages input/sec") {
                Some("pages_in")
            } else if p.ends_with("avg. disk queue length") {
                Some("disk_q")
            } else if p.ends_with("% idle time") {
                Some("disk_idle")
            } else {
                None
            }
        };
        for line in reader.lines() {
            if !running.load(Ordering::Relaxed) {
                break;
            }
            let Ok(line) = line else { break };
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            // line: "\\host\path=v,\\host\path2=v2,..." — the value may
            // itself carry a comma (comma-decimal cultures: "\\...\available
            // mbytes=12,5"), so pairs are split on ",\\" (every pair starts
            // with a backslash path); a bare ',' split would cut the value
            // in two and silently misread it.
            let mut s = Sample {
                t: iso_now(),
                ..Default::default()
            };
            for pair in line.split(",\\") {
                // the first pair keeps its leading backslash, later ones
                // lost theirs to the split — normalize before key_of
                let pair = pair.strip_prefix('\\').unwrap_or(pair);
                let Some(eq) = pair.find('=') else { continue };
                let path = format!("\\{}", pair[..eq].trim());
                let val = &pair[eq + 1..];
                let (Some(key), Some(v)) = (key_of(&path), parse_counter_value_logged(val))
                else {
                    continue;
                };
                match key {
                    "cpu" => s.cpu_total = Some(v),
                    // same sentinel guard as the typeperf path: a negative
                    // performance ratio is a PDH glitch, not a measurement
                    "perf" if v >= 0.0 => s.proc_perf = Some(v),
                    "perf" => {}
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
        super::logging::info("pdh emitter reader loop ended");
        // _keep drops here: powershell killed after the stream ends
    });
    Ok(())
}

/// Parse one counter value the way Windows may have printed it.
/// typeperf PDH-CSV is always dot-decimal (culture-independent), but the
/// PowerShell Get-Counter emitter formats with the CURRENT culture: on a
/// comma-decimal Windows (de-DE, fr-FR, es-ES, ...) a value arrives as
/// "12,5" — which fails `parse::<f64>()` in the typeperf-shaped readers
/// and would be silently MISREAD as "12" by any bare-comma split. ONE
/// parser for both paths: dot first (every locale we support today),
/// then a strict digits,digits comma-decimal fallback. Anything else is
/// None — a value we cannot confidently read is dropped, never guessed
/// (dropping is honest; misreading is a manufactured diagnosis).
fn parse_counter_value(raw: &str) -> Option<f64> {
    let t = raw.trim().trim_matches('"');
    if let Ok(v) = t.parse::<f64>() {
        return Some(v);
    }
    // comma-decimal shape: exactly digits ',' digits, nothing else.
    // Grouping shapes ("1,234,567") never match — no culture groups with
    // the same char it uses as its decimal separator.
    let (whole, frac) = t.split_once(',')?;
    if !whole.is_empty()
        && !frac.is_empty()
        && whole.bytes().all(|b| b.is_ascii_digit())
        && frac.bytes().all(|b| b.is_ascii_digit())
    {
        return format!("{whole}.{frac}").parse::<f64>().ok();
    }
    None
}

/// One-shot trace for the comma-decimal culture path: it fires at most once
/// per process, so a user log from such a machine explains its own numbers
/// without one log line per tick.
static COMMA_CULTURE_SEEN: AtomicBool = AtomicBool::new(false);

fn parse_counter_value_logged(raw: &str) -> Option<f64> {
    let v = parse_counter_value(raw)?;
    if !raw.trim().trim_matches('"').parse::<f64>().is_ok()
        && !COMMA_CULTURE_SEEN.swap(true, Ordering::Relaxed)
    {
        super::logging::info("counter values arrive in comma-decimal culture (converted per value)");
    }
    Some(v)
}

fn spawn_typeperf_native<F>(
    interval_sec: u32,
    running: Arc<AtomicBool>,
    emit: F,
) -> Result<(), String>
where
    F: Fn(Sample) + Send + Sync + 'static,
{
    let args: Vec<String> = COUNTER_PATHS
        .iter()
        .map(|s| s.to_string())
        .chain([
            "-si".to_string(),
            interval_sec.to_string(),
            // large sample cap = run until killed
            "-sc".to_string(),
            "32500".to_string(),
        ])
        .collect();

    let mut child = spawn_tracked(
        Command::new(super::system::system32_exe("typeperf.exe"))
            .args(&args)
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .creation_flags(NO_WINDOW), // CREATE_NO_WINDOW
    )
    .map_err(|e| {
        super::logging::error(&format!("typeperf spawn failed: {e}"));
        format!("typeperf spawn failed: {e}")
    })?;
    let stdout = child.stdout.take().ok_or("no stdout from typeperf")?;
    // reap this child even if its stream goes silent mid-session (the
    // watchdog polls the flag and taskkills by PID — see its doc comment)
    spawn_source_watchdog(child.id(), Arc::clone(&running));

    // the reader thread OWNS the child — kills it on exit (Drop), never before
    thread::spawn(move || {
        let _keep = SpawnedProcess { child };
        super::logging::info("typeperf reader thread started");
        let reader = BufReader::new(stdout);
        let mut header: Vec<&'static str> = Vec::new();
        let mut line_no: u32 = 0;
        for line in reader.lines() {
            line_no += 1;
            if !running.load(Ordering::Relaxed) {
                super::logging::info(&format!(
                    "typeperf reader: running flag went false at line {line_no}"
                ));
                break;
            }
            let Ok(line) = line else {
                super::logging::error(&format!(
                    "typeperf stream errored at line {line_no}"
                ));
                break;
            };
            if line_no <= 3 {
                super::logging::info(&format!("typeperf line {line_no}: {line}"));
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
                super::logging::info(&format!(
                    "typeperf header parsed: {} counters",
                    header.len()
                ));
                continue;
            }
            if header.is_empty() {
                continue;
            }
            // data line: "datetime","val1","val2",...
            let parts: Vec<&str> = line.split("\",\"").collect();
            if parts.len() < header.len() + 1 {
                super::logging::warn(&format!(
                    "typeperf data line dropped (parts={} header={})",
                    parts.len(),
                    header.len()
                ));
                continue;
            }
            let values = &parts[1..]; // first element = datetime
            let mut s = Sample {
                t: iso_now(),
                ..Default::default()
            };
            for (i, key) in header.iter().enumerate() {
                let raw = values.get(i).unwrap_or(&"");
                let Some(v) = parse_counter_value_logged(raw) else { continue };
                match *key {
                    "cpu" => s.cpu_total = Some(v),
                    // % Processor Performance is a ratio: physically it cannot
                    // go below ~0. typeperf occasionally emits a sentinel
                    // (-1) on transient PDH glitches; accepting it produced
                    // phantom "cpu_throttle" crit events (perf=-1 under 51%
                    // load). A negative reading is no reading.
                    "perf" if v >= 0.0 => s.proc_perf = Some(v),
                    "perf" => {}
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
        super::logging::info(&format!(
            "typeperf reader loop ended after {line_no} lines"
        ));
        // _keep drops here: typeperf killed after the stream truly ends
    });
    Ok(())
}

/// Spawns `nvidia-smi dmon` and calls `emit` with each GpuSample.
/// If nvidia-smi is missing, returns Ok(false) → session continues GPU-less.
/// Intentional PATH lookup (not system32_exe): driver-provided tool, also
/// reachable via its own PATH entry; absolute-only would miss valid installs.
pub fn spawn_dmon<F>(interval_sec: u32, running: Arc<AtomicBool>, emit: F) -> Result<bool, String>
where
    F: Fn(GpuSample) + Send + Sync + 'static,
{
    // check availability quickly first
    let probe = output_tracked(Command::new("nvidia-smi")
        .arg("--query-gpu=clocks.max.gr")
        .arg("--format=csv,noheader")
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(NO_WINDOW), Duration::from_secs(5));
    let Ok(out) = probe else { return Ok(false) };
    if !out.status.success() {
        return Ok(false);
    }

    // 'u' = utilization: WITHOUT it dmon never emits the sm/mem columns and
    // render-stall / gpu-mem-idle detection silently dies (real-machine bug).
    // (dmon has NO sample cap — without the Job Object an app abort leaked
    // it forever; the job now reaps it with us.)
    let mut child = spawn_tracked(
        Command::new("nvidia-smi")
            .args(["dmon", "-s", "pcmut", "-d", &interval_sec.to_string()])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .creation_flags(NO_WINDOW),
    )
    .map_err(|e| format!("nvidia-smi spawn failed: {e}"))?;

    let stdout = child.stdout.take().ok_or("no stdout from dmon")?;
    // reap this child even if its stream goes silent mid-session (the
    // watchdog polls the flag and taskkills by PID — see its doc comment)
    spawn_source_watchdog(child.id(), Arc::clone(&running));

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
                cols = line
                    .trim_start_matches('#')
                    .split_whitespace()
                    .map(String::from)
                    .collect();
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
    let out = output_tracked(Command::new(super::system::system32_exe("tasklist.exe"))
        .args(["/FO", "CSV", "/NH"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(NO_WINDOW), Duration::from_secs(5))
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
        let Some(name_raw) = parts.next() else {
            continue;
        };
        let name = name_raw.trim_matches('"');
        if !is_gameloop_process(name) {
            continue;
        }
        let pid = parts.next().unwrap_or("").trim_matches('"').parse().ok();
        let _session = parts.next();
        let _sessionnum = parts.next();
        // mem field: strip group separators. English/Arabic-Indic digits with
        // any locale thousands-separator ("," and the Arabic U+066C ٬), the
        // "K" unit and non-breaking spaces must all parse to plain kilobytes.
        let mem_str = parts
            .next()
            .unwrap_or("")
            .trim_matches('"')
            .replace([',', '\u{066C}', '\u{a0}', ' '], "")
            .trim_end_matches('K')
            .trim()
            .to_string();
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
/// v6: aow_exe = the game runtime, TBS = UI engine, TxGameAssistant =
/// launcher, AndroidEmulatorEn = engine host. v7 (Androws): the GameLoop
/// family and GLABox VM hosts (CefRendererProcess embeds in unrelated
/// apps, so the UI renderers stay OUT of the gate — they match nothing).
/// ONE list, THREE consumers: this matcher, the visibility probe's process
/// name filter below, and the top-process suspects exclusion in system.rs —
/// the names can never drift apart.
///
/// The set MUST equal the union of the emulator.rs profile families (the
/// `union_matches_profiles` test enforces it): profiles own the knowledge,
/// this const keeps the hot scan zero-cost.
pub const GAMELOOP_PROC_NAMES: [&str; 11] = [
    "aow_exe",
    "TBS",
    "TxGameAssistant",
    "AndroidEmulatorEn",
    "GameLoop",
    "GameLoopEmulator",
    "GameLoopAssistant",
    "GameLoopService",
    "GameLoopDldSvr",
    "GLABoxSVC",
    "GLABoxHeadless",
];

pub fn is_gameloop_process(name: &str) -> bool {
    let base = name.trim_end_matches(".exe");
    GAMELOOP_PROC_NAMES.iter().any(|p| {
        p.eq_ignore_ascii_case(base)
            || base
                .to_ascii_lowercase()
                .starts_with(&p.to_ascii_lowercase())
    })
}

/// Is this OURSELVES? The tool must never appear as a suspect in its own list.
/// Matches any versioned name (`...-1.0.0`) — releases are versioned by hand,
/// so the pattern stays true no matter what the exe is called this release.
/// The companion CLI (`laghunter-cli`) and the test harness binaries
/// (`lag_hunter_*`) are ourselves too: same namespace, every separator.
pub fn is_self_process(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.starts_with("pubg-gameloop-lag-hunter")
        || lower.starts_with("laghunter")
        || lower.starts_with("lag-hunter")
        || lower.starts_with("lag_hunter")
}

/// GameLoop detection: Some("GameLoop") when a game is actually running.
/// v6: an aow-family process IS the game (per-game runtime). v7: the
/// emulator idles with no game, so RunningAppInfo decides (an emulator
/// with an empty VM reads as idle, honestly).
/// What the live machine looks like, for callers that distinguish idle
/// from absent (the start gate's messages differ).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Presence {
    /// a game is running inside the emulator (either generation)
    GameRunning,
    /// v7 client up, VM empty: "start the game" is the honest message
    ClientIdle,
    /// GameLoop-ish evidence matching no profile (a future rename):
    /// never mistaken for absent, never trusted for writes
    UnknownVersion,
    /// nothing GameLoop at all
    Absent,
}

/// Presence from live evidence: one tasklist + one registry snapshot.
/// Thin I/O edge; the decision itself is the pure emulator::detect.
pub fn presence() -> Presence {
    let names = query_all_proc_names().unwrap_or_default();
    let reg = super::emulator::read_snapshot();
    match super::emulator::detect(&names, &reg) {
        super::emulator::Detected::V6Game | super::emulator::Detected::V7Game { .. } => {
            Presence::GameRunning
        }
        super::emulator::Detected::V7Idle { .. } => Presence::ClientIdle,
        super::emulator::Detected::Unknown => Presence::UnknownVersion,
        super::emulator::Detected::Absent => Presence::Absent,
    }
}

/// Every process name on the box (unfiltered): the presence scan above.
/// Fail-soft like the filtered query — an unreadable table reads as empty.
pub fn query_all_proc_names() -> Result<Vec<String>, String> {
    let out = output_tracked(Command::new(super::system::system32_exe("tasklist.exe"))
        .args(["/FO", "CSV", "/NH"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(NO_WINDOW), Duration::from_secs(5))
        .map_err(|e| format!("tasklist spawn failed: {e}"))?;
    if !out.status.success() {
        return Ok(Vec::new());
    }
    Ok(parse_tasklist_names(&String::from_utf8_lossy(&out.stdout)))
}

/// Pure CSV first-column parse (the filtered query shares it): quoted
/// names, any locale — only the name column is ever read here.
fn parse_tasklist_names(text: &str) -> Vec<String> {
    let mut names = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let mut parts = line.split("\",\"");
        if let Some(name_raw) = parts.next() {
            let name = name_raw.trim_matches('"');
            if !name.is_empty() {
                names.push(name.to_string());
            }
        }
    }
    names
}

pub fn detect_emulator() -> Option<String> {
    match presence() {
        Presence::GameRunning => Some("GameLoop".into()),
        _ => None,
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
    // the process list comes from the SAME const is_gameloop_process uses —
    // the two copies used to drift (a name added to one silently missed
    // by the other)
    let names = GAMELOOP_PROC_NAMES
        .iter()
        .map(|n| format!("'{n}'"))
        .collect::<Vec<_>>()
        .join(",");
    let script = format!(
        "$sig = '[DllImport(\"user32.dll\")] public static extern bool IsIconic(IntPtr h);';\n\
         $t = Add-Type -MemberDefinition $sig -Name Win -Namespace P -PassThru;\n\
         $vis = $false;\n\
         foreach ($n in @({names})) {{\n\
           Get-Process -Name \"$n*\" -ErrorAction SilentlyContinue | ForEach-Object {{\n\
             if ($_.MainWindowHandle -ne 0 -and -not $t::IsIconic([IntPtr]$_.MainWindowHandle)) {{ $vis = $true }}\n\
           }}\n\
         }}\n\
         \"visible|$vis\"\n"
    );
    let out = super::sampler::output_tracked(Command::new(super::system::powershell_exe())
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(NO_WINDOW), Duration::from_secs(10))
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
    let out = super::sampler::output_tracked(Command::new("nvidia-smi")
        .args([
            "--query-gpu=clocks.max.gr,clocks.max.mem",
            "--format=csv,noheader,nounits",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(NO_WINDOW), Duration::from_secs(5))
        .ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let mut it = text.trim().split(',');
    let gr = it.next()?.trim().parse().ok()?;
    let mem = it.next()?.trim().parse().ok()?;
    Some((gr, mem))
}

/// ISO-8601 timestamp with milliseconds, LOCAL time (same fixed format as
/// before: `YYYY-MM-DDTHH:MM:SS.mmm`, 24 chars, `Z` suffix retained for
/// format-compat with existing parsers). The offset from UTC is read from
/// the OS (handles DST correctly) and cached, refreshed every ~10 min so
/// a session crossing a DST boundary stays honest.
pub fn iso_now() -> String {
    let now = std::time::SystemTime::now();
    let dur = now
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let offset = local_utc_offset_secs();
    let secs_utc = dur.as_secs();
    let millis = dur.subsec_millis();
    // apply the local offset once (offset may legitimately be negative)
    let secs_local = (secs_utc as i64 + offset).max(0) as u64;
    let days = (secs_local / 86_400) as i64;
    let rem = secs_local % 86_400;
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    // civil-from-days algorithm (Howard Hinnant) — no chrono dependency
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

/// UTC offset of the local time zone, in seconds east of UTC (e.g. Egypt
/// summer = +10800, winter = +7200). Cached with a periodic re-read so a
/// DST transition mid-session corrects itself within ~10 minutes.
#[cfg(windows)]
fn local_utc_offset_secs() -> i64 {
    use std::sync::atomic::{AtomicI64, Ordering};
    use std::sync::Mutex;
    static OFFSET: AtomicI64 = AtomicI64::new(i64::MIN); // MIN = not read yet
    static LAST_READ: Mutex<Option<std::time::Instant>> = Mutex::new(None);
    let mut last = LAST_READ.lock().unwrap_or_else(|p| p.into_inner());
    let fresh = last.map(|t| t.elapsed().as_secs() < 600).unwrap_or(false);
    if !fresh {
        // [TimeZoneInfo]::Local.GetUtcOffset(DateTimeOffset.Now): native,
        // DST-aware, no registry parsing — the same source .NET uses.
        const SCRIPT: &str =
            "[int][TimeZoneInfo]::Local.GetUtcOffset([DateTimeOffset]::Now).TotalSeconds";
        let out = output_tracked(Command::new(super::system::powershell_exe())
            .args(["-NoProfile", "-NonInteractive", "-Command", SCRIPT])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .creation_flags(NO_WINDOW), Duration::from_secs(5));
        if let Ok(o) = out {
            if let Ok(v) = String::from_utf8_lossy(&o.stdout).trim().parse::<i64>() {
                if v.abs() <= 14 * 3600 {
                    OFFSET.store(v, Ordering::Relaxed);
                }
            }
        }
        *last = Some(std::time::Instant::now());
    }
    let v = OFFSET.load(Ordering::Relaxed);
    if v == i64::MIN {
        0
    } else {
        v
    }
}

#[cfg(not(windows))]
fn local_utc_offset_secs() -> i64 {
    0 // non-Windows is out of scope for this tool (Windows-only by design)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counter_mapping() {
        assert_eq!(
            map_counter_key("\\Processor(_Total)\\% Processor Time"),
            Some("cpu")
        );
        assert_eq!(map_counter_key("memory\\available mbytes"), Some("avail"));
        assert_eq!(map_counter_key("unknown counter"), None);
    }

    #[test]
    fn counter_values_parse_in_both_cultures() {
        // dot-decimal (typeperf CSV + every locale we support today)
        assert_eq!(parse_counter_value("12.5"), Some(12.5));
        assert_eq!(parse_counter_value("\"99\""), Some(99.0));
        // comma-decimal cultures (PowerShell Get-Counter formats with the
        // current culture): "12,5" is 12.5, NOT silently misread as 12
        assert_eq!(parse_counter_value("12,5"), Some(12.5));
        assert_eq!(parse_counter_value("\"4096,0\""), Some(4096.0));
        // grouping shapes are NOT comma decimals — refuse rather than guess
        assert_eq!(parse_counter_value("1,234,567"), None);
        assert_eq!(parse_counter_value("1 234"), None);
        assert_eq!(parse_counter_value("x1,2"), None);
        assert_eq!(parse_counter_value("1,"), None);
        assert_eq!(parse_counter_value(",5"), None);
        // sentinel noise stays a non-value
        assert_eq!(parse_counter_value(""), None);
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
    #[cfg(windows)]
    fn iso_now_is_local_time() {
        // The bug this guards: epoch math is UTC — on Egypt (UTC+3) the clock
        // showed "00:19" while the wall clock said "03:19". Cross-check our
        // offset source against the OS truth directly.
        let offset = local_utc_offset_secs();
        // sanity: offsets live in [-14h, +14h]
        assert!(offset.abs() <= 14 * 3600, "absurd tz offset: {offset}");
        // sanity: our iso_now hour must equal the OS local hour (InvariantCulture
        // so the OS string format is guaranteed regardless of display language)
        let ours = iso_now();
        let out = Command::new(crate::engine::system::powershell_exe())
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "(Get-Date).ToString('yyyy-MM-ddTHH:mm',[Globalization.CultureInfo]::InvariantCulture)",
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .creation_flags(NO_WINDOW)
            .output()
            .expect("powershell spawn");
        let os = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let ours_minute = format!("{}:{}", &ours[0..10], &ours[11..16]);
        // compare at the minute level — the two clock reads happen a moment
        // apart, so a second boundary is fine but a mismatch beyond that
        // (the old UTC bug: hours apart) must fail loudly
        let (os_hm, ours_hm) = (&os[11..16], &ours_minute[11..16]);
        assert_eq!(
            os_hm, ours_hm,
            "iso_now must show wall-clock time (offset={offset}, os={os}, ours={ours_minute})"
        );
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
        // v7 (Androws) family: client, emulator host, helpers, VM hosts
        assert!(is_gameloop_process("GameLoop.exe"));
        assert!(is_gameloop_process("GameLoopEmulator.exe"));
        assert!(is_gameloop_process("GameLoopAssistant.exe"));
        assert!(is_gameloop_process("GameLoopService.exe"));
        assert!(is_gameloop_process("GameLoopDldSvr.exe"));
        assert!(is_gameloop_process("GLABoxSVC.exe"));
        assert!(is_gameloop_process("GLABoxHeadless.exe"));
        assert!(!is_gameloop_process("explorer"));
        assert!(!is_gameloop_process("chrome"));
        assert!(!is_gameloop_process("dnplayer")); // other emulators are out of scope
        assert!(!is_gameloop_process("HD-Player"));
        // CEF embeds in unrelated apps: never a gate signal by itself
        assert!(!is_gameloop_process("CefRendererProcess.exe"));
        assert!(!is_gameloop_process("QQ.exe"));
    }

    #[test]
    fn union_matches_profiles() {
        // the hot-scan const and the profile cards must name the same
        // families: a name added to one and missed by the other silently
        // blinds either the scan or the attribution. CefRendererProcess is
        // deliberately scan-only-excluded (see above), so it is absent here.
        let mut from_const = GAMELOOP_PROC_NAMES.to_vec();
        from_const.sort_unstable();
        let mut from_profiles = super::super::emulator::all_proc_names();
        from_profiles.sort_unstable();
        assert_eq!(from_const, from_profiles);
    }

    #[test]
    fn tasklist_names_parsed() {
        let text = "\"GameLoopEmulator.exe\",\"8692\",\"Console\",\"1\",\"170,928 K\"\n\
                    \"explorer.exe\",\"8616\",\"Console\",\"1\",\"431,604 K\"\n\
                    \"GLABoxHeadless.exe\",\"9048\",\"Console\",\"1\",\"637,124 K\"\n";
        let names = parse_tasklist_names(text);
        assert_eq!(
            names,
            vec![
                "GameLoopEmulator.exe".to_string(),
                "explorer.exe".to_string(),
                "GLABoxHeadless.exe".to_string()
            ]
        );
        assert!(names.iter().any(|n| is_gameloop_process(n)));
    }

    #[test]
    fn self_process_matched() {
        assert!(is_self_process("pubg-gameloop-lag-hunter"));
        assert!(is_self_process("PUBG-GAMELOOP-LAG-HUNTER"));
        // versioned release names must match too
        assert!(is_self_process("pubg-gameloop-lag-hunter-1.0.0"));
        assert!(is_self_process("pubg-gameloop-lag-hunter-1.2.3"));
        assert!(is_self_process("lag-hunter-2.0.0"));
        // the headless companion and the test harness share the namespace
        assert!(is_self_process("laghunter-cli.exe"));
        assert!(is_self_process("lag_hunter_lib-ab12cd34.exe"));
        // anything that doesn't carry our prefix is not us
        assert!(!is_self_process("explorer"));
        assert!(!is_self_process("chrome"));
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
            (
                "\"System Idle Process\",\"0\",\"Services\",\"0\",\"8 K\"",
                "System Idle Process",
                "8",
            ),
            (
                "\"Registry\",\"176\",\"Services\",\"0\",\"60,516 K\"",
                "Registry",
                "60516",
            ),
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
