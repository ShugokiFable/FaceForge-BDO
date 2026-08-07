import test from 'node:test';
import assert from 'node:assert/strict';
import { toSliderPosition, METRIC_NAMES, clamp01, normalizeRange } from './face-analysis.js';
import { measurementBaselines, MEASUREMENT_KEYS } from './skyrim-face.js';

// The measurement geometry itself is Skyrim FaceForge's and is covered by that
// project's own tests. What is new here, and what these tests guard, is the
// mapping from its measurements onto BDO's 0-100 sliders.

// A metric name that does not exist in the bundle would silently produce NaN and
// park that slider at neutral forever, with nothing in the UI to show it.
test('every driven metric exists in the bundled analyzer', () => {
  for (const metric of METRIC_NAMES) {
    assert.ok(MEASUREMENT_KEYS.includes(metric), `${metric} is not a measurement the analyzer produces`);
    assert.ok(Number.isFinite(measurementBaselines[metric]), `${metric} has no baseline`);
  }
});

test('a face at the neutral baseline sits at the middle of every slider', () => {
  for (const metric of METRIC_NAMES) {
    const atBaseline = toSliderPosition(metric, measurementBaselines[metric]);
    assert.ok(Math.abs(atBaseline - 0.5) < 1e-9, `${metric} mapped a neutral face to ${atBaseline}`);
  }
});

test('deviating from the baseline moves the slider the matching way', () => {
  for (const metric of METRIC_NAMES) {
    const baseline = measurementBaselines[metric];
    // eyeTilt's baseline is 0, so scale its probe absolutely rather than by ratio.
    const step = Math.abs(baseline) < 1e-6 ? 0.05 : baseline * 0.2;
    assert.ok(toSliderPosition(metric, baseline + step) > 0.5, `${metric} did not rise above neutral`);
    assert.ok(toSliderPosition(metric, baseline - step) < 0.5, `${metric} did not fall below neutral`);
  }
});

test('extreme and broken measurements stay inside 0..1', () => {
  for (const metric of METRIC_NAMES) {
    for (const value of [-1e6, 0, 1e6, Number.NaN, Number.POSITIVE_INFINITY]) {
      const position = toSliderPosition(metric, value);
      assert.ok(position >= 0 && position <= 1, `${metric} at ${value} mapped to ${position}`);
    }
  }
});

// An ordinary face deviates from neutral by a few percent. If that produced a
// slider pinned at an end stop, every generated preset would look the same.
test('a mildly unusual face does not pin a slider', () => {
  for (const metric of METRIC_NAMES) {
    const baseline = measurementBaselines[metric];
    const step = Math.abs(baseline) < 1e-6 ? 0.02 : baseline * 0.08;
    const position = toSliderPosition(metric, baseline + step);
    assert.ok(position > 0.5 && position < 0.95, `${metric} jumped to ${position} on an 8% deviation`);
  }
});

test('normalizeRange and clamp01 stay inside 0..1', () => {
  assert.equal(normalizeRange(5, 0, 10), 0.5);
  assert.equal(normalizeRange(-99, 0, 10), 0);
  assert.equal(normalizeRange(1, 5, 5), 0.5);
  assert.equal(clamp01(Number.NaN), 0);
  assert.equal(clamp01(2), 1);
});
