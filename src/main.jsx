import React, {useEffect, useMemo, useRef, useState} from 'react';
import ReactDOM from 'react-dom/client';
import CodeMirror from '@uiw/react-codemirror';
import {markdown} from '@codemirror/lang-markdown';
import editorLogo from './assets/editor-logo.svg';
import './styles.css';

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: options.body instanceof FormData
      ? options.headers
      : {'Content-Type': 'application/json', ...options.headers},
    ...options,
  });
  const contentType = response.headers.get('content-type') || '';
  const json = contentType.includes('application/json');
  if (!response.ok) {
    const details = json ? await response.json() : null;
    const message = details?.error
      || (contentType.startsWith('text/plain') ? await response.text() : '');
    const error = new Error(message || `Request failed (${response.status})`);
    error.references = details?.references;
    throw error;
  }
  return json ? response.json() : response.text();
}

function firstMarkdownFile(nodes) {
  for (const node of nodes) {
    if (node.type === 'file' && /\.mdx?$/i.test(node.path)) {
      return node.path;
    }
    if (node.children) {
      const found = firstMarkdownFile(node.children);
      if (found) return found;
    }
  }
  return null;
}

function relativeMediaReference(documentPath, mediaPath) {
  if (mediaPath.startsWith('static/')) {
    return `/${mediaPath.slice('static/'.length)}`;
  }

  const from = documentPath.split('/').slice(0, -1);
  const to = mediaPath.split('/');
  while (from.length && to.length && from[0] === to[0]) {
    from.shift();
    to.shift();
  }
  const relative = `${from.map(() => '..').join('/')}${from.length ? '/' : './'}${to.join('/')}`;
  return relative;
}

function FileTree({nodes, selected, onSelect}) {
  return (
    <div className="tree">
      {nodes.map((node) => (
        node.type === 'directory'
          ? <Directory key={node.path} node={node} selected={selected} onSelect={onSelect} />
          : (
            <button
              className={`tree-file ${selected === node.path ? 'selected' : ''}`}
              key={node.path}
              onClick={() => onSelect(node.path)}
              title={node.path}
            >
              <span>{/\.(md|mdx)$/i.test(node.name) ? 'M' : '●'}</span>
              {node.name}
            </button>
          )
      ))}
    </div>
  );
}

function Directory({node, selected, onSelect}) {
  const containsSelected = selected?.startsWith(`${node.path}/`);
  const [open, setOpen] = useState(containsSelected || node.path === 'docs');

  useEffect(() => {
    if (containsSelected) setOpen(true);
  }, [containsSelected]);

  return (
    <div className="tree-directory">
      <button className="tree-folder" onClick={() => setOpen((value) => !value)}>
        <span>{open ? '▾' : '▸'}</span>
        {node.name}
      </button>
      {open && (
        <div className="tree-children">
          <FileTree nodes={node.children} selected={selected} onSelect={onSelect} />
        </div>
      )}
    </div>
  );
}

const snippets = [
  ['Info', ':::info Title\n\nWrite useful information here.\n\n:::\n'],
  ['Tip', ':::tip Title\n\nWrite a helpful tip here.\n\n:::\n'],
  ['Warning', ':::warning Title\n\nWrite a warning here.\n\n:::\n'],
  ['Danger', ':::danger Title\n\nWrite an important warning here.\n\n:::\n'],
  ['Code', '```bash\ncommand --option\n```\n'],
  ['Tabs', '<Tabs>\n  <TabItem value="first" label="First">\n\n  First tab content.\n\n  </TabItem>\n  <TabItem value="second" label="Second">\n\n  Second tab content.\n\n  </TabItem>\n</Tabs>\n'],
];

