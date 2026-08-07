import { measureFace, measurementBaselines } from './skyrim-face.js';

// The measurement pipeline is Skyrim FaceForge's, bundled verbatim from
// src/FaceForge.Web/src/domain into js/skyrim-face.js. It estimates head pose,
// undoes perspective foreshortening, mirror-averages the mesh, and fades each
// measurement toward neutral by how much it can be trusted. That is why a photo
// that is not perfectly square-on still measures sensibly.
//
// Crucially it also carries measurementBaselines: what each proportion reads on a
// real neutral head, measured from rendered heads rather than guessed. A BDO
// slider is therefore the *deviation from that baseline*, not a position inside an
// invented min/max window.

// METRIC_NAMES are the measurement keys FaceForge BDO drives sliders from. Each
// one must also appear as a Control metric in internal/preset/controls.go.
export const METRIC_NAMES = Object.freeze([
  'faceAspect', 'cheekWidth', 'jawWidth', 'chinWidth', 'lowerFace',
  'eyeOpenness', 'eyeSpacing', 'eyeTilt', 'browHeight',
  'noseWidth', 'noseLength', 'mouthWidth', 'lipFullness'
]);

// How far a face has to deviate from the neutral baseline to approach an end stop.
// 0.30 means a proportion 30% away from neutral lands at about 88/100. This is the
// tuning knob: lower it if real photos come out too timid, raise it if sliders pin.
const SLIDER_SPREAD = 0.30;

// eyeTilt's baseline is 0 (a neutral face has no canthal tilt), so it cannot be
// expressed as a ratio and maps on an absolute scale instead.
const TILT_SCALE = 0.10;

/** Converts one Skyrim measurement into a 0..1 BDO slider position. */
export function toSliderPosition(key, value) {
  const baseline = measurementBaselines[key];
  if (!Number.isFinite(value)) return 0.5;
  const deviation = Math.abs(baseline) < 1e-6
    ? value / TILT_SCALE
    : (value / baseline) - 1;
  return clamp01(0.5 + 0.5 * Math.tanh(deviation / SLIDER_SPREAD));
}

export const clamp01 = (value) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

export const normalizeRange = (value, minimum, maximum) => {
  if (!Number.isFinite(value) || !Number.isFinite(minimum) || !Number.isFinite(maximum)) return 0.5;
  if (maximum <= minimum) return 0.5;
  return clamp01((value - minimum) / (maximum - minimum));
};

/**
 * Measures a face and converts it into BDO slider positions.
 *
 * All of the geometry is Skyrim FaceForge's measureFace: pose estimation,
 * perspective correction, mirror averaging and trust fading happen in there. This
 * function only turns its 39 measurements into the subset of 0..1 slider positions
 * FaceForge BDO has controls for.
 */
export function measureLandmarks(points, blendshapes = {}, sourceAspectRatio = 1) {
  if (!Array.isArray(points) || points.length < 468) {
    throw new TypeError('At least 468 MediaPipe face landmarks are required.');
  }

  const analysis = measureFace(points, blendshapes, sourceAspectRatio);
  const raw = {};
  const normalized = {};
  const trust = {};
  for (const key of METRIC_NAMES) {
    const measurement = analysis.measurements[key];
    if (!measurement) continue;
    raw[key] = measurement.value;
    normalized[key] = toSliderPosition(key, measurement.value);
    trust[key] = analysis.trust?.[key] ?? 1;
  }

  return {
    raw,
    normalized,
    trust,
    warnings: analysis.warnings ?? [],
    quality: {
      symmetry: analysis.symmetry,
      rollDegrees: analysis.rollDegrees,
      yawOffset: analysis.yawOffset,
      correction: analysis.correction
    }
  };
}

let strictLandmarkerPromise;
let lenientLandmarkerPromise;
let strictCPULandmarkerPromise;
let lenientCPULandmarkerPromise;

async function createLandmarker(confidence, delegate) {
  const { FaceLandmarker, FilesetResolver } = await import('../vendor/vision_bundle.mjs');
  const wasmRoot = new URL('../mediapipe/wasm/', import.meta.url).href;
  const modelPath = new URL('../mediapipe/models/face_landmarker.task', import.meta.url).href;
  const fileset = await FilesetResolver.forVisionTasks(wasmRoot);
  const landmarker = await FaceLandmarker.createFromOptions(fileset, {
    runningMode: 'IMAGE',
    numFaces: 5,
    minFaceDetectionConfidence: confidence,
    minFacePresenceConfidence: confidence,
    minTrackingConfidence: confidence,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
    baseOptions: { modelAssetPath: modelPath, delegate }
  });
  return { landmarker, delegate };
}

const getCPULandmarker = (lenient = false) => {
  if (lenient) {
    lenientCPULandmarkerPromise ??= createLandmarker(0.2, 'CPU');
    return lenientCPULandmarkerPromise;
  }
  strictCPULandmarkerPromise ??= createLandmarker(0.6, 'CPU');
  return strictCPULandmarkerPromise;
};

const getLandmarker = (lenient = false) => {
  if (lenient) {
    lenientLandmarkerPromise ??= createLandmarker(0.2, 'GPU').catch(() => getCPULandmarker(true));
    return lenientLandmarkerPromise;
  }
  strictLandmarkerPromise ??= createLandmarker(0.6, 'GPU').catch(() => getCPULandmarker(false));
  return strictLandmarkerPromise;
};

