@echo off
setlocal
cd /d "%~dp0"
echo ================================================================
echo  FACEFORGE BDO - PUSH TO GITHUB
echo ================================================================
set /p REPO=Repository name [FaceForge-BDO]: 
if "%REPO%"=="" set REPO=FaceForge-BDO
set /p PRIVATE=Private repository? [y/N]: 
set VISIBILITY=Public
if /I "%PRIVATE%"=="Y" set VISIBILITY=Private
set /p RELEASE=Build and create GitHub release too? [Y/n]: 
set RELEASE_SWITCH=-CreateRelease
if /I "%RELEASE%"=="N" set RELEASE_SWITCH=
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0publish-github.ps1" -Repository "%REPO%" -Visibility "%VISIBILITY%" %RELEASE_SWITCH%
if errorlevel 1 (
  echo.
  echo PUBLISH FAILED. Read the error above.
  pause
  exit /b 1
)
echo.
echo PUBLISH COMPLETE.
pause
