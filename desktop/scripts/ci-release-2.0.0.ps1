$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $ProjectRoot

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter()][string[]]$ArgumentList = @(),
        [Parameter()][string]$FailureMessage = "Befehl fehlgeschlagen"
    )
    & $FilePath @ArgumentList
    if ($LASTEXITCODE -ne 0) {
        throw "$FailureMessage (ExitCode $LASTEXITCODE)"
    }
}

function Wait-LocalEndpoint {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [Parameter()][int]$Seconds = 40
    )
    $Deadline = (Get-Date).AddSeconds($Seconds)
    $LastError = $null
    while ((Get-Date) -lt $Deadline) {
        try {
            $Result = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 3
            if ($Result.StatusCode -ge 200 -and $Result.StatusCode -lt 400) {
                Write-Host "OK: $Url"
                return
            }
        }
        catch {
            $LastError = $_.Exception.Message
        }
        Start-Sleep -Seconds 2
    }
    throw "Lokaler Dienst antwortet nicht: $Url. Letzter Fehler: $LastError"
}

Write-Host "[1/10] Paket und Installer-Metadaten vorbereiten"
Invoke-Checked -FilePath "node" -ArgumentList @("scripts/finalize-package-2.0.0.cjs") -FailureMessage "package.json konnte nicht vorbereitet werden"

Write-Host "[2/10] Node-/Electron-Abhängigkeiten installieren"
$env:npm_config_ignore_scripts = "false"
Invoke-Checked -FilePath "npm" -ArgumentList @("install", "--no-audit", "--no-fund", "--ignore-scripts=false") -FailureMessage "npm install fehlgeschlagen"
if (-not (Test-Path "node_modules/electron/dist/electron.exe")) { throw "Electron wurde nicht vollständig installiert." }
if (-not (Test-Path "node_modules/electron-builder/out/cli/cli.js")) { throw "electron-builder wurde nicht vollständig installiert." }

Write-Host "[3/10] Eine saubere integrierte Produktionsquelle erstellen"
Invoke-Checked -FilePath "node" -ArgumentList @("scripts/prepare-2.0.0-release.cjs") -FailureMessage "Integrierte Quelle konnte nicht erstellt werden"
Invoke-Checked -FilePath "node" -ArgumentList @("scripts/patch-2.0.0-runtime.cjs") -FailureMessage "Laufzeit-Patches fehlgeschlagen"
Invoke-Checked -FilePath "node" -ArgumentList @("scripts/patch-2.0.0-deck-safety.cjs") -FailureMessage "Touch-Deck-Sicherheits-Patch fehlgeschlagen"
Invoke-Checked -FilePath "node" -ArgumentList @("scripts/patch-2.0.0-chat.cjs") -FailureMessage "Multi-Chat-Patch fehlgeschlagen"

Write-Host "[4/10] Produktionsregeln und Syntax prüfen"
Invoke-Checked -FilePath "node" -ArgumentList @("scripts/check-2.0.0.cjs") -FailureMessage "Produktionsprüfung fehlgeschlagen"

Write-Host "[5/10] Integrationstests ausführen"
$Tests = @(Get-ChildItem "test" -Filter "*.test.cjs" -File | Sort-Object Name)
if ($Tests.Count -eq 0) { throw "Keine Tests gefunden." }
foreach ($Test in $Tests) {
    Write-Host "Teste $($Test.Name)"
    Invoke-Checked -FilePath "node" -ArgumentList @("--test", $Test.FullName) -FailureMessage "Test fehlgeschlagen: $($Test.Name)"
}

Write-Host "[6/10] Windows-x64-NSIS-Installer bauen"
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
Invoke-Checked -FilePath "npx" -ArgumentList @("electron-builder", "--win", "nsis", "--x64") -FailureMessage "Windows-Installer konnte nicht gebaut werden"

