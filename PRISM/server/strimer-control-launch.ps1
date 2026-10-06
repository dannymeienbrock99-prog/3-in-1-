param(
  [Parameter(Mandatory=$true)][string]$Helper,
  [Parameter(Mandatory=$true)][int]$OwnerPid,
  [Parameter(Mandatory=$true)][string]$Pipe,
  [Parameter(Mandatory=$true)][string]$Token
)
$ErrorActionPreference = 'Stop'
try {
  if ($Pipe -cnotmatch '^batto-strimer-[a-f0-9]{32}$' -or $Token -notmatch '^[a-f0-9]{64}$' -or $OwnerPid -le 0) { throw 'Ungültiger Übergabeauftrag.' }
  $helperFull = [IO.Path]::GetFullPath($Helper)
  $expected = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\native-lianli\bin\PRISM-LianLi.exe'))
  if ($helperFull -ne $expected -or -not (Test-Path -LiteralPath $expected -PathType Leaf)) { throw 'Der mitgelieferte Strimer-Helfer fehlt.' }
  $owner = Get-Process -Id $OwnerPid -ErrorAction Stop
  $started = $owner.StartTime.ToUniversalTime().Ticks.ToString([Globalization.CultureInfo]::InvariantCulture)
  $arguments = @('--wireless-handoff', $Pipe, $Token, $OwnerPid.ToString(), $started)
  $helperProcess = Start-Process -FilePath $expected -ArgumentList $arguments -Verb RunAs -WindowStyle Hidden -PassThru
  [Console]::Out.WriteLine(('{"launched":true,"ownerStartUtcTicks":"' + $started + '"}'))
} catch {
  # Never print command arguments, pipe secrets or private system paths.
  [Console]::Error.WriteLine('Die Windows-Freigabe für die Strimer-Steuerung wurde abgebrochen oder ist nicht verfügbar.')
  exit 1
}
