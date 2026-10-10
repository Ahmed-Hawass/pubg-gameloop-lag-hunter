// laghunter-cli — the user-facing console companion to the GUI app.
// Same release, same engine, own binary: a console subsystem is REQUIRED
// because the GUI exe is windows-subsystem (its stdout never reaches a
// parent terminal in release builds). No window, no WebView2 needed, no
// admin needed — scanning only, by design. Writes go through the exact
// same engine paths as the GUI (same sessions dir, same reports), so a
// CLI scan shows up in the Reports tab and vice versa.
//
// Output is English only (console code pages mangle Arabic); the GUI
// stays fully bilingual. Colors auto-disable when piped, under NO_COLOR,
// or with --no-color; --quiet leaves only the final verdict.

use lag_hunter_lib::engine::{session, storage};
use std::io::IsTerminal;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

// ---- FIGlet-style banner (block capitals, built from a letter table so
// every row aligns by construction — the test pins equal row widths) ----

const LETTERS: [(char, [&str; 5]); 8] = [
    ('L', ["#    ", "#    ", "#    ", "#    ", "#####"]),
    ('A', [" ### ", "#   #", "#####", "#   #", "#   #"]),
    ('G', [" ### ", "#    ", "#.###", "#   #", " ### "]),
    ('H', ["#   #", "#   #", "#####", "#   #", "#   #"]),
    ('U', ["#   #", "#   #", "#   #", "#   #", " ### "]),
    ('N', ["#   #", "##  #", "# # #", "#  ##", "#   #"]),
    ('T', ["#####", "  #  ", "  #  ", "  #  ", "  #  "]),
    ('E', ["#####", "#    ", "#### ", "#    ", "#####"]),
];

fn banner_rows() -> [String; 5] {
    let mut rows = [
        String::new(),
        String::new(),
        String::new(),
        String::new(),
        String::new(),
    ];
    // "LAG HUNTER" has no R in the table: R shares E's top with a leg.
    let r: [&str; 5] = ["#### ", "#   #", "#### ", "#  # ", "#   #"];
    let word = |rows: &mut [String; 5], letters: &[&[&str; 5]]| {
        for (i, row) in rows.iter_mut().enumerate() {
            for (j, l) in letters.iter().enumerate() {
                if j > 0 {
                    row.push(' ');
                }
                row.push_str(l[i]);
            }
        }
    };
    let lookup = |c: char| -> &[&str; 5] {
        LETTERS
            .iter()
            .find(|(k, _)| *k == c)
            .map(|(_, v)| v)
            .unwrap_or(&LETTERS[3].1) // unknown glyphs render as H: visible, never blank
    };
    word(&mut rows, &['L', 'A', 'G'].map(lookup));
    for row in rows.iter_mut() {
        row.push_str("  ");
    }
    let hunter: Vec<&[&str; 5]> = ['H', 'U', 'N', 'T', 'E']
        .map(lookup)
        .into_iter()
        .chain(std::iter::once(&r))
        .collect();
    word(&mut rows, &hunter);
    rows
}

// ---- color: ANSI, auto-disabled when piped, under NO_COLOR, or --no-color ----

fn colors_enabled(no_color_flag: bool, no_color_env: bool, is_tty: bool) -> bool {
    !no_color_flag && !no_color_env && is_tty
}

fn paint(text: &str, code: &str, on: bool) -> String {
    if on {
        format!("\x1b[{code}m{text}\x1b[0m")
    } else {
        text.to_string()
    }
}

// ---- argument parsing (pure: every shape below is unit-tested) ----

#[derive(Debug, PartialEq, Eq)]
enum Command {
    Help,
    Version,
    Scan {
        minutes: u64,
        quiet: bool,
        no_color: bool,
    },
    Sessions,
    Report {
        id: String,
        json: bool,
    },
}

const DEFAULT_MINUTES: u64 = 5;
const MIN_MINUTES: u64 = 1;
const MAX_MINUTES: u64 = 60; // engine clamps 60..3600s; 60 min is the longest UI choice

