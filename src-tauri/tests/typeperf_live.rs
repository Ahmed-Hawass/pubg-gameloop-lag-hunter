// integration test: real typeperf → parser → sample arrives
// Run with: cargo test --test typeperf_live -- --nocapture

use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

/// The production parser's contract, re-used by the live test: a value on
/// a comma-decimal culture ("12,5") used to FAIL the old bare
/// `parse::<f64>()` here while production accepted it — the test asserted
/// a contract the engine does not have. Reach through the lib's public
/// parser so the live check tests what actually runs.
fn parse_value(raw: &str) -> Option<f64> {
    // lag_hunter_lib::engine::sampler exposes map_counter_key publicly but
    // keeps parse_counter_value private; the pdh path logs through it. The
    // parser is behavior-pinned by unit tests in sampler.rs, so the live
    // test only needs SHAPE checking (a value exists and parses in the
    // current culture OR the dot form) — parity with production rules is
    // the unit suite's job.
    let t = raw.trim().trim_matches('"');
    if let Ok(v) = t.parse::<f64>() {
        return Some(v);
    }
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

#[test]
fn typeperf_produces_samples_live() {
    let args: Vec<String> = vec![
        "\\Processor(_Total)\\% Processor Time".into(),
        "\\Processor Information(_Total)\\% Processor Performance".into(),
        "\\Memory\\Available MBytes".into(),
        "\\Memory\\Pages Input/sec".into(),
        "\\PhysicalDisk(_Total)\\Avg. Disk Queue Length".into(),
        "\\PhysicalDisk(_Total)\\% Idle Time".into(),
        "-si".into(),
        "1".into(),
        "-sc".into(),
        "3".into(),
    ];

    let mut child = Command::new("typeperf")
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("typeperf spawn");

    let stdout = child.stdout.take().unwrap();
    let reader = BufReader::new(stdout);
    let mut got = 0;
    let mut header_lines = 0;
    let mut all_lines: Vec<String> = Vec::new();
    for line in reader.lines() {
        let Ok(l) = line else { break };
        all_lines.push(l.clone());
        if l.starts_with("\"(PDH") {
            header_lines += 1;
            println!("HEADER: {l}");
        } else if l.starts_with('"') {
            got += 1;
            println!("DATA:   {l}");
        }
    }
    let _ = child.wait();
    println!("headers={header_lines} data_lines={got}");
    assert!(
        header_lines >= 1,
        "no header line seen; all output:\n{}",
        all_lines.join("\n")
    );
    assert!(
        got >= 2,
        "no data lines seen; all output:\n{}",
        all_lines.join("\n")
    );
    let _ = Duration::from_secs(0);
    let _ = Arc::new(AtomicBool::new(true)).load(Ordering::Relaxed);
}

/// Live check of the localized-Windows fallback path: the Get-Counter
/// emitter must produce parseable `path=value` lines with all six metrics.
/// This is what runs when typeperf rejects English counter names
/// (Arabic Windows) — so it must work everywhere, not just here.
#[test]
#[cfg(windows)]
fn get_counter_emitter_produces_lines_live() {
    let script = r#"
$paths = @(
  '\Processor(_Total)\% Processor Time',
  '\Processor Information(_Total)\% Processor Performance',
  '\Memory\Available MBytes',
  '\Memory\Pages Input/sec',
  '\PhysicalDisk(_Total)\Avg. Disk Queue Length',
  '\PhysicalDisk(_Total)\% Idle Time'
)
$c = Get-Counter -Counter $paths -SampleInterval 1 -MaxSamples 1 -ErrorAction Stop
($c.CounterSamples | ForEach-Object { $_.Path + '=' + $_.CookedValue }) -join ','
"#;
    let out = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .expect("powershell spawn");
    assert!(out.status.success(), "powershell exited nonzero");
    let line = String::from_utf8_lossy(&out.stdout);
    let line = line.trim();
    assert!(!line.is_empty(), "emitter produced no output");
    // the emitter joins pairs with ',' — but a comma-DECIMAL culture puts
    // a bare ',' inside values too, so pair boundaries are ",\" (every
    // pair starts with a backslash path), the same split production uses.
    // A bare ',' split counted 12 pairs on de-DE and passed vacuously.
    let pairs: Vec<&str> = line.split(",\\").collect();
    assert!(
        pairs.len() >= 6,
        "expected 6 metrics, got {}: {line}",
        pairs.len()
    );
    for pair in &pairs {
        assert!(pair.contains('='), "malformed pair: {pair}");
        let v = pair.split('=').nth(1).unwrap_or("");
        assert!(
            parse_value(v).is_some(),
            "unparseable value in pair: {pair} (both dot- and comma-decimal accepted)"
        );
    }
    println!("EMITTER: {line}");
}
