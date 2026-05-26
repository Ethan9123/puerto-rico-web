@echo off
chcp 65001 >nul
title Puerto Rico - Make Offline ZIP

cd /d "%~dp0"

echo ============================================
echo   Puerto Rico - Build Offline ZIP
echo ============================================
echo.
echo This will package the project into a zip file
echo you can send to friends via WeChat / 百度网盘.
echo.

REM Get current date for filename
for /f "tokens=1-3 delims=/- " %%a in ("%date%") do set DATE_STR=%%a%%b%%c
set ZIP_NAME=puerto-rico-web-%DATE_STR%.zip
set OUT_PATH=%USERPROFILE%\Desktop\%ZIP_NAME%

echo Output: %OUT_PATH%
echo.

REM Check if 7-Zip is installed
where 7z >nul 2>&1
if %ERRORLEVEL%==0 (
    echo [OK] 7-Zip detected. Building zip...
    7z a -tzip "%OUT_PATH%" -xr!.git -xr!node_modules -xr!.claude -xr!*.log -xr!__pycache__ -xr!Thumbs.db -xr!.DS_Store "%~dp0\*"
    goto :success
)

REM Fall back to PowerShell Compress-Archive
echo [OK] Using PowerShell Compress-Archive...
powershell -NoProfile -Command "$ErrorActionPreference='Stop'; $src = '%~dp0'; $dest = '%OUT_PATH%'; if (Test-Path $dest) { Remove-Item $dest -Force }; $tmp = Join-Path $env:TEMP 'puerto-rico-pack'; if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }; New-Item -ItemType Directory -Path $tmp | Out-Null; $exclude = @('.git','.claude','node_modules','__pycache__','Thumbs.db','.DS_Store'); Get-ChildItem $src -Force | Where-Object { $exclude -notcontains $_.Name } | ForEach-Object { Copy-Item $_.FullName -Destination $tmp -Recurse -Force }; Compress-Archive -Path (Join-Path $tmp '*') -DestinationPath $dest -CompressionLevel Optimal; Remove-Item $tmp -Recurse -Force; Write-Host '[OK] Created' $dest"
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Failed to create zip. You can manually:
    echo   1. Open File Explorer to: %~dp0
    echo   2. Right-click parent folder ^> Send to ^> Compressed (zipped) folder
    echo.
    pause
    exit /b 1
)

:success
echo.
echo ============================================
echo   Done! ZIP saved to your Desktop:
echo   %ZIP_NAME%
echo ============================================
echo.
echo Send this file to friends via:
echo   - WeChat 文件传输助手
echo   - 百度网盘 / 微云
echo   - QQ / Email
echo.
echo Friends extract it and double-click run.bat
echo to play offline.
echo.
pause
