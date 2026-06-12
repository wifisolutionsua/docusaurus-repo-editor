import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import express from 'express';
import httpProxy from 'http-proxy';
import multer from 'multer';
import {Repository} from './repository.mjs';
import {resolveInside, sanitizeFilename, toPosixPath} from './paths.mjs';
import {sendProxyError, sendSocketResponse} from './proxy-response.mjs';
import {normalizeBranch, normalizeRepositoryUrl, SettingsStore} from './settings.mjs';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(currentDirectory, '..');
const distDirectory = path.join(projectDirectory, 'dist');
const port = Number(process.env.PORT || 3000);
const previewPort = Number(process.env.PREVIEW_PORT || 3001);
const username = process.env.EDITOR_USERNAME || 'admin';
const password = process.env.EDITOR_PASSWORD || '';
const dataDirectory = process.env.DATA_DIR || '/data';
const repositoryDirectory = process.env.REPO_DIR || path.join(dataDirectory, 'repository');

if (process.env.NODE_ENV === 'production' && !password) {
  throw new Error('EDITOR_PASSWORD is required in production');
}

const settingsStore = new SettingsStore(dataDirectory);
await settingsStore.initialize();

let repository = null;
let runtimeSettings = null;
let runtimeError = '';
let initializationPromise = null;
let initializationSettings = null;

async function initializeRepository(settings) {
  if (
    repository
    && runtimeSettings?.repositoryUrl === settings.repositoryUrl
    && runtimeSettings?.branch === settings.branch
  ) {
    return repository;
  }

  if (repository) {
    throw new Error(
      'A repository is already connected. Use a new /data volume to connect another repository.',
    );
  }

  if (initializationPromise) {
    if (
      initializationSettings?.repositoryUrl !== settings.repositoryUrl
      || initializationSettings?.branch !== settings.branch
    ) {
      throw new Error('A repository is already initializing. Wait for it to finish.');
    }
    return initializationPromise;
  }

  initializationSettings = settings;
  initializationPromise = (async () => {
    runtimeError = '';
    const nextRepository = new Repository({
      directory: repositoryDirectory,
      url: settings.repositoryUrl,
      branch: settings.branch,
      sshEnvironment: settingsStore.sshEnvironment(),
    });

    try {
      await nextRepository.initialize({autoPull: process.env.AUTO_PULL === 'true'});
      await nextRepository.ensureDependencies();
      nextRepository.startPreview(previewPort);
      repository = nextRepository;
      runtimeSettings = settings;
      return repository;
    } catch (error) {
      runtimeError = error.message;
      throw error;
    } finally {
      initializationPromise = null;
      initializationSettings = null;
    }
  })();

  return initializationPromise;
}

const savedSettings = await settingsStore.read();
if (savedSettings) {
  initializeRepository(savedSettings).catch((error) => {
    console.error(`Repository initialization failed: ${error.message}`);
  });
}

const app = express();
const server = http.createServer(app);
const proxy = httpProxy.createProxyServer({
  target: `http://127.0.0.1:${previewPort}`,
  ws: true,
  changeOrigin: true,
});

proxy.on('error', (error, request, responseOrSocket) => {
  console.error(`Preview proxy error: ${error.message}`);
  sendProxyError(error, responseOrSocket);
});

function requireAuth(request, response, next) {
  if (!password) {
    next();
    return;
  }

  const authorization = request.headers.authorization || '';
  const [scheme, encoded] = authorization.split(' ');
  const credentials = scheme === 'Basic' && encoded
    ? Buffer.from(encoded, 'base64').toString('utf8')
    : '';
  const separator = credentials.indexOf(':');
  const suppliedUsername = separator >= 0 ? credentials.slice(0, separator) : '';
  const suppliedPassword = separator >= 0 ? credentials.slice(separator + 1) : '';

  if (suppliedUsername === username && suppliedPassword === password) {
    next();
    return;
  }

  response.set('WWW-Authenticate', 'Basic realm="Docusaurus Editor"');
  response.status(401).send('Authentication required');
}

app.use(requireAuth);
app.use('/api', express.json({limit: '5mb'}));
app.use('/editor-assets', express.static(distDirectory, {index: false}));

app.get(['/editor', '/editor/'], (request, response) => {
  response.sendFile(path.join(distDirectory, 'index.html'));
});

app.get('/api/settings', async (request, response, next) => {
  try {
    const settings = await settingsStore.read();
    response.json({
      repositoryUrl: settings?.repositoryUrl || '',
      branch: settings?.branch || 'main',
      publicKey: await settingsStore.publicKey(),
      ready: Boolean(repository),
      initializing: Boolean(initializationPromise),
      error: runtimeError,
    });
  } catch (error) {
    next(error);
  }
});

