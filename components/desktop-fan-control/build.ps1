param([string]$OutputDirectory = (Join-Path $PSScriptRoot 'publish'))
$ErrorActionPreference = 'Stop'
$taskOutputPath = [IO.Path]::GetFullPath($OutputDirectory)
$taskSourceRoot = [IO.Path]::GetFullPath($PSScriptRoot)
# The selected output is explicit; no files are deleted or moved by this build.
Push-Location -LiteralPath $taskSourceRoot
try {
    dotnet restore DesktopFanControl.csproj -r win-x64 --locked-mode --packages (Join-Path $taskSourceRoot '.packages')
    if ($LASTEXITCODE -ne 0) { throw 'Desktop fan restore failed.' }
    dotnet build DesktopFanControl.csproj -c Release --no-restore
    if ($LASTEXITCODE -ne 0) { throw 'Desktop fan build failed.' }
    & (Join-Path $taskSourceRoot 'bin\Release\net8.0-windows\BattoFanControl.exe') --self-test
    if ($LASTEXITCODE -ne 0) { throw 'Desktop fan self-test failed.' }
    dotnet publish DesktopFanControl.csproj -c Release -r win-x64 --self-contained true -o $taskOutputPath --no-restore
    if ($LASTEXITCODE -ne 0) { throw 'Desktop fan publish failed.' }
} finally { Pop-Location }
