# write — launch the real native app (hot-reloaded). Run from anywhere:
#   .\dev.ps1
Push-Location "$PSScriptRoot\app"
npm run tauri dev
Pop-Location
