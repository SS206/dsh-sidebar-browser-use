<#
.SYNOPSIS
  Install dsh-browser-use-mcp into a DSH profile (development link mode).

.DESCRIPTION
  Backs up the profile's package.json, pnpm-lock.yaml and cordis.patch.yml,
  adds the project as a link: dependency, appends it to dsh.profile.bundles
  and runs the DSH-bundled pnpm install. Restart DSH afterwards.

.PARAMETER DshHome
  DSH home directory (default: $env:USERPROFILE\.dsh).

.PARAMETER Profile
  Profile directory name (default: desktop).

.PARAMETER DshInstallDir
  DSH installation directory. Inferred from the running "DeepSeek Harness"
  process when omitted.
#>
param(
  [string]$DshHome = (Join-Path $env:USERPROFILE '.dsh'),
  [string]$Profile = 'desktop',
  [string]$DshInstallDir = ''
)

$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$profileDir = Join-Path $DshHome "profiles\$Profile"
$packagePath = Join-Path $profileDir 'package.json'
$lockPath = Join-Path $profileDir 'pnpm-lock.yaml'
$patchPath = Join-Path $profileDir 'cordis.patch.yml'

if (-not (Test-Path $packagePath)) { throw "profile package.json not found: $packagePath" }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir = Join-Path $DshHome ".backups\browser-use-mcp-$stamp"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
Copy-Item $packagePath (Join-Path $backupDir 'package.json')
if (Test-Path $lockPath) { Copy-Item $lockPath (Join-Path $backupDir 'pnpm-lock.yaml') }
if (Test-Path $patchPath) { Copy-Item $patchPath (Join-Path $backupDir 'cordis.patch.yml') }
Write-Host "backup: $backupDir"

$json = Get-Content $packagePath -Raw | ConvertFrom-Json
if ($null -eq $json.dependencies) { $json | Add-Member -NotePropertyName dependencies -NotePropertyValue ([pscustomobject]@{}) }
if ($json.dependencies.PSObject.Properties.Name -contains 'dsh-browser-use-mcp') {
  $json.dependencies.'dsh-browser-use-mcp' = "link:$project"
} else {
  $json.dependencies | Add-Member -NotePropertyName 'dsh-browser-use-mcp' -NotePropertyValue "link:$project"
}
if ($null -eq $json.dsh.profile.bundles) {
  $json.dsh.profile.bundles = @('dsh-browser-use-mcp')
} elseif ($json.dsh.profile.bundles -notcontains 'dsh-browser-use-mcp') {
  $json.dsh.profile.bundles = @($json.dsh.profile.bundles) + 'dsh-browser-use-mcp'
}
$json | ConvertTo-Json -Depth 30 | Set-Content -Path $packagePath -Encoding utf8NoBOM
Write-Host "profile updated: $packagePath"

if ([string]::IsNullOrWhiteSpace($DshInstallDir)) {
  $process = Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -ne $process -and -not [string]::IsNullOrWhiteSpace($process.Path)) {
    $DshInstallDir = Split-Path -Parent $process.Path
  }
}
if ([string]::IsNullOrWhiteSpace($DshInstallDir)) {
  throw 'DSH installation directory not found. Pass -DshInstallDir explicitly.'
}
$node = Join-Path $DshInstallDir 'resources\runtime\primary-runtime\dependencies\node\bin\node.exe'
$pnpm = Join-Path $DshInstallDir 'resources\runtime\pnpm\bin\pnpm.mjs'
if (-not (Test-Path $node)) { throw "node not found: $node" }
if (-not (Test-Path $pnpm)) { throw "pnpm not found: $pnpm" }

Push-Location $profileDir
try {
  & $node $pnpm install --no-frozen-lockfile
  if ($LASTEXITCODE -ne 0) { throw "pnpm install failed with exit code $LASTEXITCODE" }
} finally {
  Pop-Location
}

Write-Host ''
Write-Host 'Installed. Restart DSH to load the host half and spawn the MCP server.'
Write-Host 'Rollback: scripts\uninstall-dev.ps1 -BackupDir <backup path above>'
