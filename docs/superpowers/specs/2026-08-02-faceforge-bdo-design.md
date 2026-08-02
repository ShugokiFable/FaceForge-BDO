# FaceForge BDO Design

> **0.2.0 desktop amendment:** The shipped application uses a native Win32 window with embedded Microsoft WebView2. It does not launch the system browser.

## Purpose

FaceForge BDO is a separate, local-first Windows application for inspecting, comparing, blending, calibrating, and image-guiding Black Desert Online character customization preset files. It produces files the game can load without injecting into the game, reading process memory, automating input, or modifying game archives.

## Product boundary

Version 0.1.0 is an honest preset laboratory and hybrid generator. It does not claim to decrypt every numeric BDO customization parameter. It preserves opaque encrypted/obfuscated blocks exactly and creates deterministic hybrids by transplanting compatible feature blocks. True numeric interpolation is enabled only for fields that future calibration or format research proves decodable.

## Runtime architecture

A single Go executable embeds the complete HTML, CSS, JavaScript, MediaPipe WASM, face-landmarker model, schemas, and sample presets. On launch it binds an HTTP server to loopback only on a random port, creates a per-launch access token, opens the system browser, and serves the application. The app can shut down its own local process through a token-protected endpoint.

The browser performs image decoding, landmark analysis, overlays, and interactive state. The Go core owns preset parsing, validation, hashing, comparison, deterministic block blending, calibration mapping, BDO-folder discovery, backups, and disk writes.

## Preset model

The supplied current-format files are 924 bytes: a four-byte little-endian version followed by 115 fixed eight-byte blocks. Version 20 is supported initially. The parser keeps every byte, exposes block fingerprints, identifies repeated default blocks, and never rewrites unselected data.

A schema describes named feature groups as block ranges. Mapped groups may be copied from donors. Unknown groups remain visible in the laboratory and are preserved from the base preset. The class identity block is protected by default. Cross-class operations are marked experimental and retain the base class unless the user deliberately overrides the protection.

## Blending semantics

Two blend modes are provided:

1. Exact feature transplant copies all blocks assigned to a selected feature group from a donor preset.
2. Weighted structural blend chooses a deterministic proportion of blocks from each donor inside a group using a stable hash. A 50/50 result is reproducible and distributed across the group, but is explicitly labelled as ciphertext/block blending rather than a mathematical slider midpoint.

Every region can have a separate weight. The global weight supplies defaults. The app records the recipe, source hashes, schema version, and selected block provenance in a JSON sidecar.

## Image-guided workflow

The user supplies a front portrait and optionally side views. MediaPipe runs locally and extracts stable normalized measurements such as face aspect, eye spacing, eye openness, nose width, mouth width, jaw width, and lower-face ratio. Version 0.1.0 maps those measurements into recommended donor weights. This provides an image-guided starting hybrid, not a promise of one-click exact likeness.

The analysis UI shows landmarks, warnings for pose or weak detection, the generated measurements, and the resulting per-region recipe. Users can manually adjust every recommendation before export.

## Calibration workflow

The calibration wizard compares controlled before/after presets, identifies changed blocks, lets the user label the changed control, and stores confidence-tagged mappings in a portable JSON database. Repeated observations intersect or union block sets according to user choice. This is the intended path toward increasingly precise per-class schemas.

## Safety and file handling

The server binds only to 127.0.0.1 and requires a launch token for APIs. BDO folder discovery is read-only until an explicit save. Saving creates a timestamped backup before replacing an existing file. The UI supports browser download as an alternative. Invalid length, unsupported version, changed protected class block, and empty output are hard errors.

## User interface

The app reuses FaceForge's restrained dark industrial visual language: graphite surfaces, amber primary accents, cyan analysis accents, compact typography, and three-pane workspaces. Main workspaces are Create from Image, Preset Blender, Preset Laboratory, Calibration, Library, and Settings.

## Repository and release

The repository includes Go source, frontend source, tests, sample presets, documentation, a PowerShell build script, a packaging script, a one-click batch launcher for GitHub publishing, and GitHub Actions workflows for tests and Windows release artifacts. The release output is `FaceForge BDO 0.1.0 - STANDALONE.exe` plus a source ZIP.

## Success criteria

- The supplied four presets parse and round-trip byte-for-byte.
- Same-class Lahn blends preserve length, version, protected class identity, and unselected blocks.
- Selected groups can be transplanted and weighted deterministically.
- Invalid and unsupported files are rejected with actionable errors.
- MediaPipe analyzes a local portrait offline and generates editable region weights.
- The app scans and safely writes the default BDO customization folder.
- Tests pass on Linux and Windows.
- A Windows x64 standalone executable is produced from the repository.
