$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '../..')
if (-not $IsWindows -and $PSVersionTable.PSEdition -eq 'Core') { throw 'Compilare su Windows x64.' }
if (-not [Environment]::Is64BitOperatingSystem) { throw 'È richiesto Windows x64.' }
function Check-Exit { if ($LASTEXITCODE -ne 0) { throw "Comando non riuscito: $LASTEXITCODE" } }
python -m venv .venv
Check-Exit
$Python = Join-Path (Get-Location) '.venv/Scripts/python.exe'
& $Python -m pip install -r backend/requirements.lock -r desktop/requirements-build.txt
Check-Exit
npm.cmd --prefix frontend ci
Check-Exit
npm.cmd --prefix desktop ci
Check-Exit
$env:STUDIO_DESKTOP_BUILD = '1'
npm.cmd --prefix frontend run build
Check-Exit
Remove-Item Env:STUDIO_DESKTOP_BUILD
& $Python desktop/scripts/build-api.py
Check-Exit
npm.cmd --prefix desktop run stage
Check-Exit
$env:STUDIO_REQUIRE_PAYLOAD = '1'
$env:STUDIO_TEST_ELECTRON_NODE = '1'
npm.cmd --prefix desktop test
Check-Exit
Remove-Item Env:STUDIO_REQUIRE_PAYLOAD
Remove-Item Env:STUDIO_TEST_ELECTRON_NODE
npm.cmd --prefix desktop run dist:win
Check-Exit
Write-Output 'Installer generato nella cartella desktop/release. Eseguire il collaudo Windows prima della distribuzione.'