Write-Host "[7/10] Ungepackte Anwendung prüfen"
$Unpacked = Resolve-Path "dist/win-unpacked"
$UnpackedExe = Get-ChildItem $Unpacked -Filter "Batto OBS Tool.exe" -File -Recurse | Select-Object -First 1
if (-not $UnpackedExe) { throw "Ungepackte Batto-OBS-Tool-EXE fehlt." }
if (Get-ChildItem $Unpacked -Filter "Creator Hub.exe" -File -Recurse) { throw "Alte separate Creator-Hub-EXE wurde eingepackt." }
if (Get-ChildItem $Unpacked -Filter "Creator-Hub-.apk" -File -Recurse) { throw "Alte APK wurde unkontrolliert eingepackt." }
$Resources = Join-Path $Unpacked "resources"
foreach ($Required in @("app.asar", "team-logo.svg", "plugin-catalog-2.0.json")) {
    if (-not (Test-Path (Join-Path $Resources $Required))) { throw "Paketdatei fehlt: $Required" }
}
$ExeBytes = [IO.File]::ReadAllBytes($UnpackedExe.FullName)
if ($ExeBytes.Length -lt 2 -or $ExeBytes[0] -ne 0x4D -or $ExeBytes[1] -ne 0x5A) { throw "Hauptanwendung besitzt keinen gültigen PE-Header." }
$UnpackedSelfTest = Start-Process -FilePath $UnpackedExe.FullName -ArgumentList "--self-test" -Wait -PassThru -NoNewWindow
if ($UnpackedSelfTest.ExitCode -ne 0) { throw "Self-Test der ungepackten Anwendung fehlgeschlagen: $($UnpackedSelfTest.ExitCode)" }

Write-Host "[8/10] Installieren, normal starten und lokale Dienste prüfen"
$Installer = Get-ChildItem "dist" -Filter "Batto-OBS-Tool-Setup-2.0.0.exe" -File | Select-Object -First 1
if (-not $Installer) { throw "NSIS-Installer fehlt." }
$InstallerBytes = [IO.File]::ReadAllBytes($Installer.FullName)
if ($InstallerBytes.Length -lt 2 -or $InstallerBytes[0] -ne 0x4D -or $InstallerBytes[1] -ne 0x5A) { throw "Installer besitzt keinen gültigen PE-Header." }

$InstallDir = Join-Path $env:RUNNER_TEMP "Batto-OBS-Tool-2.0.0-Test"
Remove-Item -Recurse -Force $InstallDir -ErrorAction SilentlyContinue
$Installation = Start-Process -FilePath $Installer.FullName -ArgumentList @("/S", "/D=$InstallDir") -Wait -PassThru
if ($Installation.ExitCode -ne 0) { throw "Stille Installation fehlgeschlagen: $($Installation.ExitCode)" }

$InstalledExe = Join-Path $InstallDir "Batto OBS Tool.exe"
if (-not (Test-Path $InstalledExe)) { throw "Installierte Hauptanwendung fehlt." }
if (Test-Path (Join-Path $InstallDir "Creator Hub.exe")) { throw "Alte Creator-Hub-EXE wurde installiert." }

$InstalledSelfTest = Start-Process -FilePath $InstalledExe -ArgumentList "--self-test" -Wait -PassThru -NoNewWindow
if ($InstalledSelfTest.ExitCode -ne 0) { throw "Self-Test der installierten Anwendung fehlgeschlagen: $($InstalledSelfTest.ExitCode)" }

$First = Start-Process -FilePath $InstalledExe -PassThru
Start-Sleep -Seconds 18
if ($First.HasExited) { throw "Die installierte Anwendung wurde unmittelbar beendet. ExitCode: $($First.ExitCode)" }

Wait-LocalEndpoint "http://127.0.0.1:48620/api/status"
Wait-LocalEndpoint "http://127.0.0.1:48621/api/status"
Wait-LocalEndpoint "http://127.0.0.1:17821/api/status"
Wait-LocalEndpoint "http://127.0.0.1:17822/api/status"
Wait-LocalEndpoint "http://127.0.0.1:48621/overlay.html"
Wait-LocalEndpoint "http://127.0.0.1:48621/editor.html"

$Second = Start-Process -FilePath $InstalledExe -PassThru
Start-Sleep -Seconds 6
$AllProcesses = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $InstalledExe })
$MainProcesses = @($AllProcesses | Where-Object {
    $CommandLine = [string]$_.CommandLine
    $CommandLine -notmatch '(?:^|\s)--type=' -and
    $CommandLine -notmatch '(?:^|\s)--utility-sub-type=' -and
    $CommandLine -notmatch '(?:^|\s)--crashpad-handler'
})
if ($MainProcesses.Count -ne 1) {
    throw "Single-Instance-Prüfung fehlgeschlagen. Hauptprozesse: $($MainProcesses.Count), Electron-Prozesse insgesamt: $($AllProcesses.Count)"
}

