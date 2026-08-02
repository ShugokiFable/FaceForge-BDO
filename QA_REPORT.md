# FaceForge BDO 0.3.0 QA Report

## Native desktop host

- Windows target builds as a 64-bit `PE32+` executable with the **Windows GUI** subsystem.
- The executable contains the Win32 window host, embedded `WebView2Loader.dll`, and `CreateCoreWebView2EnvironmentWithOptions` entry point.
- The source and executable contain no `rundll32`, `FileProtocolHandler`, or system-browser launcher path.
- WebView2 environment, controller, and webview interfaces are explicitly retained with COM `AddRef` ownership and released during window shutdown.
- A Windows-only native-window smoke test is included in GitHub Actions on `windows-latest`.

## Reported image-picker regression

- The portrait chooser uses one native `<label>` activation.
- The former JavaScript forwarding call to `input.click()` has been removed.
- The DOM regression test observes exactly one input activation per chooser action.

## Rendered workflow test

A real Chromium surface was exercised with the embedded local app and assets:

- 3 MediaPipe portrait analyses completed locally.
- Image-guided suggestions became available.
- Same-class preset blend generated a valid 924-byte version 20 preset.
- Direct save wrote a valid 924-byte preset.
- Preset Laboratory reported 88 changed blocks for the supplied Lahn pair.
- Calibration recorded one controlled mapping.
- Preset Library scanned all four supplied presets.
- All six workspaces rendered.
- Desktop and 390 x 844 layouts had no horizontal overflow.
- No runtime or console errors were observed.

Screenshots are stored under `artifacts/qa/` in the verification workspace.

## Automated checks

- `go test ./...`
- `go test -race ./...`
- `go vet ./...`
- `node --test web/js/*.test.mjs`
- Windows-only test compilation with `GOOS=windows GOARCH=amd64 CGO_ENABLED=0`
- Windows GUI EXE build with `-H=windowsgui`
- JavaScript syntax parsing
- JSON schema parsing
- PE subsystem and forbidden-launcher string inspection

## Environment boundary

The release was built in a Linux verification environment, so the final Windows GUI executable was cross-compiled rather than interactively launched here. The repository includes a native WebView2 window smoke test that runs on GitHub Actions `windows-latest` after the source is pushed.

## Publisher bootstrap

- A clean Git repository with no `origin` is treated as a normal first-run state.
- Expected `gh repo view` and `gh release view` misses do not terminate Windows PowerShell 5.1.
- Existing `origin` URLs are validated against the requested `owner/repository` before push.
- `scripts/test-publish-helpers.ps1` exercises the no-origin path on Windows CI.

## GitHub publishing fallback

- Verified publisher source no longer invokes `package.ps1` or checks for local Go when `-CreateRelease` is used.
- Verified the release workflow accepts `workflow_dispatch` with an explicit version and creates the matching `v<version>` release.
- Added regression coverage for cloud release dispatch and local-toolchain independence.

## GitHub Actions exit-code regression

- The failed release run was traced to an expected `git rev-parse` miss inside `Test-NativeCommandSucceeded`.
- Every helper assertion passed, but Windows PowerShell retained native `$LASTEXITCODE = 1` and returned failure to GitHub Actions.
- The helper now captures the command result and resets global `$LASTEXITCODE` before returning.
- The Windows test asserts that the expected failure cannot leak a non-zero native exit code and explicitly exits with code 0.
- Static publisher tests verify the reset, explicit successful exit, cloud-build delegation, and failed-log printing path.
- Local verification after the repair: 17 JavaScript tests passed, all Go tests passed, and `go vet ./...` passed.

## Deleted remote repository recovery

- Confirmed the reported `Repository not found` failure occurred because local `origin` still existed while `ShugokiFable/FaceForge-BDO` no longer existed remotely.
- The publisher now checks `gh repo view` before every push, regardless of whether `origin` is present.
- A missing remote is recreated as an empty public/private repository using the requested visibility.
- Existing `origin` is canonicalized to `https://github.com/<owner>/<repository>.git`, then access is verified before push.
- A regression test proves the repository-existence check runs before `git push` and that creation does not depend on `--source` or `--remote`.
