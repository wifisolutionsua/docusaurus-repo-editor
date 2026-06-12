import {execFile} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);

export class SettingsStore {
  constructor(dataDirectory) {
    this.dataDirectory = path.resolve(dataDirectory);
    this.settingsFile = path.join(this.dataDirectory, 'settings.json');
    this.sshDirectory = path.join(this.dataDirectory, 'ssh');
    this.privateKeyFile = path.join(this.sshDirectory, 'id_ed25519');
    this.publicKeyFile = `${this.privateKeyFile}.pub`;
    this.knownHostsFile = path.join(this.sshDirectory, 'known_hosts');
  }

  async initialize() {
    await fs.mkdir(this.sshDirectory, {recursive: true, mode: 0o700});
    await this.ensureDeployKey();
  }

  async ensureDeployKey() {
    try {
      await fs.access(this.privateKeyFile);
      await fs.access(this.publicKeyFile);
    } catch {
      await execFileAsync('ssh-keygen', [
        '-q',
        '-t',
        'ed25519',
        '-C',
        'docusaurus-repo-editor',
        '-N',
        '',
        '-f',
        this.privateKeyFile,
      ]);
    }

    await fs.chmod(this.sshDirectory, 0o700);
    await fs.chmod(this.privateKeyFile, 0o600);
    await fs.chmod(this.publicKeyFile, 0o644);
  }

  async read() {
    try {
      return JSON.parse(await fs.readFile(this.settingsFile, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async write({repositoryUrl, branch}) {
    const settings = {
      repositoryUrl,
      branch,
      updatedAt: new Date().toISOString(),
    };
    await fs.writeFile(this.settingsFile, `${JSON.stringify(settings, null, 2)}\n`, {
      mode: 0o600,
    });
    return settings;
  }

  async publicKey() {
    return (await fs.readFile(this.publicKeyFile, 'utf8')).trim();
  }

  sshEnvironment() {
    return {
      GIT_SSH_COMMAND: [
        'ssh',
        `-i "${this.privateKeyFile}"`,
        '-o IdentitiesOnly=yes',
        '-o BatchMode=yes',
        '-o StrictHostKeyChecking=accept-new',
        `-o UserKnownHostsFile="${this.knownHostsFile}"`,
      ].join(' '),
    };
  }
}

export function normalizeRepositoryUrl(value) {
  const repositoryUrl = String(value || '').trim();
  if (!/^git@github\.com:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(repositoryUrl)) {
    throw new Error('Use a GitHub SSH URL such as git@github.com:owner/repository.git');
  }
  return repositoryUrl.endsWith('.git') ? repositoryUrl : `${repositoryUrl}.git`;
}

export function normalizeBranch(value) {
  const branch = String(value || 'main').trim();
  if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.includes('..') || branch.startsWith('-')) {
    throw new Error('Invalid branch name');
  }
  return branch;
}