$Renderer = Get-Content "src/renderer/index.html" -Raw
$Overlay = Get-Content "src/stream-overlay/overlay.html" -Raw
$MobilePage = Get-Content "src/mobile/index.html" -Raw
if ($Renderer -match 'Creator[ -]?Hub' -or $Overlay -match 'Creator[ -]?Hub' -or $MobilePage -match 'Creator[ -]?Hub') {
    throw "Alte sichtbare Produktbezeichnung wurde im Release gefunden."
}

@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $InstalledExe }) |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2

Write-Host "[9/10] Deinstallation prüfen"
$Uninstaller = Join-Path $InstallDir "Uninstall Batto OBS Tool.exe"
if (-not (Test-Path $Uninstaller)) { throw "Deinstallationsprogramm fehlt." }
$Uninstall = Start-Process -FilePath $Uninstaller -ArgumentList "/S" -Wait -PassThru
if ($Uninstall.ExitCode -ne 0) { throw "Stille Deinstallation fehlgeschlagen: $($Uninstall.ExitCode)" }

Write-Host "[10/10] Verifizierten Release packen"
$ReleaseDir = Join-Path $ProjectRoot "release-2.0.0"
Remove-Item -Recurse -Force $ReleaseDir -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $ReleaseDir | Out-Null
Copy-Item $Installer.FullName (Join-Path $ReleaseDir $Installer.Name)

@"
BATTO OBS TOOL 2.0.0 – WINDOWS-INSTALLATION

Ein Installer, eine Hauptanwendung. Der Installer startet das Programm nicht automatisch.
Nach der Installation Batto OBS Tool über Desktop oder Startmenü öffnen.

Enthalten:
- lokale Hardwarediagnose und Internettest
- OBS-WebSocket, Encoder-Empfehlung und bestätigungspflichtige Tests
- neues transparentes Hardware-/Encoder-Monitoring
- Stream-Overlay mit Team-Alpha-Logo, Chat, Zielen, Geschenken, Wheel und Herzfrequenz
- Twitch-Hologramm
- Multi-Chat für Twitch, YouTube und lokale TikTok-/TikFinity-/Tiktory-Webhooks
- OBS-Gastquellen
- variables Touch-Deck mit Profilen, Ordnern und Mehrfachaktionen
- Plugin-Erkennung und native Kompatibilitätsaktionen
- lokale Handy-Kopplung über QR-Code und PIN
- sichere Alt-Datenmigration ohne Überschreiben neuer Profile

OBS WebSocket lokal unter 127.0.0.1:4455 aktivieren.
Handy und PC müssen sich im selben lokalen Netzwerk befinden.
"@ | Set-Content -Encoding UTF8 (Join-Path $ReleaseDir "INSTALLATION.txt")

$InstallerHash = Get-FileHash (Join-Path $ReleaseDir $Installer.Name) -Algorithm SHA256
"$($InstallerHash.Hash.ToLowerInvariant())  $($Installer.Name)" | Set-Content -Encoding ASCII (Join-Path $ReleaseDir "SHA256.txt")

@"
Batto OBS Tool 2.0.0 – geprüfter Windows-Build
Workflow: $env:GITHUB_RUN_ID
Commit: $env:GITHUB_SHA
Self-Test ungepackt: bestanden
Stille Installation: bestanden
Self-Test installiert: bestanden
Normalstart: bestanden
Mobile-Server 48620: bestanden
Stream-Overlay 48621: bestanden
Twitch-Hologramm 17821: bestanden
Monitoring 17822: bestanden
Single-Instance: bestanden
Deinstallation: bestanden
"@ | Set-Content -Encoding UTF8 (Join-Path $ReleaseDir "BUILD-REPORT.txt")

$ZipPath = Join-Path $ProjectRoot "Batto-OBS-Tool-2.0.0-Windows.zip"
Remove-Item -Force $ZipPath -ErrorAction SilentlyContinue
Compress-Archive -Path "$ReleaseDir/*" -DestinationPath $ZipPath -CompressionLevel Optimal
Add-Type -AssemblyName System.IO.Compression.FileSystem
$Archive = [IO.Compression.ZipFile]::OpenRead($ZipPath)
try {
    $Entries = @($Archive.Entries | ForEach-Object FullName)
    foreach ($Required in @("Batto-OBS-Tool-Setup-2.0.0.exe", "INSTALLATION.txt", "SHA256.txt", "BUILD-REPORT.txt")) {
        if ($Entries -notcontains $Required) { throw "Release-ZIP ist unvollständig: $Required fehlt." }
    }
}
finally {
    $Archive.Dispose()
}

Write-Host "BATTO_OBS_TOOL_2_0_0_RELEASE_OK"
