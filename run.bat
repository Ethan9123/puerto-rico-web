@echo off
title Puerto Rico

cd /d "%~dp0"

echo ============================================
echo   Puerto Rico - Starting...
echo ============================================
echo.

REM Try Python first
where python >nul 2>&1
if %ERRORLEVEL%==0 (
    echo [OK] Python detected. Starting HTTP server on port 8765...
    echo.
    echo Open your browser at: http://localhost:8765
    echo Press Ctrl+C to stop the server.
    echo.
    start "" "http://localhost:8765"
    python -m http.server 8765
    goto :end
)

REM Try py launcher
where py >nul 2>&1
if %ERRORLEVEL%==0 (
    echo [OK] Python launcher detected. Starting HTTP server on port 8765...
    echo.
    echo Open your browser at: http://localhost:8765
    echo.
    start "" "http://localhost:8765"
    py -m http.server 8765
    goto :end
)

REM Try Node.js
where node >nul 2>&1
if %ERRORLEVEL%==0 (
    echo [OK] Node.js detected. Starting http-server...
    echo.
    start "" "http://localhost:8765"
    npx --yes http-server -p 8765 -c-1
    goto :end
)

REM No server: open file directly
echo [WARN] Python and Node.js not found.
echo Opening index.html directly. Some images may not load.
echo.
echo Recommend installing Python: https://www.python.org/downloads/
echo.
pause
start "" "%~dp0index.html"

:end
echo.
echo Server stopped.
pause
