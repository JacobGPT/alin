@echo off
chcp 65001 >nul 2>&1
title ALIN Launcher
color 0A

echo.
echo  ========================================================
echo                         ALIN
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

echo  [1/3] Starting ALIN Backend Proxy Server...
start "ALIN-Backend" /min cmd /k "cd /d "%~dp0\public" && node server.js"

:: Wait for backend to start
echo        Waiting for backend...
ping -n 6 127.0.0.1 >nul

:: Verify backend is running
curl -s http://localhost:3002/api/health >nul 2>&1
if errorlevel 1 (
    echo        Retrying...
    ping -n 4 127.0.0.1 >nul
    curl -s http://localhost:3002/api/health >nul 2>&1
)
if errorlevel 1 (
    echo  [!] Backend may not have started. Check the ALIN-Backend window.
) else (
    echo        Backend is ready on http://localhost:3002
)

echo  [2/3] Starting ALIN Frontend...
start "ALIN-Frontend" /min cmd /k "cd /d "%~dp0" && npm run dev:vite"

:: Wait for frontend to be ready (8 seconds for Vite)
echo  [3/3] Waiting for services to start...
ping -n 9 127.0.0.1 >nul

echo.
echo  ========================================================
echo                   ALIN is starting!
echo  --------------------------------------------------------
echo   Frontend:  Check ALIN-Frontend window for URL
echo              (usually :3000 or :5173)
echo   Backend:   http://localhost:3002
echo  --------------------------------------------------------
echo   Opening ALIN in your default browser...
echo  ========================================================
echo.

:: Try to open browser
start "" "http://localhost:3000"

echo  Press any key to stop ALIN and close all services...
pause >nul

:: Kill the background processes
echo.
echo  Shutting down ALIN services...
taskkill /FI "WINDOWTITLE eq ALIN-Backend*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq ALIN-Frontend*" /F >nul 2>&1

echo  ALIN has been stopped. Goodbye!
ping -n 3 127.0.0.1 >nul
