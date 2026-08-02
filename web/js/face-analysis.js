const METRIC_RANGES = Object.freeze({
  faceAspect: [1.0, 1.65],
  eyeSpacing: [0.16, 0.32],
  eyeOpenness: [0.10, 0.38],
  noseWidth: [0.14, 0.30],
  mouthWidth: [0.28, 0.54],
  jawWidth: [0.52, 0.92],
  lowerFace: [0.30, 0.55]
});

const GROUP_METRICS = Object.freeze({
  face_geometry: ['faceAspect', 'noseWidth', 'mouthWidth', 'jawWidth', 'lowerFace'],
  eyes_brows: ['eyeSpacing', 'eyeOpenness']
});

export const clamp01 = (value) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

export const normalizeRange = (value, minimum, maximum) => {
  if (!Number.isFinite(value) || !Number.isFinite(minimum) || !Number.isFinite(maximum)) return 0.5;
  if (maximum <= minimum) return 0.5;
  return clamp01((value - minimum) / (maximum - minimum));
};

const distance = (a, b) => Math.hypot((a?.x ?? 0) - (b?.x ?? 0), (a?.y ?? 0) - (b?.y ?? 0));
const midpoint = (a, b) => ({ x: ((a?.x ?? 0) + (b?.x ?? 0)) / 2, y: ((a?.y ?? 0) + (b?.y ?? 0)) / 2 });
const safeDivide = (value, divisor) => Math.abs(divisor) < 1e-9 ? 0 : value / divisor;

export function measureLandmarks(points) {
  if (!Array.isArray(points) || points.length < 455) {
    throw new TypeError('At least 455 MediaPipe face landmarks are required.');
  }

  const faceWidth = distance(points[234], points[454]);
  const faceHeight = distance(points[10], points[152]);
  const leftEyeWidth = distance(points[33], points[133]);
  const rightEyeWidth = distance(points[362], points[263]);
  const averageEyeWidth = (leftEyeWidth + rightEyeWidth) / 2;
  const leftEyeOpen = distance(points[159], points[145]);
  const rightEyeOpen = distance(points[386], points[374]);
  const leftEyeCenter = midpoint(points[33], points[133]);
  const rightEyeCenter = midpoint(points[362], points[263]);
  const eyeLineWidth = distance(leftEyeCenter, rightEyeCenter);
  const facialCenterX = ((points[234]?.x ?? 0) + (points[454]?.x ?? 0)) / 2;
  const noseCenterX = ((points[98]?.x ?? 0) + (points[327]?.x ?? 0)) / 2;

  const raw = {
    faceAspect: safeDivide(faceHeight, faceWidth),
    eyeSpacing: safeDivide(distance(points[133], points[362]), faceWidth),
    eyeOpenness: safeDivide((leftEyeOpen + rightEyeOpen) / 2, averageEyeWidth),
    noseWidth: safeDivide(distance(points[98], points[327]), faceWidth),
    mouthWidth: safeDivide(distance(points[61], points[291]), faceWidth),
    jawWidth: safeDivide(distance(points[172], points[397]), faceWidth),
    lowerFace: safeDivide(distance(points[2], points[152]), faceHeight)
  };

  const normalized = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => {
      const [minimum, maximum] = METRIC_RANGES[key];
      return [key, normalizeRange(value, minimum, maximum)];
    })
  );

  const centerPenalty = clamp01(safeDivide(Math.abs(noseCenterX - facialCenterX), faceWidth * 0.12));
  const eyeWidthPenalty = clamp01(safeDivide(Math.abs(leftEyeWidth - rightEyeWidth), averageEyeWidth * 0.45));
  const eyeHeightPenalty = clamp01(safeDivide(Math.abs(leftEyeOpen - rightEyeOpen), Math.max(leftEyeOpen, rightEyeOpen, 1e-9) * 0.65));
  const symmetry = clamp01(1 - (centerPenalty * 0.55 + eyeWidthPenalty * 0.25 + eyeHeightPenalty * 0.20));
  const rollDegrees = Math.atan2(rightEyeCenter.y - leftEyeCenter.y, rightEyeCenter.x - leftEyeCenter.x) * 180 / Math.PI;

  return {
    raw,
    normalized,
    quality: {
      symmetry,
      rollDegrees,
      faceCoverage: clamp01(faceWidth * faceHeight * 3.5),
      eyeLineWidth
    }
  };
}

const median = (values) => {
  if (values.length === 0) return 0.5;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

function solveGroup(target, base, donor, metricNames) {
  const ratios = [];
  const separations = [];
  for (const metric of metricNames) {
    const targetValue = Number(target?.[metric]);
    const baseValue = Number(base?.[metric]);
    const donorValue = Number(donor?.[metric]);
    if (![targetValue, baseValue, donorValue].every(Number.isFinite)) continue;
    const delta = donorValue - baseValue;
    if (Math.abs(delta) < 0.03) continue;
    ratios.push(clamp01((targetValue - baseValue) / delta));
    separations.push(Math.abs(delta));
  }

  if (ratios.length === 0) {
    return { weight: 50, confidence: 0, metricsUsed: 0 };
  }

  const coverage = ratios.length / metricNames.length;
  const separation = separations.reduce((sum, value) => sum + value, 0) / separations.length;
  const confidence = clamp01(coverage * Math.min(1, separation / 0.5));
  return {
    weight: median(ratios) * 100,
    confidence,
    metricsUsed: ratios.length
  };
}

export function weightsFromProfiles(target, base, donor) {
  const warnings = [];
  const faceGeometry = solveGroup(target, base, donor, GROUP_METRICS.face_geometry);
  const eyesBrows = solveGroup(target, base, donor, GROUP_METRICS.eyes_brows);

  if (faceGeometry.metricsUsed === 0 || eyesBrows.metricsUsed === 0) {
    warnings.push('The donor portraits are too similar in one or more regions, so those weights remain neutral at 50%.');
  }

  return {
    groups: {
      face_type: { weight: 50, confidence: 0, metricsUsed: 0 },
      face_geometry: faceGeometry,
      eyes_brows: eyesBrows,
      makeup_detail: { weight: 50, confidence: 0, metricsUsed: 0 },
      hair: { weight: 50, confidence: 0, metricsUsed: 0 },
      body: { weight: 50, confidence: 0, metricsUsed: 0 },
      skin_finish: { weight: 50, confidence: 0, metricsUsed: 0 },
      extended: { weight: 50, confidence: 0, metricsUsed: 0 }
    },
    warnings
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
          return {
            landmarks,
            measurements: measureLandmarks(landmarks),
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
