# FaceForge BDO 0.5.1 QA Report

## Summary

This release restructures the main UX around a direct **Create Face** pipeline while preserving the existing binary parser, deterministic blender, local library scan, and advanced tools.

## Automated validation completed

- `go test ./...`
- `node --test web/js/*.test.mjs`
- JavaScript syntax parsing for `web/js/app.js`, `web/js/create-face.js`, and `web/js/state.js`

## New 0.5.1 workflow coverage

- Create Face is now the default view after launch.
- The normal path requires only:
  - one target image,
  - one starting preset.
- Automatic generation remains honest:
  - only same-class profiled library presets are used as references,
  - if no compatible profiled references exist, the app shows a reference-required state instead of pretending it can infer encrypted slider values from a photo alone,
  - unsupported groups remain at 0% until the user changes them manually.
- Generated Create Face results stay on the same screen and expose:
  - Save to BDO,
  - Download Preset,
  - Adjust Result.
- Library screenshot profiling is stored locally in browser storage and does not upload portraits anywhere.

## New 0.5.1 unit coverage

- Candidate distance scoring prefers closer references.
- Automatic ranking orders the best profiled candidates first.
- Automatic plans populate supported groups and keep unsupported groups at zero.
- Existing portrait-picker, facial-metric, state, and calibration tests continue to pass.

## Notes

- The Windows EXE is still produced by the standard cross-compile build pipeline.
- Merge Presets, Preset Laboratory, and Calibration remain available under More Tools and were not removed.
