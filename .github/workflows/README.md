> **Windows-only project.** The Rust engine spawns `typeperf`, `nvidia-smi`,
> and `tasklist`, all Windows surfaces. CI runs on `windows-latest` only.

# Continuous Integration

Every push and pull request runs the full verification chain that keeps this
project honest:

| Check | What it protects |
| --- | --- |
| `npm test` | Vitest unit tests, version comparison (the update check), error-to-dialog mapping, locale key parity, theme resolution |
| `npm run build` | TypeScript compiles (incl. the locale type bond: `ar.ts` must match `en.ts` key-for-key) and the frontend bundles |
| `npm audit` | Frontend dependency advisories (high+ fails the build) |
| `cargo test` | All engine tests (unit + live integration), detector fingerprints, settings migration, path traversal, honest reporting, plus the **live** typeperf/PowerShell pipeline tests, session race guards, update path hardening |
| `cargo clippy` | Zero warnings policy, the codebase ships clean |
| `cargo audit` | RustSec advisories for the engine's dependency tree |
| version-sync | `package.json`, `tauri.conf.json` (version + `mainBinaryName`), `Cargo.toml`, and `CHANGELOG.md` must all agree: a drifted bump publishes an updater that can never find its own asset |

The live tests (`typeperf_live`, `iso_now_is_local_time`) run against the
runner's real Windows performance counters, the same surfaces users hit.

## Release builds (manual, for now)

The `release-build` job is dispatchable by hand from the Actions tab. It runs
the full `tauri build --no-bundle` in the release profile (LTO, panic=abort),
generates `SHA256SUMS.txt` in the same job (the update contract: the exe and
its checksums are built together), and uploads both as a workflow artifact from the profile the unit tests never touch. Flip it to run on tags once it has
proven itself stable.
