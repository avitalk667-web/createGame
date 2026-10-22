# PORTAL X — create the administrator password hash for the server setting Admin__PasswordHash.
#
# The password is typed into a hidden prompt and never stored, printed or logged.
# The resulting hash is copied to the clipboard (not printed) so it can be pasted into Render > Environment.
#
#   .\tools\set-admin-password.ps1                  # uses the .NET SDK and the server's own hashing code
#   .\tools\set-admin-password.ps1 -WithoutDotnet   # no .NET SDK needed: same standard hash, computed in PowerShell
#   .\tools\set-admin-password.ps1 -Local           # also saves the hash for the local launcher
param([switch]$Local, [switch]$WithoutDotnet)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent

function Find-Dotnet {
  $candidates = @()
  $cmd = Get-Command dotnet -ErrorAction SilentlyContinue
  if ($cmd) { $candidates += $cmd.Source }
  if ($env:DOTNET_ROOT) { $candidates += (Join-Path $env:DOTNET_ROOT 'dotnet.exe') }
  $candidates += (Join-Path $env:ProgramFiles 'dotnet\dotnet.exe')
  $candidates += (Join-Path $env:LOCALAPPDATA 'Microsoft\dotnet\dotnet.exe')
  $candidates += (Join-Path $HOME '.dotnet\dotnet.exe')
  foreach ($path in $candidates) {
    if (-not $path -or -not (Test-Path $path -PathType Leaf)) { continue }
    # an SDK (not only a runtime) of version 8 or later is needed to build the server
    $sdks = & $path --list-sdks 2>$null
    if ($LASTEXITCODE -eq 0 -and ($sdks | Where-Object { $_ -match '^(\d+)\.' -and [int]$Matches[1] -ge 8 })) { return $path }
  }
  return $null
}

function Read-Secret([string]$prompt) {
  $secure = Read-Host $prompt -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

<#
  The ASP.NET Core Identity "V3" password hash, byte for byte the format the server verifies:
  0x01 | PRF (2 = HMAC-SHA512) | iterations (100000) | salt length (16) | salt | 32-byte PBKDF2 subkey, all big-endian, Base64.
#>
function New-IdentityV3Hash([string]$password) {
  $salt = New-Object byte[] 16
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($salt)
  $rng.Dispose()
  $kdf = New-Object Security.Cryptography.Rfc2898DeriveBytes($password, $salt, 100000, [Security.Cryptography.HashAlgorithmName]::SHA512)
  $subkey = $kdf.GetBytes(32)
  $kdf.Dispose()
  $be = { param([uint32]$v) $b = [BitConverter]::GetBytes($v); [Array]::Reverse($b); $b }
  $bytes = [byte[]](@([byte]1) + (& $be 2) + (& $be 100000) + (& $be 16) + $salt + $subkey)
  return [Convert]::ToBase64String($bytes)
}

# 1) prepare the hashing tool before asking for the password
$out = $null
$dotnet = $null
if (-not $WithoutDotnet) {
  $dotnet = Find-Dotnet
  if (-not $dotnet) {
    Write-Host ''
    Write-Host 'The .NET 8 SDK was not found on this computer.' -ForegroundColor Yellow
    Write-Host 'Either install it:'
    Write-Host '    winget install Microsoft.DotNet.SDK.8'
    Write-Host '  (or download "SDK 8.0" for Windows x64 from https://dotnet.microsoft.com/download/dotnet/8.0),'
    Write-Host '  then open a NEW terminal and run this script again;'
    Write-Host 'or create the same standard hash without .NET:'
    Write-Host '    .\tools\set-admin-password.ps1 -WithoutDotnet'
    Write-Host 'Nothing was changed.'
    exit 1
  }
  Write-Host "Using .NET SDK: $dotnet"
  $env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
  # a separate output folder, so this works while a local server is running
  $out = Join-Path $env:TEMP 'portalx-hash-tool'
  Write-Host 'Building the hash tool (first time can take a minute)...'
  & $dotnet build (Join-Path $root 'server\PortalX.Server') -c Release -o $out -v quiet -nologo | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Write-Host 'The server build failed, so no hash was created. Run "dotnet build server\PortalX.Server" to see the error,' -ForegroundColor Yellow
    Write-Host 'or use: .\tools\set-admin-password.ps1 -WithoutDotnet'
    exit 1
  }
}

# 2) the password (hidden, typed twice)
$plain = Read-Secret 'New admin password (at least 12 characters)'
if ($plain.Length -lt 12) { Write-Host 'Use at least 12 characters. Nothing was changed.' -ForegroundColor Yellow; exit 1 }
if ((Read-Secret 'Type it again') -cne $plain) { Write-Host 'The two passwords are different. Nothing was changed.' -ForegroundColor Yellow; exit 1 }

# 3) the hash
if ($WithoutDotnet) {
  $hash = New-IdentityV3Hash $plain
} else {
  $hash = $plain | & $dotnet (Join-Path $out 'PortalX.Server.dll') --hash-password
  if ($LASTEXITCODE -ne 0 -or -not $hash) { $plain = $null; Write-Host 'Could not create the hash.' -ForegroundColor Yellow; exit 1 }
  $hash = ($hash | Select-Object -Last 1).Trim()
}
$plain = $null

if ($Local) {
  $dir = Join-Path $env:LOCALAPPDATA 'PortalX'
  New-Item -ItemType Directory -Force $dir | Out-Null
  Set-Content -Path (Join-Path $dir 'admin.hash') -Value $hash -Encoding ascii -NoNewline
  Write-Host "Saved for local runs: $dir\admin.hash"
}

Set-Clipboard -Value $hash
$hash = $null
Write-Host ''
Write-Host 'Done. The password hash is now in the clipboard (it is not shown here).' -ForegroundColor Green
Write-Host 'In Render > portal-x > Environment add:'
Write-Host '  Admin__Username      = the user name you will log in with'
Write-Host '  Admin__PasswordHash  = paste (Ctrl+V)'
Write-Host 'then Save Changes. Afterwards copy something else, so the hash does not stay in the clipboard.'
