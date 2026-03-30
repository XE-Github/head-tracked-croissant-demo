@echo off
setlocal

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20.19.0 or newer is required to run this demo.
  echo Download: https://nodejs.org/
  pause
  exit /b 1
)

node scripts\start-demo.mjs
if errorlevel 1 (
  echo.
  echo Demo startup failed. Please review the messages above.
  pause
  exit /b 1
)
