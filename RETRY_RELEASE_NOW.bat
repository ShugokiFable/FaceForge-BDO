@echo off
setlocal
cd /d "%~dp0"
echo ================================================================
echo  FACEFORGE BDO - REPAIR, PUSH, AND CREATE RELEASE
echo ================================================================
echo.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0publish-github.ps1" -Repository "FaceForge-BDO" -Visibility Public -CreateRelease
if errorlevel 1 (
  echo.
  echo RELEASE FAILED. Read the error above.
  pause
  exit /b 1
)
echo.
echo RELEASE COMPLETE.
pause
