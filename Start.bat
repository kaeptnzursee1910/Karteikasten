@echo off
rem Startet den Karteikasten. Dieses Fenster offen lassen, solange die App laufen soll.
title Karteikasten
cd /d "%~dp0"

python --version >/dev/null 2>&1
if not errorlevel 1 (
  python server.py %*
  goto ende
)
py --version >/dev/null 2>&1
if not errorlevel 1 (
  py server.py %*
  goto ende
)

echo.
echo Python wurde nicht gefunden.
echo Bitte von https://www.python.org/downloads/ installieren
echo und dabei den Haken bei "Add python.exe to PATH" setzen.
echo.

:ende
pause
