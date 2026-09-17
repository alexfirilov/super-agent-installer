<#
 super-agent-installer bootstrap for Windows (Windows PowerShell 5.1 and PowerShell 7).
 Usage: irm https://raw.githubusercontent.com/alexfirilov/super-agent-installer/v0.1.0/install.ps1 | iex
        & ([scriptblock]::Create((irm https://raw.githubusercontent.com/alexfirilov/super-agent-installer/v0.1.0/install.ps1))) -NoRun
#>
[CmdletBinding()]
param([switch]$NoRun, [Parameter(ValueFromRemainingArguments = $true)][string[]]$RestArgs)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$defaultVersion = '0.1.0'
$version = if ($env:SAI_VERSION) { $env:SAI_VERSION } else { $defaultVersion }
$repo = if ($env:SAI_REPO) { $env:SAI_REPO } else { 'alexfirilov/super-agent-installer' }
$base = if ($env:SAI_BASE_URL) { $env:SAI_BASE_URL } else { "https://github.com/$repo/releases/download/v$version" }
$installDir = if ($env:SAI_INSTALL_DIR) { $env:SAI_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'super-agent-installer\bin' }

function Say([string]$m) { Write-Host "super-agent-installer: $m" }
function Fail([string]$m) { Write-Host "super-agent-installer: $m"; exit 1 }

$archRaw = if ($env:SAI_TEST_ARCH) { $env:SAI_TEST_ARCH } else { $env:PROCESSOR_ARCHITECTURE }
$arch = switch ($archRaw) { 'AMD64' { 'x64' } 'ARM64' { Fail 'no windows-arm64 build yet (use WSL and install.sh on this machine)' } default { Fail "unsupported architecture: $archRaw" } }
$asset = "super-agent-installer-windows-$arch.exe"

$tmp = Join-Path ([IO.Path]::GetTempPath()) ("sai-" + [Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $tmp | Out-Null

function Get-Asset([string]$name, [string]$dest) {
  if ($base -match '^https?://') { Invoke-WebRequest -UseBasicParsing -Uri "$base/$name" -OutFile $dest }
  else { Copy-Item -Path (Join-Path $base $name) -Destination $dest }
}

try {
  Say "downloading $asset v$version"
  try { Get-Asset $asset (Join-Path $tmp $asset); Get-Asset 'SHA256SUMS' (Join-Path $tmp 'SHA256SUMS') }
  catch { Fail "download failed: $($_.Exception.Message). Retry, or download $asset and SHA256SUMS from https://github.com/$repo/releases/tag/v$version and put it at $installDir\super-agent-installer.exe" }

  $line = Get-Content (Join-Path $tmp 'SHA256SUMS') | Where-Object { $_ -match "\s$([regex]::Escape($asset))$" } | Select-Object -First 1
  if (-not $line) { Fail "no checksum for $asset in SHA256SUMS" }
  $expected = ($line -split '\s+')[0].ToLower()
  $actual = (Get-FileHash -Algorithm SHA256 (Join-Path $tmp $asset)).Hash.ToLower()
  if ($actual -ne $expected) { Fail "checksum mismatch for ${asset}: expected $expected, got $actual" }

  New-Item -ItemType Directory -Path $installDir -Force | Out-Null
  $exe = Join-Path $installDir 'super-agent-installer.exe'
  try { Move-Item -Path (Join-Path $tmp $asset) -Destination $exe -Force }
  catch { Fail "cannot replace $exe (is super-agent-installer running?): $($_.Exception.Message)" }

  if (-not $env:SAI_TEST_NO_PATH) {
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if (-not $userPath) { $userPath = '' }
    if (($userPath -split ';') -notcontains $installDir) {
      [Environment]::SetEnvironmentVariable('Path', ($userPath.TrimEnd(';') + ';' + $installDir).TrimStart(';'), 'User')
      Say "added $installDir to your user PATH"
    }
    if (($env:Path -split ';') -notcontains $installDir) { $env:Path = "$installDir;$env:Path" }
  }

  Say "installed to $exe"
  if ($NoRun) { exit 0 }
  & $exe @RestArgs
  exit $LASTEXITCODE
}
finally { Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue }
