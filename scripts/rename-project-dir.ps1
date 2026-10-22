#requires -Version 5.1
<#
.SYNOPSIS
  Rename the project directory to dsh-sidebar-browser-use.

.DESCRIPTION
  DSH locks the workspace directory while it runs, so the directory rename
  cannot happen in-session (EBUSY). Quit DSH completely, then run:

      pwsh -File scripts/rename-project-dir.ps1

  The script renames the project folder, points the desktop profile at the new
  path (dependency key, link target and bundle entry), runs the DSH-bundled
  pnpm install and asks you to restart DSH.

  The npm package name is already dsh-sidebar-browser-use; this script only
  finishes the directory rename and the profile link.

.PARAMETER DshHome
  DSH home directory (default: $env:USERPROFILE\.dsh).

.PARAMETER Profile
  Profile directory name (default: desktop).

.PARAMETER DshInstallDir
  DSH installation directory. Detected from common install locations when omitted.
#>
param(
  [string]$DshHome = (Join-Path $env:USERPROFILE '.dsh'),
  [string]$Profile = 'desktop',
  [string]$DshInstallDir = ''
)

$ErrorActionPreference = 'Stop'

$running = Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue
if ($null -ne $running) {
  throw 'DSH is still running. Quit DeepSeek Harness completely, then run this script again.'
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$parent = Split-Path -Parent $projectRoot
$oldName = Split-Path -Leaf $projectRoot
$newName = 'dsh-sidebar-browser-use'
$newRoot = Join-Path $parent $newName

if ($oldName -eq $newName) {
  Write-Host "Project directory is already named $newName."
  $newRoot = $projectRoot
} else {
  if (Test-Path -LiteralPath $newRoot) { throw "Target directory already exists: $newRoot" }
  Rename-Item -LiteralPath $projectRoot -NewName $newName
  Write-Host "Renamed: $projectRoot -> $newRoot"
}

$profileDir = Join-Path $DshHome "profiles\$Profile"
$packagePath = Join-Path $profileDir 'package.json'
if (-not (Test-Path $packagePath)) { throw "profile package.json not found: $packagePath" }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir = Join-Path $DshHome ".backups\sidebar-browser-use-rename-$stamp"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
Copy-Item $packagePath (Join-Path $backupDir 'package.json')

$json = Get-Content $packagePath -Raw | ConvertFrom-Json
if ($null -eq $json.dependencies) {
  $json | Add-Member -NotePropertyName dependencies -NotePropertyValue ([pscustomobject]@{})
}
if ($json.dependencies.PSObject.Properties.Name -contains 'dsh-sidebar-browser-use') {
  $json.dependencies.'dsh-sidebar-browser-use' = "link:$newRoot"
} else {
  $json.dependencies | Add-Member -NotePropertyName 'dsh-sidebar-browser-use' -NotePropertyValue "link:$newRoot"
}
if ($json.dependencies.PSObject.Properties.Name -contains 'dsh-browser-use-mcp') {
  $json.dependencies.PSObject.Properties.Remove('dsh-browser-use-mcp')
}
if ($null -eq $json.dsh.profile.bundles) {
  $json.dsh.profile.bundles = @('dsh-sidebar-browser-use')
} else {
  $json.dsh.profile.bundles = @(
    $json.dsh.profile.bundles |
      ForEach-Object { if ($_ -eq 'dsh-browser-use-mcp') { 'dsh-sidebar-browser-use' } else { $_ } } |
      Select-Object -Unique
  )
}
$json | ConvertTo-Json -Depth 30 | Set-Content -Path $packagePath -Encoding utf8NoBOM
Write-Host "profile updated: $packagePath"

if ([string]::IsNullOrWhiteSpace($DshInstallDir)) {
  $programFilesX86 = [Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFilesX86)
  $candidates = @(
    (Join-Path $env:ProgramFiles 'dsh'),
    (Join-Path $programFilesX86 'dsh'),
    (Join-Path $env:LOCALAPPDATA 'Programs\dsh'),
    (Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness')
  )
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path (Join-Path $candidate 'resources\runtime\pnpm\bin\pnpm.mjs'))) {
      $DshInstallDir = $candidate
      break
    }
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
Write-Host "Done. Project directory: $newRoot"
Write-Host 'Restart DSH, then open this new directory as the workspace.'
