@echo off
title ProjectPlanner v2 - Backend Server
cd /d "%~dp0backend"

echo.
echo  Verifico Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo  ERRORE: Node.js non trovato. Scaricalo da https://nodejs.org
    pause
    exit /b 1
)

echo  Verifico dipendenze...
if not exist "node_modules" (
    echo  Installo dipendenze (solo al primo avvio)...
    npm install
    if errorlevel 1 (
        echo  ERRORE durante npm install.
        pause
        exit /b 1
    )
)

echo.
echo  Avvio ProjectPlanner v2 Backend...
echo  Apri il browser su: http://localhost:3001
echo.
echo  Premi CTRL+C per fermare il server.
echo.
node server.js
pause
