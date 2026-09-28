$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Source = Join-Path $PSScriptRoot "ci-release-2.0.0.ps1"
$Temporary = Join-Path $PSScriptRoot "ci-release-2.0.0.generated.ps1"
$Content = Get-Content $Source -Raw
$PatchLine = 'Invoke-Checked -FilePath "node" -ArgumentList @("scripts/patch-2.0.0-chat.cjs") -FailureMessage "Multi-Chat-Patch fehlgeschlagen"'
$Replacement = $PatchLine + [Environment]::NewLine + 'Invoke-Checked -FilePath "node" -ArgumentList @("scripts/patch-2.0.0-hologram.cjs") -FailureMessage "Hologramm-Persistenz-Patch fehlgeschlagen"'
if (-not $Content.Contains($PatchLine)) {
    throw "Patchpunkt im Release-Skript wurde nicht gefunden."
}
$Content = $Content.Replace($PatchLine, $Replacement)
Set-Content -Path $Temporary -Value $Content -Encoding UTF8
try {
    & $Temporary
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
finally {
    Remove-Item -Force $Temporary -ErrorAction SilentlyContinue
}
