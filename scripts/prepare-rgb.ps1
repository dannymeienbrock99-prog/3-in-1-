[CmdletBinding()]
param(
    [switch]$Offline,
    [string]$WindowsSdkReferences = '',
    [string]$WebViewSdk = '',
    [string]$NuGetPackages = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$projectRoot = Split-Path -Parent $PSScriptRoot
$rgbRoot = Join-Path $projectRoot 'PRISM'
$buildRoot = Join-Path $projectRoot 'work/rgb-build'
New-Item -ItemType Directory -Path $buildRoot -Force | Out-Null

function Invoke-RgbChecked([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed with exit code $LASTEXITCODE." }
}

function Get-RgbSdk([string]$Uri, [string]$Sha256, [string]$Name) {
    $archive = Join-Path $buildRoot ($Name + '.zip')
    $destination = Join-Path $buildRoot $Name
    if (-not (Test-Path -LiteralPath $archive)) {
        if ($Offline) { throw "Offline SDK archive is missing: $Name" }
        Invoke-WebRequest -Uri $Uri -OutFile $archive -MaximumRedirection 10
    }
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $Sha256) {
        throw "RGB SDK checksum failed: $Name"
    }
    if (-not (Test-Path -LiteralPath $destination)) {
        Expand-Archive -LiteralPath $archive -DestinationPath $destination
    }
    return $destination
}

if (-not $WindowsSdkReferences) {
    $sdk = Get-RgbSdk 'https://api.nuget.org/v3-flatcontainer/microsoft.windows.sdk.net.ref/10.0.26100.57/microsoft.windows.sdk.net.ref.10.0.26100.57.nupkg' 'EAA0E3B938319F75BEAC5C046C84EF57212C2743E9263E0DB33B2019AB70B524' 'windows-sdk'
    $WindowsSdkReferences = Join-Path $sdk 'lib/net8.0'
}
if (-not $WebViewSdk) {
    $WebViewSdk = Get-RgbSdk 'https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/1.0.4258.31/microsoft.web.webview2.1.0.4258.31.nupkg' '56F7F4B8BF9AEE4B8EFEFBBDD4F67D5F74EBD1B100ED0806DA71BF76AF481AA9' 'webview2'
}
$WindowsSdkReferences = (Resolve-Path -LiteralPath $WindowsSdkReferences).Path
$WebViewSdk = (Resolve-Path -LiteralPath $WebViewSdk).Path
foreach ($file in @(
    (Join-Path $WindowsSdkReferences 'Microsoft.Windows.SDK.NET.dll'),
    (Join-Path $WindowsSdkReferences 'WinRT.Runtime.dll'),
    (Join-Path $WebViewSdk 'lib/net462/Microsoft.Web.WebView2.Core.dll'),
    (Join-Path $WebViewSdk 'lib/net462/Microsoft.Web.WebView2.WinForms.dll'),
    (Join-Path $WebViewSdk 'runtimes/win-x64/native/WebView2Loader.dll')
)) {
    if (-not (Test-Path -LiteralPath $file)) { throw "Required RGB SDK file is missing: $file" }
}

Push-Location -LiteralPath $rgbRoot
try {
    if ($Offline) {
        if (-not (Test-Path -LiteralPath 'node_modules/.bin/vite.cmd')) { throw 'Offline PRISM frontend dependencies are missing.' }
    } else {
        Invoke-RgbChecked 'npm.cmd' @('ci', '--no-audit', '--no-fund')
    }
    # Fixture providers test device discovery and RGB behavior without physical LED writes.
    Invoke-RgbChecked 'npm.cmd' @('test')
    Invoke-RgbChecked 'npm.cmd' @('run', 'build')
} finally { Pop-Location }

$nugetConfig = Join-Path $buildRoot 'NuGet.Config'
$sources = if ($Offline) { '' } else { '<add key="nuget.org" value="https://api.nuget.org/v3/index.json" />' }
[IO.File]::WriteAllText($nugetConfig, ('<configuration><packageSources><clear />' + $sources + '</packageSources></configuration>'), [Text.UTF8Encoding]::new($false))
$arguments = @(
    'publish', (Join-Path $rgbRoot 'native/Prism.WindowsLighting.csproj'),
    '--configuration', 'Release', '--runtime', 'win-x64', '--self-contained', 'true',
    '--output', (Join-Path $buildRoot 'native-publish'),
    "-p:WindowsSdkReferencePath=$WindowsSdkReferences", "-p:WebViewSdkPath=$WebViewSdk",
    "-p:BaseOutputPath=$(Join-Path $buildRoot 'native-build/')",
    "-p:BaseIntermediateOutputPath=$(Join-Path $buildRoot 'native-obj/')",
    "-p:RestoreConfigFile=$nugetConfig"
)
if ($NuGetPackages) { $arguments += "-p:RestorePackagesPath=$([IO.Path]::GetFullPath($NuGetPackages))" }
$previousAppData = $env:APPDATA
$previousCliHome = $env:DOTNET_CLI_HOME
$previousSkipFirstTime = $env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE
$previousGenerateCertificate = $env:DOTNET_GENERATE_ASPNET_CERTIFICATE
Push-Location -LiteralPath (Join-Path $rgbRoot 'native')
try {
    if ($Offline) {
        # SDK framework resolution can inspect user NuGet config even with an explicit restore config.
        $env:APPDATA = Join-Path $buildRoot 'appdata'
        $env:DOTNET_CLI_HOME = Join-Path $buildRoot 'dotnet-home'
        $env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE = '1'
        $env:DOTNET_GENERATE_ASPNET_CERTIFICATE = 'false'
        New-Item -ItemType Directory -Path (Join-Path $env:APPDATA 'NuGet') -Force | Out-Null
        Copy-Item -LiteralPath $nugetConfig -Destination (Join-Path $env:APPDATA 'NuGet/NuGet.Config') -Force
    }
    Invoke-RgbChecked 'dotnet' $arguments
} finally {
    $env:APPDATA = $previousAppData
    $env:DOTNET_CLI_HOME = $previousCliHome
    $env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE = $previousSkipFirstTime
    $env:DOTNET_GENERATE_ASPNET_CERTIFICATE = $previousGenerateCertificate
    Pop-Location
}
$nativeBin = Join-Path $rgbRoot 'native/bin'
New-Item -ItemType Directory -Path $nativeBin -Force | Out-Null
foreach ($name in @('PRISM-Lighting.exe', 'WebView2Loader.dll')) {
    $file = Join-Path $buildRoot ('native-publish/' + $name)
    if (-not (Test-Path -LiteralPath $file)) { throw "RGB native output is missing: $name" }
    Copy-Item -LiteralPath $file -Destination (Join-Path $nativeBin $name) -Force
}
foreach ($name in @('index.html', 'pc-base.png', 'pc-msi.png', 'pc-asus.png')) {
    if (-not (Test-Path -LiteralPath (Join-Path $rgbRoot ('dist/' + $name)))) { throw "RGB preview output is missing: $name" }
}
foreach ($name in @('Windows-SDK-license.rtf', 'CsWinRT-LICENSE.txt', 'WebView2-LICENSE.txt', 'dotnet-LICENSE.txt', 'dotnet-THIRD-PARTY-NOTICES.txt', 'WindowsDesktop-LICENSE.txt')) {
    if (-not (Test-Path -LiteralPath (Join-Path $rgbRoot ('native/licenses/' + $name)))) {
        throw "RGB native license notice is missing: $name"
    }
}
Write-Output 'PRISM frontend, RGB provider tests and native Windows lighting host prepared.'
