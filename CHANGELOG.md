# Changelog

## 0.3.0 · 2026-08-02

- Separated Face from Photo and Merge Presets into clear user-facing workflows.
- Added a Home screen, plain-language starting/borrow preset terminology, quick merge ratios, and Advanced Tools grouping.
- Fixed GitHub Actions release failure caused by Windows PowerShell propagating a stale native `$LASTEXITCODE` after an expected failed lookup.
- Added an explicit exit-code regression assertion and successful `exit 0` contract to the Windows helper test.
- The publisher now prints failed GitHub Actions job logs automatically before reporting a release failure.
- GitHub release publishing continues to use the Windows Actions runner, so local Go and Node.js are not required.

## 0.1.0 · 2026-08-02

Initial standalone release.

- Added strict parser and round-trip validation for 924-byte BDO customization format version 20.
- Added deterministic feature-region blending with exact weighted block selection.
- Added same-class safety checks, protected metadata/class preservation, provenance, and JSON reports.
- Added the 115-block binary laboratory and comparison runs.
- Added controlled before/after calibration observations with union/intersection learning.
- Added local MediaPipe face measurements and confidence-scored image-guided blend suggestions.
- Added customization folder discovery, scanning, direct save, atomic replacement, and timestamped backups.
- Added a token-protected loopback desktop host with a fully embedded offline interface.
- Added Windows standalone packaging, CI, release automation, and GitHub publishing scripts.

### Publishing fix

- `PUSH_TO_GITHUB.bat` no longer requires Go or Node.js to be installed locally when GitHub release creation is selected.
- Release builds are dispatched to a Windows GitHub Actions runner, watched to completion, and verified before the publisher reports success.
- Added manual `workflow_dispatch` release support with an explicit version input.
