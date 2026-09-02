// integration test: real typeperf → parser → sample arrives
// Run with: cargo test --test typeperf_live -- --nocapture

use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

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
    assert!(header_lines >= 1, "no header line seen; all output:\n{}", all_lines.join("\n"));
    assert!(got >= 2, "no data lines seen; all output:\n{}", all_lines.join("\n"));
    let _ = Duration::from_secs(0);
    let _ = Arc::new(AtomicBool::new(true)).load(Ordering::Relaxed);
}
