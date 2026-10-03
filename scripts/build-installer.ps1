[CmdletBinding()]
param(
  [string]$InnoCompiler = '',
  [string]$KeyFile = '',
  [string]$AppSource = '',
  [string]$OutputDirectory = ''
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $InnoCompiler) { $InnoCompiler = (Get-Command ISCC.exe -ErrorAction SilentlyContinue).Source }
if (-not $InnoCompiler -or -not (Test-Path -LiteralPath $InnoCompiler)) { throw 'Inno Setup 7.1 oder neuer ist erforderlich. -InnoCompiler angeben.' }
if (-not $KeyFile) { $KeyFile = Join-Path $env:USERPROFILE 'Documents/Codex/Signing/BattoInstaller/install-key.dpapi' }
$keyPath = [IO.Path]::GetFullPath($KeyFile)
$projectPath = [IO.Path]::GetFullPath($projectRoot).TrimEnd('\','/') + [IO.Path]::DirectorySeparatorChar
if ($keyPath.StartsWith($projectPath,[StringComparison]::OrdinalIgnoreCase)) { throw 'Die private Schlüsseldatei muss außerhalb des Repositories liegen.' }
if (-not (Test-Path -LiteralPath $keyPath)) { throw 'Lokaler Installationsschlüssel fehlt. Kein ungeschützter Installer wird gebaut.' }
$arguments = @((Join-Path $projectRoot 'installer/BattoSuite.iss'))
if ($AppSource) { $arguments = @('/DAppSource=' + [IO.Path]::GetFullPath($AppSource)) + $arguments }
if ($OutputDirectory) { $arguments = @('/DOutputPath=' + [IO.Path]::GetFullPath($OutputDirectory)) + $arguments }
$previousBuildPassword = $env:BATTO_BUILD_PASSWORD
$secureKey = $null
$plainKey = $null
try {
  $secureKey = ConvertTo-SecureString ((Get-Content -LiteralPath $keyPath -Raw).Trim())
  $plainKey = [Net.NetworkCredential]::new('', $secureKey).Password
  if ([string]::IsNullOrWhiteSpace($plainKey) -or $plainKey.Contains("`r") -or $plainKey.Contains("`n")) { throw 'Ungültiger lokaler Installationsschlüssel.' }
  $env:BATTO_BUILD_PASSWORD = $plainKey
  & $InnoCompiler @arguments
  if ($LASTEXITCODE -ne 0) { throw 'Geschützter Installer-Build fehlgeschlagen.' }
} finally {
  if ($null -eq $previousBuildPassword) { Remove-Item Env:BATTO_BUILD_PASSWORD -ErrorAction SilentlyContinue } else { $env:BATTO_BUILD_PASSWORD = $previousBuildPassword }
  if ($secureKey) { $secureKey.Dispose() }
  $secureKey = $null; $plainKey = $null; $previousBuildPassword = $null
}
