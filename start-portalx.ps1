# PORTAL X — local launcher
# Starts the local PostgreSQL (portable, %LOCALAPPDATA%\PortalX) and the ASP.NET Core game server.
# The server also serves the built Angular game: open http://localhost:5080
#
#   .\start-portalx.ps1            # build the client (if needed) and run
#   .\start-portalx.ps1 -Rebuild   # force a fresh client build
#   .\start-portalx.ps1 -Lan       # also listen on the local network (other computers can join)
#   .\start-portalx.ps1 -MinPlayers 2   # TESTING ONLY: allow starting with fewer than 4 players (spec default is 4)
param([switch]$Rebuild, [switch]$Lan, [int]$Port = 5080, [int]$MinPlayers = 0)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$pgRoot = Join-Path $env:LOCALAPPDATA 'PortalX'
$pgBin = Join-Path $pgRoot 'pgsql\bin'
$pgData = Join-Path $pgRoot 'data'
$dotnetRoot = Join-Path $env:LOCALAPPDATA 'Microsoft\dotnet'
$dotnet = Join-Path $dotnetRoot 'dotnet.exe'

if (-not (Test-Path $dotnet)) { throw ".NET 8 SDK not found at $dotnet" }
if (-not (Test-Path (Join-Path $pgBin 'pg_ctl.exe'))) { throw "PostgreSQL not found at $pgBin" }

# 1) database
& (Join-Path $pgBin 'pg_ctl.exe') -D $pgData status *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Starting PostgreSQL on port 5433...'
  Start-Process -FilePath (Join-Path $pgBin 'pg_ctl.exe') -ArgumentList @('-D', "`"$pgData`"", '-l', "`"$pgRoot\pg.log`"", 'start') -WindowStyle Hidden -Wait
  Start-Sleep -Seconds 2
}
$pass = (Get-Content (Join-Path $pgRoot 'pg.pass') -Raw).Trim()
$env:ConnectionStrings__Default = "Host=localhost;Port=5433;Database=portalx;Username=portalx;Password=$pass"

# 2) client build (Angular → server wwwroot)
$wwwIndex = Join-Path $root 'server\PortalX.Server\wwwroot\index.html'
if ($Rebuild -or -not (Test-Path $wwwIndex)) {
  Write-Host 'Building the game client...'
  Push-Location (Join-Path $root 'client')
  if (-not (Test-Path 'node_modules')) { npm ci }
  npx ng build
  Pop-Location
}

# 3) server
$env:DOTNET_ROOT = $dotnetRoot
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$bind = if ($Lan) { "http://0.0.0.0:$Port" } else { "http://localhost:$Port" }
$env:ASPNETCORE_URLS = $bind
if ($MinPlayers -gt 0) {
  $env:Game__MinPlayersOverride = "$MinPlayers"
  Write-Host "TEST MODE: minimum players set to $MinPlayers (spec default: 4)"
} else { Remove-Item Env:Game__MinPlayersOverride -ErrorAction SilentlyContinue }
# Local runs use the TEST payment provider: no money is charged and nothing counts as revenue.
# The server refuses the test provider in the Production environment, so local runs use "Local".
$env:ASPNETCORE_ENVIRONMENT = 'Local'
$env:Payments__Provider = 'sandbox'
Write-Host 'TEST PAYMENTS: purchases go through the sandbox page, no real charge.'
Write-Host "PORTAL X is running: http://localhost:$Port   (Ctrl+C to stop)"
if ($Lan) {
  $ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.PrefixOrigin -ne 'WellKnown' } |
    Select-Object -ExpandProperty IPAddress
  foreach ($ip in $ips) { Write-Host "Other devices on the same network: http://${ip}:$Port" }
}
& $dotnet run --project (Join-Path $root 'server\PortalX.Server') --no-launch-profile -c Release
