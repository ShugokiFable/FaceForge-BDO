@echo off
setlocal
cd /d "%~dp0"

echo ================================================================
echo  FACEFORGE BDO - PUSH CI SMOKE STABILITY FIX
echo ================================================================
echo.

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0publish-github.ps1" -Repository "FaceForge-BDO" -Visibility Public -Version "0.3.0" -CommitMessage "Fix flaky Windows native smoke cleanup"
set "EXITCODE=%ERRORLEVEL%"

echo.
if not "%EXITCODE%"=="0" (
    echo PUSH FAILED. Read the error above.
    pause
    exit /b %EXITCODE%
)

echo FIX PUSHED. GitHub CI will run automatically.
echo This does not rebuild or replace the already-created v0.3.0 release.
pause
exit /b 0
