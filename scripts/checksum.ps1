# checksum.ps1 — release checksum for the built exe.
# Reads the exe name from src-tauri/tauri.conf.json (never hardcoded, so it
# can't drift from the real binary name across versions), hashes it, and
# writes SHA256SUMS.txt next to it in the exact format the in-app updater
# parses AND the format every past release used:
#     <UPPERCASE_HASH> *<filename><CRLF>
# (GNU-style single line: hash, one space, asterisk, file name.)
# Fails loudly — never writes a wrong or empty sums file.

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$confPath = Join-Path $repoRoot "src-tauri\tauri.conf.json"

if (-not (Test-Path -LiteralPath $confPath)) {
    Write-Error "tauri.conf.json not found at $confPath"
    exit 1
}

$conf = Get-Content -LiteralPath $confPath -Raw | ConvertFrom-Json
$exeName = "$($conf.mainBinaryName).exe"
$exePath = Join-Path $repoRoot "src-tauri\target\release\$exeName"

if (-not (Test-Path -LiteralPath $exePath)) {
    Write-Error "Built exe not found at $exePath. Run 'npx tauri build --no-bundle' first."
    exit 1
}

$hash = (Get-FileHash -LiteralPath $exePath -Algorithm SHA256).Hash.ToUpperInvariant()
$outPath = Join-Path (Split-Path -Parent $exePath) "SHA256SUMS.txt"

# CRLF line ending to match every previously published sums file
[IO.File]::WriteAllText($outPath, "$hash *$exeName`r`n")

Write-Output "SHA256SUMS.txt written:"
Write-Output "  file: $outPath"
Write-Output "  $hash *$exeName"
