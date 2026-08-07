// vendor-src/occlusion.ts
var OCCLUSION_REPORTING_FLOOR = 0.25;

// vendor-src/sourceCorrection.ts
var DEGREES = 180 / Math.PI;
var toMetric = (landmarks, sourceAspectRatio) => landmarks.map((point2) => ({
  x: point2.x * sourceAspectRatio,
  y: point2.y,
  z: (point2.z ?? 0) * sourceAspectRatio
}));
var fromMetric = (landmarks, sourceAspectRatio) => landmarks.map((point2) => ({
  x: point2.x / sourceAspectRatio,
  y: point2.y,
  z: (point2.z ?? 0) / sourceAspectRatio
}));
var clamp = (value, low, high) => Math.max(low, Math.min(high, value));
var ramp = (magnitude, good, bad) => clamp(1 - (Math.abs(magnitude) - good) / (bad - good), 0, 1);
function estimatePose(landmarks, sourceAspectRatio) {
  const metric = toMetric(landmarks, sourceAspectRatio);
  const top = metric[10];
  const chin = metric[152];
  const leftEdge = metric[234];
  const rightEdge = metric[454];
  const leftEye = metric[33];
  const rightEye = metric[263];
  const noseTip = metric[1];
  if (!top || !chin || !leftEdge || !rightEdge || !leftEye || !rightEye || !noseTip) {
    return { rollDegrees: 0, yawDegrees: 0, pitchDegrees: 0, yawOffset: 0 };
  }
  const rollDegrees = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x) * DEGREES;
  const yawDegrees = Math.atan2(-((rightEdge.z ?? 0) - (leftEdge.z ?? 0)), rightEdge.x - leftEdge.x) * DEGREES;
  const pitchDegrees = Math.atan2((chin.z ?? 0) - (top.z ?? 0), chin.y - top.y) * DEGREES;
  const faceWidth = Math.hypot(rightEdge.x - leftEdge.x, rightEdge.y - leftEdge.y);
  const yawOffset = faceWidth > 0 ? Math.abs(noseTip.x - (leftEdge.x + rightEdge.x) / 2) / faceWidth : 0;
  return {
    rollDegrees: Number.isFinite(rollDegrees) ? rollDegrees : 0,
    yawDegrees: Number.isFinite(yawDegrees) ? clamp(yawDegrees, -60, 60) : 0,
    pitchDegrees: Number.isFinite(pitchDegrees) ? clamp(pitchDegrees, -50, 50) : 0,
    yawOffset
  };
}
function mirrorPairs(metric, axisX, faceWidth) {
  const pairs = new Int32Array(metric.length).fill(-1);
  for (const [left, right] of KEY_PAIRS) {
    if (metric[left] && metric[right]) {
      pairs[left] = right;
      pairs[right] = left;
    }
  }
  for (const index of KEY_MIDLINE) {
    if (metric[index]) pairs[index] = index;
  }
  const tolerance = faceWidth * 0.035;
  const best = new Int32Array(metric.length).fill(-1);
  const bestDistance = new Float64Array(metric.length).fill(Infinity);
  for (let index = 0; index < metric.length; index += 1) {
    if (pairs[index] >= 0) continue;
    const point2 = metric[index];
    if (!point2) continue;
    const mirroredX = 2 * axisX - point2.x;
    for (let other = 0; other < metric.length; other += 1) {
      if (pairs[other] >= 0) continue;
      const candidate = metric[other];
      if (!candidate) continue;
      const distance2 = Math.hypot(candidate.x - mirroredX, candidate.y - point2.y);
      if (distance2 < bestDistance[index]) {
        bestDistance[index] = distance2;
        best[index] = other;
      }
    }
  }
  for (let index = 0; index < metric.length; index += 1) {
    if (pairs[index] >= 0) continue;
    const other = best[index];
    if (other >= 0 && best[other] === index && bestDistance[index] <= tolerance) {
      pairs[index] = other;
    }
  }
  return pairs;
}
var asymmetryOf = (metric, axisX, faceWidth) => {
  let total = 0;
  let count = 0;
  for (const [left, right] of KEY_PAIRS) {
    const a = metric[left];
    const b = metric[right];
    if (!a || !b) continue;
    total += Math.abs(Math.abs(a.x - axisX) - Math.abs(b.x - axisX)) + Math.abs(a.y - b.y);
    count += 1;
  }
  return count > 0 && faceWidth > 0 ? total / count / faceWidth * 100 : 0;
};
var MAX_CORRECTED_ANGLE = 32;
var KEY_PAIRS = [
  [234, 454],
  // face edges
  [123, 352],
  // cheeks
  [172, 397],
  // jaw
  [148, 377],
  // chin
  [33, 263],
  // eye outer corners
  [133, 362],
  // eye inner corners
  [159, 386],
  // upper lids
  [145, 374],
  // lower lids
  [155, 382],
  // inner lower lids
  [144, 373],
  // outer lower lids
  [70, 300],
  // brow outer
  [107, 336],
  // brow inner
  [122, 351],
  // nose bridge
  [45, 275],
  // nose tip sides
  [98, 327],
  // nose wings
  [61, 291],
  // mouth corners
  [37, 267]
  // philtrum
];
var KEY_MIDLINE = [10, 152, 168, 1, 2, 0, 13, 14, 17];
function correctSourceLandmarks(landmarks, sourceAspectRatio) {
  const pose = estimatePose(landmarks, sourceAspectRatio);
  const notes = [];
  let metric = toMetric(landmarks, sourceAspectRatio);
  const top = metric[10];
  const chin = metric[152];
  const leftEdge = metric[234];
  const rightEdge = metric[454];
  if (!top || !chin || !leftEdge || !rightEdge) {
    return {
      landmarks: [...landmarks],
      correction: {
        pose,
        straightenedDegrees: 0,
        asymmetryBefore: 0,
        asymmetryAfter: 0,
        widthConfidence: 1,
        heightConfidence: 1,
        pairedLandmarks: 0,
        notes: ["Pose correction was skipped: the landmark mesh is incomplete."]
      }
    };
  }
  const centerX = (leftEdge.x + rightEdge.x) / 2;
  const centerY = (top.y + chin.y) / 2;
  if (Math.abs(pose.rollDegrees) > 0.4) {
    const angle = -pose.rollDegrees / DEGREES;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    metric = metric.map((point2) => {
      const dx = point2.x - centerX;
      const dy = point2.y - centerY;
      return {
        x: centerX + dx * cos - dy * sin,
        y: centerY + dx * sin + dy * cos,
        z: point2.z
      };
    });
    notes.push(`Head tilt of ${pose.rollDegrees.toFixed(1)}\xB0 was rotated out.`);
  }
  const correctedYaw = clamp(pose.yawDegrees, -MAX_CORRECTED_ANGLE, MAX_CORRECTED_ANGLE);
  const correctedPitch = clamp(pose.pitchDegrees, -MAX_CORRECTED_ANGLE, MAX_CORRECTED_ANGLE);
  const widthScale = 1 / Math.cos(correctedYaw / DEGREES);
  const heightScale = 1 / Math.cos(correctedPitch / DEGREES);
  if (Math.abs(correctedYaw) > 2 || Math.abs(correctedPitch) > 2) {
    metric = metric.map((point2) => ({
      x: centerX + (point2.x - centerX) * widthScale,
      y: centerY + (point2.y - centerY) * heightScale,
      z: point2.z
    }));
    if (Math.abs(correctedYaw) > 2) {
      notes.push(
        `Head turn of ${Math.abs(pose.yawDegrees).toFixed(1)}\xB0 was un-foreshortened; widths were scaled by ${widthScale.toFixed(3)}.`
      );
    }
    if (Math.abs(correctedPitch) > 2) {
      notes.push(
        `Head nod of ${Math.abs(pose.pitchDegrees).toFixed(1)}\xB0 was un-foreshortened; heights were scaled by ${heightScale.toFixed(3)}.`
      );
    }
  }
  const axisX = (metric[234].x + metric[454].x) / 2;
  const faceWidth = Math.abs(metric[454].x - metric[234].x);
  const pairs = mirrorPairs(metric, axisX, faceWidth);
  const asymmetryBefore = asymmetryOf(metric, axisX, faceWidth);
  const symmetric = metric.map((point2) => ({ ...point2 }));
  let pairedLandmarks = 0;
  for (let index = 0; index < metric.length; index += 1) {
    const other = pairs[index];
    if (other < 0) continue;
    pairedLandmarks += 1;
    if (other === index) {
      symmetric[index].x = axisX;
      continue;
    }
    if (other < index) continue;
    const a = metric[index];
    const b = metric[other];
    const offset = (a.x - axisX - (b.x - axisX)) / 2;
    const y = (a.y + b.y) / 2;
    const z = ((a.z ?? 0) + (b.z ?? 0)) / 2;
    symmetric[index] = { x: axisX + offset, y, z };
    symmetric[other] = { x: axisX - offset, y, z };
  }
  const asymmetryAfter = asymmetryOf(symmetric, axisX, faceWidth);
  if (asymmetryBefore > 0.4) {
    notes.push(
      `Left/right landmark disagreement of ${asymmetryBefore.toFixed(1)}% was mirror-averaged across ${pairedLandmarks} paired points.`
    );
  }
  const unpairedKeyPoints = KEY_PAIRS.filter(
    ([left, right]) => pairs[left] !== right || pairs[right] !== left
  );
  if (unpairedKeyPoints.length > KEY_PAIRS.length * 0.25) {
    notes.push(
      `${unpairedKeyPoints.length} of ${KEY_PAIRS.length} core feature pairs could not be mirror-matched; the face may be too turned or partly hidden.`
    );
  }
  const widthConfidence = ramp(pose.yawDegrees, MAX_CORRECTED_ANGLE, 55);
  const heightConfidence = ramp(pose.pitchDegrees, MAX_CORRECTED_ANGLE, 50);
  if (widthConfidence < 0.999) {
    notes.push(
      `Turn beyond ${MAX_CORRECTED_ANGLE}\xB0 cannot be undone from one image; width-driven sliders were held ${Math.round((1 - widthConfidence) * 100)}% toward neutral.`
    );
  }
  if (heightConfidence < 0.999) {
    notes.push(
      `Nod beyond ${MAX_CORRECTED_ANGLE}\xB0 cannot be undone from one image; height-driven sliders were held ${Math.round((1 - heightConfidence) * 100)}% toward neutral.`
    );
  }
  return {
    landmarks: fromMetric(symmetric, sourceAspectRatio),
    correction: {
      pose,
      straightenedDegrees: 0,
      asymmetryBefore,
      asymmetryAfter,
      widthConfidence,
      heightConfidence,
      pairedLandmarks,
      notes
    }
  };
}
var widthDriven = [
  "faceAspect",
  "cheekWidth",
  "jawWidth",
  "chinWidth",
  "chinShape",
  "eyeWidth",
  "eyeSpacing",
  "browWidth",
  "noseWidth",
  "noseBridgeWidth",
  "noseTipWidth",
  "mouthWidth",
  "philtrumWidth"
];
var heightDriven = [
  "faceAspect",
  "cheekHeight",
  "jawHeight",
  "lowerFace",
  "eyeVertical",
  "browHeight",
  "noseLength",
  "noseVertical",
  "noseRootHeight",
  "noseWingHeight",
  "mouthVertical",
  "upperLip",
  "lowerLip"
];
var expressionRules = [
  {
    label: "open mouth",
    shapes: ["jawOpen"],
    dead: 0.1,
    full: 0.55,
    targets: {
      mouthVertical: 1,
      lowerFace: 0.9,
      jawHeight: 0.8,
      faceAspect: 0.6,
      chinShape: 0.5,
      upperLip: 0.6,
      lowerLip: 0.6
    }
  },
  {
    label: "smile",
    shapes: ["mouthSmileLeft", "mouthSmileRight"],
    dead: 0.15,
    full: 0.6,
    targets: {
      mouthWidth: 1,
      mouthAngle: 1,
      philtrumWidth: 0.6,
      cheekWidth: 0.6,
      cheekHeight: 0.5,
      upperLip: 0.7,
      lowerLip: 0.7
    }
  },
  {
    label: "stretched mouth",
    shapes: ["mouthStretchLeft", "mouthStretchRight"],
    dead: 0.15,
    full: 0.6,
    targets: { mouthWidth: 0.9, upperLip: 0.6, lowerLip: 0.6 }
  },
  {
    label: "frown",
    shapes: ["mouthFrownLeft", "mouthFrownRight"],
    dead: 0.15,
    full: 0.6,
    targets: { mouthAngle: 1, mouthWidth: 0.5, lowerLip: 0.5 }
  },
  {
    label: "pursed lips",
    shapes: ["mouthPucker", "mouthFunnel"],
    dead: 0.15,
    full: 0.6,
    targets: { mouthWidth: 1, philtrumWidth: 0.7, upperLip: 0.8, lowerLip: 0.8 }
  },
  {
    label: "compressed lips",
    shapes: ["mouthPressLeft", "mouthPressRight", "mouthRollUpper", "mouthRollLower", "mouthShrugUpper", "mouthShrugLower"],
    dead: 0.2,
    full: 0.7,
    targets: { upperLip: 0.9, lowerLip: 0.9, philtrumWidth: 0.4 }
  },
  {
    label: "raised lip",
    shapes: ["mouthUpperUpLeft", "mouthUpperUpRight", "mouthLowerDownLeft", "mouthLowerDownRight"],
    dead: 0.2,
    full: 0.7,
    targets: { upperLip: 0.7, lowerLip: 0.7, mouthVertical: 0.5 }
  },
  {
    label: "closed or narrowed eyes",
    shapes: ["eyeBlinkLeft", "eyeBlinkRight", "eyeSquintLeft", "eyeSquintRight"],
    // Resting faces carry a little squint, so the dead zone is wider here than for the mouth.
    dead: 0.22,
    full: 0.6,
    targets: {
      eyeOpenness: 1,
      eyeInnerHeight: 0.9,
      eyeOuterHeight: 0.9,
      eyeVertical: 0.4
    }
  },
  {
    label: "widened eyes",
    shapes: ["eyeWideLeft", "eyeWideRight"],
    dead: 0.2,
    full: 0.7,
    targets: { eyeOpenness: 0.9, eyeInnerHeight: 0.7, eyeOuterHeight: 0.7 }
  },
  {
    label: "moved brows",
    shapes: ["browDownLeft", "browDownRight", "browInnerUp", "browOuterUpLeft", "browOuterUpRight"],
    // Brow blendshapes idle well above zero on a relaxed face; start later than the mouth rules.
    dead: 0.22,
    full: 0.65,
    targets: { browHeight: 1, browAngle: 1, browWidth: 0.5 }
  },
  {
    label: "raised cheeks",
    shapes: ["cheekSquintLeft", "cheekSquintRight", "cheekPuff"],
    dead: 0.2,
    full: 0.7,
    targets: { cheekWidth: 0.8, cheekHeight: 0.8, eyeOuterHeight: 0.5 }
  },
  {
    label: "wrinkled nose",
    shapes: ["noseSneerLeft", "noseSneerRight"],
    dead: 0.2,
    full: 0.7,
    targets: { noseWidth: 0.8, noseWingHeight: 0.7, noseTipWidth: 0.5 }
  },
  {
    label: "shifted jaw",
    shapes: ["jawLeft", "jawRight", "jawForward"],
    dead: 0.2,
    full: 0.7,
    targets: { jawWidth: 0.7, chinWidth: 0.7, chinShape: 0.7 }
  },
  {
    label: "tongue out",
    shapes: ["tongueOut"],
    dead: 0.1,
    full: 0.4,
    targets: { upperLip: 1, lowerLip: 1, mouthVertical: 1, mouthWidth: 0.6 }
  }
];
function measurementTrust(blendshapes, correction, keys, occlusion = null) {
  const confidence = Object.fromEntries(keys.map((key) => [key, 1]));
  const apply = (key, factor) => {
    if (confidence[key] === void 0) return;
    confidence[key] = clamp(confidence[key] * factor, 0, 1);
  };
  for (const key of widthDriven) apply(key, correction.widthConfidence);
  for (const key of heightDriven) apply(key, correction.heightConfidence);
  const causes = [];
  for (const rule of expressionRules) {
    const score = Math.max(0, ...rule.shapes.map((shape) => blendshapes[shape] ?? 0));
    const strength = clamp((score - rule.dead) / (rule.full - rule.dead), 0, 1);
    if (strength <= 0) continue;
    causes.push({ label: rule.label, strength });
    for (const [rawKey, weight] of Object.entries(rule.targets)) {
      apply(rawKey, 1 - strength * (weight ?? 0));
    }
  }
  if (occlusion && occlusion.forehead >= OCCLUSION_REPORTING_FLOOR) {
    const strength = occlusion.forehead;
    for (const key of ["browHeight", "browWidth", "browThickness", "browAngle"]) {
      apply(key, 1 - strength);
    }
    causes.push({ label: "hair over the forehead", strength });
  }
  const reasons = causes.filter((cause) => cause.strength >= 0.15).sort((a, b) => b.strength - a.strength).map(
    (cause) => `Detected ${cause.label} at ${Math.round(cause.strength * 100)}% strength; the measurements it moves were faded toward neutral.`
  );
  return { confidence, reasons };
}

