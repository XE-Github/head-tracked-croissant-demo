@echo off
setlocal

cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\bootstrap-windows.ps1"
if errorlevel 1 (
  echo.
  echo Demo startup failed. Please review the messages above.
  echo If dependency installation failed, check artifacts\startup\last-install.log for launcher details.
  pause
  exit /b 1
)
