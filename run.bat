@echo off
chcp 65001 >nul
title 波多黎各 Puerto Rico

REM ===== 自动检测可用的 HTTP 服务器 =====
echo.
echo ============================================
echo   波多黎各 Puerto Rico - 启动中...
echo ============================================
echo.

REM 切到本脚本所在目录
cd /d "%~dp0"

REM 优先用 Python（大部分 Windows 都自带或可装）
where python >nul 2>&1
if %ERRORLEVEL%==0 (
    echo [OK] 检测到 Python，启动 HTTP 服务器...
    echo.
    echo 游戏地址：http://localhost:8765
    echo 浏览器会在 2 秒后自动打开
    echo 按 Ctrl+C 退出
    echo.
    start "" timeout /t 2 /nobreak >nul ^& start "" http://localhost:8765
    python -m http.server 8765
    goto :end
)

REM 备选：Node.js (npx http-server)
where node >nul 2>&1
if %ERRORLEVEL%==0 (
    echo [OK] 检测到 Node.js，启动 http-server...
    echo.
    echo 游戏地址：http://localhost:8765
    echo.
    start "" timeout /t 2 /nobreak >nul ^& start "" http://localhost:8765
    npx --yes http-server -p 8765 -c-1
    goto :end
)

REM 备选：直接打开 file://
echo [警告] 未检测到 Python 或 Node.js
echo 将直接用浏览器打开 index.html （注意：图片可能加载不全）
echo.
echo 建议安装 Python：https://www.python.org/downloads/
echo.
pause
start "" "%~dp0index.html"

:end
echo.
echo 游戏已关闭。按任意键退出...
pause >nul
