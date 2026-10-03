[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$InnoCompiler, [Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$fixtureRoot = Join-Path ([IO.Path]::GetFullPath($OutputDirectory)) ('installer-key-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixtureRoot -Force | Out-Null
$fixtureFile = Join-Path $fixtureRoot 'key-test.iss'
$includeFile = Join-Path $projectRoot 'installer/InstallerKey.iss'
@"
[Setup]
AppName=Batto Installer Key Test
AppVersion=1
DefaultDirName=$fixtureRoot\installed
PrivilegesRequired=lowest
OutputDir=$fixtureRoot
OutputBaseFilename=key-test
CreateUninstallRegKey=no
Uninstallable=no
DisableWelcomePage=yes
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=yes
Compression=none
[Files]
Source: "$fixtureRoot\payload.txt"; DestDir: "{app}"
#include "$includeFile"
"@ | Set-Content -LiteralPath $fixtureFile -Encoding utf8
'Isolated encrypted installer test.' | Set-Content -LiteralPath (Join-Path $fixtureRoot 'payload.txt') -Encoding utf8
$previousBuild = $env:BATTO_BUILD_PASSWORD
$previousInstall = $env:BATTO_INSTALL_KEY
$testKey = 'Fixture-' + [Guid]::NewGuid().ToString('N')
$results = @()
try {
  Remove-Item Env:BATTO_BUILD_PASSWORD -ErrorAction SilentlyContinue
  & $InnoCompiler /Q $fixtureFile *> (Join-Path $fixtureRoot 'missing-build-key.log')
  if ($LASTEXITCODE -eq 0 -or (Test-Path -LiteralPath (Join-Path $fixtureRoot 'key-test.exe'))) { throw 'Missing build key did not block compilation.' }
  $results += 'Missing build key rejects compilation'
  $env:BATTO_BUILD_PASSWORD = $testKey
  & $InnoCompiler /Q $fixtureFile *> (Join-Path $fixtureRoot 'compile.log')
  if ($LASTEXITCODE -ne 0) { throw "Fixture compilation failed. See $fixtureRoot/compile.log" }
  Remove-Item Env:BATTO_BUILD_PASSWORD -ErrorAction SilentlyContinue
  foreach ($mode in @('missing','wrong','correct')) {
    if ($mode -eq 'missing') { Remove-Item Env:BATTO_INSTALL_KEY -ErrorAction SilentlyContinue }
    elseif ($mode -eq 'wrong') { $env:BATTO_INSTALL_KEY = 'wrong-fixture-key' }
    else { $env:BATTO_INSTALL_KEY = $testKey }
    $destination = Join-Path $fixtureRoot $mode
    $log = Join-Path $fixtureRoot "$mode.log"
    $arguments = @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',('/DIR="' + $destination + '"'),('/LOG="' + $log + '"'))
    $process = Start-Process -FilePath (Join-Path $fixtureRoot 'key-test.exe') -ArgumentList $arguments -WindowStyle Hidden -PassThru
    if (-not $process.WaitForExit(20000)) { $process.Kill();throw 'Isolated installer fixture timed out.' }
    $process.Refresh()
    $installed = Test-Path -LiteralPath (Join-Path $destination 'payload.txt')
    if (($mode -eq 'correct') -ne $installed) { throw "Unexpected installation result for $mode key. See $fixtureRoot" }
    if ($mode -eq 'correct' -and (Get-Content -LiteralPath (Join-Path $destination 'payload.txt') -Raw).Trim() -ne 'Isolated encrypted installer test.') { throw 'Encrypted payload does not match.' }
    if ((Get-Content -LiteralPath $log -Raw).Contains($testKey)) { throw 'Installer test key leaked into log.' }
    $results += "Runtime $mode key: " + $(if($installed){'encrypted payload installed'}else{'installation rejected'})
  }
  $results += 'No command-line password, no key in installer logs'
  $results | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $fixtureRoot 'result.json') -Encoding utf8
  $results
  Write-Output "Evidence: $fixtureRoot/result.json"
} finally {
  if ($null -eq $previousBuild) { Remove-Item Env:BATTO_BUILD_PASSWORD -ErrorAction SilentlyContinue } else { $env:BATTO_BUILD_PASSWORD = $previousBuild }
  if ($null -eq $previousInstall) { Remove-Item Env:BATTO_INSTALL_KEY -ErrorAction SilentlyContinue } else { $env:BATTO_INSTALL_KEY = $previousInstall }
  $testKey = $null; $previousBuild = $null; $previousInstall = $null
}
