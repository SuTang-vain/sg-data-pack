'use strict';

/* Deterministic, read-only filesystem tree snapshots and diffs. */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { canonicalPath, matchesGlob } = require('./sg-path-policy.js');

const DEFAULT_EXCLUDES = ['.git', '**/.git', '.git/**', '**/.git/**'];

function compareNames(left, right) {
  return left === right ? 0 : (left < right ? -1 : 1);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function entryMode(stat) {
  return stat.mode & 0o7777;
}

function normalizePatterns(value) {
  if (value === false || value === null) return [];
  if (value === undefined) return DEFAULT_EXCLUDES;
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value) || value.some((pattern) => typeof pattern !== 'string')) {
    throw new TypeError('exclude must be a string, an array of strings, false, or null');
  }
  return value;
}

function isExcluded(relativePath, patterns) {
  return patterns.some((pattern) => matchesGlob(relativePath, pattern));
}

function snapshotEntry(absolutePath, relativePath, stat) {
  const base = {
    path: relativePath,
    relativePath,
    kind: null,
    mode: entryMode(stat),
    sha256: null,
    size: 0,
    target: null,
  };
  if (stat.isFile()) {
    const bytes = fs.readFileSync(absolutePath);
    return { ...base, kind: 'file', sha256: sha256(bytes), size: bytes.length };
  }
  if (stat.isDirectory()) return { ...base, kind: 'directory' };
  if (stat.isSymbolicLink()) {
    const target = fs.readlinkSync(absolutePath);
    const bytes = Buffer.from(target);
    return { ...base, kind: 'symlink', sha256: sha256(bytes), size: bytes.length, target };
  }
  return null;
}

function treeHash(entries) {
  if (!Array.isArray(entries)) throw new TypeError('entries must be an array');
  const normalized = entries.map((entry) => ({
    ...entry,
    path: entry.path === undefined ? entry.relativePath : entry.path,
  }));
  if (normalized.some((entry) => typeof entry.path !== 'string')) throw new TypeError('snapshot entry path must be a string');
  const ordered = normalized.sort((left, right) => compareNames(left.path, right.path));
  return sha256(Buffer.from(ordered.map((entry) => JSON.stringify([
    entry.path,
    entry.kind,
    entry.mode,
    entry.sha256,
    entry.size,
    entry.target,
  ])).join('\n')));
}

function treeSha256(value, options = {}) {
  return typeof value === 'string' ? snapshotTree(value, options).treeSha256 : treeHash(snapshotEntries(value));
}

function snapshotTree(root, options = {}) {
  const physicalRoot = canonicalPath(root, { mustExist: true });
  const rootStat = fs.lstatSync(physicalRoot);
  if (!rootStat.isDirectory()) throw new TypeError(`snapshot root must be a directory: ${root}`);
  const exclude = normalizePatterns(options.exclude);
  const entries = [];

  function visit(directory, prefix) {
    const names = fs.readdirSync(directory).sort(compareNames);
    for (const name of names) {
      const relativePath = prefix ? `${prefix}/${name}` : name;
      if (isExcluded(relativePath, exclude)) continue;
      const absolutePath = path.join(directory, name);
      const stat = fs.lstatSync(absolutePath);
      const entry = snapshotEntry(absolutePath, relativePath, stat);
      if (!entry) {
        if (options.errorOnSpecialFile) throw new Error(`unsupported filesystem entry: ${relativePath}`);
        continue;
      }
      entries.push(entry);
      if (entry.kind === 'directory') visit(absolutePath, relativePath);
    }
  }

  visit(physicalRoot, '');
  return {
    root: physicalRoot,
    entries,
    treeSha256: treeHash(entries),
  };
}

function snapshotEntries(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.entries)) return value.entries;
  throw new TypeError('snapshot must be an entry array or an object with entries');
}

function indexEntries(snapshot) {
  const out = new Map();
  for (const entry of snapshotEntries(snapshot)) {
    if (!entry || typeof (entry.path === undefined ? entry.relativePath : entry.path) !== 'string') throw new TypeError('snapshot entry path must be a string');
    const relativePath = entry.path === undefined ? entry.relativePath : entry.path;
    if (out.has(relativePath)) throw new Error(`duplicate snapshot entry: ${relativePath}`);
    out.set(relativePath, entry);
  }
  return out;
}

