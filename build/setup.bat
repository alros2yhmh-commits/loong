@echo off
set "DEST=%LOCALAPPDATA%\Programs\Loong"
if not exist "%DEST%" mkdir "%DEST%"

echo Extracting Loong, please wait...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Force -Path '%~dp0Loong.zip' -DestinationPath '%DEST%'"

echo Creating Desktop shortcut...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%USERPROFILE%\Desktop\Loong.lnk'); $s.TargetPath='%DEST%\Loong\Loong.exe'; $s.WorkingDirectory='%DEST%\Loong'; $s.IconLocation='%DEST%\Loong\Loong.exe'; $s.Description='Loong AI Agent'; $s.Save()"

echo Copying README...
if exist "%~dp0README.txt" copy /Y "%~dp0README.txt" "%DEST%\Loong\README.txt" >nul

echo.
echo Loong installed. Launching...
start "" "%DEST%\Loong\Loong.exe"
