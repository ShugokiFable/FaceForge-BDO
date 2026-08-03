@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ================================================================
echo  FACEFORGE BDO 0.4.0 - PUSH SOURCE AND RELEASE TO GITHUB
echo ================================================================
echo.
echo Target repository:
echo   https://github.com/ShugokiFable/FaceForge-BDO
echo.
echo This uploads the complete source, tags v0.4.0, and publishes the
echo already-built EXE, source ZIP, release ZIP, and checksums.
echo It does not require Go or Node.js on this PC.
echo.
set /p CONFIRM=Continue? [Y/n]: 
if /I "%CONFIRM%"=="N" exit /b 0

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0PUBLISH_0.4.0_GITHUB.ps1"
if errorlevel 1 (
  echo.
  echo ================================================================
  echo  PUBLISH FAILED
  echo ================================================================
  echo Read the exact error above. Rerunning this BAT is safe.
  pause
  exit /b 1
)

echo.
echo ================================================================
echo  FACEFORGE BDO 0.4.0 PUBLISHED SUCCESSFULLY
echo ================================================================
echo Repository:
echo   https://github.com/ShugokiFable/FaceForge-BDO
echo Release:
echo   https://github.com/ShugokiFable/FaceForge-BDO/releases/tag/v0.4.0
echo.
pause
exit /b 0
