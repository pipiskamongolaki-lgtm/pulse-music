@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Нужен Node.js: скачай с https://nodejs.org и запусти этот файл снова.
  pause
  exit /b 1
)
rem Server runs minimized in the taskbar window "Pulse server". Close it to stop Pulse.
start "Pulse server" /min node server.js --open
exit /b 0
