@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul
title GPT Image Studio

where node >nul 2>nul
if errorlevel 1 goto :no_node

where pnpm >nul 2>nul
if errorlevel 1 (set "PM=npm") else (set "PM=pnpm")

if not exist "node_modules" goto :install
if not exist "server\public\index.html" goto :build
goto :run

:install
echo [setup] First run: installing dependencies, 1-2 minutes...
call %PM% install
if errorlevel 1 goto :failed

:build
if exist "server\public\index.html" goto :run
echo [setup] Building frontend...
call %PM% run build
if errorlevel 1 goto :failed

:run
node "scripts\launch.mjs"
echo.
echo Server stopped. Double-click start.bat to start again.
pause
exit /b 0

:no_node
echo [ERROR] Node.js 20 or newer is required.
echo         Download: https://nodejs.org/
echo.
pause
exit /b 1

:failed
echo.
echo [ERROR] Setup failed. Please check the log above.
echo         If it is a network problem, retry later or set a proxy.
pause
exit /b 1
