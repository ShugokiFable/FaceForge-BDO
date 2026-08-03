import test from 'node:test';
import assert from 'node:assert/strict';
import { metricDistance, rankReferenceCandidates, buildAutomaticPlan, normalizeBlendResult, createBaseFallbackResult } from './create-face.js';

const target = {
  faceAspect: 0.50,
  eyeSpacing: 0.48,
  eyeOpenness: 0.45,
  noseWidth: 0.52,
  mouthWidth: 0.49,
  jawWidth: 0.50,
  lowerFace: 0.53
};

const candidate = (id, name, metrics) => ({ id, name, path: `${name}.preset`, sha256: id, metrics, analysis: { measurements: { normalized: metrics, quality: { symmetry: 0.98 } } } });

test('metricDistance returns a smaller score for closer profiles', () => {
  const close = metricDistance(target, { ...target, jawWidth: 0.52 }, ['jawWidth', 'mouthWidth']);
  const far = metricDistance(target, { ...target, jawWidth: 0.82 }, ['jawWidth', 'mouthWidth']);
  assert.ok(close < far);
});

test('rankReferenceCandidates sorts best match first', () => {
  const ranked = rankReferenceCandidates(target, [
    candidate('b', 'Far', { ...target, jawWidth: 0.90, eyeSpacing: 0.90 }),
    candidate('a', 'Near', { ...target, jawWidth: 0.52, eyeSpacing: 0.49 })
  ]);
  assert.equal(ranked[0].name, 'Near');
  assert.ok(ranked[0].overallDistance < ranked[1].overallDistance);
});

test('buildAutomaticPlan selects supported groups and leaves unsupported groups at zero', () => {
  const plan = buildAutomaticPlan({
    targetMetrics: target,
    baseMetrics: null,
    candidates: [
      candidate('ref1', 'Geom Best', { ...target, eyeSpacing: 0.70, eyeOpenness: 0.68 }),
      candidate('ref2', 'Eyes Best', { ...target, jawWidth: 0.80, noseWidth: 0.81 })
    ]
  });

  assert.equal(plan.selected.length, 2);
  assert.ok(plan.groups.face_geometry.weight > 0);
  assert.ok(plan.groups.eyes_brows.weight > 0);
  assert.equal(plan.groups.hair.weight, 0);
  assert.match(plan.warnings.join(' '), /starting preset has no screenshot profile/i);
});

test('buildAutomaticPlan can fall back to the starting preset when it is the only profiled reference', () => {
  const plan = buildAutomaticPlan({
    targetMetrics: target,
    baseMetrics: target,
    baseCandidateId: 'base-profile',
    candidates: [candidate('base-profile', 'Base', target)]
  });

  assert.equal(plan.selected.length, 1);
  assert.equal(plan.selected[0].id, 'base-profile');
  assert.match(plan.warnings.join(' '), /starting preset is profiled right now/i);
});


test('normalizeBlendResult converts null collections into empty collections', () => {
  const result = normalizeBlendResult({ changedBlocks: null, warnings: null, provenance: null });
  assert.deepEqual(result.changedBlocks, []);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.provenance, {});
});


test('createBaseFallbackResult returns an immediate zero-change result', () => {
  const result = createBaseFallbackResult({ data: 'abc', sha256: 'deadbeef', warnings: ['only base'] });
  assert.equal(result.data, 'abc');
  assert.equal(result.sha256, 'deadbeef');
  assert.deepEqual(result.changedBlocks, []);
  assert.deepEqual(result.provenance, {});
  assert.deepEqual(result.warnings, ['only base']);
});
