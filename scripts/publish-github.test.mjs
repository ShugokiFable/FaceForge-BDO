import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const publishScript = readFileSync(new URL('../publish-github.ps1', import.meta.url), 'utf8');
const helperURL = new URL('./publish-helpers.ps1', import.meta.url);

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

test('publisher suppresses expected gh lookup failures without terminating PowerShell 5.1', () => {
  const helpers = readHelpers();

  assert.match(helpers, /function\s+Test-NativeCommandSucceeded/);
  assert.match(helpers, /\$ErrorActionPreference\s*=\s*'SilentlyContinue'/);
  assert.match(publishScript, /Test-NativeCommandSucceeded\s+\{\s*gh\s+repo\s+view/);
  assert.match(publishScript, /Test-NativeCommandSucceeded\s+\{\s*gh\s+release\s+view/);
});

test('publisher refuses to push when origin targets a different GitHub repository', () => {
  const helpers = readHelpers();

  assert.match(helpers, /function\s+Get-GitHubRepositorySlug/);
  assert.match(publishScript, /origin points to/i);
  assert.match(publishScript, /expected/i);
});
