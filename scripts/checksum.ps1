# checksum.ps1 — release checksums for the shipped exes.
# Reads the GUI exe name from src-tauri/tauri.conf.json (never hardcoded,
# so it can't drift from the real binary name across versions) plus the
# stable CLI companion name, hashes both, and writes SHA256SUMS.txt next
# to them in the exact format the in-app updater parses AND the format
# every past release used:
#     <UPPERCASE_HASH> *<filename><CRLF>
# (GNU-style lines: hash, one space, asterisk, file name. The updater
# looks its own asset up by exact name, so extra lines are ignored.)
# Fails loudly — never writes a wrong or empty sums file.

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$confPath = Join-Path $repoRoot "src-tauri\tauri.conf.json"

if (-not (Test-Path -LiteralPath $confPath)) {
    Write-Error "tauri.conf.json not found at $confPath"
    exit 1
}

$conf = Get-Content -LiteralPath $confPath -Raw | ConvertFrom-Json
$exeNames = @("$($conf.mainBinaryName).exe", "laghunter-cli.exe")

$lines = foreach ($exeName in $exeNames) {
    $exePath = Join-Path $repoRoot "src-tauri\target\release\$exeName"
    if (-not (Test-Path -LiteralPath $exePath)) {
        Write-Error "Built exe not found at $exePath. Run 'npx tauri build --no-bundle' first."
        exit 1
    }
    $hash = (Get-FileHash -LiteralPath $exePath -Algorithm SHA256).Hash.ToUpperInvariant()
    Write-Output "  $hash *$exeName"
    "$hash *$exeName"
}
$outPath = Join-Path $repoRoot "src-tauri\target\release\SHA256SUMS.txt"

# CRLF line endings to match every previously published sums file
[IO.File]::WriteAllText($outPath, (($lines -join "`r`n") + "`r`n"))

Write-Output "SHA256SUMS.txt written:"
Write-Output "  file: $outPath"
