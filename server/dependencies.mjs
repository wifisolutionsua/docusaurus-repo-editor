import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function validateDocusaurusProject(directory) {
  const message = 'Connect the GitHub repository containing your Docusaurus site. '
    + 'The selected branch must declare @docusaurus/core in its root package.json.';
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) {
      throw new Error(message);
    }
    throw error;
  }

  if (!manifest?.dependencies?.['@docusaurus/core']
    && !manifest?.devDependencies?.['@docusaurus/core']) {
    throw new Error(message);
  }
}

export async function dependencyInstallPlan(directory) {
  for (const filename of ['npm-shrinkwrap.json', 'package-lock.json']) {
    const lockfile = path.join(directory, filename);
    try {
      const contents = await fs.readFile(lockfile);
      const metadata = JSON.parse(contents);
      if (Number(metadata.lockfileVersion) >= 1) {
        return {
          command: 'ci',
          hash: createHash('sha256').update(contents).digest('hex'),
        };
      }
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) {
        throw error;
      }
    }
  }

  const packageJson = await fs.readFile(path.join(directory, 'package.json'));
  return {
    command: 'install',
    hash: createHash('sha256').update(packageJson).digest('hex'),
  };
}

export function isNpmCiLockfileError(error) {
  const output = `${error?.stdout || ''}\n${error?.stderr || ''}`;
  return error?.code === 1
    && (
      output.includes('npm error code EUSAGE')
      || output.includes('can only install with an existing package-lock.json')
    );
}
