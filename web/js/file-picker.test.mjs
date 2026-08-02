import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('./app.js', import.meta.url), 'utf8');

test('portrait chooser relies on one native label activation only', () => {
  assert.match(appSource, /<label class="portrait-box"[^>]*>[\s\S]*?<input class="hidden" type="file"/);
  assert.doesNotMatch(appSource, /portraitBox\.querySelector\(['"]input['"]\)\?\.click\(\)/);
});
