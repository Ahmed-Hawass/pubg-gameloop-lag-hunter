# CLI (headless, no window)

The engine runs without the interface. This is what we use to debug
"the samples stopped flowing" reports, and what you can use to test the
diagnosis engine on any machine.

## The engine probe

```bash
cd src-tauri
cargo run --bin engine_probe --release
```

What it does:
1. Starts a real 12-second monitoring session (same samplers, same detector,
   same storage as the app).
2. Prints one line per second: sample count, game detection, live CPU values.
3. Stops, finalizes the session on disk (real report files).
4. Prints the verdict: `ENGINE OK` or `ENGINE BROKEN`.

Reading the output:

```
[1] starting session (no auto-stop)...
[2] stopping...
[3] final: samples=12 game_seen=true status=Finished
== RESULT: ENGINE OK, samples flowed ==
== GAME DETECTION OK ==
```

- `samples=0` → the sampling pipeline is broken on this machine
  (look at `logs/laghunter-<date>.log` for spawn errors).
- `game_seen=false` → GameLoop detection failed, check that
  `aow_exe`/`TBS`/`TxGameAssistant`/`AndroidEmulatorEn` appear in
  `tasklist` output on that machine.

Exit codes: `0` healthy, `2` engine broken, other non-zero = start failure
(including `GAMELOOP_NOT_RUNNING`, the gate applies headless too).

## The live pipeline test

```bash
cd src-tauri
cargo test --test typeperf_live -- --nocapture
```

Asserts that real typeperf output parses into ≥1 header and ≥2 samples.
This is the test that caught two of the worst bugs during development
(a process-lifetime bug and a machine-name parsing bug).