fn parse_args(args: &[String]) -> Result<Command, String> {
    let mut rest = args.iter().peekable();
    // argv[0] is our own path: the command is the first real token,
    // with or without a leading `--` (both `scan` and `--scan` work)
    let first = rest.next().map(|s| s.as_str()).unwrap_or("");
    let verb = first.strip_prefix("--").unwrap_or(first);
    match verb {
        "" | "help" | "-h" => Ok(Command::Help),
        "version" | "-v" => Ok(Command::Version),
        "scan" => {
            let mut minutes = DEFAULT_MINUTES;
            let mut quiet = false;
            let mut no_color = false;
            let mut positional: Option<&str> = None;
            for tok in rest {
                match tok.as_str() {
                    "--quiet" | "-q" => quiet = true,
                    "--no-color" => no_color = true,
                    other if other.starts_with('-') => {
                        return Err(format!("unknown flag for scan: {other}"));
                    }
                    other => {
                        if positional.is_some() {
                            return Err("scan takes at most one duration".into());
                        }
                        positional = Some(other);
                    }
                }
            }
            if let Some(p) = positional {
                match p.parse::<u64>() {
                    Ok(m) if (MIN_MINUTES..=MAX_MINUTES).contains(&m) => minutes = m,
                    _ => {
                        return Err(format!(
                            "scan minutes must be a number {MIN_MINUTES}..={MAX_MINUTES}"
                        ));
                    }
                }
            }
            Ok(Command::Scan {
                minutes,
                quiet,
                no_color,
            })
        }
        "sessions" | "list" => {
            if rest.next().is_some() {
                return Err("sessions takes no arguments".into());
            }
            Ok(Command::Sessions)
        }
        "report" | "show" => {
            let mut id: Option<String> = None;
            let mut json = false;
            for tok in rest {
                match tok.as_str() {
                    "--json" => json = true,
                    other if other.starts_with('-') => {
                        return Err(format!("unknown flag for report: {other}"));
                    }
                    other => {
                        if id.is_some() {
                            return Err("report takes one session id".into());
                        }
                        id = Some(other.to_string());
                    }
                }
            }
            match id {
                Some(id) => Ok(Command::Report { id, json }),
                None => Err("report needs a session id (or: latest)".into()),
            }
        }
        other => Err(format!("unknown command: {other}")),
    }
}

fn usage() -> &'static str {
    "laghunter — headless lag scans for PUBG Mobile on GameLoop\n\
     \n\
     Usage:\n  \
     laghunter scan [minutes]   run a scan (default 5, 1..60)\n  \
     laghunter sessions         list saved sessions\n  \
     laghunter report <id|latest> [--json]  print a saved report\n  \
     laghunter --help | --version\n\
     \n\
     Flags (scan): --quiet (verdict only), --no-color\n\
     Exit codes: 0 healthy, 1 usage/start failure, 2 engine broken.\n\
     The game must be running inside GameLoop first."
}

// ---- sessions list (+live marker: partial summary + fresh samples file
// means a scan is being written RIGHT NOW, by us or the GUI app) ----

/// Pure half of the live-session marker (the filesystem walk stays below).
fn is_live_marker(partial: bool, samples_age_secs: u64) -> bool {
    partial && samples_age_secs < 60
}

fn session_live(id: &str) -> bool {
    let dir = storage::sessions_root().join(id);
    let summary: serde_json::Value = std::fs::read_to_string(dir.join("summary.json"))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or(serde_json::json!({}));
    let partial = summary
        .get("partial")
        .and_then(|p| p.as_bool())
        .unwrap_or(false);
    if !partial {
        return false;
    }
    let age = std::fs::metadata(dir.join("samples.jsonl"))
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.elapsed().ok())
        .map(|d| d.as_secs())
        .unwrap_or(u64::MAX);
    is_live_marker(partial, age)
}

