@echo off
rem laghunter.cmd — short stable alias for the versioned CLI binary.
rem Lives next to the exes (uses its own folder, never PATH-dependent):
rem   laghunter scan 10
rem Verify hashes first (SHA256SUMS.txt names the versioned files), then
rem just use this name — it never changes across releases.
"%~dp0laghunter-cli.exe" %*
