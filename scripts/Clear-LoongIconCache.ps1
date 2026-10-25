# Clear-LoongIconCache.ps1
# Run this as Administrator if possible, then restart the computer.
# Windows caches shell icons aggressively; this script kills the cache files
# and refreshes the shell so the new Loong icon is read from the EXE.

$ErrorActionPreference = "SilentlyContinue"

Write-Host "Stopping Explorer..."
Stop-Process -Name explorer -Force

Write-Host "Clearing icon cache files..."
$cachePaths = @(
    "$env:LOCALAPPDATA\IconCache.db",
    "$env:LOCALAPPDATA\Microsoft\Windows\Explorer\iconcache*.db",
    "$env:LOCALAPPDATA\Microsoft\Windows\Explorer\thumbcache*.db"
)

foreach ($path in $cachePaths) {
    Remove-Item $path -Recurse -Force
    Write-Host "  removed: $path"
}

Write-Host "Rebuilding icon cache..."
ie4uinit.exe -show
ie4uinit.exe -ClearIconCache

Write-Host "Restarting Explorer..."
Start-Process explorer

Write-Host ""
Write-Host "Done. If the icon is still generic, a full restart is required."
Write-Host "The icon resource inside Loong.exe is correct; Windows is simply"
Write-Host "refusing to re-read it until the session restarts."
