import path from 'node:path';

export function resolveInside(root, requestedPath = '') {
  const normalizedRoot = path.resolve(root);
  const resolved = path.resolve(normalizedRoot, requestedPath);

  if (resolved !== normalizedRoot && !resolved.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new Error('Path is outside the repository');
  }

  return resolved;
}

export function toPosixPath(value) {
  return value.split(path.sep).join('/');
}

export function previewPathForDocument(filePath, frontMatter = {}) {
  if (!/^docs\/.*\.mdx?$/i.test(filePath)) {
    return '/';
  }

  if (typeof frontMatter.slug === 'string' && frontMatter.slug.trim()) {
    const slug = frontMatter.slug.trim();
    return slug.startsWith('/') ? slug : `/docs/${slug}`;
  }

  let docPath = filePath.replace(/^docs\//, '').replace(/\.mdx?$/i, '');
  docPath = docPath.replace(/(^|\/)index$/i, '').replace(/\/$/, '');
  return `/docs${docPath ? `/${docPath}` : ''}`;
}

export function sanitizeFilename(filename) {
  const cleaned = path.basename(filename).replace(/[^a-zA-Z0-9._-]+/g, '-');
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    throw new Error('Invalid filename');
  }
  return cleaned;
}
