import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const smokeTest = readFileSync(new URL('../cmd/faceforge-bdo/desktop_windows_test.go', import.meta.url), 'utf8');

test('native desktop smoke test isolates the loaded WebView2 DLL in a child process', () => {
  assert.match(smokeTest, /os\/exec/);
  assert.match(smokeTest, /FACEFORGE_BDO_DESKTOP_SMOKE_CHILD/);
  assert.match(smokeTest, /exec\.Command\(os\.Args\[0\]/);
  assert.match(smokeTest, /TestNativeDesktopWindowSmokeChild/);
  assert.doesNotMatch(smokeTest, /runDesktopWindow\([^\n]*t\.TempDir\(\)/);
});

test('parent removes the smoke runtime only after the child process exits', () => {
  const waitIndex = smokeTest.search(/CombinedOutput\(\)|\.Run\(\)/);
  const cleanupIndex = smokeTest.search(/removeSmokeRuntime|os\.RemoveAll/);

  assert.ok(waitIndex >= 0, 'the parent must wait for the child process');
  assert.ok(cleanupIndex > waitIndex, 'runtime cleanup must happen after the child exits');
  assert.match(smokeTest, /Access is denied|retry|deadline/i);
});

test('native smoke cleanup is best-effort after the child process exits', () => {
  assert.doesNotMatch(smokeTest, /if cleanupErr != nil \{\s*t\.Fatalf\(/s);
  assert.match(smokeTest, /if cleanupErr != nil \{\s*t\.Logf\(/s);
  assert.match(smokeTest, /native desktop child exited successfully/i);
});