fn cmd_sessions() -> i32 {
    let entries = storage::session_entries(None);
    if entries.is_empty() {
        println!("No sessions yet. Run: laghunter scan");
        return 0;
    }
    // session_entries is already newest-first (reversed inside storage.rs):
    // no reverse here (the old reverse flipped it back to oldest-first).
    println!(
        "{:<28} {:<16} {:>8} {:>8}  OUTCOME",
        "SESSION", "DATE", "DUR", "SAMPLES"
    );
    for e in entries {
        let live = if session_live(&e.id) {
            "  (running)"
        } else {
            ""
        };
        let dur = if e.duration_sec >= 60 {
            format!("{}m", e.duration_sec / 60)
        } else {
            format!("{}s", e.duration_sec)
        };
        println!(
            "{:<28} {:<16} {:>8} {:>8}  {}{}",
            e.id, e.date, dur, e.samples, e.outcome, live
        );
    }
    0
}

// ---- report printing (human sections, or stable JSON for scripts) ----

fn cmd_report(id: &str, json: bool) -> i32 {
    let resolved = if id.eq_ignore_ascii_case("latest") {
        match storage::list_sessions().pop() {
            Some(last) => last,
            None => {
                eprintln!("No sessions yet. Run: laghunter scan");
                return 1;
            }
        }
    } else {
        id.to_string()
    };
    match storage::friendly_report(&resolved) {
        Err(e) => {
            eprintln!("Cannot open report {resolved}: {e}");
            1
        }
        Ok(r) => {
            if json {
                match serde_json::to_string_pretty(&r) {
                    Ok(text) => println!("{text}"),
                    Err(e) => {
                        eprintln!("Cannot encode report: {e}");
                        return 1;
                    }
                }
                return 0;
            }
            println!("== {} — {} ==", r.id, r.date);
            println!(
                "{} min, {} samples, {} lag spike(s): {}",
                r.duration_sec / 60,
                r.samples,
                r.lag_spikes,
                r.outcome
            );
            if !r.findings.is_empty() {
                println!("\n-- findings --");
                for f in &r.findings {
                    println!("[{}] {}", f.severity, f.title);
                    println!("  {}", f.simple);
                    println!("  fix: {}", f.fix);
                }
            }
            if !r.highlights.is_empty() {
                println!("\n-- key moments --");
                for h in &r.highlights {
                    println!("- {} @ {}", h.kind, h.clock);
                }
            }
            if !r.metrics_summary.is_empty() {
                println!("\n-- numbers --");
                for m in &r.metrics_summary {
                    println!("- {}: {}", m.key, m.value);
                }
            }
            println!("\nfile: {}", r.raw_path);
            0
        }
    }
}

// ---- scan: the engine session with a terminal face ----

fn print_tick(color: bool, secs: u64, samples: u64, game: bool, cpu: String, overall: String) {
    let g = if game {
        paint("game", "32", color)
    } else {
        paint("nogame", "33", color)
    };
    println!("t+{secs:02}s  samples={samples}  {g}  cpu={cpu}  {overall}");
}

