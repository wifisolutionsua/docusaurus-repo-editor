import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeBranch, normalizeRepositoryUrl} from './settings.mjs';

test('normalizeRepositoryUrl accepts GitHub SSH URLs', () => {
  assert.equal(
    normalizeRepositoryUrl('git@github.com:owner/docs'),
    'git@github.com:owner/docs.git',
  );
});

test('normalizeRepositoryUrl rejects HTTPS URLs', () => {
  assert.throws(
    () => normalizeRepositoryUrl('https://github.com/owner/docs.git'),
    /GitHub SSH URL/,
  );
});

test('normalizeBranch validates branch names', () => {
  assert.equal(normalizeBranch('docs/main'), 'docs/main');
  assert.throws(() => normalizeBranch('../main'), /Invalid/);
});
