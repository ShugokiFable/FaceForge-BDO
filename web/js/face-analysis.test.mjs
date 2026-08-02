import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clamp01,
  normalizeRange,
  measureLandmarks,
  weightsFromProfiles
} from './face-analysis.js';

const createFace = (overrides = {}) => {
  const points = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  const set = (index, x, y, z = 0) => { points[index] = { x, y, z }; };

  set(234, 0.20, 0.50); // left outer face
  set(454, 0.80, 0.50); // right outer face
  set(10, 0.50, 0.18);  // forehead
  set(152, 0.50, 0.88); // chin
  set(33, 0.31, 0.40);  // left eye outer
  set(133, 0.43, 0.40); // left eye inner
  set(362, 0.57, 0.40); // right eye inner
  set(263, 0.69, 0.40); // right eye outer
  set(159, 0.37, 0.38);
  set(145, 0.37, 0.42);
  set(386, 0.63, 0.38);
  set(374, 0.63, 0.42);
  set(98, 0.44, 0.55);
  set(327, 0.56, 0.55);
  set(1, 0.50, 0.53);
  set(2, 0.50, 0.59);
  set(61, 0.37, 0.68);
  set(291, 0.63, 0.68);
  set(172, 0.28, 0.72);
  set(397, 0.72, 0.72);

  for (const [index, value] of Object.entries(overrides)) {
    points[Number(index)] = { ...points[Number(index)], ...value };
  }
  return points;
};

test('clamp01 and normalizeRange clamp values', () => {
  assert.equal(clamp01(-2), 0);
  assert.equal(clamp01(2), 1);
  assert.equal(normalizeRange(5, 0, 10), 0.5);
  assert.equal(normalizeRange(-1, 0, 10), 0);
  assert.equal(normalizeRange(11, 0, 10), 1);
});

test('measureLandmarks returns stable normalized face measurements', () => {
  const result = measureLandmarks(createFace());

  for (const key of ['faceAspect', 'eyeSpacing', 'eyeOpenness', 'noseWidth', 'mouthWidth', 'jawWidth', 'lowerFace']) {
    assert.ok(result.normalized[key] >= 0 && result.normalized[key] <= 1, `${key} out of range`);
    assert.ok(Number.isFinite(result.raw[key]), `${key} raw value is not finite`);
  }
  assert.ok(result.quality.symmetry > 0.95, `symmetry=${result.quality.symmetry}`);
  assert.ok(Math.abs(result.quality.rollDegrees) < 0.01, `roll=${result.quality.rollDegrees}`);
});

test('measureLandmarks detects a wider mouth', () => {
  const normal = measureLandmarks(createFace());
  const wider = measureLandmarks(createFace({
    61: { x: 0.31 },
    291: { x: 0.69 }
  }));

  assert.ok(wider.raw.mouthWidth > normal.raw.mouthWidth);
  assert.ok(wider.normalized.mouthWidth > normal.normalized.mouthWidth);
});

test('weightsFromProfiles maps a midpoint target to an approximately 50 percent donor blend', () => {
  const base = {
    faceAspect: 0.2, eyeSpacing: 0.2, eyeOpenness: 0.2,
    noseWidth: 0.2, mouthWidth: 0.2, jawWidth: 0.2, lowerFace: 0.2
  };
  const donor = {
    faceAspect: 0.8, eyeSpacing: 0.8, eyeOpenness: 0.8,
    noseWidth: 0.8, mouthWidth: 0.8, jawWidth: 0.8, lowerFace: 0.8
  };
  const target = Object.fromEntries(Object.keys(base).map((key) => [key, 0.5]));

  const result = weightsFromProfiles(target, base, donor);
  assert.ok(Math.abs(result.groups.face_geometry.weight - 50) < 0.001);
  assert.ok(Math.abs(result.groups.eyes_brows.weight - 50) < 0.001);
  assert.ok(result.groups.face_geometry.confidence > 0.9);
});

test('weightsFromProfiles falls back honestly when donors are indistinguishable', () => {
  const same = {
    faceAspect: 0.5, eyeSpacing: 0.5, eyeOpenness: 0.5,
    noseWidth: 0.5, mouthWidth: 0.5, jawWidth: 0.5, lowerFace: 0.5
  };
  const result = weightsFromProfiles(same, same, same);

  assert.equal(result.groups.face_geometry.weight, 50);
  assert.equal(result.groups.face_geometry.confidence, 0);
  assert.match(result.warnings.join(' '), /donor portraits/i);
});
