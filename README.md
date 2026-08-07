<div align="center">

# FaceForge BDO

**Offline Black Desert photo-to-preset tool with measured byte layout, user-supplied slider calibration, and a single-screen workflow.**

Windows-first. One standalone EXE. No game injection, process memory access, macros, or cloud face upload.

</div>

## What it does

FaceForge BDO reads Black Desert customization format **version 20** files (fixed **924-byte** records), decrypts the Thin-ICE ciphertext, edits plaintext bytes that have been measured on a real corpus, re-encrypts, and validates by re-parsing before export or save.

Photo matching drives only **calibrated** sliders from local face measurements. Everything else (class, face type, hair, makeup, colours, body, uncalibrated sliders) is copied byte-for-byte from your starting preset.

### Create Face

1. Choose a front-facing target photo (analyzed locally — nothing is uploaded).
2. Choose a starting preset that already works in game.
3. Click **Create Preset** — calibrated controls are written from measured proportions; uncalibrated bytes stay on the base.
4. Save to the BDO Customization folder or download the file.

The main screen always shows how many of the **13** catalogue controls are calibrated. It never pretends uncalibrated sliders can be inferred from a photo alone.

### Face measurement (0.7.1+)

Landmarks still come from the bundled MediaPipe Face Landmarker. Geometry is handled by **Skyrim FaceForge’s** measurement pipeline, vendored as `web/js/skyrim-face.js` from `web/vendor-src/`:

- head-pose estimation and perspective / foreshortening correction
- mirror averaging and per-measurement trust fading
- **baselines** from real neutral heads (not invented min/max windows)

Each BDO slider position is the **deviation from baseline**, mid at 50, tanh-compressed so strong faces approach end stops without pinning.

### Calibrate (Learn)

For each control, make a base save, then drag **exactly one** named in-game slider to maximum and save again. FaceForge diffs the plaintext, records the single moved byte offset, and stores it in:

```text
%LOCALAPPDATA%\FaceForge BDO\slidermap.json
```

Ambiguous diffs (more than one candidate byte) are refused and listed instead of guessed. A `slidermap.json` next to the EXE seeds a fresh install so one person's calibration can ship with the release.

### Merge

Optional panel under the main workflow. Mixes only the slider region (bytes 98–220) between same-class presets. Cross-class donors are refused.

### Safe saving

- Detects the usual `Documents\Black Desert\Customization` folder, including common OneDrive layouts.
- Scans only files that pass strict preset validation.
- Saves through a temporary file and validates before installation.
- Creates a timestamped backup before replacing an existing file.

## Measured binary map (v20)

| Region | Plaintext bytes | Notes |
|---|---:|---|
| Version header | 0–3 | Little-endian `20` |
| Character name | 8–39 | UTF-16LE, NUL-padded |
| Class id | 80 | Matches filename class prefix on album downloads |
| Face / body sliders | 98–220 | Almost all 0–100; three unclassified offsets (106, 109, 112) are never written |
| Zero separator | 221–232 | Zero in the research corpus |
| Style / colour / hair / makeup | 233+ | Copied from the base; not photo-driven |

ICE 8-byte blocks are a **cipher** unit only. FaceForge never treats whole blocks as single features. Full notes: `LAYOUT.md`.

### Controls catalogue (13)

Each control maps one analyzer metric to one in-game slider once calibrated:

| Control | Metric |
|---|---|
| Face length | `faceAspect` |
| Cheekbone width | `cheekWidth` |
| Jaw width | `jawWidth` |
| Chin width | `chinWidth` |
| Chin length | `lowerFace` |
| Eye size | `eyeOpenness` |
| Eye spacing | `eyeSpacing` |
| Eye angle | `eyeTilt` |
| Eyebrow height | `browHeight` |
| Nose width | `noseWidth` |
| Nose length | `noseLength` |
| Mouth width | `mouthWidth` |
| Lip thickness | `lipFullness` |

## Run the release

Download the current standalone EXE from the [GitHub Releases](https://github.com/ShugokiFable/FaceForge-BDO/releases) page:

```text
FaceForge BDO 0.7.1 - STANDALONE.exe
```

Double-click it. The EXE opens a dedicated FaceForge BDO desktop window (WebView2) and keeps its private token-protected service bound to `127.0.0.1` only. Close the window when finished.

**Requirements:** Windows 10/11 x64 and the [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) (usually already installed).

## Build from source

Requirements:

- Go 1.22 or newer
- Node.js 20 or newer (JavaScript tests)
- PowerShell 7 or Windows PowerShell 5.1

```powershell
.\build.ps1
```

Output:

```text
artifacts\FaceForge BDO 0.7.1 - STANDALONE.exe
```

Full local package (EXE + source zip + release zip + checksums):

```powershell
.\package.ps1
```

The committed `web/js/skyrim-face.js` is the pre-bundled analyzer. Rebuild it from `web/vendor-src/` with esbuild only when those TypeScript sources change.

## Source layout

```text
cmd/faceforge-bdo/     Portable desktop host (embedded WebView2 loader)
internal/preset/       Parser, ICE crypto, controls, learn, generate, merge
internal/storage/      Customization folder discovery, scan, atomic save, backups
internal/app/          Token-protected local JSON API
web/                   Embedded offline UI + MediaPipe + Skyrim analyzer bundle
web/vendor-src/        Upstream Skyrim FaceForge domain sources for rebundling
samples/               Research presets
testdata/presets/      Fixtures for automated tests
scripts/               Native-window smoke helpers
```

## Security model

- The server binds to IPv4 loopback only.
- Every API request requires a random per-launch 256-bit token.
- The token is delivered in the URL fragment (not sent as an HTTP header on first load), then retained for the session.
- Request bodies are size-limited.
- Generated binaries are parsed again before download or save.
- Existing files are backed up before replacement.
- Photos and presets stay on this PC; nothing is uploaded by FaceForge BDO.
- The app does not attach to the Black Desert process or automate its UI.

## Honest limits

- Photo matching only changes **calibrated** controls. Without a slidermap, Create Preset cannot invent face geometry from a photo.
- Hair, makeup, colours, body, class, and face type always come from the starting preset.
- A wrong calibration offset would corrupt later outputs; Learn refuses multi-byte diffs instead of guessing.
- Cross-class merge is blocked because classes can use incompatible meshes and valid ranges.
- Game updates may introduce a new preset format version requiring a new parser and map.

## License

FaceForge BDO source code is MIT-licensed. Bundled MediaPipe components use Apache License 2.0. See `THIRD_PARTY_NOTICES.md` and `licenses/`.