app.put('/api/settings', async (request, response, next) => {
  try {
    const settings = {
      repositoryUrl: normalizeRepositoryUrl(request.body.repositoryUrl),
      branch: normalizeBranch(request.body.branch),
    };
    await initializeRepository(settings);
    await settingsStore.write(settings);
    response.json({
      ...settings,
      publicKey: await settingsStore.publicKey(),
      ready: true,
      error: '',
    });
  } catch (error) {
    next(error);
  }
});

function requireRepository(request, response, next) {
  if (repository) {
    next();
    return;
  }
  response.status(409).json({
    error: runtimeError || 'Configure and connect a repository in Settings first',
    needsSettings: true,
  });
}

app.use('/api/tree', requireRepository);
app.use('/api/file', requireRepository);
app.use('/api/move', requireRepository);
app.use('/api/media', requireRepository);
app.use('/api/upload', requireRepository);
app.use('/api/git', requireRepository);

app.get('/api/tree', async (request, response, next) => {
  try {
    response.json(await repository.listTree());
  } catch (error) {
    next(error);
  }
});

app.get('/api/file', async (request, response, next) => {
  try {
    const filePath = String(request.query.path || '');
    response.json({path: filePath, content: await repository.readFile(filePath)});
  } catch (error) {
    next(error);
  }
});

app.put('/api/file', async (request, response, next) => {
  try {
    const {path: filePath, content} = request.body;
    if (typeof filePath !== 'string' || typeof content !== 'string') {
      response.status(400).json({error: 'path and content are required'});
      return;
    }
    await repository.writeFile(filePath, content);
    response.json({
      ok: true,
      previewPath: await repository.previewPath(filePath, content),
    });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/file', async (request, response, next) => {
  try {
    await repository.deleteFile(String(request.query.path || ''));
    response.json({ok: true});
  } catch (error) {
    next(error);
  }
});

app.post('/api/move', async (request, response, next) => {
  try {
    const {from, to} = request.body;
    await repository.moveFile(String(from || ''), String(to || ''));
    response.json({ok: true});
  } catch (error) {
    next(error);
  }
});

app.get('/api/media', async (request, response, next) => {
  try {
    const directory = String(request.query.directory || '');
    if (!directory) {
      response.status(400).json({error: 'directory is required'});
      return;
    }
    response.json(await repository.listMedia(directory));
  } catch (error) {
    next(error);
  }
});

app.get('/api/media/file', async (request, response, next) => {
  try {
    const filePath = String(request.query.path || '');
    response.sendFile(resolveInside(repository.directory, filePath));
  } catch (error) {
    next(error);
  }
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {fileSize: 25 * 1024 * 1024},
});

app.post('/api/upload', upload.single('file'), async (request, response, next) => {
  try {
    if (!request.file) {
      response.status(400).json({error: 'file is required'});
      return;
    }
    const destinationDirectory = String(request.body.directory || 'static/img');
    const filename = sanitizeFilename(request.file.originalname);
    const relativePath = toPosixPath(path.join(destinationDirectory, filename));
    const absolutePath = resolveInside(repository.directory, relativePath);
    await fs.mkdir(path.dirname(absolutePath), {recursive: true});
    await fs.writeFile(absolutePath, request.file.buffer, {flag: 'wx'});
    response.status(201).json({path: relativePath});
  } catch (error) {
    next(error);
  }
});

app.get('/api/git/status', async (request, response, next) => {
  try {
    response.json(await repository.status());
  } catch (error) {
    next(error);
  }
});

app.post('/api/git/pull', async (request, response, next) => {
  try {
    response.json({output: await repository.pull()});
  } catch (error) {
    next(error);
  }
});

app.post('/api/git/publish', async (request, response, next) => {
  try {
    const message = String(request.body.message || '').trim();
    if (!message) {
      response.status(400).json({error: 'Commit message is required'});
      return;
    }
    response.json({output: await repository.publish(message)});
  } catch (error) {
    next(error);
  }
});

app.use('/api', (error, request, response, next) => {
  console.error(error);
  response.status(400).json({error: error.message || 'Request failed'});
});

app.use((request, response) => {
  if (!repository) {
    response.status(503).send('Configure the repository at /editor');
    return;
  }
  proxy.web(request, response);
});

server.on('upgrade', (request, socket, head) => {
  if (!repository) {
    sendSocketResponse(
      socket,
      503,
      'Service Unavailable',
      'Configure the repository at /editor',
    );
    return;
  }
  proxy.ws(request, socket, head);
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Editor: http://0.0.0.0:${port}/editor`);
  console.log(`Repository data: ${repositoryDirectory}`);
});
