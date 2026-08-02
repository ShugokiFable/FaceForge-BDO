package webassets

import "embed"

// FS contains the complete offline browser application, MediaPipe runtime, and face model.
//
//go:embed index.html styles.css favicon.svg js/*.js vendor/* mediapipe/wasm/* mediapipe/models/*
var FS embed.FS
