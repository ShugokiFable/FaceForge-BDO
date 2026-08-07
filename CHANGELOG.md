# Changelog

## 0.7.1 · 2026-08-07

### Face measurement is now Skyrim FaceForge's, not a second implementation

- `web/js/skyrim-face.js` is Skyrim FaceForge's own analysis pipeline, bundled
  from `src/FaceForge.Web/src/domain` with esbuild (`web/vendor-src/`). FaceForge
  BDO calls its `measureFace` instead of measuring landmarks itself.
- That brings head-pose estimation, perspective/foreshortening correction,
  mirror averaging, and per-measurement trust fading, so an imperfectly square-on
  photo still measures sensibly. The previous hand-rolled version measured raw 2D
  distances and degraded badly off-axis.
- Sliders are now driven by deviation from `measurementBaselines` — what each
  proportion reads on a real neutral head, measured from rendered heads in the
  Skyrim project — instead of the invented [min, max] windows 0.7.0 first shipped.
  A face at the baseline lands at 50; deviation is tanh-compressed by
  `SLIDER_SPREAD` so a strong face approaches an end stop without pinning.
- Controls went from 12 to 13 and now map onto real measurement keys:
  forehead height is gone (the analyzer has no forehead measurement), chin width
  and nose length are new, eye angle uses `eyeTilt`, lips use `lipFullness`.
- Added regression tests for metric/baseline presence, neutral midpoint, mild
  deviation, and clamp behaviour in `web/js/face-analysis.test.mjs`.

**Note:** Existing `slidermap.json` entries for removed control IDs (for example
`forehead_height`) are ignored; calibrate the new controls (`chin_width`,
`nose_length`) once if you want the photo to drive them.

## 0.7.0 · 2026-08-06

Rebuilt around a measured byte layout and a calibration the user can actually
supply, replacing the reference-library workflow that could never complete.

### Format map, derived from evidence

- Profiled every byte offset across a corpus of 134 real customization files
  (124 Customization Album downloads whose filenames carry the class id, 6 player
  saves, 4 research samples). Decrypt/re-encrypt is byte-identical on all of them.
- Confirmed the class id lives at plaintext byte **80**: it equals the filename's
  class prefix in all 124 prefixed files, across 12 distinct classes.
- Confirmed the character name at byte **8**, UTF-16LE, and read it back as text.
- Identified the face and body slider region as bytes **98–220**, bounded by a
  zero run at 221–232. Every varying byte in it stays within 0–100 except three
  (106, 109, 112) that reach 254; those are marked unclassified and never written.

### Removed the 8-byte block abstraction

- Blocks are the ICE cipher's unit, not the data's. The old schema assigned whole
  8-byte blocks to features, so editing "face geometry" moved eight unrelated
  sliders at once. Everything now addresses plaintext bytes directly.
- Deleted the invented starter regions (`face_geometry: blocks 11-37` and friends).
  Nothing in the corpus supported those boundaries.

### Photo to preset, honestly

- Create Face no longer needs a "profiled reference library". It measures the
  photo, then drives each **calibrated** slider from one facial proportion.
- Added a fixed catalogue of 12 controls — exactly one per proportion the first
  analyzer could measure. No control exists without a measurement behind it.
- Uncalibrated sliders, the class, face type, hair, makeup, colours and body are
  copied from the starting preset byte for byte, so output is always a variant of
  a preset that already worked in game.
- The main screen always states how many of the catalogue sliders are calibrated.
  It never implies more.

### Calibration replaces the calibration wizard

- Learn takes a base preset plus one saved with a single slider dragged to
  maximum, and records which byte moved. It refuses ambiguous diffs and reports
  the candidates instead of guessing, because a wrong offset would silently
  corrupt every later preset.
- The map is stored as `slidermap.json` in local app data, and is seeded from a
  `slidermap.json` next to the EXE when present, so one person's calibration can
  ship to everyone.

### Simpler app

- Collapsed seven screens (Create Face, Library, Merge, Laboratory, Calibration,
  Adjust, Settings) into one: photo, starting preset, Create Preset, save.
  Calibrate and Merge are collapsed panels beneath it.
- Merge now mixes only the slider region and refuses cross-class donors outright.
- Removed the reference catalog, the block laboratory, the block comparer and the
  block-based blend recipe.

## 0.6.0 · 2026-08-03

- Replaced ciphertext block swapping with a real decrypted preset engine for BDO version 20 presets.
- Added independent Thin-ICE preset decryption and re-encryption with strict round-trip validation.
- Blend operations now modify decrypted customization bytes and re-encrypt the finished preset instead of selecting whole encrypted blocks.
- 0% group weight still preserves the base preset, while 100% still copies the donor exactly for the selected group.
- Mid-range weights now generate genuine intermediate presets for mapped groups instead of crude all-or-nothing block transplants.
- Added plaintext block access, plaintext round-trip tests, and regression coverage for interpolated output.
- Blend responses now report `changedBytes` in addition to changed encrypted blocks.
- Kept protected metadata and class identity preservation rules intact.


## 0.5.2 · 2026-08-03

- Fixed automatic Create Face producing a zero-change copy when the only profiled reference was the starting preset itself.
- The starting preset is now used only as the protected base and optional interpolation profile. It can never count as its own donor.
- Create Preset stays disabled until at least one genuinely different screenshot-profiled preset with the same class fingerprint is available.
- Automatic generation now rejects zero-change blends and explains that the selected reference has identical mapped face blocks instead of presenting the original face as a successful result.
- Moved the reference screenshot profile catalog from per-port browser storage to `%LOCALAPPDATA%\FaceForge BDO\reference-catalog.json`, so profiles survive app restarts and version upgrades.
- Added authenticated reference-catalog load/save API routes with atomic on-disk persistence.
- Added persistence, API, self-donor rejection, and zero-change rejection regression tests.

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
