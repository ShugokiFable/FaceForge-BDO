# FaceForge BDO 0.7.0 QA Report

## Summary

This release rebuilds Create Face around measured plaintext offsets and a
user-supplied slider map. The old 8-byte block feature map, reference-catalog
workflow, laboratory screens, and block blend recipe are gone.

## Automated validation

- `go test ./...`
- Windows x64 desktop compile check (`go test -c` for `cmd/faceforge-bdo`)
- `node --test` for face-analysis and native-window smoke tests
- `.\build.ps1` end-to-end (format, tests, standalone EXE)

## Workflow coverage

- Create Face requires one target image and one starting preset.
- Generation writes only calibrated control bytes plus the optional output name.
- Uncalibrated sliders, class, face type, hair, makeup, colours, and body stay
  on the starting preset.
- Status advertises the fixed 12-control catalogue and the current calibration
  count (zero on a fresh install).
- Learn accepts a single-byte slider max diff and refuses multi-byte ambiguity.
- Merge mixes only the slider region and rejects cross-class donors.
- Save validates by re-parse and creates a timestamped backup before replace.

## Regression coverage

- Parser / ICE round-trip on research fixtures.
- Learn → generate path on real preset bytes (class preserved; only calibrated
  offsets and name change).
- Storage discovery, atomic write, and backup behaviour.
- Face-analysis metrics stay in 0..1 and move in the expected direction.
- Native desktop host remains a self-contained WebView2 window (no go-webview2
  dependency in the product binary).

## Manual check

- Standalone EXE launches a native window and renders the single-screen UI.
- User confirmed the EXE launches successfully before the GitHub publish step.
