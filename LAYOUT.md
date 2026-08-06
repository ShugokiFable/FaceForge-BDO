# BDO customization v20 plaintext layout

This map is measured from a corpus of **134** real customization files
(124 Customization Album downloads with a class-id filename prefix, 6 player
saves, 4 research samples). Decrypt and re-encrypt are byte-identical on every
file in that set.

ICE uses 8-byte blocks. That is a **cipher** detail only. Feature data does not
align to those blocks, so FaceForge never assigns whole blocks to one slider.

## File shape

| Field | Bytes | Description |
|---|---:|---|
| On-disk size | 924 | Fixed for version 20 |
| Version header | 0–3 | `uint32` little-endian = `20` (outside ciphertext) |
| Ciphertext body | 4–923 | Thin-ICE encrypted payload |

## Confirmed plaintext fields

| Field | Offset | Size | Evidence |
|---|---:|---:|---|
| Character name | 8 | 32 | UTF-16LE, NUL-padded; readable as text after decrypt |
| Class id | 80 | 1 | Equals the filename class prefix on all 124 prefixed album files (12 classes) |
| Slider region | 98–220 | 123 | Face and body sliders; almost all values stay in 0–100 across the corpus |
| Zero separator | 221–232 | 12 | Zero in every corpus file |
| Style / colour / hair / makeup / remaining | 233+ | … | Wide-valued fields; copied from the base, not photo-driven |

Offsets 40–69 are zero across the corpus (between name and class).

## Unclassified bytes inside the slider region

Offsets **106**, **109**, and **112** reach 254 in the corpus, so they are not
treated as 0–100 sliders. Their stride of 3 suggests a packed triple, but the
corpus does not establish their meaning. FaceForge **never writes** them; they
are always copied from the starting preset.

## What FaceForge may write

- Character name (optional rename on generate / save)
- One plaintext byte per **calibrated** control (offset discovered via Learn)
- Merge may interpolate bytes inside the slider region only, still skipping
  unclassified offsets and never changing class

Everything else is preserved from the base preset after re-encryption.

## Calibration storage

Learned offsets live in `slidermap.json` under the user's local app data (or a
seed file next to the EXE). The fixed control catalogue and metric names are
source-defined in `internal/preset/controls.go` and
`web/js/face-analysis.js`.