fn cmd_scan(minutes: u64, quiet: bool, no_color: bool) -> i32 {
    let color = colors_enabled(
        no_color,
        std::env::var_os("NO_COLOR").is_some(),
        std::io::stdout().is_terminal(),
    );
    if !quiet {
        for row in banner_rows() {
            println!("{}", paint(&row, "32;1", color));
        }
        println!(
            "PUBG GameLoop Lag Hunter {} — headless scan, {} min (Ctrl+C stops, partial saves)",
            lag_hunter_lib::engine::VERSION,
            minutes
        );
    }
    let eng = session::init_global();
    let gen = match eng.start(Some(minutes * 60)) {
        Ok(gen) => gen,
        Err(e) => {
            // the gate speaks machine keys; the CLI is English-only by design
            // (console code pages mangle Arabic), so map the known ones here.
            let msg = match e.as_str() {
                "GAMELOOP_NOT_RUNNING" => {
                    "Game is not running inside GameLoop. Start PUBG Mobile, then scan again.".to_string()
                }
                "EMULATOR_UNKNOWN" => {
                    "GameLoop runs a build this tool does not recognize yet. Update laghunter to the latest version.".to_string()
                }
                other => format!("Start failed: {other}"),
            };
            eprintln!("{msg}");
            if !quiet {
                eprintln!("(log: %LOCALAPPDATA%\\LagHunter\\logs)");
            }
            return 1;
        }
    };
    // same guard threads as the GUI session (probes + liveness + auto-stop):
    // without them a closed game never stops a headless scan and snapshots rot
    session::spawn_session_guards(gen, || {});
    if !quiet {
        println!("measuring — play normally, minimizing pauses GPU monitoring");
    }

    // Ctrl+C stops the scan AND finalizes: a partial report beats no report.
    let stop_flag = Arc::new(AtomicBool::new(false));
    let flag = stop_flag.clone();
    let _ = ctrlc::set_handler(move || {
        flag.store(true, Ordering::SeqCst);
    });

    let deadline = std::time::Instant::now() + Duration::from_secs(minutes * 60);
    let mut last_count = 0u64;
    loop {
        // a guard-triggered stop (game closed, auto-stop) ends the scan
        // early like the GUI: spinning to the deadline on a dead session
        // would only sample the desktop
        if eng.status() != lag_hunter_lib::engine::types::SessionStatus::Running {
            break;
        }
        if stop_flag.load(Ordering::SeqCst) || std::time::Instant::now() >= deadline {
            break;
        }
        std::thread::sleep(Duration::from_millis(1000));
        let ui = eng.last_ui();
        if let Some(ui) = &ui {
            if !quiet && ui.samples_count != last_count {
                print_tick(
                    color,
                    ui.elapsed_sec,
                    ui.samples_count,
                    ui.game_running,
                    ui.bars
                        .cpu
                        .map(|v| v.to_string())
                        .unwrap_or_else(|| "--".into()),
                    format!("{:?}", ui.overall),
                );
                last_count = ui.samples_count;
            }
        }
    }

    match eng.stop() {
        Ok(report) => {
            if !quiet {
                println!(
                    "report: {}",
                    report.as_deref().unwrap_or("(no report file)")
                );
            }
        }
        Err(e) => eprintln!("stop failed: {e}"),
    }
    if !quiet {
        match eng.stop_reason() {
            Some(lag_hunter_lib::engine::types::StopReason::GameLoopClosed) => {
                println!("ended early: the game closed mid-scan — report saved");
            }
            Some(lag_hunter_lib::engine::types::StopReason::AutoStop) => {
                println!("ended: auto-stop time reached");
            }
            _ => {}
        }
    }
    let final_ui = eng.last_ui();
    let samples = final_ui.as_ref().map(|u| u.samples_count).unwrap_or(0);
    let outcome = if samples > 0 {
        let line = format!(
            "done: {samples} samples, {} lag spike(s)",
            final_ui.as_ref().map(|u| u.lag_count).unwrap_or(0)
        );
        println!("{}", paint(&line, "32;1", color));
        0
    } else {
        eprintln!(
            "{}",
            paint(
                "no samples flowed — see %LOCALAPPDATA%\\LagHunter\\logs",
                "31;1",
                color
            )
        );
        2
    };
    outcome
}