// vendor-src/faceAnalysis.ts
var NO_CORRECTION_NEEDED = "Front-facing and neutral; no pose or expression correction was needed.";
var MEASUREMENT_KEYS = [
  "faceAspect",
  "cheekWidth",
  "cheekHeight",
  "jawWidth",
  "jawHeight",
  "chinWidth",
  "chinShape",
  "lowerFace",
  "eyeWidth",
  "eyeSpacing",
  "eyeOpenness",
  "eyeVertical",
  "eyeInnerHeight",
  "eyeOuterHeight",
  "browHeight",
  "browAngle",
  "browWidth",
  "noseWidth",
  "noseBridgeWidth",
  "noseTipWidth",
  "noseLength",
  "noseVertical",
  "noseRootHeight",
  "noseWingHeight",
  "mouthWidth",
  "mouthAngle",
  "philtrumWidth",
  "upperLip",
  "lowerLip",
  "mouthVertical",
  "eyeInnerCorner",
  "eyeOuterCorner",
  "upperLidCurve",
  "lowerLidCurve",
  "eyeTilt",
  "irisSize",
  "browThickness",
  "lipFullness",
  "lipGap"
];
var point = (landmarks, index) => {
  const value = landmarks[index];
  if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y)) {
    throw new Error(`Face landmark ${index} is missing or invalid.`);
  }
  return value;
};
var distance = (a, b, sourceAspectRatio) => Math.hypot((a.x - b.x) * sourceAspectRatio, a.y - b.y);
var midpoint = (a, b) => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
  z: ((a.z ?? 0) + (b.z ?? 0)) / 2
});
var ratio = (numerator, denominator, label) => {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    throw new Error(`Unable to measure ${label} from this image.`);
  }
  return numerator / denominator;
};
var measured = (key, label, value) => ({
  key,
  label,
  value,
  display: value.toFixed(3)
});
function measureFace(sourceLandmarks, blendshapes = {}, sourceAspectRatio = 1, occlusion = null) {
  if (sourceLandmarks.length < 468) {
    throw new Error(`Expected at least 468 face landmarks, received ${sourceLandmarks.length}.`);
  }
  if (!Number.isFinite(sourceAspectRatio) || sourceAspectRatio <= 0) {
    throw new Error("Expected a positive finite source image aspect ratio.");
  }
  const pose = estimatePose(sourceLandmarks, sourceAspectRatio);
  const { landmarks: correctedLandmarks, correction } = correctSourceLandmarks(
    sourceLandmarks,
    sourceAspectRatio
  );
  const landmarks = correctedLandmarks;
  const top = point(landmarks, 10);
  const chin = point(landmarks, 152);
  const leftEdge = point(landmarks, 234);
  const rightEdge = point(landmarks, 454);
  const faceWidth = distance(leftEdge, rightEdge, sourceAspectRatio);
  const faceHeight = distance(top, chin, sourceAspectRatio);
  const leftEyeOuter = point(landmarks, 33);
  const leftEyeInner = point(landmarks, 133);
  const rightEyeInner = point(landmarks, 362);
  const rightEyeOuter = point(landmarks, 263);
  const leftEyeCenter = midpoint(leftEyeOuter, leftEyeInner);
  const rightEyeCenter = midpoint(rightEyeInner, rightEyeOuter);
  const eyeWidth = (distance(leftEyeOuter, leftEyeInner, sourceAspectRatio) + distance(rightEyeInner, rightEyeOuter, sourceAspectRatio)) / 2;
  const eyeOpen = (distance(point(landmarks, 159), point(landmarks, 145), sourceAspectRatio) + distance(point(landmarks, 386), point(landmarks, 374), sourceAspectRatio)) / 2;
  const browLeft = midpoint(point(landmarks, 70), point(landmarks, 107));
  const browRight = midpoint(point(landmarks, 336), point(landmarks, 300));
  const browHeight = (distance(browLeft, leftEyeCenter, sourceAspectRatio) + distance(browRight, rightEyeCenter, sourceAspectRatio)) / 2;
  const leftBrowAngle = Math.atan2(
    point(landmarks, 107).y - point(landmarks, 70).y,
    (point(landmarks, 107).x - point(landmarks, 70).x) * sourceAspectRatio
  );
  const rightBrowAngle = Math.atan2(
    point(landmarks, 300).y - point(landmarks, 336).y,
    (point(landmarks, 300).x - point(landmarks, 336).x) * sourceAspectRatio
  );
  const irisSize = (() => {
    if (landmarks.length < 478) return 0.115;
    const span = (center, edge) => distance(point(landmarks, center), point(landmarks, edge), sourceAspectRatio) * 2;
    const diameter = (span(468, 469) + span(473, 474)) / 2;
    const value = diameter / faceWidth;
    return Number.isFinite(value) && value > 0.02 && value < 0.35 ? value : 0.115;
  })();
  const noseRoot = point(landmarks, 168);
  const noseBase = point(landmarks, 2);
  const noseTip = point(landmarks, 1);
  const mouthCenter = midpoint(point(landmarks, 13), point(landmarks, 14));
  const eyeLine = midpoint(leftEyeCenter, rightEyeCenter);
  const values = {
    faceAspect: measured("faceAspect", "Face height / width", ratio(faceHeight, faceWidth, "face aspect")),
    cheekWidth: measured(
      "cheekWidth",
      "Cheek width",
      ratio(
        distance(point(landmarks, 123), point(landmarks, 352), sourceAspectRatio),
        faceWidth,
        "cheek width"
      )
    ),
    cheekHeight: measured(
      "cheekHeight",
      "Cheek vertical position",
      ratio(
        distance(
          top,
          midpoint(point(landmarks, 123), point(landmarks, 352)),
          sourceAspectRatio
        ),
        faceHeight,
        "cheek height"
      )
    ),
    jawWidth: measured(
      "jawWidth",
      "Jaw width",
      ratio(
        distance(point(landmarks, 172), point(landmarks, 397), sourceAspectRatio),
        faceWidth,
        "jaw width"
      )
    ),
    jawHeight: measured(
      "jawHeight",
      "Jaw vertical position",
      ratio(
        distance(
          top,
          midpoint(point(landmarks, 172), point(landmarks, 397)),
          sourceAspectRatio
        ),
        faceHeight,
        "jaw height"
      )
    ),
    chinWidth: measured(
      "chinWidth",
      "Chin width",
      ratio(
        distance(point(landmarks, 148), point(landmarks, 377), sourceAspectRatio),
        faceWidth,
        "chin width"
      )
    ),
    chinShape: measured(
      "chinShape",
      "Chin taper",
      ratio(
        distance(point(landmarks, 148), point(landmarks, 377), sourceAspectRatio),
        distance(point(landmarks, 172), point(landmarks, 397), sourceAspectRatio),
        "chin taper"
      )
    ),
    lowerFace: measured(
      "lowerFace",
      "Lower-face length",
      ratio(distance(noseBase, chin, sourceAspectRatio), faceHeight, "lower-face length")
    ),
    eyeWidth: measured("eyeWidth", "Mean eye width", ratio(eyeWidth, faceWidth, "eye width")),
    eyeSpacing: measured(
      "eyeSpacing",
      "Inner-eye spacing",
      ratio(distance(leftEyeInner, rightEyeInner, sourceAspectRatio), faceWidth, "eye spacing")
    ),
    eyeOpenness: measured(
      "eyeOpenness",
      "Eye openness",
      ratio(eyeOpen, eyeWidth, "eye openness")
    ),
    eyeVertical: measured(
      "eyeVertical",
      "Eye vertical position",
      ratio(distance(top, eyeLine, sourceAspectRatio), faceHeight, "eye vertical position")
    ),
    eyeInnerHeight: measured(
      "eyeInnerHeight",
      "Inner eye height",
      ratio(
        (distance(point(landmarks, 133), point(landmarks, 155), sourceAspectRatio) + distance(point(landmarks, 362), point(landmarks, 382), sourceAspectRatio)) / 2,
        eyeWidth,
        "inner eye height"
      )
    ),
    eyeOuterHeight: measured(
      "eyeOuterHeight",
      "Outer eye height",
      ratio(
        (distance(point(landmarks, 33), point(landmarks, 144), sourceAspectRatio) + distance(point(landmarks, 263), point(landmarks, 373), sourceAspectRatio)) / 2,
        eyeWidth,
        "outer eye height"
      )
    ),
    browHeight: measured(
      "browHeight",
      "Brow-to-eye spacing",
      ratio(browHeight, faceHeight, "brow height")
    ),
    browAngle: measured(
      "browAngle",
      "Brow angle",
      (leftBrowAngle - rightBrowAngle) / 2 * (180 / Math.PI)
    ),
    browWidth: measured(
      "browWidth",
      "Brow width",
      ratio(
        (distance(point(landmarks, 70), point(landmarks, 107), sourceAspectRatio) + distance(point(landmarks, 336), point(landmarks, 300), sourceAspectRatio)) / 2,
        faceWidth,
        "brow width"
      )
    ),
    noseWidth: measured(
      "noseWidth",
      "Nose wing width",
      ratio(
        distance(point(landmarks, 98), point(landmarks, 327), sourceAspectRatio),
        faceWidth,
        "nose width"
      )
    ),
    noseBridgeWidth: measured(
      "noseBridgeWidth",
      "Nose bridge width",
      ratio(
        distance(point(landmarks, 122), point(landmarks, 351), sourceAspectRatio),
        faceWidth,
        "nose bridge width"
      )
    ),
    noseTipWidth: measured(
      "noseTipWidth",
      "Nose tip width",
      ratio(
        distance(point(landmarks, 45), point(landmarks, 275), sourceAspectRatio),
        faceWidth,
        "nose tip width"
      )
    ),
    noseLength: measured(
      "noseLength",
      "Nose length",
      ratio(distance(noseRoot, noseBase, sourceAspectRatio), faceHeight, "nose length")
    ),
    noseVertical: measured(
      "noseVertical",
      "Nose vertical position",
      ratio(distance(top, noseTip, sourceAspectRatio), faceHeight, "nose vertical position")
    ),
    noseRootHeight: measured(
      "noseRootHeight",
      "Nose root position",
      ratio(distance(top, noseRoot, sourceAspectRatio), faceHeight, "nose root height")
    ),
    noseWingHeight: measured(
      "noseWingHeight",
      "Nose wing position",
      ratio(
        distance(
          top,
          midpoint(point(landmarks, 98), point(landmarks, 327)),
          sourceAspectRatio
        ),
        faceHeight,
        "nose wing height"
      )
    ),
    mouthWidth: measured(
      "mouthWidth",
      "Mouth width",
      ratio(
        distance(point(landmarks, 61), point(landmarks, 291), sourceAspectRatio),
        faceWidth,
        "mouth width"
      )
    ),
    mouthAngle: measured(
      "mouthAngle",
      "Mouth corner angle",
      Math.atan2(
        point(landmarks, 291).y - point(landmarks, 61).y,
        (point(landmarks, 291).x - point(landmarks, 61).x) * sourceAspectRatio
      ) * (180 / Math.PI)
    ),
    philtrumWidth: measured(
      "philtrumWidth",
      "Philtrum width",
      ratio(
        distance(point(landmarks, 37), point(landmarks, 267), sourceAspectRatio),
        faceWidth,
        "philtrum width"
      )
    ),
    upperLip: measured(
      "upperLip",
      "Upper lip thickness",
      ratio(
        distance(point(landmarks, 0), point(landmarks, 13), sourceAspectRatio),
        faceHeight,
        "upper lip"
      )
    ),
    lowerLip: measured(
      "lowerLip",
      "Lower lip thickness",
      ratio(
        distance(point(landmarks, 14), point(landmarks, 17), sourceAspectRatio),
        faceHeight,
        "lower lip"
      )
    ),
    mouthVertical: measured(
      "mouthVertical",
      "Mouth vertical position",
      ratio(distance(top, mouthCenter, sourceAspectRatio), faceHeight, "mouth vertical position")
    ),
    // Corner-to-pupil-line spans separate a narrow inner canthus from a wide one, which is most
    // of what reads as eye "shape" once size and spacing are already accounted for.
    eyeInnerCorner: measured(
      "eyeInnerCorner",
      "Inner corner width",
      ratio(
        (distance(leftEyeInner, point(landmarks, 155), sourceAspectRatio) + distance(rightEyeInner, point(landmarks, 382), sourceAspectRatio)) / 2,
        faceWidth,
        "inner corner width"
      )
    ),
    eyeOuterCorner: measured(
      "eyeOuterCorner",
      "Outer corner width",
      ratio(
        (distance(leftEyeOuter, point(landmarks, 144), sourceAspectRatio) + distance(rightEyeOuter, point(landmarks, 373), sourceAspectRatio)) / 2,
        faceWidth,
        "outer corner width"
      )
    ),
    // How far the lid peak sits above the corner-to-corner line: a hooded lid is flat, an
    // almond lid is domed.
    upperLidCurve: measured(
      "upperLidCurve",
      "Upper lid curve",
      ratio(
        (distance(point(landmarks, 159), leftEyeCenter, sourceAspectRatio) + distance(point(landmarks, 386), rightEyeCenter, sourceAspectRatio)) / 2,
        eyeWidth,
        "upper lid curve"
      )
    ),
    lowerLidCurve: measured(
      "lowerLidCurve",
      "Lower lid curve",
      ratio(
        (distance(point(landmarks, 145), leftEyeCenter, sourceAspectRatio) + distance(point(landmarks, 374), rightEyeCenter, sourceAspectRatio)) / 2,
        eyeWidth,
        "lower lid curve"
      )
    ),
    // Canthal tilt: outer corner above or below the inner one. Measured on the symmetrized mesh,
    // so it reports the shape of the eye rather than any leftover head tilt.
    eyeTilt: measured(
      "eyeTilt",
      "Eye canthal tilt",
      (Math.atan2(
        leftEyeOuter.y - leftEyeInner.y,
        (leftEyeInner.x - leftEyeOuter.x) * sourceAspectRatio
      ) - Math.atan2(
        rightEyeOuter.y - rightEyeInner.y,
        (rightEyeOuter.x - rightEyeInner.x) * sourceAspectRatio
      )) / 2 * (180 / Math.PI)
    ),
    irisSize: measured("irisSize", "Iris size", irisSize),
    browThickness: measured(
      "browThickness",
      "Brow thickness",
      ratio(
        (distance(point(landmarks, 105), point(landmarks, 66), sourceAspectRatio) + distance(point(landmarks, 334), point(landmarks, 296), sourceAspectRatio)) / 2,
        faceHeight,
        "brow thickness"
      )
    ),
    lipFullness: measured(
      "lipFullness",
      "Combined lip thickness",
      ratio(
        distance(point(landmarks, 0), point(landmarks, 17), sourceAspectRatio),
        faceHeight,
        "lip fullness"
      )
    ),
    lipGap: measured(
      "lipGap",
      "Lip separation",
      ratio(
        distance(point(landmarks, 13), point(landmarks, 14), sourceAspectRatio),
        faceHeight,
        "lip separation"
      )
    )
  };
  const symmetry = Math.max(0, Math.min(100, 100 - correction.asymmetryBefore * 6));
  const trustResult = measurementTrust(blendshapes, correction, MEASUREMENT_KEYS, occlusion);
  const faded = Object.fromEntries(
    MEASUREMENT_KEYS.map((key) => {
      const measurement = values[key];
      const confidence = trustResult.confidence[key];
      if (confidence >= 0.999) return [key, measurement];
      const baseline = measurementBaselines[key];
      const value = baseline + (measurement.value - baseline) * confidence;
      return [key, measured(key, measurement.label, value)];
    })
  );
  const lowTrust = MEASUREMENT_KEYS.filter((key) => trustResult.confidence[key] < 0.35);
  const neutralised = lowTrust.filter((key) => trustResult.confidence[key] <= 1e-3);
  const partiallyFaded = lowTrust.filter((key) => trustResult.confidence[key] > 1e-3);
  const warnings = [...correction.notes, ...trustResult.reasons];
  const names = (keys) => keys.map((key) => values[key].label.toLowerCase()).join(", ");
  if (neutralised.length > 0) {
    warnings.push(
      `${neutralised.length} measurement${neutralised.length === 1 ? " was" : "s were"} unusable and left at the neutral default: ${names(neutralised)}.`
    );
  }
  if (partiallyFaded.length > 0) {
    warnings.push(
      `${partiallyFaded.length} measurement${partiallyFaded.length === 1 ? " kept only" : "s kept only"} ${partiallyFaded.map((key) => `${Math.round(trustResult.confidence[key] * 100)}%`).join("/")} of ${partiallyFaded.length === 1 ? "its" : "their"} deviation and still contribute${partiallyFaded.length === 1 ? "s" : ""} to the export: ${names(partiallyFaded)}.`
    );
  }
  if (warnings.length === 0) warnings.push(NO_CORRECTION_NEEDED);
  return {
    measurements: faded,
    sourceAspectRatio,
    symmetry,
    rollDegrees: pose.rollDegrees,
    yawOffset: pose.yawOffset,
    warnings,
    correction,
    trust: trustResult.confidence,
    correctedLandmarks
  };
}
var saturate = (value, range) => range * Math.tanh(value / range);
var measurementBaselines = {
  eyeInnerCorner: 0.0109,
  eyeOuterCorner: 0.0654,
  upperLidCurve: 0.2631,
  lowerLidCurve: 0.123,
  eyeTilt: 0,
  irisSize: 0.0907,
  // estimated: median of 20 rendered heads; they disagree by 51% of the mean
  browThickness: 0.0807,
  // measured: 20 rendered heads, 8.5% spread
  lipFullness: 0.1585,
  lipGap: 0.0728,
  // estimated: median of 20 rendered heads; they disagree by 169% of the mean
  faceAspect: 1.1407,
  cheekWidth: 0.8736,
  cheekHeight: 0.4854,
  jawWidth: 0.8237,
  jawHeight: 0.7918,
  chinWidth: 0.1913,
  chinShape: 0.2322,
  lowerFace: 0.4106,
  eyeWidth: 0.1961,
  eyeSpacing: 0.2408,
  eyeOpenness: 0.3724,
  eyeVertical: 0.3056,
  eyeInnerHeight: 0.0555,
  eyeOuterHeight: 0.3339,
  browHeight: 0.1077,
  // measured: 16 rendered heads, 24.3% spread
  browAngle: 0,
  // estimated: no brow geometry on the neutral mesh
  browWidth: 0.3013,
  // measured: 20 rendered heads, 4.0% spread
  noseWidth: 0.2304,
  noseBridgeWidth: 0.0789,
  noseTipWidth: 0.0804,
  noseLength: 0.2771,
  noseVertical: 0.527,
  noseRootHeight: 0.2896,
  noseWingHeight: 0.5583,
  mouthWidth: 0.3494,
  mouthAngle: 0,
  philtrumWidth: 0.1004,
  upperLip: 0.0341,
  lowerLip: 0.057,
  mouthVertical: 0.7442
};
var raceTargets = [
  {
    race: "Breton",
    editorIdPrefix: "BretonRace",
    factors: { faceAspect: 0.981, cheekWidth: 0.995, cheekHeight: 1.013, jawWidth: 1.002, jawHeight: 1.006, chinWidth: 0.993, chinShape: 0.992, eyeWidth: 0.993, eyeSpacing: 0.984, eyeVertical: 1.019, eyeInnerHeight: 1.007, eyeOuterHeight: 0.994, noseWidth: 0.992, noseBridgeWidth: 0.998, noseTipWidth: 0.998, noseLength: 1.002, noseVertical: 1.013, noseRootHeight: 1.023, noseWingHeight: 1.012, eyeInnerCorner: 0.999, eyeOuterCorner: 0.987, upperLidCurve: 1.009, lowerLidCurve: 0.978, lipFullness: 0.882 },
    reasons: ["longer face 1.8% below the playable average", "wider-set eyes 1.8% below the playable average"]
  },
  {
    race: "Dark Elf",
    editorIdPrefix: "DarkElfRace",
    factors: { faceAspect: 1.035, cheekWidth: 1.007, cheekHeight: 0.989, jawWidth: 0.977, jawHeight: 0.98, chinWidth: 0.987, chinShape: 1.01, eyeWidth: 1.017, eyeSpacing: 1.056, eyeVertical: 0.995, eyeInnerHeight: 1.032, eyeOuterHeight: 1.013, noseWidth: 1.02, noseBridgeWidth: 1.03, noseTipWidth: 1.02, noseLength: 1.003, noseVertical: 1.007, noseRootHeight: 1.002, noseWingHeight: 1, eyeInnerCorner: 1.05, eyeOuterCorner: 1.03, upperLidCurve: 0.924, lowerLidCurve: 1.067, lipFullness: 1.122 },
    reasons: ["wider-set eyes 5.4% above the playable average", "longer face 3.7% above the playable average"]
  },
  {
    race: "High Elf",
    editorIdPrefix: "HighElfRace",
    factors: { faceAspect: 1.027, cheekWidth: 0.998, cheekHeight: 0.974, jawWidth: 0.993, jawHeight: 0.977, chinWidth: 1.022, chinShape: 1.029, eyeWidth: 1.005, eyeSpacing: 0.999, eyeVertical: 0.975, eyeInnerHeight: 0.967, eyeOuterHeight: 1.004, noseWidth: 1.014, noseBridgeWidth: 1.007, noseTipWidth: 1.017, noseLength: 0.992, noseVertical: 0.984, noseRootHeight: 0.972, noseWingHeight: 0.979, eyeInnerCorner: 0.972, eyeOuterCorner: 1.011, upperLidCurve: 1.025, lowerLidCurve: 1.05, lipFullness: 1.1 },
    reasons: ["squarer chin 3.1% above the playable average", "higher cheeks 2.9% below the playable average"]
  },
  {
    race: "Imperial",
    editorIdPrefix: "ImperialRace",
    factors: { faceAspect: 0.985, cheekWidth: 1.001, cheekHeight: 1.017, jawWidth: 1.004, jawHeight: 1.01, chinWidth: 0.985, chinShape: 0.982, eyeWidth: 0.993, eyeSpacing: 0.995, eyeVertical: 1.019, eyeInnerHeight: 0.981, eyeOuterHeight: 1.004, noseWidth: 0.992, noseBridgeWidth: 1, noseTipWidth: 0.998, noseLength: 1.016, noseVertical: 1.025, noseRootHeight: 1.029, noseWingHeight: 1.022, eyeInnerCorner: 0.974, eyeOuterCorner: 0.996, upperLidCurve: 1.002, lowerLidCurve: 1.003, lipFullness: 0.862 },
    reasons: ["squarer chin 1.6% below the playable average", "higher eyes 1.5% above the playable average"]
  },
  {
    race: "Nord",
    editorIdPrefix: "NordRace",
    factors: { faceAspect: 0.979, cheekWidth: 0.996, cheekHeight: 1.018, jawWidth: 1.007, jawHeight: 1.012, chinWidth: 0.993, chinShape: 0.985, eyeWidth: 0.985, eyeSpacing: 0.972, eyeVertical: 1.023, eyeInnerHeight: 1.012, eyeOuterHeight: 0.988, noseWidth: 0.984, noseBridgeWidth: 0.984, noseTipWidth: 0.982, noseLength: 1.004, noseVertical: 1.013, noseRootHeight: 1.025, noseWingHeight: 1.015, eyeInnerCorner: 0.996, eyeOuterCorner: 0.973, upperLidCurve: 0.983, lowerLidCurve: 0.98, lipFullness: 0.866 },
    reasons: ["wider-set eyes 3.0% below the playable average", "longer face 2.0% below the playable average"]
  },
  {
    race: "Orc",
    editorIdPrefix: "OrcRace",
    factors: { faceAspect: 0.996, cheekWidth: 1.003, cheekHeight: 0.987, jawWidth: 1.031, jawHeight: 1.014, chinWidth: 1.036, chinShape: 1.005, eyeWidth: 0.996, eyeSpacing: 0.976, eyeVertical: 0.972, eyeInnerHeight: 1.032, eyeOuterHeight: 0.981, noseWidth: 1.004, noseBridgeWidth: 0.987, noseTipWidth: 0.997, noseLength: 0.97, noseVertical: 0.956, noseRootHeight: 0.955, noseWingHeight: 0.966, eyeInnerCorner: 1.027, eyeOuterCorner: 0.977, upperLidCurve: 1.055, lowerLidCurve: 0.958, lipFullness: 1.118 },
    reasons: ["wider chin 3.8% above the playable average", "higher eyes 3.2% below the playable average"]
  },
  {
    race: "Redguard",
    editorIdPrefix: "RedguardRace",
    factors: { faceAspect: 0.963, cheekWidth: 0.998, cheekHeight: 1.02, jawWidth: 1.003, jawHeight: 1.015, chinWidth: 0.976, chinShape: 0.972, eyeWidth: 0.998, eyeSpacing: 0.991, eyeVertical: 1.021, eyeInnerHeight: 0.951, eyeOuterHeight: 1.016, noseWidth: 0.969, noseBridgeWidth: 0.986, noseTipWidth: 0.975, noseLength: 1.021, noseVertical: 1.02, noseRootHeight: 1.024, noseWingHeight: 1.022, eyeInnerCorner: 0.95, eyeOuterCorner: 1.014, upperLidCurve: 0.961, lowerLidCurve: 0.989, lipFullness: 0.809 },
    reasons: ["longer face 3.6% below the playable average", "wider nose 3.1% below the playable average"]
  },
  {
    race: "Wood Elf",
    editorIdPrefix: "WoodElfRace",
    factors: { faceAspect: 1.034, cheekWidth: 1, cheekHeight: 0.981, jawWidth: 0.984, jawHeight: 0.984, chinWidth: 1.007, chinShape: 1.023, eyeWidth: 1.015, eyeSpacing: 1.028, eyeVertical: 0.978, eyeInnerHeight: 1.02, eyeOuterHeight: 0.996, noseWidth: 1.025, noseBridgeWidth: 1.012, noseTipWidth: 1.017, noseLength: 0.989, noseVertical: 0.983, noseRootHeight: 0.973, noseWingHeight: 0.982, eyeInnerCorner: 1.033, eyeOuterCorner: 1.012, upperLidCurve: 1.039, lowerLidCurve: 0.977, lipFullness: 1.24 },
    reasons: ["longer face 3.6% above the playable average", "wider-set eyes 2.6% above the playable average"]
  }
];
var rankingKeys = Object.keys(raceTargets[0].factors).filter((key) => raceTargets.every((target) => key in target.factors));
export {
  MEASUREMENT_KEYS,
  measureFace,
  measurementBaselines,
  saturate
};
