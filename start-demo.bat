@echo off
setlocal

cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\bootstrap-windows.ps1"
if errorlevel 1 (
  echo.
  echo Demo startup failed. Please review the messages above.
  pause
  exit /b 1
)
