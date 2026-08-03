<div align="center">

# FaceForge BDO

**Offline Black Desert preset workshop with direct photo-to-preset generation, deterministic blending, and binary inspection tools.**

Windows-first. One standalone EXE. No game injection, process memory access, macros, or cloud face upload.

</div>

## What it does

FaceForge BDO reads Black Desert customization format **version 20** files, validates their exact binary structure, and lets you inspect, compare, blend, calibrate, download, or safely save generated presets.

The supplied research samples established a fixed **924-byte** record containing a four-byte version header followed by **115 encrypted or obfuscated eight-byte blocks**. FaceForge BDO works with those blocks without pretending their ciphertext is directly readable slider data.

### Preset Blender

- Load a base and donor preset.
- Give every mapped feature region an independent 0–100% donor weight.
- Produce deterministic output: the same files, weights, and seed generate the same preset.
- Preserve protected metadata and the confirmed class identity block from the base.
- Reject cross-class donors unless the experimental override is explicitly enabled.
- Export a provenance report showing which donor supplied each changed block.

A 50% region blend selects an exact rounded half of that region's mapped blocks. It is a reproducible structural hybrid, not arithmetic interpolation of encrypted bytes.

### Create from Image

Face images are analyzed locally with the bundled MediaPipe Face Landmarker. The app measures normalized facial proportions such as eye spacing, face aspect, nose width, mouth width, jaw width, and lower-face length.

For useful image guidance, build a local reference library over time:

1. scan your preset folder,
2. attach one in-game screenshot to any preset you want FaceForge to learn from,
3. return to Create Face and let the app reuse those profiled references automatically.

A screenshot for the starting preset is optional. If it exists, FaceForge can use it. If it does not, the app still works and falls back honestly to the closest profiled same-class references for supported facial groups.

The app now supports a direct Create Face workflow. You provide a target photo and a starting preset. FaceForge then searches your local scanned preset library for same-class presets that already have linked screenshot profiles, selects the closest references for supported facial groups, and generates the result on the same screen. If the library has no compatible profiled presets yet, FaceForge tells you so instead of pretending it can infer encrypted BDO values from a raw photo alone.

### Preset Laboratory

- Inspect every fixed block with ciphertext, default status, region, protection, and map confidence.
- Compare two files and highlight changed blocks and contiguous runs.
- Confirm version, size, SHA-256, class fingerprint, face-type fingerprint, and default-block count.

### Calibration Wizard

Create controlled BDO presets where exactly one customization control changes. Import the before and after files, name the operation, and record the changed blocks. Repeated observations track:

- **intersection:** blocks changed in every sample,
- **union:** blocks changed in at least one sample.

The calibration database is local, importable, and exportable JSON.

### Library and safe saving

- Detects the usual `Documents\Black Desert\Customization` folder, including common OneDrive layouts.
- Scans only files that pass strict preset validation.
- Saves through a temporary file and validates before installation.
- Creates a timestamped backup before replacing an existing file.

## Current binary map

| Region | Blocks | Confidence |
|---|---:|---|
| Metadata and ownership | 0–8 | Protected |
| Class identity | 9 | Confirmed |
| Face type | 10 | High |
| Face geometry | 11–37 | Experimental |
| Eyes and brows | 38–60 | Experimental |
| Makeup and face detail | 61–70 | Experimental |
| Hair | 71–89 | Experimental |
| Body | 90–99 | Experimental |
| Skin and finish | 100–104 | Experimental |
| Extended and unknown | 105–114 | Unknown |

The calibration workflow exists specifically to replace broad starter regions with stronger evidence over time.

## Run the release

Download the current standalone EXE from the GitHub release or the packaged release ZIP:

```text
FaceForge BDO 0.5.1 - STANDALONE.exe
```

Double-click it. The EXE opens a dedicated FaceForge BDO desktop window and keeps its private token-protected service bound to `127.0.0.1` only. Close the window or use **Settings → Exit FaceForge BDO** when finished.

## Build from source

Local build requirements:

- Go 1.22 or newer
- Node.js 20 or newer, used for JavaScript tests
- PowerShell 7 or Windows PowerShell 5.1

```powershell
.\build.ps1
```

The output is written to `artifacts\FaceForge BDO 0.5.1 - STANDALONE.exe`.

Run the full local packaging pipeline with `package.ps1`, or double-click `BUILD_EXE.bat`.

## Build and package locally

This clean source pack deliberately contains no publishing or repair BAT files.

Local requirements:

- Go 1.22 or newer
- Node.js 20 or newer
- PowerShell 7 or Windows PowerShell 5.1

Build the executable:

```powershell
.\build.ps1
```

Build the executable plus local release archives:

```powershell
.\package.ps1
```

## Source layout

```text
cmd/faceforge-bdo/       Portable desktop host
internal/preset/         Parser, comparer, schema, deterministic blender
internal/calibration/    Controlled change observations
internal/storage/        Discovery, scan, atomic save, backups
internal/app/            Token-protected local JSON API
web/                     Embedded offline interface and face analysis
assets/schema/           Versioned preset maps
samples/                 Initial research presets
scripts/                 QA and release helpers
```

## Security model

- The server binds to IPv4 loopback only.
- Every API request requires a random per-launch 256-bit token.
- The token is delivered in the URL fragment, which is not sent in HTTP requests, then retained for the browser session.
- Request bodies are size-limited.
- Generated binaries are parsed again before download or save.
- Existing files are backed up before replacement.
- The app does not attach to the Black Desert process or automate its UI.

## Honest limits

- Feature regions beyond class identity and face type are still broad starter mappings.
- Weighted blending is deterministic block selection, not numeric slider interpolation.
- Image guidance needs photographed base and donor presets to connect visible measurements to encrypted data.
- Cross-class blending can produce unusable faces because classes may use incompatible meshes, assets, and valid ranges.
- Game updates may introduce a new preset format version requiring a new schema and parser.

## License

FaceForge BDO source code is MIT-licensed. Bundled MediaPipe components use Apache License 2.0. See `THIRD_PARTY_NOTICES.md` and `licenses/`.
