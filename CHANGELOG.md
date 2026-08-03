# Changelog

## 0.5.1 · 2026-08-03

- Fixed Create Face appearing permanently stuck after an immediate same-preset fallback result.
- Root cause: zero-change blends serialized `changedBlocks` as JSON `null`; the result renderer expected an array and crashed before replacing the processing screen.
- Zero-change comparisons now serialize empty collections as `[]`, and the frontend defensively normalizes older or malformed blend responses.
- When the starting preset is the only profiled same-class reference, FaceForge now returns the honest zero-change fallback immediately instead of making an unnecessary blend request.
- Replaced the misleading frozen elapsed-time display with an explicit 25-second safety timeout.
- Fixed GitHub release verification for asset names containing spaces by parsing the full JSON response rather than line-oriented `--jq` output.

## 0.5.0 · 2026-08-02

- Fixed the confusing Create Face dead-end where a starting preset with its own linked screenshot could still report that a reference screenshot was required. The starting preset can now act as an automatic fallback reference.
- Simplified the Create Face screen into a clearer three-step workflow that is closer to the cleaner Skyrim edition layout.
- Added clearer automatic-reference readiness status so you can immediately see whether the current class is ready for photo matching.
- Added request timeouts and a Cancel action during Create Face builds, so the app no longer appears to hang forever at "Building and validating the preset...".
- Added build-time feedback in the result panel and friendlier messaging when only one profiled same-class reference is available.
- Reduced some UI bulk and tightened the desktop layout for easier 1440p use.
- Added a regression test for the starting-preset fallback reference behavior.

## 0.4.0 · 2026-08-02

- Replaced the old “Face from Photo → helper preset → go to Merge Presets” normal path with a direct **Create Face** workflow.
- Create Face now generates the result on the same screen and exposes **Save to BDO**, **Download Preset**, and **Adjust Result** immediately after generation.
- Added a local **reference screenshot profile catalog** in the Preset Library. You can now attach one screenshot to a preset and reuse that analyzed profile later for photo matching.
- Automatic photo matching now searches the scanned preset library for compatible **same-class** profiled references and selects the closest candidates per supported feature group.
- Starting presets no longer require their own screenshot profile. If one is missing, FaceForge falls back honestly and borrows supported facial groups from the closest profiled same-class references.
- Unsupported groups remain at 0% in the automatic workflow until the user changes them in **Adjust Result**.
- Simplified navigation to four main areas: **Create Face**, **Preset Library**, **More Tools**, and **Settings**.
- Moved **Merge Presets**, **Preset Laboratory**, and **Calibration** under **More Tools** so the normal workflow stays focused.
- Reduced UI bulk and made the primary workflow fit typical 1440p desktop use better with fewer oversized cards and fewer forced scrolls.
- Added automatic-recipe unit tests for ranking and supported/unsupported group behavior.
- Bumped the app and package version to 0.5.0.

## 0.3.0 · 2026-08-02

- Separated Face from Photo and Merge Presets into clear user-facing workflows.
- Added a Home screen, plain-language starting/borrow preset terminology, quick merge ratios, and Advanced Tools grouping.
- Fixed GitHub Actions release failure caused by Windows PowerShell propagating a stale native `$LASTEXITCODE` after an expected failed lookup.
- Added an explicit exit-code regression assertion and successful `exit 0` contract to the Windows helper test.
- The publisher now prints failed GitHub Actions job logs automatically before reporting a release failure.
- GitHub release publishing continues to use the Windows Actions runner, so local Go and Node.js are not required.
- The publisher now verifies the GitHub repository itself on every run, recreates a deleted remote even when local `origin` still exists, canonicalizes the remote URL, and verifies access before push.

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
