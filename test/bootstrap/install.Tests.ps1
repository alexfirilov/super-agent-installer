Describe 'install.ps1' {
  BeforeEach {
    $script:tmp = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid().ToString()); New-Item -ItemType Directory -Path $script:tmp | Out-Null
    $env:SAI_INSTALL_DIR = Join-Path $script:tmp 'bin'; $env:SAI_VERSION = '0.1.0'; $env:SAI_BASE_URL = Join-Path $script:tmp 'release'
    New-Item -ItemType Directory -Path $env:SAI_BASE_URL | Out-Null
    $asset = Join-Path $env:SAI_BASE_URL 'super-agent-installer-windows-x64.exe'
    [IO.File]::WriteAllText($asset, 'fake', [Text.UTF8Encoding]::new($false))
    $hash = (Get-FileHash -Algorithm SHA256 $asset).Hash.ToLower()
    [IO.File]::WriteAllText((Join-Path $env:SAI_BASE_URL 'SHA256SUMS'), "$hash  super-agent-installer-windows-x64.exe`n", [Text.UTF8Encoding]::new($false))
    $env:SAI_TEST_ARCH = 'AMD64'; $env:SAI_TEST_NO_PATH = '1'
  }
  It 'downloads from a local base, verifies and installs with -NoRun' {
    & pwsh -NoProfile -File "$PSScriptRoot/../../install.ps1" -NoRun
    $LASTEXITCODE | Should -Be 0
    Test-Path (Join-Path $env:SAI_INSTALL_DIR 'super-agent-installer.exe') | Should -BeTrue
  }
  It 'fails on checksum mismatch and installs nothing' {
    [IO.File]::WriteAllText((Join-Path $env:SAI_BASE_URL 'SHA256SUMS'), "0000  super-agent-installer-windows-x64.exe`n", [Text.UTF8Encoding]::new($false))
    $out = & pwsh -NoProfile -File "$PSScriptRoot/../../install.ps1" -NoRun 2>&1
    $LASTEXITCODE | Should -Not -Be 0
    ($out -join "`n") | Should -Match 'checksum'
    Test-Path (Join-Path $env:SAI_INSTALL_DIR 'super-agent-installer.exe') | Should -BeFalse
  }
  It 'passes PSScriptAnalyzer with 5.1 compatibility rules' {
    $r = Invoke-ScriptAnalyzer -Path "$PSScriptRoot/../../install.ps1" -Severity Warning,Error -IncludeRule PSUseCompatibleSyntax,PSUseCompatibleCommands -Settings @{ Rules = @{ PSUseCompatibleSyntax = @{ Enable = $true; TargetVersions = @('5.1', '7.0') }; PSUseCompatibleCommands = @{ Enable = $true; TargetProfiles = @('win-8_x64_10.0.17763.0_5.1.17763.316_x64_4.0.30319.42000_framework') } } }
    $r | Should -BeNullOrEmpty
  }
  It 'rejects ARM64 with a clear message' {
    $env:SAI_TEST_ARCH = 'ARM64'
    $out = & pwsh -NoProfile -File "$PSScriptRoot/../../install.ps1" -NoRun 2>&1
    $LASTEXITCODE | Should -Be 1
    ($out -join "`n") | Should -Match 'no windows-arm64 build yet'
    Test-Path (Join-Path $env:SAI_INSTALL_DIR 'super-agent-installer.exe') | Should -BeFalse
  }
  It 'fails with a retry / releases-page hint when the download fails (no npx fallback)' {
    Remove-Item (Join-Path $env:SAI_BASE_URL 'super-agent-installer-windows-x64.exe')
    $out = & pwsh -NoProfile -File "$PSScriptRoot/../../install.ps1" -NoRun 2>&1
    $LASTEXITCODE | Should -Be 1
    ($out -join "`n") | Should -Match 'download failed'
    ($out -join "`n") | Should -Match 'releases/tag/v0.1.0'
    ($out -join "`n") | Should -Not -Match 'npx'
  }
}
