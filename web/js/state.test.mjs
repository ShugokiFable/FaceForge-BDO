import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialState,
  recipeFromState,
  mergeSuggestedWeights,
  calibrationMerge
} from './state.js';

const groups = [
  { id: 'metadata', protected: true },
  { id: 'class', protected: true },
  { id: 'face_geometry', protected: false },
  { id: 'eyes_brows', protected: false },
  { id: 'hair', protected: false }
];

test('initial state creates editable weights only for non-protected groups', () => {
  const state = createInitialState({ groups, customizationDir: 'C:/BDO' });
  assert.equal(state.settings.customizationDir, 'C:/BDO');
  assert.deepEqual(Object.keys(state.blend.weights), ['face_geometry', 'eyes_brows', 'hair']);
  assert.equal(state.blend.weights.face_geometry, 50);
});

test('recipeFromState excludes protected groups and preserves seed and cross-class flag', () => {
  const state = createInitialState({ groups, customizationDir: '' });
  state.blend.seed = 'portrait-1';
  state.blend.allowCrossClass = true;
  state.blend.weights.hair = 100;
  const recipe = recipeFromState(state, groups);
  assert.equal(recipe.seed, 'portrait-1');
  assert.equal(recipe.allowCrossClass, true);
  assert.equal(recipe.allowProtected, false);
  assert.equal(recipe.groups.length, 3);
  assert.equal(recipe.groups.find((item) => item.groupId === 'hair').weight, 100);
  assert.ok(recipe.groups.every((item) => item.donorId === 'donor'));
});

test('mergeSuggestedWeights applies confidence-qualified image suggestions only', () => {
  const current = { face_geometry: 20, eyes_brows: 30, hair: 70 };
  const suggested = {
    face_geometry: { weight: 62, confidence: 0.9 },
    eyes_brows: { weight: 44, confidence: 0.1 },
    hair: { weight: 10, confidence: 0 }
  };
  assert.deepEqual(mergeSuggestedWeights(current, suggested, 0.35), {
    face_geometry: 62,
    eyes_brows: 30,
    hair: 70
  });
});

test('calibrationMerge records union and intersection for repeated labels', () => {
  let db = calibrationMerge(null, { label: 'nose width max', changedBlocks: [12, 14, 16] });
  db = calibrationMerge(db, { label: 'nose width max', changedBlocks: [14, 16, 18] });
  assert.deepEqual(db.observations['nose width max'].union, [12, 14, 16, 18]);
  assert.deepEqual(db.observations['nose width max'].intersection, [14, 16]);
  assert.equal(db.observations['nose width max'].samples, 2);
});
