// Entry point for the bundled Skyrim FaceForge analyzer. FaceForge BDO reuses that
// tool's measurement pipeline verbatim: pose estimation, perspective correction,
// mirror averaging, per-measurement trust, and baselines measured from real heads
// rather than guessed windows. Only these four symbols are needed here.
export {
  measureFace,
  measurementBaselines,
  MEASUREMENT_KEYS,
  saturate
} from "./faceAnalysis";
