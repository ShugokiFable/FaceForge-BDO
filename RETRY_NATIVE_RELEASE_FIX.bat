@echo off
setlocal
cd /d "%~dp0"

echo ================================================================
echo  FACEFORGE BDO - PUSH NATIVE SMOKE FIX AND CREATE RELEASE
echo ================================================================
echo.

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0publish-github.ps1" -Repository "FaceForge-BDO" -Visibility Public -CreateRelease -Version "0.3.0"
set "EXITCODE=%ERRORLEVEL%"

echo.
if not "%EXITCODE%"=="0" (
    echo RELEASE FAILED. Read the error above.
    pause
    exit /b %EXITCODE%
)

echo RELEASE COMPLETED SUCCESSFULLY.
pause
exit /b 0
