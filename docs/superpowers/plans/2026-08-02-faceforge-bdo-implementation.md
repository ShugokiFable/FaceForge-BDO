# FaceForge BDO 0.1.0 Implementation Plan

> **0.2.0 desktop amendment:** The shipped application uses a native Win32 window with embedded Microsoft WebView2. It does not launch the system browser.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a portable Windows application that safely analyzes, blends, calibrates, image-guides, and exports Black Desert Online customization presets.

**Architecture:** A Go loopback server embeds a dependency-free browser UI and offline MediaPipe assets. Go owns binary correctness and filesystem safety; browser JavaScript owns image analysis and interactive workflow state.

**Tech Stack:** Go 1.22+, HTML5, CSS, JavaScript ES modules, MediaPipe Tasks Vision 0.10.35 assets, Node built-in test runner, PowerShell, GitHub Actions.

## Global Constraints

- Product name is exactly `FaceForge BDO`.
- Initial release version is `0.1.0`.
- Runtime binds only to loopback and uses a per-launch API token.
- No game injection, memory access, input automation, or archive modification.
- Version 20 presets must round-trip byte-for-byte.
- Unknown data is preserved from the base preset.
- Weighted block blending must be deterministic and clearly labelled non-numeric.
- Windows release is a single self-contained x64 executable.

---

### Task 1: Preset core and validation

**Files:**
- Create: `internal/preset/model.go`
- Create: `internal/preset/parser.go`
- Create: `internal/preset/hash.go`
- Test: `internal/preset/parser_test.go`
- Create: `testdata/presets/*`

**Interfaces:**
- Produces: `preset.Parse([]byte) (*Preset, error)`, `(*Preset).Bytes() []byte`, `(*Preset).SHA256() string`, `(*Preset).Block(index int) [8]byte`.

- [ ] Write failing tests for valid version-20 parsing, exact round trip, invalid lengths, unsupported versions, and block bounds.
- [ ] Run `go test ./internal/preset` and verify failures are caused by missing implementation.
- [ ] Implement immutable header/block parsing and validation.
- [ ] Run `go test ./internal/preset` and verify all tests pass.
- [ ] Commit preset core.

### Task 2: Schema, comparison, and deterministic blending

**Files:**
- Create: `internal/preset/schema.go`
- Create: `internal/preset/compare.go`
- Create: `internal/preset/blend.go`
- Create: `assets/schema/version20.json`
- Test: `internal/preset/blend_test.go`

**Interfaces:**
- Produces: `Compare(a, b *Preset) Comparison`, `Blend(base *Preset, donors map[string]*Preset, recipe Recipe, schema Schema) (*BlendResult, error)`.

- [ ] Write failing tests for changed-block discovery, exact feature transplant, protected class block, deterministic 50/50 output, boundary weights, and untouched-block preservation.
- [ ] Run the targeted tests and verify expected failures.
- [ ] Implement schema validation, comparison, stable hash selection, provenance, and safety gates.
- [ ] Run all preset tests and verify passing output.
- [ ] Commit blending engine.

### Task 3: Calibration database

**Files:**
- Create: `internal/calibration/model.go`
- Create: `internal/calibration/service.go`
- Test: `internal/calibration/service_test.go`

**Interfaces:**
- Produces: `calibration.Observe(before, after *preset.Preset, label string) Observation`, `Database.Merge(Observation, MergeMode)`.

- [ ] Write failing tests for changed-block observations, intersection merge, union merge, JSON round trip, and rejection of mismatched versions.
- [ ] Verify tests fail for missing behavior.
- [ ] Implement observations and portable JSON database.
- [ ] Verify calibration and complete test suite pass.
- [ ] Commit calibration engine.

### Task 4: Local server, folder discovery, backups, and API

**Files:**
- Create: `cmd/faceforge-bdo/main.go`
- Create: `internal/app/server.go`
- Create: `internal/app/routes.go`
- Create: `internal/storage/bdo.go`
- Create: `internal/storage/write.go`
- Test: `internal/app/routes_test.go`
- Test: `internal/storage/write_test.go`

**Interfaces:**
- Produces: loopback HTTP routes for status, preset inspect, compare, blend, calibration, folder scan, safe save, and shutdown.

- [ ] Write failing HTTP and filesystem tests using temporary directories.
- [ ] Verify token, method, traversal, and backup tests fail correctly.
- [ ] Implement JSON APIs, strict request limits, loopback binding, token authentication, discovery, and atomic backup writes.
- [ ] Verify all Go tests pass.
- [ ] Commit application service.

### Task 5: Offline image analysis module

**Files:**
- Create: `web/vendor/vision_bundle.mjs`
- Create: `web/mediapipe/wasm/*`
- Create: `web/mediapipe/models/face_landmarker.task`
- Create: `web/js/face-analysis.js`
- Test: `web/js/face-analysis.test.mjs`

**Interfaces:**
- Produces: `analyzeFaceImage(image)`, `measureLandmarks(points)`, `weightsFromMeasurements(measurements)`.

- [ ] Write failing Node tests for normalized measurements, clamping, symmetry handling, and deterministic donor-weight recommendations.
- [ ] Verify tests fail because functions are absent.
- [ ] Extract the licensed MediaPipe browser module and assets from the supplied FaceForge build, then implement the pure measurement functions and browser detector wrapper.
- [ ] Run `node --test web/js/*.test.mjs` and verify passing output.
- [ ] Commit offline analysis module.

### Task 6: Product UI

**Files:**
- Create: `web/index.html`
- Create: `web/styles.css`
- Create: `web/js/api.js`
- Create: `web/js/state.js`
- Create: `web/js/components.js`
- Create: `web/js/app.js`
- Test: `web/js/state.test.mjs`

**Interfaces:**
- Consumes: all API routes and face-analysis functions.
- Produces: six working workspaces and complete browser workflow.

- [ ] Write failing state tests for preset slots, recipes, view switching, and persisted settings schema.
- [ ] Verify expected failures.
- [ ] Implement the FaceForge-derived design system and functional workspaces: Image, Blender, Laboratory, Calibration, Library, Settings.
- [ ] Verify JavaScript tests and manually exercise all workflows through the local server.
- [ ] Commit UI.

### Task 7: Embedded samples, build scripts, executable, and GitHub packaging

**Files:**
- Create: `samples/*`
- Create: `go.mod`
- Create: `build.ps1`
- Create: `package.ps1`
- Create: `PUSH_TO_GITHUB.bat`
- Create: `publish-github.ps1`
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/release.yml`
- Create: `README.md`
- Create: `START HERE.txt`
- Create: `CHANGELOG.md`
- Create: `LICENSE`

**Interfaces:**
- Produces: `artifacts/FaceForge BDO 0.1.0 - STANDALONE.exe`, source ZIP, SHA-256 manifest, and repeatable GitHub release workflow.

- [ ] Write build-gate checks for required assets and generated artifact names.
- [ ] Run complete Go and Node tests.
- [ ] Cross-compile the Windows GUI executable with embedded assets.
- [ ] Verify PE format, artifact inventory, hashes, source archive, and clean Git status.
- [ ] Commit release package.
