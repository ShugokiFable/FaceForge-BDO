import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const publisher = await readFile(new URL('../PUBLISH_0.4.0_GITHUB.ps1', import.meta.url), 'utf8');
const launcher = await readFile(new URL('../PUSH_0.4.0_TO_GITHUB.bat', import.meta.url), 'utf8');
const releaseWorkflow = await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');

test('one-click launcher calls the direct 0.4.0 publisher', () => {
  assert.match(launcher, /PUBLISH_0\.4\.0_GITHUB\.ps1/i);
  assert.doesNotMatch(launcher, /publish-github\.ps1/i);
});

test('direct publisher uploads verified local assets without dispatching Actions', () => {
  assert.match(publisher, /FaceForge BDO \$Version - STANDALONE\.exe/);
  assert.match(publisher, /FaceForge BDO \$Version - SOURCE\.zip/);
  assert.match(publisher, /FaceForge BDO \$Version - RELEASE\.zip/);
  assert.match(publisher, /gh @ReleaseArguments/);
  assert.doesNotMatch(publisher, /gh workflow run/i);
});

test('direct publisher clones or creates the repository and excludes build artifacts from source commits', () => {
  assert.match(publisher, /gh repo clone/);
  assert.match(publisher, /gh repo create/);
  assert.match(publisher, /robocopy[\s\S]*\/XD \.git artifacts/);
});

test('release workflow does not race direct tag publication', () => {
  assert.match(releaseWorkflow, /workflow_dispatch:/);
  assert.doesNotMatch(releaseWorkflow, /push:\s*[\s\S]*tags:/);
});
