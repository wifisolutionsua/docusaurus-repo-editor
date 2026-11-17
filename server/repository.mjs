import {execFile, spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import matter from 'gray-matter';
import {
  dependencyInstallPlan,
  isNpmCiLockfileError,
  validateDocusaurusProject,
} from './dependencies.mjs';
import {previewPathForDocument, resolveInside, toPosixPath} from './paths.mjs';

const execFileAsync = promisify(execFile);
const ignoredDirectories = new Set([
  '.git',
  '.docusaurus',
  'build',
  'node_modules',
]);
const visibleExtensions = new Set([
  '.md',
  '.mdx',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.pdf',
  '.mp4',
  '.webm',
]);
const mediaExtensions = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
]);

async function run(command, args, options = {}) {
  return execFileAsync(command, args, {
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  });
}

function gitOptions(sshEnvironment, options = {}) {
  return {
    ...options,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      ...sshEnvironment,
      ...options.env,
    },
  };
}

function githubRepositoryIdentity(repositoryUrl) {
  const match = repositoryUrl.match(
    /^(?:git@github\.com:|https:\/\/github\.com\/)([^/]+)\/([^/]+?)(?:\.git)?$/,
  );
  return match ? `${match[1].toLowerCase()}/${match[2].toLowerCase()}` : '';
}

function repositoryProcessEnvironment() {
  const environment = {...process.env};
  delete environment.EDITOR_PASSWORD;
  delete environment.GITHUB_TOKEN;
  delete environment.GIT_USERNAME;
  return environment;
}

export class Repository {
  constructor({directory, url, branch = 'main', sshEnvironment = {}}) {
    this.directory = path.resolve(directory);
    this.url = url;
    this.branch = branch;
    this.sshEnvironment = sshEnvironment;
    this.previewProcess = null;
  }

  async initialize({autoPull = false} = {}) {
    const gitDirectory = path.join(this.directory, '.git');
    let hasRepository = true;

    try {
      await fs.access(gitDirectory);
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes(error.code)) {
        throw error;
      }
      hasRepository = false;
    }

    if (hasRepository) {
      const {stdout} = await run(
        'git',
        ['remote', 'get-url', 'origin'],
        gitOptions(this.sshEnvironment, {cwd: this.directory}),
      );
      if (stdout.trim() !== this.url) {
        const currentIdentity = githubRepositoryIdentity(stdout.trim());
        const requestedIdentity = githubRepositoryIdentity(this.url);
        if (currentIdentity && currentIdentity === requestedIdentity) {
          await run(
            'git',
            ['remote', 'set-url', 'origin', this.url],
            gitOptions(this.sshEnvironment, {cwd: this.directory}),
          );
        } else {
          throw new Error(
            `Repository volume already contains ${stdout.trim()}. `
            + 'Remove the repository volume before switching repositories.',
          );
        }
      }
    } else {
      await fs.mkdir(path.dirname(this.directory), {recursive: true});
      await run(
        'git',
        ['clone', '--branch', this.branch, '--single-branch', this.url, this.directory],
        gitOptions(this.sshEnvironment),
      );
    }

