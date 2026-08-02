@echo off
setlocal
cd /d "%~dp0"
echo ================================================================
echo  FACEFORGE BDO - BUILD WINDOWS EXE
echo ================================================================
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0package.ps1"
if errorlevel 1 (
  echo.
  echo BUILD FAILED. Read the error above.
  pause
  exit /b 1
)
echo.
echo BUILD COMPLETE. Open the artifacts folder for the EXE and source ZIP.
explorer.exe "%~dp0artifacts"
pause
