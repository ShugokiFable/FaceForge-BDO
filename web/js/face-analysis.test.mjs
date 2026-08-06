import test from 'node:test';
import assert from 'node:assert/strict';
import { measureLandmarks, normalizeRange, clamp01, METRIC_NAMES } from './face-analysis.js';

// A plausible frontal face in MediaPipe's normalized image space (x right, y down).
// Only the landmark indices measureLandmarks actually reads are meaningful; the
// rest exist so the array is long enough for the guard.
const FACE = {
  234: [0.300, 0.500], 454: [0.700, 0.500],   // face width
  10: [0.500, 0.220], 152: [0.500, 0.780],    // face height
  9: [0.500, 0.360],                          // glabella
  116: [0.345, 0.550], 345: [0.655, 0.550],   // cheekbones
  172: [0.365, 0.680], 397: [0.635, 0.680],   // jaw
  2: [0.500, 0.585],                          // subnasale
  33: [0.380, 0.450], 133: [0.450, 0.450],    // left eye outer, inner
  362: [0.550, 0.450], 263: [0.620, 0.450],   // right eye inner, outer
  159: [0.415, 0.4415], 145: [0.415, 0.4585], // left eye lids
  386: [0.585, 0.4415], 374: [0.585, 0.4585], // right eye lids
  105: [0.415, 0.405], 334: [0.585, 0.405],   // eyebrow centres
  98: [0.455, 0.600], 327: [0.545, 0.600],    // nose alae
  61: [0.440, 0.680], 291: [0.560, 0.680],    // mouth corners
  0: [0.500, 0.655], 17: [0.500, 0.705]       // lip top, lip bottom
};

function buildPoints(overrides = {}) {
  const points = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  for (const [index, [x, y]] of Object.entries({ ...FACE, ...overrides })) {
    points[Number(index)] = { x, y, z: 0 };
  }
  return points;
}

function rotate(points, degrees, cx = 0.5, cy = 0.5) {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return points.map(({ x, y, z }) => ({
    x: cx + (x - cx) * cos - (y - cy) * sin,
    y: cy + (x - cx) * sin + (y - cy) * cos,
    z
  }));
}

test('every control metric is produced and lands inside 0..1', () => {
  const { raw, normalized } = measureLandmarks(buildPoints());
  for (const metric of METRIC_NAMES) {
    assert.ok(Number.isFinite(raw[metric]), `${metric} raw value is not finite`);
    assert.ok(normalized[metric] >= 0 && normalized[metric] <= 1, `${metric} normalized to ${normalized[metric]}`);
  }
});

// A neutral face must not sit pinned at an extreme, or every generated preset
// would slam its sliders to 0 or 100 no matter whose photo went in.
test('a neutral face does not pin any metric to an extreme', () => {
  const { normalized } = measureLandmarks(buildPoints());
  for (const metric of METRIC_NAMES) {
    assert.ok(
      normalized[metric] > 0.02 && normalized[metric] < 0.98,
      `${metric} normalized to ${normalized[metric]}, so its METRIC_RANGES window is wrong for an ordinary face`
    );
  }
});

// Head roll is the most common flaw in a usable photo. Averaging the two eyes'
// canthal tilt is what cancels it, so this guards that specific trick.
test('measurements survive head roll', () => {
  const upright = measureLandmarks(buildPoints()).normalized;
  for (const degrees of [-12, 8, 20]) {
    const rolled = measureLandmarks(rotate(buildPoints(), degrees)).normalized;
    for (const metric of METRIC_NAMES) {
      assert.ok(
        Math.abs(rolled[metric] - upright[metric]) < 1e-6,
        `${metric} moved from ${upright[metric]} to ${rolled[metric]} under ${degrees}° of roll`
      );
    }
  }
});

test('metrics move in the direction their name implies', () => {
  const base = measureLandmarks(buildPoints()).normalized;

  const wideNose = measureLandmarks(buildPoints({ 98: [0.425, 0.600], 327: [0.575, 0.600] })).normalized;
  assert.ok(wideNose.noseWidth > base.noseWidth, 'a wider nose did not raise noseWidth');

  const wideMouth = measureLandmarks(buildPoints({ 61: [0.410, 0.680], 291: [0.590, 0.680] })).normalized;
  assert.ok(wideMouth.mouthWidth > base.mouthWidth, 'a wider mouth did not raise mouthWidth');

  const longFace = measureLandmarks(buildPoints({ 152: [0.500, 0.860] })).normalized;
  assert.ok(longFace.faceAspect > base.faceAspect, 'a longer face did not raise faceAspect');

  const wideJaw = measureLandmarks(buildPoints({ 172: [0.330, 0.680], 397: [0.670, 0.680] })).normalized;
  assert.ok(wideJaw.jawWidth > base.jawWidth, 'a wider jaw did not raise jawWidth');

  const openEyes = measureLandmarks(buildPoints({ 159: [0.415, 0.437], 145: [0.415, 0.463], 386: [0.585, 0.437], 374: [0.585, 0.463] })).normalized;
  assert.ok(openEyes.eyeOpenness > base.eyeOpenness, 'rounder eyes did not raise eyeOpenness');

  // Outer corners lifted above inner corners is a positive canthal tilt.
  const tilted = measureLandmarks(buildPoints({ 33: [0.380, 0.438], 263: [0.620, 0.438] })).normalized;
  assert.ok(tilted.eyeAngle > base.eyeAngle, 'lifting the outer eye corners did not raise eyeAngle');

  const fullLips = measureLandmarks(buildPoints({ 0: [0.500, 0.645], 17: [0.500, 0.715] })).normalized;
  assert.ok(fullLips.lipThickness > base.lipThickness, 'fuller lips did not raise lipThickness');
});

test('measureLandmarks rejects a short landmark array', () => {
  assert.throws(() => measureLandmarks([{ x: 0, y: 0 }]), TypeError);
});

test('normalizeRange and clamp01 stay inside 0..1', () => {
  assert.equal(normalizeRange(5, 0, 10), 0.5);
  assert.equal(normalizeRange(-99, 0, 10), 0);
  assert.equal(normalizeRange(99, 0, 10), 1);
  assert.equal(normalizeRange(1, 5, 5), 0.5, 'a zero-width range should fall back to the midpoint');
  assert.equal(clamp01(Number.NaN), 0);
  assert.equal(clamp01(2), 1);
});
