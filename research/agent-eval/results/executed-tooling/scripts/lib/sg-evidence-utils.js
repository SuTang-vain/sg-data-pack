'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function sha256Bytes(value) {
  return 'sha256:' + crypto.createHash('sha256').update(value).digest('hex');
}

function contentId(prefix, value, omitted = []) {
  const copy = { ...value };
  for (const key of omitted) delete copy[key];
  return `${prefix}:${sha256Bytes(stableJson(copy)).slice(7)}`;
}

function isDigest(value) {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);
}

function safeRelative(value, label = 'path') {
  if (typeof value !== 'string' || !value || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`${label} must be a non-empty safe relative path`);
  if (path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)) throw new Error(`${label} must be relative`);
  const normalized = value.replace(/\\/g, '/');
  if (normalized.split('/').includes('..')) throw new Error(`${label} must not escape its root`);
  return normalized.replace(/^\.\//, '');
}

function verifyArtifacts(artifacts, baseDir, errors) {
  const verifiedIds = new Set();
  const ids = new Set();
  const paths = new Set();
  let root = null;
  if ((artifacts || []).length && !baseDir) errors.push('artifact verification baseDir is required');
  else if (baseDir) {
    try { root = fs.realpathSync(baseDir); }
    catch (error) { errors.push(`artifact verification root cannot be resolved: ${error.message}`); }
  }
  for (const artifact of artifacts || []) {
    if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
      errors.push('artifact must be an object');
      continue;
    }
    const id = typeof artifact.id === 'string' && artifact.id ? artifact.id : null;
    if (!id) errors.push('artifact.id must be a non-empty string');
    else if (ids.has(id)) errors.push(`artifact id is duplicated: ${id}`);
    else ids.add(id);
    if (!isDigest(artifact.sha256)) errors.push(`artifact ${id || '<unknown>'} sha256 is required`);
    let relative;
    try { relative = safeRelative(artifact.path, `artifact ${id || '<unknown>'} path`); }
    catch (error) { errors.push(error.message); continue; }
    if (paths.has(relative)) {
      errors.push(`artifact path is duplicated: ${relative}`);
      continue;
    }
    paths.add(relative);
    if (!root || !id || !isDigest(artifact.sha256)) continue;
    const file = path.resolve(root, relative);
    const fromRoot = path.relative(root, file);
    if (fromRoot === '..' || fromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(fromRoot)) {
      errors.push(`artifact ${id} escapes evidence root`);
      continue;
    }
    try {
      let current = root;
      for (const segment of relative.split('/')) {
        current = path.join(current, segment);
        const stat = fs.lstatSync(current);
        if (stat.isSymbolicLink()) throw new Error('path must not contain symlinks');
      }
      const stat = fs.lstatSync(file);
      if (!stat.isFile()) throw new Error('must be a regular file');
      if (stat.nlink > 1) throw new Error('hardlinks are not allowed');
      const canonicalFile = fs.realpathSync(file);
      const canonicalRelative = path.relative(root, canonicalFile);
      if (canonicalRelative === '..' || canonicalRelative.startsWith(`..${path.sep}`) || path.isAbsolute(canonicalRelative)) throw new Error('resolves outside evidence root');
      const actual = sha256Bytes(fs.readFileSync(file));
      if (actual !== artifact.sha256) throw new Error('digest mismatch');
      verifiedIds.add(id);
    } catch (error) {
      errors.push(`artifact ${id} cannot be verified: ${error.message}`);
    }
  }
  return verifiedIds;
}

module.exports = { stableValue, stableJson, sha256Bytes, contentId, isDigest, safeRelative, verifyArtifacts };