function contentSignature(entry) {
  return JSON.stringify([entry.kind, entry.sha256, entry.size, entry.target]);
}

function renameSignature(entry) {
  if (entry.kind === 'directory') return null;
  return JSON.stringify([entry.kind, entry.sha256, entry.size, entry.target]);
}

function diffTrees(before, after, options = {}) {
  const beforeMap = indexEntries(before);
  const afterMap = indexEntries(after);
  let added = [...afterMap.keys()].filter((entryPath) => !beforeMap.has(entryPath)).sort();
  let deleted = [...beforeMap.keys()].filter((entryPath) => !afterMap.has(entryPath)).sort();
  const modified = [];
  const modeChanged = [];
  const typeChanged = [];
  const renamed = [];

  for (const entryPath of [...afterMap.keys()].filter((name) => beforeMap.has(name)).sort()) {
    const oldEntry = beforeMap.get(entryPath);
    const newEntry = afterMap.get(entryPath);
    if (oldEntry.kind !== newEntry.kind) {
      typeChanged.push({ path: entryPath, before: oldEntry, after: newEntry });
    } else if (contentSignature(oldEntry) !== contentSignature(newEntry)) {
      modified.push({ path: entryPath, before: oldEntry, after: newEntry, modeChanged: oldEntry.mode !== newEntry.mode });
    } else if (oldEntry.mode !== newEntry.mode) {
      modeChanged.push({ path: entryPath, before: oldEntry, after: newEntry });
    }
  }

  if (options.detectRenames || options.renames) {
    const available = new Map();
    for (const entryPath of added) {
      const signature = renameSignature(afterMap.get(entryPath));
      if (signature === null) continue;
      if (!available.has(signature)) available.set(signature, []);
      available.get(signature).push(entryPath);
    }
    const renamedFrom = new Set();
    const renamedTo = new Set();
    for (const from of deleted) {
      const oldEntry = beforeMap.get(from);
      const signature = renameSignature(oldEntry);
      const candidates = signature === null ? null : available.get(signature);
      if (!candidates || candidates.length === 0) continue;
      const to = candidates.shift();
      const newEntry = afterMap.get(to);
      renamed.push({
        from,
        to,
        kind: newEntry.kind,
        sha256: newEntry.sha256,
        modeChanged: oldEntry.mode !== newEntry.mode,
        before: oldEntry,
        after: newEntry,
      });
      renamedFrom.add(from);
      renamedTo.add(to);
    }
    deleted = deleted.filter((entryPath) => !renamedFrom.has(entryPath));
    added = added.filter((entryPath) => !renamedTo.has(entryPath));
  }

  const addChanges = added.map((entryPath) => ({ change: 'add', path: entryPath, after: afterMap.get(entryPath) }));
  const modifyChanges = modified.map((change) => ({ change: 'modify', ...change }));
  const deleteChanges = deleted.map((entryPath) => ({ change: 'delete', path: entryPath, before: beforeMap.get(entryPath) }));
  const modeChanges = modeChanged.map((change) => ({ change: 'mode', ...change }));
  const typeChanges = typeChanged.map((change) => ({ change: 'type', ...change }));
  const renameChanges = renamed.map((change) => ({ change: 'rename', path: change.to, ...change }));
  const changes = [...addChanges, ...modifyChanges, ...deleteChanges, ...modeChanges, ...typeChanges, ...renameChanges]
    .sort((left, right) => (left.path || left.from).localeCompare(right.path || right.from) || left.change.localeCompare(right.change));

  return {
    added: addChanges,
    modified: modifyChanges,
    deleted: deleteChanges,
    modeChanged: modeChanges,
    typeChanged: typeChanges,
    renamed: renameChanges,
    add: addChanges,
    modify: modifyChanges,
    delete: deleteChanges,
    mode: modeChanges,
    type: typeChanges,
    renames: renameChanges,
    changes,
    changed: changes.length > 0,
  };
}

module.exports = {
  DEFAULT_EXCLUDES,
  sha256,
  treeHash,
  treeSha256,
  snapshotTree,
  createTreeSnapshot: snapshotTree,
  diffTrees,
  diffTreeSnapshots: diffTrees,
};
