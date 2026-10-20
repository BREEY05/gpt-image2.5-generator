@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\create-shortcut.ps1"
echo.
pause
