import assert from 'node:assert/strict';
import test from 'node:test';
import {previewBuildState} from './preview-status.mjs';

test('preview stays in startup until the client begins compiling', () => {
  assert.equal(previewBuildState('[SUCCESS] Docusaurus website is running'), null);
  assert.deepEqual(previewBuildState('[webpackbar] Compiling Client'), {phase: 'compiling'});
});

test('preview detects both successful compilations and build failures', () => {
  assert.deepEqual(previewBuildState('client (webpack 5.105.4) compiled successfully'), {phase: 'ready'});
  assert.deepEqual(previewBuildState('\x1b[31mERROR in ./docs/intro.mdx\x1b[0m'), {
    phase: 'error',
    message: 'ERROR in ./docs/intro.mdx',
  });
  assert.equal(previewBuildState('client compiled with 1 error and 2 warnings').phase, 'error');
});
