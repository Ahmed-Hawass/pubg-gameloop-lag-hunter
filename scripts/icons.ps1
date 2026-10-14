# icons.ps1: one-command artwork refresh (app set + tray states).
# Inputs are exported masters, never hand-drawn pixels: a 1024 app master
# plus the two 32px tray states (idle gray, busy colors). The script
# validates sizes, regenerates the platform set via the Tauri CLI, copies
# the tray states into place, and re-checks every output. Anything off
# fails loudly before it can reach a build.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/icons.ps1 `
#     -Master <path to 1024 app-master PNG> `
#     -TrayIdle <path to 32 tray-idle PNG> `
#     -TrayBusy <path to 32 tray-busy PNG>

param(
  [Parameter(Mandatory = $true)][string]$Master,
  [Parameter(Mandatory = $true)][string]$TrayIdle,
  [Parameter(Mandatory = $true)][string]$TrayBusy
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$iconsDir = Join-Path $repoRoot "src-tauri\icons"

Add-Type -AssemblyName System.Drawing

function Assert-PngSize([string]$path, [int]$want, [string]$role) {
  if (-not (Test-Path -LiteralPath $path)) {
    Write-Error "$role not found at $path. Export it first, then re-run."
    exit 1
  }
  $img = [System.Drawing.Bitmap]::FromFile((Join-Path (Get-Location) $path))
  try {
    if ($img.Width -ne $want -or $img.Height -ne $want) {
      Write-Error "$role must be ${want}x${want}px, got $($img.Width)x$($img.Height)px ($path)."
      exit 1
    }
  } finally {
    $img.Dispose()
  }
  Write-Output "  ok: $role (${want}x${want})"
}

Write-Output "Checking inputs:"
Assert-PngSize $Master 1024 "app master"
Assert-PngSize $TrayIdle 32 "tray idle"
Assert-PngSize $TrayBusy 32 "tray busy"

# Platform set via the local Tauri CLI only (--no-install: never fetch,
# fail loudly when node_modules is missing instead).
Write-Output "Regenerating the platform set (tauri icon)..."
Push-Location -LiteralPath $repoRoot
try {
  npx --no-install tauri icon $Master
  if ($LASTEXITCODE -ne 0) {
    Write-Error "tauri icon failed with exit code $LASTEXITCODE."
    exit 1
  }
} finally {
  Pop-Location
}

Write-Output "Copying tray states..."
Copy-Item -LiteralPath $TrayIdle -Destination (Join-Path $iconsDir "tray-idle-32.png") -Force
Copy-Item -LiteralPath $TrayBusy -Destination (Join-Path $iconsDir "tray-busy-32.png") -Force

Write-Output "Re-checking outputs:"
Assert-PngSize (Join-Path $iconsDir "32x32.png") 32 "platform 32px"
Assert-PngSize (Join-Path $iconsDir "tray-idle-32.png") 32 "tray idle"
Assert-PngSize (Join-Path $iconsDir "tray-busy-32.png") 32 "tray busy"
if (-not (Test-Path -LiteralPath (Join-Path $iconsDir "icon.ico"))) {
  Write-Error "icon.ico missing after tauri icon run."
  exit 1
}
Write-Output "  ok: icon.ico present"

Write-Output "Icons refreshed. Next: npm test, npm run build, cargo test, and"
Write-Output "eyeball the tray tiles at 16/24/32 on light and dark taskbars."
