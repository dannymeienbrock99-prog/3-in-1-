[CmdletBinding()]
param(
    [string]$OutputDirectory = (Join-Path $PSScriptRoot 'publish'),
    [string]$WindowsSdkReferences = '',
    [string]$NuGetPackages = ''
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$source = [IO.Path]::GetFullPath($PSScriptRoot)
$output = [IO.Path]::GetFullPath($OutputDirectory)
if (-not $output.StartsWith($source + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Build output must remain within batto-hardware.' }
if (-not $WindowsSdkReferences) { $WindowsSdkReferences = Join-Path $source '..\..\work\rgb-build\windows-sdk\lib\net8.0' }
$WindowsSdkReferences = [IO.Path]::GetFullPath($WindowsSdkReferences)
foreach ($sdkFile in 'Microsoft.Windows.SDK.NET.dll','WinRT.Runtime.dll') {
    if (-not (Test-Path -LiteralPath (Join-Path $WindowsSdkReferences $sdkFile) -PathType Leaf)) {
        throw "Windows SDK reference is missing: $sdkFile. Run scripts/prepare-rgb.ps1 first or supply its verified SDK through -WindowsSdkReferences."
    }
}
if (-not $NuGetPackages) { $NuGetPackages = Join-Path $source '.packages' }
$cache = [IO.Path]::GetFullPath($NuGetPackages)
$runtimeVersion = '8.0.31'
$runtimePackage = Join-Path $cache "microsoft.netcore.app.runtime.win-x64\$runtimeVersion"
$runtimePack = Join-Path $runtimePackage 'runtimes\win-x64'
$sdkArgument = "-p:WindowsSdkReferencePath=$WindowsSdkReferences"
$restoreArguments = @('--runtime','win-x64','--locked-mode','--source','https://api.nuget.org/v3/index.json','--packages',$cache,$sdkArgument)
Push-Location -LiteralPath $source
try {
    # The checked-in lock file fixes application packages. PackageDownload in the
    # project obtains the exact private runtime without a developer's old cache.
    dotnet restore Batto.Hardware.csproj @restoreArguments
    if ($LASTEXITCODE -ne 0) { throw 'Hardware library restore failed.' }
    foreach ($runtimeFile in 'runtimes\win-x64\native\hostfxr.dll','runtimes\win-x64\native\hostpolicy.dll','runtimes\win-x64\native\coreclr.dll','runtimes\win-x64\lib\net8.0\System.Private.CoreLib.dll','LICENSE.TXT','THIRD-PARTY-NOTICES.TXT') {
        if (-not (Test-Path -LiteralPath (Join-Path $runtimePackage $runtimeFile) -PathType Leaf)) { throw "Restored .NET $runtimeVersion runtime pack is incomplete: $runtimeFile" }
    }
    dotnet publish Batto.Hardware.csproj -c Release -r win-x64 --self-contained false --no-restore -o $output $sdkArgument
    if ($LASTEXITCODE -ne 0) { throw 'Hardware library publish failed.' }
    dotnet restore tests/Batto.Hardware.Tests.csproj @restoreArguments
    if ($LASTEXITCODE -ne 0) { throw 'Hardware unit-check restore failed.' }
    dotnet run --project tests/Batto.Hardware.Tests.csproj -c Release --no-restore --runtime win-x64 $sdkArgument
    if ($LASTEXITCODE -ne 0) { throw 'Hardware unit checks failed.' }
    $framework = Join-Path $output "runtime\shared\Microsoft.NETCore.App\$runtimeVersion"
    $runtimeHost = Join-Path $output "runtime\host\fxr\$runtimeVersion"
    New-Item -ItemType Directory -Path $framework,$runtimeHost -Force | Out-Null
    Get-ChildItem -LiteralPath (Join-Path $runtimePack 'lib\net8.0') -File | Where-Object { $_.Extension -in '.dll','.json' } | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $framework $_.Name) }
    Get-ChildItem -LiteralPath (Join-Path $runtimePack 'native') -File | Where-Object { $_.Extension -eq '.dll' -and $_.Name -ne 'hostfxr.dll' } | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $framework $_.Name) }
    Copy-Item -LiteralPath (Join-Path $runtimePack 'native\hostfxr.dll') -Destination (Join-Path $runtimeHost 'hostfxr.dll')
    Copy-Item -LiteralPath (Join-Path $runtimePackage 'LICENSE.TXT') -Destination (Join-Path $output 'dotnet-LICENSE.txt')
    Copy-Item -LiteralPath (Join-Path $runtimePackage 'THIRD-PARTY-NOTICES.TXT') -Destination (Join-Path $output 'dotnet-THIRD-PARTY-NOTICES.txt')
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
    [pscustomobject]@{published=$true;inProcess=$true;childExecutables=0;runtime=$runtimeVersion;output=$output}|ConvertTo-Json
} finally { Pop-Location }
