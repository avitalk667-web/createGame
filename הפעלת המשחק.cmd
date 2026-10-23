@echo off
rem PORTAL X — double-click to start the database and the game server.
rem The game opens at http://localhost:5080 (other devices on the same Wi-Fi: see the address printed below).
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-portalx.ps1" -Lan
pause
