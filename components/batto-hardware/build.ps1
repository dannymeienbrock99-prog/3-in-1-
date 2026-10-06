param([string]$OutputDirectory = (Join-Path $PSScriptRoot 'publish'))
$ErrorActionPreference = 'Stop'
$source = [IO.Path]::GetFullPath($PSScriptRoot)
$output = [IO.Path]::GetFullPath($OutputDirectory)
if (-not $output.StartsWith($source + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Build output must remain within batto-hardware.' }
$cache = [IO.Path]::GetFullPath((Join-Path $source '..\desktop-fan-control\.packages'))
$runtimePack = Join-Path $cache 'microsoft.netcore.app.runtime.win-x64\8.0.31\runtimes\win-x64'
if (-not (Test-Path -LiteralPath (Join-Path $runtimePack 'native\hostfxr.dll'))) { throw 'Existing .NET 8.0.31 runtime pack unavailable.' }
Push-Location -LiteralPath $source
try {
    dotnet restore Batto.Hardware.csproj -r win-x64 --source $cache --packages (Join-Path $source '.packages')
    if ($LASTEXITCODE -ne 0) { throw 'Hardware library restore failed.' }
    dotnet publish Batto.Hardware.csproj -c Release -r win-x64 --self-contained false --no-restore -o $output
    if ($LASTEXITCODE -ne 0) { throw 'Hardware library publish failed.' }
    dotnet restore tests/Batto.Hardware.Tests.csproj --source $cache --packages (Join-Path $source '.packages')
    if ($LASTEXITCODE -ne 0) { throw 'Hardware unit-check restore failed.' }
    dotnet run --project tests/Batto.Hardware.Tests.csproj -c Release --no-restore
    if ($LASTEXITCODE -ne 0) { throw 'Hardware unit checks failed.' }
    $framework = Join-Path $output 'runtime\shared\Microsoft.NETCore.App\8.0.31'
    $runtimeHost = Join-Path $output 'runtime\host\fxr\8.0.31'
    New-Item -ItemType Directory -Path $framework,$runtimeHost -Force | Out-Null
    Get-ChildItem -LiteralPath (Join-Path $runtimePack 'lib\net8.0') -File | Where-Object { $_.Extension -in '.dll','.json' } | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $framework $_.Name) }
    Get-ChildItem -LiteralPath (Join-Path $runtimePack 'native') -File | Where-Object { $_.Extension -eq '.dll' -and $_.Name -ne 'hostfxr.dll' } | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $framework $_.Name) }
    Copy-Item -LiteralPath (Join-Path $runtimePack 'native\hostfxr.dll') -Destination (Join-Path $runtimeHost 'hostfxr.dll')
    Copy-Item -LiteralPath (Join-Path $cache 'microsoft.netcore.app.runtime.win-x64\8.0.31\LICENSE.TXT') -Destination (Join-Path $output 'dotnet-LICENSE.txt')
    Copy-Item -LiteralPath (Join-Path $cache 'microsoft.netcore.app.runtime.win-x64\8.0.31\THIRD-PARTY-NOTICES.TXT') -Destination (Join-Path $output 'dotnet-THIRD-PARTY-NOTICES.txt')
    $licenseOutput = Join-Path $output 'licenses'
    $fanLicenses = [IO.Path]::GetFullPath((Join-Path $source '..\desktop-fan-control\licenses'))
    $windowsLicenses = [IO.Path]::GetFullPath((Join-Path $source '..\..\PRISM\native\licenses'))
    New-Item -ItemType Directory -Path $licenseOutput -Force | Out-Null
    foreach ($licenseFile in Get-ChildItem -LiteralPath $fanLicenses -File -Recurse) {
        $relativeLicense = [IO.Path]::GetRelativePath($fanLicenses,$licenseFile.FullName)
        $licenseTarget = Join-Path $licenseOutput $relativeLicense
        New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($licenseTarget)) -Force | Out-Null
        Copy-Item -LiteralPath $licenseFile.FullName -Destination $licenseTarget
    }
    foreach ($licenseName in 'CsWinRT-LICENSE.txt','Windows-SDK-license.rtf') {
        $licenseSource = Join-Path $windowsLicenses $licenseName
        $licenseTarget = Join-Path $licenseOutput $licenseName
        if ((Test-Path -LiteralPath $licenseTarget) -and (Get-FileHash -LiteralPath $licenseTarget).Hash -ne (Get-FileHash -LiteralPath $licenseSource).Hash) { throw 'A Windows SDK license conflicts with an existing dependency license.' }
        Copy-Item -LiteralPath $licenseSource -Destination $licenseTarget
    }
    if (@(Get-ChildItem -LiteralPath $output -File -Recurse -Filter '*.exe').Count -ne 0) { throw 'Hardware runtime contains an executable.' }
    [pscustomobject]@{published=$true;inProcess=$true;childExecutables=0;runtime='8.0.31';output=$output}|ConvertTo-Json
} finally { Pop-Location }
