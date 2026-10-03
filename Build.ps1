param([string]$InnoCompiler = '',[switch]$PrepareVoice,[switch]$SkipInstaller,[string]$InstallerKeyFile = '')
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
function Check-Exit { if ($LASTEXITCODE -ne 0) { throw "Build-Schritt fehlgeschlagen: $LASTEXITCODE" } }
if ($PrepareVoice) { python scripts/prepare-voice.py; Check-Exit }
python scripts/prepare-virtualcam.py; Check-Exit
if (-not (Test-Path jarvis/python/python.exe) -or -not (Test-Path jarvis/models/whisper-small/model.bin)) { throw 'Sprachpaket fehlt. Mit Python 3.12 und -PrepareVoice vorbereiten.' }
& ./jarvis/python/python.exe -m unittest discover -s jarvis/tests -p 'test_*.py'; Check-Exit
dotnet publish components/fanatlas-src/FanAtlas/FanAtlas.csproj -c Release -r win-x64 --self-contained true -p:RuntimeFrameworkVersion=8.0.31 -o FanAtlas; Check-Exit
dotnet publish components/dual-stream/DualStreamHost.csproj -c Release -r win-x64 --self-contained true -p:RuntimeFrameworkVersion=8.0.31 -o FanAtlas; Check-Exit
dotnet publish components/audio-control/BattoAudioControl.csproj -c Release -r win-x64 --self-contained true -p:RuntimeFrameworkVersion=8.0.31 -o FanAtlas; Check-Exit
New-Item -ItemType Directory -Force work | Out-Null
$fanTest = Start-Process -FilePath (Join-Path $PSScriptRoot 'FanAtlas/FanAtlas.exe') -ArgumentList '--fan-tests',('"' + (Join-Path $PSScriptRoot 'work/fan-tests.txt') + '"') -WindowStyle Hidden -Wait -PassThru
if ($fanTest.ExitCode -ne 0) { throw 'iCUE fan tests failed' }
$plugin = 'streamdeck/de.crazybatto.suite.sdPlugin'
dotnet publish components/fanatlas-src/FanAtlas.Deck/FanAtlas.Deck.csproj -c Release -r win-x64 --self-contained true -p:RuntimeFrameworkVersion=8.0.31 -o "$plugin/bin"; Check-Exit
Copy-Item assets/fan.png "$plugin/bin/fan.png"
Copy-Item assets/deck-pause.png "$plugin/bin/deck-pause.png"
New-Item -ItemType Directory -Force dist/Extras | Out-Null
npx --yes @elgato/cli@1.10.1 validate $plugin; Check-Exit
npx --yes @elgato/cli@1.10.1 pack $plugin --output dist/Extras --force; Check-Exit
Copy-Item ANLEITUNG.html dist/Extras/ANLEITUNG.html
Copy-Item THIRD-PARTY.md dist/Extras/THIRD-PARTY.md
New-Item -ItemType Directory -Force dist/Extras/Touch-Deck-Licenses | Out-Null
Copy-Item licenses/touch-deck/* dist/Extras/Touch-Deck-Licenses/ -Force
Copy-Item components/dual-stream/LICENSE dist/Extras/DualStream-LICENSE.txt
python scripts/prepare-obs-piper.py; Check-Exit
Push-Location desktop
npm ci; Check-Exit
& .\node_modules\.bin\electron.cmd scripts/prepare-icons.cjs; Check-Exit
npm run test:jarvis; Check-Exit
npm run test:widgets; Check-Exit
npm run test:touch; Check-Exit
node --test test/dual-stream.test.cjs; Check-Exit
npm run test:core; Check-Exit
node scripts/audio-playback-regression.cjs; Check-Exit
node scripts/ui-contract.cjs; Check-Exit
node scripts/smoke.cjs; Check-Exit
node scripts/broadcast-regression.cjs; Check-Exit
node scripts/tiktok-match-regression.cjs; Check-Exit
node scripts/piper-regression.cjs; Check-Exit
node scripts/build-physical-input.cjs; Check-Exit
node scripts/build-mouse-helper.cjs; Check-Exit
npm run pack:win; Check-Exit
Pop-Location
if ($SkipInstaller) {
  Write-Output 'Build und Tests fertig. Privater Installer wird in CI nicht erstellt oder veröffentlicht.'
} else {
  & (Join-Path $PSScriptRoot 'scripts/build-installer.ps1') -InnoCompiler $InnoCompiler -KeyFile $InstallerKeyFile
  Write-Output 'Fertig: geschützter dist/Batto-3-in-1-Setup-1.8.3.exe und dist/Extras/de.crazybatto.suite.streamDeckPlugin'
}
