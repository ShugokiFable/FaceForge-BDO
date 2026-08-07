# FaceForge BDO 0.7.1 QA Report

## Summary

0.7.1 replaces the hand-rolled landmark math with Skyrim FaceForge's measurement
pipeline (pose, perspective correction, baselines) and expands the control
catalogue from 12 to 13 real analyzer metrics.

## Automated validation

- `go test ./...`
- Windows x64 desktop compile check (`go test -c` for `cmd/faceforge-bdo`)
- `node --test` for face-analysis mapping tests and native-window smoke tests
- `.\build.ps1` / `.\package.ps1` end-to-end (format, tests, standalone EXE)

## Workflow coverage

- Create Face requires one target image, one starting preset, and at least one
  calibrated control.
- Generation writes only calibrated control bytes plus the optional output name.
- Uncalibrated sliders, class, face type, hair, makeup, colours, and body stay
  on the starting preset.
- Status advertises the fixed 13-control catalogue and the current calibration
  count (zero on a fresh install).
- Learn accepts a single-byte slider max diff and refuses multi-byte ambiguity.
- Merge mixes only the slider region and rejects cross-class donors.
- Save validates by re-parse and creates a timestamped backup before replace.

## Measurement mapping coverage

- Every driven metric exists in the bundled analyzer and has a finite baseline.
- A face at baseline maps to slider midpoint (0.5).
- Mild deviation moves the slider without pinning; extremes stay in 0..1.

## Regression coverage

- Parser / ICE round-trip on research fixtures.
- Learn → generate path on real preset bytes.
- Storage discovery, atomic write, and backup behaviour.
- Native desktop host remains a self-contained WebView2 window.