function replaceFailedGPUWithCPU(lenient, current) {
  try { current?.landmarker?.close?.(); } catch { /* best-effort GPU cleanup */ }
  const fallback = getCPULandmarker(lenient);
  if (lenient) lenientLandmarkerPromise = fallback;
  else strictLandmarkerPromise = fallback;
  return fallback;
}

function imageSize(image) {
  return image instanceof HTMLImageElement
    ? { width: image.naturalWidth, height: image.naturalHeight }
    : { width: image.width, height: image.height };
}

function transformImage(image, degrees = 0, autoLevel = false) {
  const { width, height } = imageSize(image);
  if (width <= 0 || height <= 0) return null;
  const quarterTurn = Math.abs(degrees % 180) === 90;
  const canvas = document.createElement('canvas');
  canvas.width = quarterTurn ? height : width;
  canvas.height = quarterTurn ? width : height;
  const context = canvas.getContext('2d', { willReadFrequently: autoLevel });
  if (!context) return null;
  context.translate(canvas.width / 2, canvas.height / 2);
  if (degrees) context.rotate(degrees * Math.PI / 180);
  context.drawImage(image, -width / 2, -height / 2, width, height);
  if (!autoLevel) return canvas;

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const histogram = new Uint32Array(256);
  for (let index = 0; index < pixels.data.length; index += 4) {
    const luminance = (pixels.data[index] * 0.2126 + pixels.data[index + 1] * 0.7152 + pixels.data[index + 2] * 0.0722) | 0;
    histogram[luminance] += 1;
  }
  const cut = pixels.data.length / 4 * 0.02;
  let low = 0;
  let high = 255;
  for (let total = 0, value = 0; value < 256; value += 1) {
    total += histogram[value];
    if (total >= cut) { low = value; break; }
  }
  for (let total = 0, value = 255; value >= 0; value -= 1) {
    total += histogram[value];
    if (total >= cut) { high = value; break; }
  }
  if (high - low >= 8) {
    const scale = 255 / (high - low);
    for (let index = 0; index < pixels.data.length; index += 4) {
      pixels.data[index] = Math.max(0, Math.min(255, (pixels.data[index] - low) * scale));
      pixels.data[index + 1] = Math.max(0, Math.min(255, (pixels.data[index + 1] - low) * scale));
      pixels.data[index + 2] = Math.max(0, Math.min(255, (pixels.data[index + 2] - low) * scale));
    }
    context.putImageData(pixels, 0, 0);
  }
  return canvas;
}

function selectPrimaryFace(faceLandmarks) {
  if (faceLandmarks.length <= 1) return 0;
  let bestIndex = 0;
  let bestScore = -Infinity;
  faceLandmarks.forEach((points, index) => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const point of points) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }
    const area = Math.max(0, maxX - minX) * Math.max(0, maxY - minY);
    const centerOffset = Math.hypot((minX + maxX) / 2 - 0.5, (minY + maxY) / 2 - 0.5);
    const score = area * (1 - centerOffset * 0.35);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  return bestIndex;
}

export async function analyzeFaceImage(image) {
  if (typeof document === 'undefined') throw new Error('Image analysis is available in the desktop browser UI only.');
  const attempts = [
    { degrees: 0, autoLevel: false, strategy: '' },
    { degrees: 0, autoLevel: true, strategy: 'Auto-levelled exposure' },
    { degrees: 90, autoLevel: false, strategy: 'Rotated 90° clockwise' },
    { degrees: -90, autoLevel: false, strategy: 'Rotated 90° anticlockwise' },
    { degrees: 180, autoLevel: false, strategy: 'Rotated 180°' }
  ];

  for (const lenient of [false, true]) {
    let runtime = await getLandmarker(lenient);
    let retriedOnCPU = false;
    while (runtime) {
      try {
        for (const attempt of attempts) {
          const candidate = attempt.degrees || attempt.autoLevel
            ? transformImage(image, attempt.degrees, attempt.autoLevel)
            : image;
          if (!candidate) continue;
          const result = runtime.landmarker.detect(candidate);
          if (!result.faceLandmarks?.length) continue;
          const selectedIndex = selectPrimaryFace(result.faceLandmarks);
          const landmarks = result.faceLandmarks[selectedIndex];
          // measureFace corrects for pose, so it needs the aspect ratio of the
          // image the landmarks came from and the blendshapes that reveal how
          // much of a proportion is expression rather than face shape.
          const { width, height } = imageSize(candidate);
          const blendshapes = Object.fromEntries(
            (result.faceBlendshapes?.[selectedIndex]?.categories ?? [])
              .map((category) => [category.categoryName, category.score])
          );
          return {
            landmarks,
            measurements: measureLandmarks(landmarks, blendshapes, height > 0 ? width / height : 1),
            candidates: result.faceLandmarks.length,
            selectedIndex,
            strategy: lenient
              ? `${attempt.strategy || 'Direct detection'} at reduced confidence`
              : attempt.strategy,
            blendshapes: result.faceBlendshapes?.[selectedIndex]?.categories ?? [],
            transformationMatrix: result.facialTransformationMatrixes?.[selectedIndex] ?? null,
            analyzedImage: candidate,
            delegate: runtime.delegate
          };
        }
        break;
      } catch (error) {
        if (runtime.delegate !== 'GPU' || retriedOnCPU) throw error;
        retriedOnCPU = true;
        runtime = await replaceFailedGPUWithCPU(lenient, runtime);
      }
    }
  }
  throw new Error('No face was detected. Use a clear, front-facing image with the full face visible.');
}
