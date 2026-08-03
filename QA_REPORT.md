# FaceForge BDO 0.6.0 QA Report

## Summary

This release fixes the automatic Create Face path so a starting preset can no longer be used as its own donor and screenshot profiles persist across launches.

## Automated validation

- `go test ./...`
- `go vet ./...`
- `node --test web/js/*.test.mjs scripts/*.test.mjs`
- JavaScript syntax checks for the main application modules
- Windows x64 GUI cross-build

## Workflow coverage

- Create Face requires one target image, one starting preset, and at least one **different** screenshot-profiled preset with the same class fingerprint.
- The starting preset profile may improve interpolation but is never counted as a donor.
- If no distinct compatible donor exists, Create Preset is disabled with a direct explanation.
- A generated automatic result with zero changed blocks is rejected instead of being presented as a successful face conversion.
- Reference profiles are persisted in `%LOCALAPPDATA%\FaceForge BDO\reference-catalog.json` and are not uploaded.
- Generated results remain on the Create Face screen with Save to BDO, Download Preset, and Adjust Result.

## Regression coverage

- Reference catalogs survive save and reload with normalized SHA-256 keys.
- Missing catalog files produce an empty valid catalog.
- The authenticated catalog API writes and reloads profiles from disk.
- Automatic planning excludes the starting preset when it appears in the candidate list.
- Automatic generation rejects zero-change results.
- Existing parser, blender, storage, face-analysis, picker, state, calibration, and native-window tests continue to pass.
