[CmdletBinding()]
param(
  [string]$Sdk = $env:ANDROID_HOME,
  [string]$JavaHome = $env:JAVA_HOME,
  [string]$OutputDirectory,
  [string]$SigningDirectory,
  [switch]$DebugBuild
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$sourceRoot = Join-Path $projectRoot 'mobile/android'
if (-not $Sdk) { $Sdk = Join-Path $env:LOCALAPPDATA 'Android/Sdk' }
if (-not $JavaHome -or -not (Test-Path -LiteralPath (Join-Path $JavaHome 'bin/javac.exe'))) {
  $JavaHome = (Get-ChildItem -LiteralPath 'C:/Program Files/Eclipse Adoptium' -Directory -ErrorAction SilentlyContinue | Where-Object Name -like 'jdk-21*' | Select-Object -First 1).FullName
}
if (-not $JavaHome) { throw 'JDK 21 or later is required. Set JAVA_HOME or -JavaHome.' }
$java = Join-Path $JavaHome 'bin/java.exe'
$javac = Join-Path $JavaHome 'bin/javac.exe'
$jar = Join-Path $JavaHome 'bin/jar.exe'
$keytool = Join-Path $JavaHome 'bin/keytool.exe'
$buildTools = (Get-ChildItem -LiteralPath (Join-Path $Sdk 'build-tools') -Directory | Where-Object Name -match '^36\.' | Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1).FullName
$androidJar = Join-Path $Sdk 'platforms/android-36/android.jar'
if (-not $buildTools -or -not (Test-Path -LiteralPath $androidJar)) { throw 'Android SDK platform 36 and build-tools 36.x are required.' }
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $projectRoot 'dist/Extras' }
$buildRoot = Join-Path $sourceRoot ('build/run-' + [Guid]::NewGuid().ToString('N'))
$classes = Join-Path $buildRoot 'classes'
$testClasses = Join-Path $buildRoot 'test-classes'
$dex = Join-Path $buildRoot 'dex'
$generated = Join-Path $buildRoot 'generated'
New-Item -ItemType Directory -Force $buildRoot,$classes,$testClasses,$dex,$generated,$OutputDirectory | Out-Null
function Invoke-Checked([string]$Executable, [string[]]$Arguments) { & $Executable @Arguments; if ($LASTEXITCODE -ne 0) { throw "Android build step failed: $([IO.Path]::GetFileName($Executable)) ($LASTEXITCODE)" } }
$addressSource = Join-Path $sourceRoot 'src/de/crazybatto/touchdeck/DeckAddress.java'
Invoke-Checked $javac @('-encoding','UTF-8','-d',$testClasses,$addressSource,(Join-Path $sourceRoot 'test/DeckAddressTest.java'))
Invoke-Checked $java @('-cp',$testClasses,'de.crazybatto.touchdeck.DeckAddressTest')
$compiledResources = Join-Path $buildRoot 'resources.zip'
$unsignedApk = Join-Path $buildRoot 'unsigned.apk'
$alignedApk = Join-Path $buildRoot 'aligned.apk'
Invoke-Checked (Join-Path $buildTools 'aapt2.exe') @('compile','--dir',(Join-Path $sourceRoot 'res'),'-o',$compiledResources)
Invoke-Checked (Join-Path $buildTools 'aapt2.exe') @('link','-o',$unsignedApk,'--manifest',(Join-Path $sourceRoot 'AndroidManifest.xml'),'-I',$androidJar,'--java',$generated,'--min-sdk-version','26','--target-sdk-version','36',$compiledResources)
$sourceFiles = @((Get-ChildItem -LiteralPath (Join-Path $sourceRoot 'src') -Recurse -Filter '*.java').FullName) + @((Get-ChildItem -LiteralPath $generated -Recurse -Filter '*.java').FullName)
Invoke-Checked $javac (@('-encoding','UTF-8','-source','8','-target','8','-classpath',$androidJar,'-d',$classes) + $sourceFiles)
$classJar = Join-Path $buildRoot 'classes.jar'
Invoke-Checked $jar @('cf',$classJar,'-C',$classes,'.')
Invoke-Checked $java @('-cp',(Join-Path $buildTools 'lib/d8.jar'),'com.android.tools.r8.D8','--release','--min-api','26','--lib',$androidJar,'--output',$dex,$classJar)
Invoke-Checked $jar @('uf',$unsignedApk,'-C',$dex,'classes.dex')
Invoke-Checked (Join-Path $buildTools 'zipalign.exe') @('-f','4',$unsignedApk,$alignedApk)
[xml]$manifest = Get-Content -LiteralPath (Join-Path $sourceRoot 'AndroidManifest.xml') -Raw
$version = $manifest.manifest.GetAttribute('versionName','http://schemas.android.com/apk/res/android')
if ($DebugBuild) {
  $SigningDirectory = Join-Path $buildRoot 'ci-signing'
  $signingPassword = 'android'
  $outName = "Batto-Touch-Deck-$version-ci-test.apk"
} else {
  if (-not $SigningDirectory) { throw 'Release signing requires -SigningDirectory outside the repository. The private key is retained there for future updates.' }
  $resolvedSigning = [IO.Path]::GetFullPath($SigningDirectory)
  if ($resolvedSigning.StartsWith([IO.Path]::GetFullPath($projectRoot) + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Keep the release signing directory outside the repository.' }
  $outName = "Batto-Touch-Deck-$version.apk"
}
New-Item -ItemType Directory -Force $SigningDirectory | Out-Null
$keystore = Join-Path $SigningDirectory 'batto-touch-deck.p12'
$passwordFile = Join-Path $SigningDirectory 'password.dpapi'
if (-not $DebugBuild) {
  if (Test-Path -LiteralPath $keystore) {
    if (-not (Test-Path -LiteralPath $passwordFile)) { throw 'The existing signing key password file is missing. Restore it; do not replace the key.' }
    $securePassword = ConvertTo-SecureString ((Get-Content -LiteralPath $passwordFile -Raw).Trim())
    $signingPassword = [Net.NetworkCredential]::new('', $securePassword).Password
  } else {
    if (Test-Path -LiteralPath $passwordFile) { throw 'The signing key is missing. Restore the original key to preserve update compatibility.' }
    $bytes = New-Object byte[] 32
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $signingPassword = [Convert]::ToBase64String($bytes)
    ConvertFrom-SecureString (ConvertTo-SecureString $signingPassword -AsPlainText -Force) | Set-Content -LiteralPath $passwordFile -Encoding ascii
  }
}
$env:BATTO_ANDROID_SIGN_PASSWORD = $signingPassword
try {
  if (-not (Test-Path -LiteralPath $keystore)) { Invoke-Checked $keytool @('-genkeypair','-keystore',$keystore,'-storetype','PKCS12','-storepass:env','BATTO_ANDROID_SIGN_PASSWORD','-keypass:env','BATTO_ANDROID_SIGN_PASSWORD','-alias','batto-touch-deck','-keyalg','RSA','-keysize','3072','-validity','10000','-dname','CN=Batto Touch Deck, O=CrazyBatto, C=DE') }
  $finalApk = Join-Path $OutputDirectory $outName
  Invoke-Checked $java @('-jar',(Join-Path $buildTools 'lib/apksigner.jar'),'sign','--ks',$keystore,'--ks-key-alias','batto-touch-deck','--ks-pass','env:BATTO_ANDROID_SIGN_PASSWORD','--key-pass','env:BATTO_ANDROID_SIGN_PASSWORD','--out',$finalApk,$alignedApk)
  Invoke-Checked $java @('-jar',(Join-Path $buildTools 'lib/apksigner.jar'),'verify','--verbose','--print-certs',$finalApk)
  Invoke-Checked (Join-Path $buildTools 'zipalign.exe') @('-c','4',$finalApk)
  Get-Item -LiteralPath $finalApk | Select-Object FullName,Length
  Get-FileHash -LiteralPath $finalApk -Algorithm SHA256 | Select-Object Algorithm,Hash
} finally { Remove-Item Env:BATTO_ANDROID_SIGN_PASSWORD -ErrorAction SilentlyContinue; $signingPassword = $null }
