# PORTAL X — create the administrator password hash.
# The password itself is never stored anywhere: only its hash goes into the server's environment.
#
#   .\tools\set-admin-password.ps1          # prints a hash to paste into Render as Admin__PasswordHash
#   .\tools\set-admin-password.ps1 -Local   # also saves it for the local launcher (%LOCALAPPDATA%\PortalX\admin.hash)
param([switch]$Local)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$dotnet = Join-Path $env:LOCALAPPDATA 'Microsoft\dotnet\dotnet.exe'
$env:DOTNET_ROOT = Split-Path $dotnet
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'

$secure = Read-Host 'New admin password (at least 12 characters)' -AsSecureString
$plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
if ($plain.Length -lt 12) { throw 'Use at least 12 characters.' }

$hash = $plain | & $dotnet run --project (Join-Path $root 'server\PortalX.Server') --no-launch-profile -c Release -- --hash-password
$plain = $null
if ($LASTEXITCODE -ne 0 -or -not $hash) { throw 'Could not create the hash.' }
$hash = ($hash | Select-Object -Last 1).Trim()

if ($Local) {
  $dir = Join-Path $env:LOCALAPPDATA 'PortalX'
  Set-Content -Path (Join-Path $dir 'admin.hash') -Value $hash -Encoding ascii -NoNewline
  Write-Host "Saved for local runs: $dir\admin.hash"
}
Write-Host ''
Write-Host 'Set these two environment variables on the server (e.g. Render > Environment):'
Write-Host '  Admin__Username      = <your admin user name>'
Write-Host "  Admin__PasswordHash  = $hash"