    if (autoPull) {
      await this.pull();
    }
  }

  async ensureDependencies() {
    await validateDocusaurusProject(this.directory);
    const docusaurusBinary = path.join(this.directory, 'node_modules', '.bin', 'docusaurus');
    const stampFile = path.join(this.directory, 'node_modules', '.editor-lock-hash');
    const installPlan = await dependencyInstallPlan(this.directory);
    let installedHash = '';

    try {
      await fs.access(docusaurusBinary);
      installedHash = (await fs.readFile(stampFile, 'utf8')).trim();
    } catch {}

    if (installPlan.hash !== installedHash) {
      const npmOptions = {
        cwd: this.directory,
        env: repositoryProcessEnvironment(),
      };

      try {
        await run('npm', [installPlan.command], npmOptions);
      } catch (error) {
        if (installPlan.command !== 'ci' || !isNpmCiLockfileError(error)) {
          throw error;
        }
        console.warn('npm ci rejected the lockfile; retrying with npm install');
        await run('npm', ['install'], npmOptions);
      }

      const completedPlan = await dependencyInstallPlan(this.directory);
      await fs.writeFile(stampFile, `${completedPlan.hash}\n`);
    }
  }

  startPreview(port) {
    if (this.previewProcess) {
      return this.previewProcess;
    }

    this.previewProcess = spawn(
      'npm',
      ['start', '--', '--host', '0.0.0.0', '--port', String(port), '--no-open'],
      {
        cwd: this.directory,
        env: {...repositoryProcessEnvironment(), BROWSER: 'none'},
        stdio: ['ignore', 'inherit', 'inherit'],
      },
    );

    this.previewProcess.once('exit', () => {
      this.previewProcess = null;
    });

    return this.previewProcess;
  }

  async listTree() {
    const walk = async (directory) => {
      const entries = await fs.readdir(directory, {withFileTypes: true});
      const nodes = [];

      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name.startsWith('.') || ignoredDirectories.has(entry.name)) {
          continue;
        }

        const absolutePath = path.join(directory, entry.name);
        const relativePath = toPosixPath(path.relative(this.directory, absolutePath));

        if (entry.isDirectory()) {
          const children = await walk(absolutePath);
          if (children.length) {
            nodes.push({type: 'directory', name: entry.name, path: relativePath, children});
          }
        } else if (visibleExtensions.has(path.extname(entry.name).toLowerCase())) {
          nodes.push({type: 'file', name: entry.name, path: relativePath});
        }
      }

      return nodes;
    };

    return walk(this.directory);
  }

  async readFile(filePath) {
    const absolutePath = resolveInside(this.directory, filePath);
    return fs.readFile(absolutePath, 'utf8');
  }

  async writeFile(filePath, content) {
    const absolutePath = resolveInside(this.directory, filePath);
    await fs.mkdir(path.dirname(absolutePath), {recursive: true});
    await fs.writeFile(absolutePath, content, 'utf8');
  }

  async deleteFile(filePath) {
    const absolutePath = resolveInside(this.directory, filePath);
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) {
      throw new Error('Only files can be deleted');
    }
    await fs.unlink(absolutePath);
  }

  async moveFile(fromPath, toPath) {
    const source = resolveInside(this.directory, fromPath);
    const destination = resolveInside(this.directory, toPath);
    await fs.mkdir(path.dirname(destination), {recursive: true});
    await fs.rename(source, destination);
  }

  async listMedia(directoryPath) {
    const mediaDirectory = resolveInside(this.directory, directoryPath);
    const results = [];

    let entries;
    try {
      entries = await fs.readdir(mediaDirectory, {withFileTypes: true});
    } catch (error) {
      if (error.code === 'ENOENT') {
        return results;
      }
      throw error;
    }

    for (const entry of entries) {
      if (
        entry.isFile()
        && !entry.name.startsWith('.')
        && mediaExtensions.has(path.extname(entry.name).toLowerCase())
      ) {
        const absolutePath = path.join(mediaDirectory, entry.name);
        try {
          const {mtimeMs} = await fs.lstat(absolutePath);
          results.push({filePath: toPosixPath(path.relative(this.directory, absolutePath)), mtimeMs});
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
    }

    return results
      .sort((a, b) => b.mtimeMs - a.mtimeMs || a.filePath.localeCompare(b.filePath))
      .map(({filePath}) => filePath);
  }

  async previewPath(filePath, content) {
    let frontMatter = {};
    try {
      frontMatter = matter(content).data;
    } catch {
      // Docusaurus will display the detailed parsing error in the preview.
    }
    return previewPathForDocument(filePath, frontMatter);
  }

  async status() {
    const [{stdout: porcelain}, {stdout: branch}] = await Promise.all([
      run(
        'git',
        ['status', '--short'],
        gitOptions(this.sshEnvironment, {cwd: this.directory}),
      ),
      run(
        'git',
        ['branch', '--show-current'],
        gitOptions(this.sshEnvironment, {cwd: this.directory}),
      ),
    ]);
    return {
      branch: branch.trim(),
      changes: porcelain
        .split('\n')
        .filter(Boolean)
        .map((line) => ({status: line.slice(0, 2), path: line.slice(3)})),
    };
  }

  async pull() {
    const {stdout, stderr} = await run(
      'git',
      ['pull', '--ff-only', 'origin', this.branch],
      gitOptions(this.sshEnvironment, {cwd: this.directory}),
    );
    return `${stdout}${stderr}`.trim();
  }

  async publish(message) {
    await run(
      'git',
      ['add', '--all'],
      gitOptions(this.sshEnvironment, {cwd: this.directory}),
    );
    const currentStatus = await this.status();
    if (!currentStatus.changes.length) {
      throw new Error('There are no changes to publish');
    }
    await run(
      'git',
      [
        '-c',
        'user.name=Docusaurus Repo Editor',
        '-c',
        'user.email=editor@localhost',
        'commit',
        '-m',
        message,
      ],
      gitOptions(this.sshEnvironment, {cwd: this.directory}),
    );
    const {stdout, stderr} = await run(
      'git',
      ['push', 'origin', this.branch],
      gitOptions(this.sshEnvironment, {cwd: this.directory}),
    );
    return `${stdout}${stderr}`.trim();
  }
}
