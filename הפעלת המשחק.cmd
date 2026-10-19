@echo off
rem PORTAL X — double-click to start the database and the game server.
rem The game opens at http://localhost:5080 (other devices on the same Wi-Fi: see the address printed below).
rem TEST MODE: -MinPlayers 2 lets you start with 2 players; remove it for the spec's 4-player minimum.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-portalx.ps1" -Lan -MinPlayers 2
pause
