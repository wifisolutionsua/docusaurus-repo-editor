import test from 'node:test';
import assert from 'node:assert/strict';
import {mentionsMediaFilename, previewPathForDocument, resolveInside, sanitizeFilename} from './paths.mjs';

test('resolveInside accepts repository paths', () => {
  assert.equal(resolveInside('/repo', 'docs/intro.md'), '/repo/docs/intro.md');
});

test('resolveInside rejects traversal', () => {
  assert.throws(() => resolveInside('/repo', '../secret'), /outside/);
});

test('previewPathForDocument derives Docusaurus routes', () => {
  assert.equal(previewPathForDocument('docs/admin/admin-tutorial.md'), '/docs/admin/admin-tutorial');
  assert.equal(previewPathForDocument('docs/intro.mdx', {slug: '/welcome'}), '/welcome');
});

test('sanitizeFilename removes unsafe characters', () => {
  assert.equal(sanitizeFilename('../../My photo (1).png'), 'My-photo-1-.png');
});
test('media usage checks catch Markdown, MDX and percent-encoded filenames', () => {
  assert.equal(mentionsMediaFilename('![Photo](./img/sample.png)', 'sample.png'), true);
  assert.equal(mentionsMediaFilename('<img src="/img/my%20photo.png" />', 'my photo.png'), true);
  assert.equal(mentionsMediaFilename('![Other](./img/other.png)', 'sample.png'), false);
});
