# CLI (headless, no window)

Every release ships `laghunter-cli.exe` next to the app: the same engine
with a terminal face. No install, no admin, no WebView2 needed. Scanning
only, by design (writes stay in the GUI behind its confirms). Verify
hashes first (`SHA256SUMS.txt` covers both exes), then either call the
exe directly or use the stable `laghunter.cmd` alias beside it.

Which headless tool when:

| You want to... | Use |
|---|---|
| Run a real scan without the window | `laghunter scan` (below) |
| Debug "samples stopped flowing" on a machine | `engine_probe` (developers) |
| Assert the live typeperf pipeline parses | `typeperf_live` test |

```text
laghunter scan [minutes]      run a scan (default 5, 1..60)
laghunter sessions            list saved sessions (newest first)
laghunter report <id|latest> [--json]  print a saved report
laghunter --help | --version
```

Flags for `scan`: `--quiet` (verdict only), `--no-color` (colors also
switch off automatically when piped or under `NO_COLOR`).

```text
> laghunter scan 10
LAG HUNTER
PUBG GameLoop Lag Hunter 1.6.0 — headless scan, 10 min
t+07s  samples=1  game  cpu=26  Ok
...
done: 600 samples, 3 lag spike(s)
report: %LOCALAPPDATA%\LagHunter\sessions\session-...\report.md
```

Rules that match the GUI: the game must be running first (same refusal
otherwise), minimizing pauses GPU monitoring, Ctrl+C stops and saves the
partial report instead of dropping it, and a CLI scan shows up in the
Reports tab (one sessions folder for both). Exit codes: `0` healthy, `1`
usage or start failure, `2` engine broken. Sessions with a `(running)`
marker belong to a scan in flight (the GUI app's included). For scripts,
`report latest --json` prints stable machine-keyed fields. Output is
English only (console code pages mangle Arabic).

## Distribution (winget, planned)

Global install without an installer: a `winget` manifest (package
`AhmedHawass.LagHunter`, command alias `laghunter`) pointing at the
release assets. Prerequisites, in order: the CLI exe ships in a GitHub
release first (the manifest needs its published URL and SHA-256, which
only exist after release), then a manifest PR via `wingetcreate` to
`microsoft/winget-pkgs` (bot validation plus reviewer merge, usually
days — nothing instant). Unsigned first-run SmartScreen warnings stay
regardless of the channel.

## Engine probe (developers)

```bash
cd src-tauri
cargo run --bin engine_probe --release [-- seconds]
```

What it does:
1. Starts a real monitoring session of the given length (default 12
   seconds, 1..120) with the same samplers, detector, and storage.
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
  a GameLoop process family appears in `tasklist` output on that machine
  (v6: `aow_exe`/`TBS`/`TxGameAssistant`/`AndroidEmulatorEn`; v7 Androws:
  `GameLoop*`/`GLABox*`).

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
