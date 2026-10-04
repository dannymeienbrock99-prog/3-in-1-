$ErrorActionPreference = 'Stop'
$codecRoot = $PSScriptRoot
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) {
    throw 'Der Windows .NET-Framework-C#-Compiler fehlt.'
}
$codecOutput = Join-Path $codecRoot 'bin'
New-Item -ItemType Directory -Path $codecOutput -Force | Out-Null
$codecExe = Join-Path $codecOutput 'PRISM-KingstonCodec.exe'
& $compiler /nologo /optimize+ /target:exe /platform:anycpu /reference:System.Web.Extensions.dll "/out:$codecExe" (Join-Path $codecRoot 'Codec.cs')
if ($LASTEXITCODE -ne 0) { throw 'Der Kingston-Protokollcodec konnte nicht gebaut werden.' }
Write-Output $codecExe
