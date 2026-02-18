@echo off
chcp 65001 >nul 2>&1
title ALIN Private Launcher
color 0D

echo.
echo  ========================================================
echo                      ALIN PRIVATE
echo        Artificial Life Intelligence Network
echo  ========================================================
echo.

cd /d "%~dp0"

:: Check if node_modules exists
if not exist "node_modules" (
    echo  [!] Installing dependencies... This may take a few minutes.
    echo.
    call npm install
    if errorlevel 1 (
        echo  [ERROR] Failed to install dependencies.
        pause
        exit /b 1
    )
    echo.
    echo  [OK] Dependencies installed successfully!
    echo.
)

echo  [1/3] Starting ALIN Private Backend (localhost only)...
start "ALIN-Private-Backend" /min cmd /k "cd /d "%~dp0\private" && node server.js"

:: Wait for backend to start
echo        Waiting for backend...
ping -n 6 127.0.0.1 >nul

:: Verify backend is running
curl -s http://127.0.0.1:3001/api/health >nul 2>&1
if errorlevel 1 (
    echo        Retrying...
    ping -n 4 127.0.0.1 >nul
    curl -s http://127.0.0.1:3001/api/health >nul 2>&1
)
if errorlevel 1 (
    echo  [!] Backend may not have started. Check the ALIN-Private-Backend window.
) else (
    echo        Private backend is ready on http://127.0.0.1:3001
)

echo  [2/3] Starting Frontend (proxied to private backend)...
set API_PORT=3001
start "ALIN-Private-Frontend" /min cmd /k "cd /d "%~dp0" && set API_PORT=3001 && npx --workspace=public vite --port 3000 --host"

:: Wait for frontend to be ready
echo  [3/3] Waiting for services to start...
ping -n 9 127.0.0.1 >nul

echo.
echo  ========================================================
echo               ALIN PRIVATE is starting!
echo  --------------------------------------------------------
echo   Frontend:  http://localhost:3000
echo   Backend:   http://127.0.0.1:3001 (localhost only)
echo   Database:  private/data/alin-private.db
echo  ========================================================
echo.

echo  Press any key to stop ALIN Private and close all services...
pause >nul

:: Kill the background processes
echo.
echo  Shutting down ALIN Private services...
taskkill /FI "WINDOWTITLE eq ALIN-Private-Backend*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq ALIN-Private-Frontend*" /F >nul 2>&1

echo  ALIN Private has been stopped. Goodbye!
ping -n 3 127.0.0.1 >nul
