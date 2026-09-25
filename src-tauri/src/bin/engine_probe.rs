// engine headless test: run a session WITHOUT the UI — pure engine isolation.
// cargo run --bin engine_probe [-- <seconds>] (default 12, 1..120)

use lag_hunter_lib::engine::session;
use std::time::{Duration, Instant};

/// Probe duration from argv (pure: every shape below is unit-tested).
/// No flags, one optional number — a dev tool, not a product surface.
fn probe_secs(args: &[String]) -> Result<u64, String> {
    if args.len() > 1 {
        return Err("engine_probe takes at most one duration".into());
    }
    match args.first().map(|s| s.as_str()) {
        None => Ok(12),
        Some(raw) => match raw.parse::<u64>() {
            Ok(n) if (1..=120).contains(&n) => Ok(n),
            _ => Err(format!("engine_probe takes seconds 1..=120, got: {raw}")),
        },
    }
}

fn main() {
    println!("== engine headless probe ==");
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let secs = match probe_secs(&argv) {
        Ok(n) => n,
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(1);
        }
    };
    let eng = session::init_global();

    println!("[1] starting session (no auto-stop)...");
    if let Err(e) = eng.start(None) {
        println!("    START FAILED: {e}");
        std::process::exit(1);
    }
    println!(
        "    started ok (generation {}), status = {:?}",
        eng.current_generation(),
        eng.status()
    );

    let start = Instant::now();
    let mut last_count = 0u64;
    let mut saw_game = false;
    while start.elapsed() < Duration::from_secs(secs) {
        std::thread::sleep(Duration::from_millis(1000));
        let ui = eng.last_ui();
        if let Some(ui) = &ui {
            if ui.samples_count != last_count {
                println!(
                    "    t+{:02}s  samples={}  game_running={}  cpu={:?}  overall={:?}",
                    start.elapsed().as_secs(),
                    ui.samples_count,
                    ui.game_running,
                    ui.bars.cpu,
                    ui.overall,
                );
                last_count = ui.samples_count;
            }
            if ui.game_running {
                saw_game = true;
            }
        }
    }

    println!("[2] stopping...");
    match eng.stop() {
        Ok(report) => println!("    stopped ok, report: {report:?}"),
        Err(e) => println!("    STOP FAILED: {e}"),
    }

    let final_ui = eng.last_ui();
    println!(
        "[3] final: samples={} game_seen={} status={:?}",
        final_ui.as_ref().map(|u| u.samples_count).unwrap_or(0),
        saw_game,
        eng.status(),
    );

    if last_count > 0 {
        println!("== RESULT: ENGINE OK — samples flowed ==");
        if saw_game {
            println!("== GAME DETECTION OK ==");
        } else {
            println!("== WARNING: no emulator detected (is the game open?) ==");
        }
    } else {
        println!("== RESULT: ENGINE BROKEN — zero samples flowed ==");
        std::process::exit(2);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn probe_duration_defaults_and_bounds() {
        assert_eq!(probe_secs(&args(&[])), Ok(12));
        assert_eq!(probe_secs(&args(&["30"])), Ok(30));
        assert_eq!(probe_secs(&args(&["1"])), Ok(1));
        assert_eq!(probe_secs(&args(&["120"])), Ok(120));
        assert!(probe_secs(&args(&["0"])).is_err());
        assert!(probe_secs(&args(&["121"])).is_err());
        assert!(probe_secs(&args(&["ten"])).is_err());
        assert!(probe_secs(&args(&["5", "6"])).is_err());
    }
}
