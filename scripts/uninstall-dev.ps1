<#
.SYNOPSIS
  Uninstall dsh-sidebar-browser-use from a DSH profile.

.DESCRIPTION
  Restores the most recent install backup (or -BackupDir) and re-runs the
  DSH-bundled pnpm install. Without a backup it removes the dependency and
  bundle entry and reinstalls.
#>
param(
  [string]$DshHome = (Join-Path $env:USERPROFILE '.dsh'),
  [string]$Profile = 'desktop',
  [string]$DshInstallDir = '',
  [string]$BackupDir = ''
)

$ErrorActionPreference = 'Stop'
$profileDir = Join-Path $DshHome "profiles\$Profile"
$packagePath = Join-Path $profileDir 'package.json'
if (-not (Test-Path $packagePath)) { throw "profile package.json not found: $packagePath" }

if ([string]::IsNullOrWhiteSpace($BackupDir)) {
  $candidate = Get-ChildItem (Join-Path $DshHome '.backups') -Directory -Filter 'sidebar-browser-use-*' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($null -ne $candidate) { $BackupDir = $candidate.FullName }
}

if (-not [string]::IsNullOrWhiteSpace($BackupDir)) {
  if (-not (Test-Path (Join-Path $BackupDir 'package.json'))) { throw "backup package.json not found in $BackupDir" }
  Copy-Item (Join-Path $BackupDir 'package.json') $packagePath -Force
  if (Test-Path (Join-Path $BackupDir 'pnpm-lock.yaml')) { Copy-Item (Join-Path $BackupDir 'pnpm-lock.yaml') (Join-Path $profileDir 'pnpm-lock.yaml') -Force }
  if (Test-Path (Join-Path $BackupDir 'cordis.patch.yml')) { Copy-Item (Join-Path $BackupDir 'cordis.patch.yml') (Join-Path $profileDir 'cordis.patch.yml') -Force }
  Write-Host "restored backup: $BackupDir"
} else {
  $json = Get-Content $packagePath -Raw | ConvertFrom-Json
  if ($json.dependencies.PSObject.Properties.Name -contains 'dsh-sidebar-browser-use') {
    $json.dependencies.PSObject.Properties.Remove('dsh-sidebar-browser-use')
  }
  $json.dsh.profile.bundles = @($json.dsh.profile.bundles | Where-Object { $_ -ne 'dsh-sidebar-browser-use' })
  $json | ConvertTo-Json -Depth 30 | Set-Content -Path $packagePath -Encoding utf8NoBOM
  Write-Host 'removed dependency and bundle entry (no backup found)'
}

if ([string]::IsNullOrWhiteSpace($DshInstallDir)) {
  $process = Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -ne $process -and -not [string]::IsNullOrWhiteSpace($process.Path)) { $DshInstallDir = Split-Path -Parent $process.Path }
}
if ([string]::IsNullOrWhiteSpace($DshInstallDir)) { throw 'DSH installation directory not found. Pass -DshInstallDir explicitly.' }
$node = Join-Path $DshInstallDir 'resources\runtime\primary-runtime\dependencies\node\bin\node.exe'
$pnpm = Join-Path $DshInstallDir 'resources\runtime\pnpm\bin\pnpm.mjs'

Push-Location $profileDir
try {
  & $node $pnpm install --no-frozen-lockfile
  if ($LASTEXITCODE -ne 0) { throw "pnpm install failed with exit code $LASTEXITCODE" }
} finally {
  Pop-Location
}
Write-Host ''
Write-Host 'Uninstalled. Restart DSH to unload the plugin.'
