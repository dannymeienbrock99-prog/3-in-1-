param([Parameter(Mandatory=$true)][string]$Helper,
      [Parameter(Mandatory=$true)][int]$OwnerPid,
      [Parameter(Mandatory=$true)][string]$Pipe,
      [Parameter(Mandatory=$true)][string]$Token)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
try {
    if($OwnerPid -le 0 -or $Pipe -cnotmatch '^batto-fan-[0-9a-f]{32}$' -or $Token -cnotmatch '^[0-9a-f]{64}$'){throw 'Invalid request'}
    $fanHelper=[IO.Path]::GetFullPath($Helper)
    $expectedFanHelper=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'BattoFanControl.exe'))
    if(-not [string]::Equals($fanHelper,$expectedFanHelper,[StringComparison]::OrdinalIgnoreCase) -or -not [IO.File]::Exists($fanHelper)){throw 'Wrong helper'}
    $fanOwner=[Diagnostics.Process]::GetProcessById($OwnerPid)
    try { $fanOwnerTicks=$fanOwner.StartTime.ToUniversalTime().Ticks.ToString([Globalization.CultureInfo]::InvariantCulture) }
    finally { $fanOwner.Dispose() }
    $fanArgs=@('--pipe',$Pipe,'--token',$Token,'--parent-pid',$OwnerPid.ToString([Globalization.CultureInfo]::InvariantCulture),'--parent-start',$fanOwnerTicks)
    $fanProcess=Start-Process -FilePath $fanHelper -ArgumentList $fanArgs -Verb RunAs -WindowStyle Hidden -PassThru
    $fanProcess.Dispose()
    [ordered]@{launched=$true;ownerStartUtcTicks=$fanOwnerTicks}|ConvertTo-Json -Compress
} catch {
    [Console]::Error.WriteLine('Der PC-Lüfterhelfer konnte nicht mit Administratorrechten gestartet werden. Windows-Abfrage bestätigen und erneut versuchen.')
    exit 1
}
