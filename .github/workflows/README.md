> **Windows-only project.** The Rust engine spawns `typeperf`, `nvidia-smi`,
> and `tasklist` — all Windows surfaces. CI runs on `windows-latest` only.

# Continuous Integration

Every push and pull request runs the full verification chain that keeps this
project honest:

| Check | What it protects |
| --- | --- |
| `npm test` | Vitest unit tests — version comparison (the update check), error-to-dialog mapping, locale key parity |
| `npm run build` | TypeScript compiles (incl. the locale type bond: `ar.ts` must match `en.ts` key-for-key) and the frontend bundles |
| `cargo test` | All 46 tests — detector fingerprints, settings migration, path traversal, honest reporting, plus the **live** typeperf/PowerShell pipeline tests |
| `cargo clippy` | Zero warnings policy — the codebase ships clean |

The live tests (`typeperf_live`, `iso_now_is_local_time`) run against the
runner's real Windows performance counters — the same surfaces users hit.

## Release builds (manual, for now)

The `release-build` job is dispatchable by hand from the Actions tab. It runs
the full `tauri build --no-bundle` in the release profile (LTO, panic=abort) —
the profile the unit tests never touch. Flip it to run on tags once it has
proven itself stable.
