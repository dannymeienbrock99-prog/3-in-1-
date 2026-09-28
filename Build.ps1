param([string]$InnoCompiler = '',[switch]$PrepareVoice)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
function Check-Exit { if ($LASTEXITCODE -ne 0) { throw "Build-Schritt fehlgeschlagen: $LASTEXITCODE" } }
if ($PrepareVoice) { python scripts/prepare-voice.py; Check-Exit }
if (-not (Test-Path jarvis/python/python.exe) -or -not (Test-Path jarvis/models/whisper-small/model.bin)) { throw 'Sprachpaket fehlt. Mit Python 3.12 und -PrepareVoice vorbereiten.' }
dotnet publish components/fanatlas-src/FanAtlas/FanAtlas.csproj -c Release -r win-x64 --self-contained true -p:RuntimeFrameworkVersion=8.0.31 -o FanAtlas; Check-Exit
$plugin = 'streamdeck/de.crazybatto.suite.sdPlugin'
dotnet publish components/fanatlas-src/FanAtlas.Deck/FanAtlas.Deck.csproj -c Release -r win-x64 --self-contained true -p:RuntimeFrameworkVersion=8.0.31 -o "$plugin/bin"; Check-Exit
Copy-Item assets/fan.png "$plugin/bin/fan.png"
New-Item -ItemType Directory -Force dist/Extras | Out-Null
npx --yes @elgato/cli@1.10.1 validate $plugin; Check-Exit
npx --yes @elgato/cli@1.10.1 pack $plugin --output dist/Extras --force; Check-Exit
Copy-Item ANLEITUNG.html dist/Extras/ANLEITUNG.html
Copy-Item THIRD-PARTY.md dist/Extras/THIRD-PARTY.md
Push-Location desktop
npm ci; Check-Exit
npm run test:jarvis; Check-Exit
npm run test:core; Check-Exit
npm run test:modules; Check-Exit
npm run pack:win; Check-Exit
Pop-Location
if (-not $InnoCompiler) { $InnoCompiler = (Get-Command ISCC.exe -ErrorAction SilentlyContinue).Source }
if (-not $InnoCompiler) { throw 'Inno Setup 7.1 oder neuer: -InnoCompiler mit Pfad zu ISCC.exe angeben.' }
& $InnoCompiler installer/BattoSuite.iss; Check-Exit
Write-Output 'Fertig: dist/Batto-3-in-1-Setup-1.0.0.exe und dist/Extras/de.crazybatto.suite.streamDeckPlugin'
