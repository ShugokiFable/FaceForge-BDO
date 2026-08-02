import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const publishScript = readFileSync(new URL('../publish-github.ps1', import.meta.url), 'utf8');
const releaseWorkflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
const helperURL = new URL('./publish-helpers.ps1', import.meta.url);
const helperTestURL = new URL('./test-publish-helpers.ps1', import.meta.url);

function readHelpers() {
  return readFileSync(helperURL, 'utf8');
}

test('publisher handles a missing origin without invoking a failing get-url probe', () => {
  const helpers = readHelpers();

  assert.match(publishScript, /publish-helpers\.ps1/);
  assert.match(publishScript, /Get-GitRemoteUrl\s+-Name\s+'origin'/);
  assert.doesNotMatch(publishScript, /git\s+remote\s+get-url\s+origin\s+2>\$null/i);
  assert.match(helpers, /git\s+remote\b/);
  assert.match(helpers, /-notcontains\s+\$Name/);
  assert.match(helpers, /git\s+remote\s+get-url\s+\$Name/);
});

test('publisher suppresses expected GitHub lookup failures without terminating PowerShell 5.1', () => {
  const helpers = readHelpers();
  const helperTest = readFileSync(helperTestURL, 'utf8');

  assert.match(helpers, /function\s+Test-NativeCommandSucceeded/);
  assert.match(helpers, /\$ErrorActionPreference\s*=\s*'SilentlyContinue'/);
  assert.match(helpers, /\$global:LASTEXITCODE\s*=\s*0/);
  assert.match(helperTest, /leaked LASTEXITCODE/);
  assert.match(helperTest, /exit\s+0\s*$/m);
  assert.match(publishScript, /Test-NativeCommandSucceeded\s+\{\s*gh\s+repo\s+view/);
  assert.match(publishScript, /Test-NativeCommandSucceeded\s+\{\s*gh\s+release\s+view/);
});

test('publisher refuses to push when origin targets a different GitHub repository', () => {
  const helpers = readHelpers();

  assert.match(helpers, /function\s+Get-GitHubRepositorySlug/);
  assert.match(publishScript, /origin points to/i);
  assert.match(publishScript, /expected/i);
});

test('publisher delegates release builds to GitHub Actions instead of requiring local Go', () => {
  assert.match(publishScript, /gh\s+workflow\s+run\s+release\.yml/);
  assert.match(publishScript, /gh\s+run\s+watch/);
  assert.doesNotMatch(publishScript, /package\.ps1/);
  assert.doesNotMatch(publishScript, /Get-Command\s+go/i);
});

test('release workflow supports manual dispatch with an explicit version and creates the matching tag', () => {
  assert.match(releaseWorkflow, /workflow_dispatch:/);
  assert.match(releaseWorkflow, /version:/);
  assert.match(releaseWorkflow, /release_meta/);
  assert.match(releaseWorkflow, /tag_name:\s*'\$\{\{\s*steps\.release_meta\.outputs\.tag\s*\}\}'/);
  assert.match(releaseWorkflow, /package\.ps1\s+-Version/);
});


test('publisher prints failed GitHub Actions logs before reporting failure', () => {
  assert.match(publishScript, /gh\s+run\s+view\s+\$runId\s+--repo\s+\$fullName\s+--log-failed/);
  assert.match(publishScript, /\$global:LASTEXITCODE\s*=\s*0/);
});
