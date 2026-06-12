import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {dependencyInstallPlan, isNpmCiLockfileError} from './dependencies.mjs';

async function temporaryProject(files) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'docs-editor-project-'));
  await Promise.all(
    Object.entries(files).map(([filename, contents]) => (
      fs.writeFile(path.join(directory, filename), contents)
    )),
  );
  return directory;
}

test('dependencyInstallPlan uses npm ci for a valid package lock', async (context) => {
  const directory = await temporaryProject({
    'package.json': '{"name":"docs"}',
    'package-lock.json': '{"lockfileVersion":3}',
  });
  context.after(() => fs.rm(directory, {recursive: true, force: true}));

  const plan = await dependencyInstallPlan(directory);
  assert.equal(plan.command, 'ci');
});

test('dependencyInstallPlan uses npm install without a lockfile', async (context) => {
  const directory = await temporaryProject({
    'package.json': '{"name":"docs"}',
  });
  context.after(() => fs.rm(directory, {recursive: true, force: true}));

  const plan = await dependencyInstallPlan(directory);
  assert.equal(plan.command, 'install');
});

test('dependencyInstallPlan ignores an invalid lockfile', async (context) => {
  const directory = await temporaryProject({
    'package.json': '{"name":"docs"}',
    'package-lock.json': '{"lockfileVersion":0}',
  });
  context.after(() => fs.rm(directory, {recursive: true, force: true}));

  const plan = await dependencyInstallPlan(directory);
  assert.equal(plan.command, 'install');
});

test('isNpmCiLockfileError recognizes npm EUSAGE failures', () => {
  assert.equal(isNpmCiLockfileError({
    code: 1,
    stderr: 'npm error code EUSAGE\nnpm ci can only install with an existing package-lock.json',
  }), true);
  assert.equal(isNpmCiLockfileError({
    code: 1,
    stderr: 'npm error code ERESOLVE',
  }), false);
});
