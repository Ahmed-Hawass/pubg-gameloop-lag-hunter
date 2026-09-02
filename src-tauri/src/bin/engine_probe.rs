// engine headless test: run a session WITHOUT the UI — pure engine isolation.
// cargo run --bin engine_probe

use lag_hunter_lib::engine::session;
use lag_hunter_lib::engine::types::SessionStatus;
use std::time::{Duration, Instant};

fn main() {
    println!("== engine headless probe ==");
    let eng = session::init_global();

    println!("[1] starting session (no auto-stop)...");
    if let Err(e) = eng.start(None) {
        println!("    START FAILED: {e}");
        std::process::exit(1);
    }
    println!("    started ok, status = {:?}", eng.status());

    let start = Instant::now();
    let mut last_count = 0u64;
    let mut saw_game = false;
    while start.elapsed() < Duration::from_secs(12) {
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
    let _ = SessionStatus::Idle;
}
