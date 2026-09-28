$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Source = Join-Path $PSScriptRoot "ci-release-2.0.0.ps1"
$Temporary = Join-Path $PSScriptRoot "ci-release-2.0.0.complete-v4.generated.ps1"
$Content = Get-Content $Source -Raw

$DependencyAnchor = 'if (-not (Test-Path "node_modules/electron-builder/out/cli/cli.js")) { throw "electron-builder wurde nicht vollständig installiert." }'
$DependencyReplacement = $DependencyAnchor + [Environment]::NewLine + @'
$ElectronExe = Resolve-Path "node_modules/electron/dist/electron.exe"
& $ElectronExe "scripts/generate-brand-icon-v2.cjs"
if ($LASTEXITCODE -ne 0) { throw "Team-Alpha-App-Icon konnte nicht erzeugt werden." }
Invoke-Checked -FilePath "node" -ArgumentList @("scripts/patch-2.0.0-brand-package.cjs") -FailureMessage "Team-Alpha-App-Icon konnte nicht in den Installer übernommen werden"
'@
if (-not $Content.Contains($DependencyAnchor)) { throw "Icon-Patchpunkt im Release-Skript wurde nicht gefunden." }
$Content = $Content.Replace($DependencyAnchor, $DependencyReplacement)

$ChatPatch = 'Invoke-Checked -FilePath "node" -ArgumentList @("scripts/patch-2.0.0-chat.cjs") -FailureMessage "Multi-Chat-Patch fehlgeschlagen"'
$ChatReplacement = $ChatPatch + [Environment]::NewLine + @'
Invoke-Checked -FilePath "node" -ArgumentList @("scripts/patch-2.0.0-hologram.cjs") -FailureMessage "Hologramm-Persistenz-Patch fehlgeschlagen"
Invoke-Checked -FilePath "node" -ArgumentList @("scripts/patch-2.0.0-hardware.cjs") -FailureMessage "Hardware-Enrichment-Patch fehlgeschlagen"
Invoke-Checked -FilePath "node" -ArgumentList @("scripts/patch-2.0.0-installer-package.cjs") -FailureMessage "Finale Installer-Ressourcen konnten nicht gesetzt werden"
'@
if (-not $Content.Contains($ChatPatch)) { throw "Funktions-Patchpunkt im Release-Skript wurde nicht gefunden." }
$Content = $Content.Replace($ChatPatch, $ChatReplacement)

Set-Content -Path $Temporary -Value $Content -Encoding UTF8
try {
    & $Temporary
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
finally {
    Remove-Item -Force $Temporary -ErrorAction SilentlyContinue
}