const imagePattern = /\.(png|jpe?g|gif|webp|svg)$/i;
const clipboardImageExtensions = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};
const previewLabels = {
  starting: 'Starting preview…',
  compiling: 'Compiling…',
  ready: 'Ready',
  error: 'Preview error',
};
const mediaDateFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function App() {
  const editorRef = useRef(null);
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('docs-editor-theme') === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  });
  const [tree, setTree] = useState([]);
  const [selectedPath, setSelectedPath] = useState('');
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [previewPath, setPreviewPath] = useState('/');
  const previewUrl = useMemo(() => {
    const url = new URL(previewPath, window.location.origin);
    url.searchParams.set('docusaurus-theme', theme);
    return url.href;
  }, [previewPath, theme]);
  const [previewVersion, setPreviewVersion] = useState(0);
  const [previewFrame, setPreviewFrame] = useState(null);
  const [previewStatus, setPreviewStatus] = useState({phase: 'starting'});
  const previewPhase = previewStatus.phase;
  const refreshPending = previewFrame?.url !== previewUrl || previewFrame?.version !== previewVersion;
  const [status, setStatus] = useState({branch: '', changes: []});
  const [message, setMessage] = useState('Loading repository…');
  const [busy, setBusy] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [mediaDeleteError, setMediaDeleteError] = useState(null);
  const [media, setMedia] = useState([]);
  const [mediaView, setMediaView] = useState('grid');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState({
    repositoryUrl: '',
    branch: 'main',
    publicKey: '',
    ready: false,
    initializing: false,
    error: '',
  });
  const dirty = content !== savedContent;

  const markdownSelected = /\.mdx?$/i.test(selectedPath);
  const title = useMemo(() => selectedPath.split('/').pop() || 'No file selected', [selectedPath]);

  async function refreshTree(preferredPath = selectedPath) {
    const nextTree = await api('/api/tree');
    setTree(nextTree);
    return preferredPath || firstMarkdownFile(nextTree);
  }

  async function refreshStatus() {
    setStatus(await api('/api/git/status'));
  }

  async function loadWorkspace() {
    const initialPath = await refreshTree('');
    await refreshStatus();
    if (initialPath) await openFile(initialPath, {force: true});
  }

  async function loadSettings() {
    const nextSettings = await api('/api/settings');
    setSettings(nextSettings);
    return nextSettings;
  }

  async function openFile(filePath, {force = false} = {}) {
    if (!force && dirty && !window.confirm('Discard unsaved changes?')) return;
    if (!/\.mdx?$/i.test(filePath)) {
      setMessage('Media files can be inserted with the Media button.');
      return;
    }
    setBusy(true);
    try {
      const file = await api(`/api/file?path=${encodeURIComponent(filePath)}`);
      setSelectedPath(filePath);
      setContent(file.content);
      setSavedContent(file.content);
      setPreviewPath(file.previewPath);
      setPreviewVersion((value) => value + 1);
      setMessage('Ready');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!settings.ready) return;
    let cancelled = false;
    let timer;
    async function checkPreview() {
      try {
        const status = await api('/api/preview/status');
        if (!cancelled) setPreviewStatus(status);
      } catch (error) {
        if (!cancelled) setPreviewStatus({phase: 'error', message: error.message});
      } finally {
        if (!cancelled) timer = window.setTimeout(checkPreview, 750);
      }
    }
    checkPreview();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [settings.ready]);

  useEffect(() => {
    if (!refreshPending || previewPhase !== 'ready') return;
    const timer = window.setTimeout(() => {
      setPreviewFrame({url: previewUrl, version: previewVersion});
    }, 1250);
    return () => window.clearTimeout(timer);
  }, [previewUrl, previewVersion, previewPhase, refreshPending]);

  useEffect(() => {
    document.documentElement.dataset.editorTheme = theme;
    try {
      localStorage.setItem('docs-editor-theme', theme);
    } catch {
      // The toggle still works when browser storage is unavailable.
    }
  }, [theme]);

  useEffect(() => {
    (async () => {
      try {
        const initialSettings = await loadSettings();
        if (initialSettings.ready) {
          await loadWorkspace();
        } else {
          setSettingsOpen(true);
          setMessage(
            initialSettings.error
              || (initialSettings.initializing
                ? 'Repository is initializing…'
                : 'Configure a repository to begin.'),
          );
        }
      } catch (error) {
        setMessage(error.message);
      }
    })();
  }, []);

  useEffect(() => {
    if (!settings.initializing || settings.ready) return undefined;

    let cancelled = false;
    let timer;
    async function checkSetup() {
      try {
        const nextSettings = await api('/api/settings');
        if (cancelled) return;
        setSettings((current) => ({
          ...nextSettings,
          repositoryUrl: nextSettings.repositoryUrl || current.repositoryUrl,
          branch: nextSettings.repositoryUrl ? nextSettings.branch : current.branch,
        }));
        if (nextSettings.ready) {
          setSettingsOpen(false);
          await loadWorkspace();
          setMessage('Repository connected.');
        } else if (nextSettings.initializing) {
          timer = window.setTimeout(checkSetup, 2000);
        } else {
          setMessage(nextSettings.error || 'Repository setup stopped. Connect again to retry.');
        }
      } catch (error) {
        if (cancelled) return;
        setMessage(error.message);
        timer = window.setTimeout(checkSetup, 2000);
      }
    }
    timer = window.setTimeout(checkSetup, 2000);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [settings.initializing, settings.ready]);

  useEffect(() => {
    const handler = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        save();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [content, selectedPath]);

  async function save() {
    if (!selectedPath || !markdownSelected) return false;
    setBusy(true);
    setMessage('Saving…');
    try {
      const result = await api('/api/file', {
        method: 'PUT',
        body: JSON.stringify({path: selectedPath, content}),
      });
      setSavedContent(content);
      setPreviewPath(result.previewPath);
      setPreviewVersion((value) => value + 1);
      await refreshStatus();
      setMessage('Saved.');
      return true;
    } catch (error) {
      setMessage(error.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  function insertSnippet(snippet, selection) {
    const view = editorRef.current?.view;
    if (!view) {
      setContent((value) => `${value}\n${snippet}`);
      return;
    }
    const range = selection || view.state.selection.main;
    view.dispatch({
      changes: {from: range.from, to: range.to, insert: snippet},
      selection: {anchor: range.from + snippet.length},
      scrollIntoView: true,
    });
    view.focus();
  }

  function replaceSelection(createReplacement) {
    const view = editorRef.current?.view;
    if (!view) return;

    const range = view.state.selection.main;
    const selectedText = view.state.sliceDoc(range.from, range.to);
    const replacement = createReplacement(selectedText);
    view.dispatch({
      changes: {from: range.from, to: range.to, insert: replacement},
      selection: {anchor: range.from + replacement.length},
      scrollIntoView: true,
    });
    view.focus();
  }

  function insertHeading(level) {
    replaceSelection((selectedText) => `${'#'.repeat(level)} ${selectedText || 'Heading'}`);
  }

  function wrapSelection(prefix, suffix, placeholder) {
    replaceSelection((selectedText) => `${prefix}${selectedText || placeholder}${suffix}`);
  }

  function insertList(ordered = false) {
    replaceSelection((selectedText) => {
      const lines = (selectedText || 'List item').split('\n');
      return lines
        .map((line, index) => `${ordered ? `${index + 1}.` : '-'} ${line}`)
        .join('\n');
    });
  }

  function insertQuote() {
    replaceSelection((selectedText) => (
      (selectedText || 'Quoted text')
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n')
    ));
  }

  function insertLink() {
    const url = window.prompt('Link URL', 'https://');
    if (!url) return;
    wrapSelection('[', `](${url})`, 'link text');
  }

  function insertTabs() {
    const tabSnippet = snippets.find(([label]) => label === 'Tabs')[1];
    const imports = "import Tabs from '@theme/Tabs';\nimport TabItem from '@theme/TabItem';\n\n";
    if (!content.includes("from '@theme/Tabs'")) {
      const view = editorRef.current?.view;
      const range = view?.state.selection.main || {from: content.length, to: content.length};
      setContent(
        `${imports}${content.slice(0, range.from)}${tabSnippet}${content.slice(range.to)}`,
      );
      return;
    }
    insertSnippet(tabSnippet);
  }

  async function createFile() {
    const filePath = window.prompt('New document path', 'docs/new-document.md');
    if (!filePath) return;
    try {
      await api('/api/file', {
        method: 'PUT',
        body: JSON.stringify({
          path: filePath,
          content: '---\nsidebar_position: 1\n---\n\n# New document\n\nStart writing here.\n',
        }),
      });
      await refreshTree(filePath);
      await openFile(filePath, {force: true});
      await refreshStatus();
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function renameFile() {
    if (!selectedPath) return;
    const nextPath = window.prompt('Rename or move file', selectedPath);
    if (!nextPath || nextPath === selectedPath) return;
    try {
      await api('/api/move', {
        method: 'POST',
        body: JSON.stringify({from: selectedPath, to: nextPath}),
      });
      setSelectedPath(nextPath);
      await refreshTree(nextPath);
      await refreshStatus();
      setMessage('File moved.');
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function deleteFile() {
    if (!selectedPath || !window.confirm(`Delete ${selectedPath}?`)) return;
    try {
      await api(`/api/file?path=${encodeURIComponent(selectedPath)}`, {method: 'DELETE'});
      setSelectedPath('');
      setContent('');
      setSavedContent('');
      const nextPath = await refreshTree('');
      if (nextPath) await openFile(nextPath, {force: true});
      await refreshStatus();
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function showMedia() {
    try {
      setMedia(await api(`/api/media?directory=${encodeURIComponent(defaultUploadDirectory)}`));
      setMediaDeleteError(null);
      setMediaOpen(true);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function deleteMedia(filePath) {
    if (busy) return;
    const filename = filePath.split('/').pop();
    if (dirty) {
      setMediaDeleteError({message: 'Save your document before deleting an image so its references can be checked.'});
      return;
    }
    if (!window.confirm(`Check for references and delete "${filename}" if none are found?`)) return;
    setBusy(true);
    setMediaDeleteError(null);
    try {
      await api(`/api/media/file?path=${encodeURIComponent(filePath)}`, {method: 'DELETE'});
      setMedia((items) => items.filter((item) => item.filePath !== filePath));
      await refreshTree();
      await refreshStatus();
      setMessage(`Deleted ${filename}`);
    } catch (error) {
      setMediaDeleteError({message: error.message, references: error.references});
    } finally {
      setBusy(false);
    }
  }

  function insertMedia(mediaPath, selection) {
    const reference = relativeMediaReference(selectedPath, mediaPath);
    const alt = mediaPath.split('/').pop().replace(/\.[^.]+$/, '');
    const isImage = imagePattern.test(mediaPath);
    insertSnippet(isImage ? `![${alt}](${reference})` : `[${alt}](${reference})`, selection);
    setMediaOpen(false);
  }

  async function uploadFile(file, {insert = true, directory = defaultUploadDirectory, paste} = {}) {
    if (!file) return;

    const form = new FormData();
    form.set('directory', directory);
    form.set('file', file);
    setBusy(true);
    setMessage(`Uploading ${file.name}…`);
    try {
      const result = await api('/api/upload', {method: 'POST', body: form});
      const canInsert = !paste || (
        editorRef.current?.view === paste.view && paste.view.state.doc === paste.document
      );
      if (insert && canInsert) {
        insertMedia(result.path, paste?.selection);
        setUploadOpen(false);
      }
      await refreshTree();
      await refreshStatus();
      if (!insert) {
        setMedia(await api(`/api/media?directory=${encodeURIComponent(defaultUploadDirectory)}`));
      }
      setMessage(canInsert
        ? `Uploaded ${result.path}`
        : 'Screenshot uploaded. Select it in Media to insert it.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  function pasteScreenshot(event) {
    const clipboard = event.clipboardData;
    if (!clipboard) return;
    const image = Array.from(clipboard.files).find((file) => clipboardImageExtensions[file.type]);
    if (!image) return;
    event.preventDefault();
    event.stopPropagation();
    const view = editorRef.current?.view;
    if (!markdownSelected || !view || busy) {
      setMessage(busy ? 'Wait for the current operation before pasting.' : 'Open a document before pasting an image.');
      return;
    }
    const id = Array.from(crypto.getRandomValues(new Uint8Array(8)),
      (byte) => byte.toString(16).padStart(2, '0')).join('');
    const filename = `screenshot-${id}.${clipboardImageExtensions[image.type]}`;
    const file = new File([image], filename, {type: image.type});
    uploadFile(file, {paste: {view, document: view.state.doc, selection: view.state.selection.main}});
  }

  async function uploadMedia(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await uploadFile(form.get('file'), {directory: String(form.get('directory'))});
  }

  async function pull() {
    if (dirty && !window.confirm('Pull may conflict with unsaved changes. Continue?')) return;
    setBusy(true);
    setMessage('Pulling from GitHub…');
    try {
      const result = await api('/api/git/pull', {method: 'POST', body: '{}'});
      await refreshTree();
      if (selectedPath) await openFile(selectedPath, {force: true});
      await refreshStatus();
      setMessage(result.output || 'Repository is up to date.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (dirty && !await save()) return;
    const commitMessage = window.prompt('Commit message', `Update ${title}`);
    if (!commitMessage) return;
    setBusy(true);
    setMessage('Committing and pushing…');
    try {
      const result = await api('/api/git/publish', {
        method: 'POST',
        body: JSON.stringify({message: commitMessage}),
      });
      await refreshStatus();
      setMessage(result.output || 'Published to GitHub.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage('Connecting to the repository…');
    try {
      const nextSettings = await api('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({
          repositoryUrl: form.get('repositoryUrl'),
          branch: form.get('branch'),
        }),
      });
      setSettings(nextSettings);
      if (nextSettings.ready) {
        setSettingsOpen(false);
        await loadWorkspace();
        setMessage('Repository connected.');
      }
    } catch (error) {
      setSettings((value) => ({...value, error: error.message}));
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function copyPublicKey() {
    try {
      await navigator.clipboard.writeText(settings.publicKey);
      setMessage('Public deploy key copied.');
    } catch {
      setMessage('Could not copy automatically. Select and copy the key manually.');
    }
  }

  const documentDirectory = selectedPath.split('/').slice(0, -1).join('/');
  const defaultUploadDirectory = documentDirectory ? `${documentDirectory}/img` : 'img';

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <img className="brand-mark" src={editorLogo} alt="" width="32" height="32" />
          <div>
            <strong>Docs Editor</strong>
            <small>{status.branch || 'repository'}</small>
          </div>
        </div>
        <div className="topbar-actions">
          <button
            type="button"
            onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
          <span className={`change-count ${status.changes.length ? 'active' : ''}`}>
            {status.changes.length} changed
          </span>
          <button onClick={() => setSettingsOpen(true)}>Settings</button>
          <button onClick={pull} disabled={busy}>Pull</button>
          <button className="primary" onClick={publish} disabled={busy || !status.changes.length}>
            Publish
          </button>
        </div>
      </header>

      <main className="workspace">
        <aside className="sidebar">
          <div className="panel-heading">
            <span>Files</span>
            <div>
              <button className="icon-button" onClick={createFile} title="New document">＋</button>
              <button className="icon-button" onClick={renameFile} title="Rename">↗</button>
              <button className="icon-button danger-text" onClick={deleteFile} title="Delete">×</button>
            </div>
          </div>
          <FileTree nodes={tree} selected={selectedPath} onSelect={openFile} />
        </aside>

        <section className="editor-panel">
          <div className="document-bar">
            <div>
              <strong>{title}</strong>
              <small>{selectedPath}</small>
            </div>
            <button className="primary" onClick={save} disabled={busy || !dirty}>
              {dirty ? 'Save' : 'Saved'}
            </button>
          </div>
          <div className="format-toolbar">
            <div className="toolbar-group" aria-label="Headings">
              <button onClick={() => insertHeading(1)} title="Heading 1">H1</button>
              <button onClick={() => insertHeading(2)} title="Heading 2">H2</button>
              <button onClick={() => insertHeading(3)} title="Heading 3">H3</button>
            </div>
            <div className="toolbar-group" aria-label="Text formatting">
              <button onClick={() => wrapSelection('**', '**', 'bold text')} title="Bold">
                <strong>B</strong>
              </button>
              <button onClick={() => wrapSelection('*', '*', 'italic text')} title="Italic">
                <em>I</em>
              </button>
              <button onClick={() => wrapSelection('`', '`', 'code')} title="Inline code">
                {'</>'}
              </button>
            </div>
            <div className="toolbar-group" aria-label="Lists and links">
              <button onClick={() => insertList(false)} title="Bulleted list">• List</button>
              <button onClick={() => insertList(true)} title="Numbered list">1. List</button>
              <button onClick={insertLink} title="Link">
                URL
              </button>
              <button onClick={insertQuote} title="Blockquote">Quote</button>
            </div>
            <div className="toolbar-divider" />
            {snippets.map(([label, snippet]) => (
              <button
                key={label}
                onClick={() => label === 'Tabs' ? insertTabs() : insertSnippet(snippet)}
              >
                {label}
              </button>
            ))}
            <span className="toolbar-spacer" />
            <button onClick={showMedia}>Media</button>
            <button onClick={() => setUploadOpen(true)} title="Upload a file or paste a screenshot into the editor">
              Upload
            </button>
          </div>
          <div className="code-editor" onPasteCapture={pasteScreenshot}>
            <CodeMirror
              key={selectedPath}
              ref={editorRef}
              value={content}
              height="100%"
              extensions={[markdown()]}
              onChange={setContent}
              basicSetup={{
                lineNumbers: true,
                foldGutter: true,
                highlightActiveLine: true,
              }}
              theme={theme}
            />
          </div>
        </section>

        <section className="preview-panel">
          <div className="preview-bar">
            <span role="status" title={previewStatus.message}>
              {!settings.ready && !settings.initializing && !settings.error
                ? 'Connect a repository for preview'
                : previewPhase === 'ready' && refreshPending
                  ? 'Updating preview…'
                  : previewLabels[previewPhase]}
            </span>
            <button disabled={!settings.ready} onClick={() => setPreviewVersion((value) => value + 1)}>
              Refresh
            </button>
          </div>
          {previewFrame && (
            <iframe
              key={`${previewFrame.url}-${previewFrame.version}`}
              title="Docusaurus preview"
              src={previewFrame.url}
            />
          )}
          {previewPhase === 'error' && previewStatus.message && (
            <div className="preview-error" role="alert">{previewStatus.message}</div>
          )}
        </section>
      </main>

      <footer className="statusbar">
        <span className={busy ? 'pulse' : ''}>{message}</span>
        <span>{dirty ? 'Unsaved changes' : 'Working tree saved locally'}</span>
      </footer>

      {mediaOpen && (
        <div className="modal-backdrop" onMouseDown={() => setMediaOpen(false)}>
          <div className="modal media-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <h2>Media library</h2>
                <p>
                  Images from <code>{defaultUploadDirectory}</code>. Select one to insert it.
                </p>
              </div>
              <div className="modal-actions">
                <label className={`upload-button ${busy ? 'disabled' : ''}`}>
                  Upload image
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
                    disabled={busy}
                    onChange={async (event) => {
                      await uploadFile(event.target.files?.[0], {insert: false});
                      event.target.value = '';
                    }}
                  />
                </label>
                <button className="icon-button" onClick={() => setMediaOpen(false)}>×</button>
              </div>
            </div>
            <div className="media-view-options" role="group" aria-label="Media view">
              <button type="button" aria-pressed={mediaView === 'grid'} onClick={() => setMediaView('grid')}>
                Grid
              </button>
              <button type="button" aria-pressed={mediaView === 'list'} onClick={() => setMediaView('list')}>
                List
              </button>
            </div>
            {mediaDeleteError && (
              <div className="settings-error" role="alert">
                {mediaDeleteError.message}
                {mediaDeleteError.references?.length > 0 && (
                  <ul>
                    {mediaDeleteError.references.map((file) => <li key={file}>{file}</li>)}
                  </ul>
                )}
              </div>
            )}
            <div className={mediaView === 'grid' ? 'media-grid' : 'media-list'}>
              {media.map(({filePath, addedAt}) => (
                <div key={filePath} className="media-item">
                  <button className="media-card" disabled={busy} onClick={() => insertMedia(filePath)}>
                    {mediaView === 'grid' && (
                      <img src={`/api/media/file?path=${encodeURIComponent(filePath)}`} alt="" loading="lazy" />
                    )}
                    <span>{filePath.split('/').pop()}</span>
                    <time dateTime={new Date(addedAt).toISOString()}>
                      {mediaDateFormat.format(addedAt)}
                    </time>
                  </button>
                  <button
                    type="button"
                    className="media-delete danger-text"
                    aria-label={`Delete ${filePath.split('/').pop()}`}
                    onClick={() => deleteMedia(filePath)}
                    disabled={busy}
                  >
                    Delete
                  </button>
                </div>
              ))}
              {!media.length && (
                <div className="empty-media">
                  No images in this document’s <code>img</code> folder yet.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {uploadOpen && (
        <div className="modal-backdrop" onMouseDown={() => setUploadOpen(false)}>
          <form className="modal upload-modal" onSubmit={uploadMedia} onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <h2>Upload media</h2>
                <p>The inserted link will be relative to the current document.</p>
              </div>
              <button type="button" className="icon-button" onClick={() => setUploadOpen(false)}>×</button>
            </div>
            <label>
              Destination folder
              <input name="directory" defaultValue={defaultUploadDirectory} required />
            </label>
            <label>
              File
              <input name="file" type="file" required />
            </label>
            <button className="primary wide" type="submit" disabled={busy}>Upload and insert</button>
          </form>
        </div>
      )}

      {settingsOpen && (
        <div className="modal-backdrop">
          <form
            key={`${settings.repositoryUrl}:${settings.branch}`}
            className="modal settings-modal"
            onSubmit={saveSettings}
          >
            <div className="modal-heading">
              <div>
                <h2>Repository settings</h2>
                <p>Connect one GitHub repository with a write-enabled deploy key.</p>
              </div>
              {settings.ready && (
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => setSettingsOpen(false)}
                >
                  ×
                </button>
              )}
            </div>

            <div className="settings-step">
              <span className="step-number">1</span>
              <div>
                <h3>Add this deploy key on GitHub</h3>
                <p>
                  Repository → Settings → Deploy keys → Add deploy key. Enable
                  <strong> Allow write access</strong>.
                </p>
              </div>
            </div>
            <div className="public-key-box">
              <code>{settings.publicKey}</code>
              <button type="button" onClick={copyPublicKey}>Copy public key</button>
            </div>

            <div className="settings-step">
              <span className="step-number">2</span>
              <div>
                <h3>Connect the repository</h3>
                <p>Use the SSH URL from GitHub’s Code button.</p>
              </div>
            </div>
            <label>
              GitHub repository SSH URL
              <input
                name="repositoryUrl"
                type="text"
                defaultValue={settings.repositoryUrl}
                placeholder="git@github.com:owner/repository.git"
                readOnly={settings.ready}
                required
              />
            </label>
            <label>
              Branch
              <input
                name="branch"
                type="text"
                defaultValue={settings.branch || 'main'}
                readOnly={settings.ready}
                required
              />
            </label>

            {settings.error && <div className="settings-error">{settings.error}</div>}

            {settings.ready
              ? (
                <button
                  className="primary wide"
                  type="button"
                  onClick={() => setSettingsOpen(false)}
                >
                  Done
                </button>
              )
              : (
                <button
                  className="primary wide"
                  type="submit"
                  disabled={busy || settings.initializing}
                >
                  {busy || settings.initializing ? 'Connecting…' : 'Connect repository'}
                </button>
              )}
            <p className="settings-note">
              The private key stays in the persistent Docker volume and is never shown
              in the browser or stored in Compose. Use a new volume to connect a
              different repository.
            </p>
          </form>
        </div>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