fn main() {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let code = match parse_args(&argv) {
        Err(e) => {
            eprintln!("{e}\n\n{}", usage());
            1
        }
        Ok(Command::Help) => {
            println!("{}", usage());
            0
        }
        Ok(Command::Version) => {
            println!("laghunter {}", lag_hunter_lib::engine::VERSION);
            0
        }
        Ok(Command::Scan {
            minutes,
            quiet,
            no_color,
        }) => cmd_scan(minutes, quiet, no_color),
        Ok(Command::Sessions) => cmd_sessions(),
        Ok(Command::Report { id, json }) => cmd_report(&id, json),
    };
    std::process::exit(code);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn parse_help_and_version_forms() {
        assert_eq!(parse_args(&args(&[])), Ok(Command::Help));
        assert_eq!(parse_args(&args(&["--help"])), Ok(Command::Help));
        assert_eq!(parse_args(&args(&["-h"])), Ok(Command::Help));
        assert_eq!(parse_args(&args(&["--version"])), Ok(Command::Version));
        assert_eq!(parse_args(&args(&["-v"])), Ok(Command::Version));
        assert!(parse_args(&args(&["bogus"])).is_err());
        assert!(parse_args(&args(&["--bogus"])).is_err());
    }

    #[test]
    fn parse_scan_defaults_and_bounds() {
        assert_eq!(
            parse_args(&args(&["scan"])),
            Ok(Command::Scan {
                minutes: 5,
                quiet: false,
                no_color: false,
            })
        );
        assert_eq!(
            parse_args(&args(&["scan", "10"])),
            Ok(Command::Scan {
                minutes: 10,
                quiet: false,
                no_color: false,
            })
        );
        assert_eq!(
            parse_args(&args(&["--scan", "60", "--quiet", "--no-color"])),
            Ok(Command::Scan {
                minutes: 60,
                quiet: true,
                no_color: true,
            })
        );
        // outside 1..=60, non-numbers, doubles: usage errors, never panics
        assert!(parse_args(&args(&["scan", "0"])).is_err());
        assert!(parse_args(&args(&["scan", "61"])).is_err());
        assert!(parse_args(&args(&["scan", "ten"])).is_err());
        assert!(parse_args(&args(&["scan", "5", "6"])).is_err());
        assert!(parse_args(&args(&["scan", "--json"])).is_err());
    }

    #[test]
    fn parse_sessions_and_report_shapes() {
        assert_eq!(parse_args(&args(&["sessions"])), Ok(Command::Sessions));
        assert_eq!(parse_args(&args(&["list"])), Ok(Command::Sessions));
        assert!(parse_args(&args(&["sessions", "x"])).is_err());
        assert_eq!(
            parse_args(&args(&["report", "latest"])),
            Ok(Command::Report {
                id: "latest".into(),
                json: false
            })
        );
        assert_eq!(
            parse_args(&args(&["report", "session-1", "--json"])),
            Ok(Command::Report {
                id: "session-1".into(),
                json: true
            })
        );
        assert!(parse_args(&args(&["report"])).is_err());
        assert!(parse_args(&args(&["report", "a", "b"])).is_err());
        assert!(parse_args(&args(&["show", "x", "--verbose"])).is_err());
    }

    #[test]
    fn banner_rows_align() {
        // misaligned ASCII art reads broken: every row same visible width
        let rows = banner_rows();
        assert_eq!(rows.len(), 5);
        let w = rows[0].chars().count();
        assert!(w > 40, "banner too narrow to read as a logo");
        for r in &rows {
            assert_eq!(r.chars().count(), w);
        }
        let joined = rows.join("\n");
        assert!(joined.contains('#'));
    }

    #[test]
    fn colors_gate_on_flag_env_and_tty() {
        assert!(colors_enabled(false, false, true));
        assert!(!colors_enabled(true, false, true)); // --no-color wins
        assert!(!colors_enabled(false, true, true)); // NO_COLOR wins
        assert!(!colors_enabled(false, false, false)); // piped: plain always
        assert_eq!(paint("x", "32", true), "\x1b[32mx\x1b[0m");
        assert_eq!(paint("x", "32", false), "x");
    }

    #[test]
    fn live_marker_needs_partial_and_fresh() {
        assert!(is_live_marker(true, 10));
        assert!(!is_live_marker(true, 3600)); // old partial = crashed, not live
        assert!(!is_live_marker(false, 5)); // finished report, fresh or not
        assert!(!is_live_marker(false, 3600));
    }
}
