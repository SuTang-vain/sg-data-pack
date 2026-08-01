'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const {
  snapshotTree,
  treeHash,
  diffTrees,
} = require('../scripts/lib/sg-tree-snapshot.js');

function tempTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-tree-snapshot-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, '.git'));
  fs.writeFileSync(path.join(root, 'src', 'app.js'), 'one');
  fs.writeFileSync(path.join(root, 'src', 'same.txt'), 'same');
  fs.writeFileSync(path.join(root, '.git', 'ignored'), 'not in snapshot');
  return root;
}

function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

function entry(snapshot, relativePath) {
  return snapshot.entries.find((item) => item.path === relativePath);
}

test('snapshot records files, directories, symlinks and excludes .git by default', (t) => {
  const root = tempTree();
  try {
    const linkPath = path.join(root, 'src', 'app-link.js');
    try {
      fs.symlinkSync('app.js', linkPath);
    } catch (error) {
      t.skip(`symlinks unavailable: ${error.message}`);
      return;
    }
    const snapshot = snapshotTree(root);
    assert.equal(snapshot.root, fs.realpathSync(root));
    assert.equal(entry(snapshot, 'src').kind, 'directory');
    assert.equal(entry(snapshot, 'src/app.js').kind, 'file');
    assert.equal(entry(snapshot, 'src/app.js').size, 3);
    assert.match(entry(snapshot, 'src/app.js').sha256, /^[a-f0-9]{64}$/);
    assert.deepEqual({
      kind: entry(snapshot, 'src/app-link.js').kind,
      target: entry(snapshot, 'src/app-link.js').target,
      size: entry(snapshot, 'src/app-link.js').size,
    }, { kind: 'symlink', target: 'app.js', size: 6 });
    assert.equal(entry(snapshot, '.git'), undefined);
    assert.match(snapshot.treeSha256, /^[a-f0-9]{64}$/);
  } finally {
    cleanup(root);
  }
});

test('tree hash is deterministic and configurable excludes affect the tree', () => {
  const first = tempTree();
  const second = tempTree();
  try {
    const a = snapshotTree(first);
    const b = snapshotTree(second);
    assert.equal(a.treeSha256, b.treeSha256);
    assert.equal(treeHash(a.entries), a.treeSha256);
    fs.writeFileSync(path.join(second, 'ignored.log'), 'ignored');
    assert.notEqual(snapshotTree(second).treeSha256, a.treeSha256);
    assert.equal(snapshotTree(second, { exclude: ['.git', '.git/**', '**/*.log'] }).treeSha256, a.treeSha256);
    assert.equal(snapshotTree(first, { exclude: false }).entries.some((item) => item.path === '.git/ignored'), true);
  } finally {
    cleanup(first);
    cleanup(second);
  }
});

test('tree diff identifies add, modify, delete, mode and type changes', () => {
  const before = {
    entries: [
      { path: 'same.txt', kind: 'file', mode: 0o644, sha256: 'same', size: 4, target: null },
      { path: 'changed.txt', kind: 'file', mode: 0o644, sha256: 'old', size: 3, target: null },
      { path: 'deleted.txt', kind: 'file', mode: 0o644, sha256: 'gone', size: 4, target: null },
      { path: 'mode.txt', kind: 'file', mode: 0o644, sha256: 'mode', size: 4, target: null },
      { path: 'type.txt', kind: 'file', mode: 0o644, sha256: 'type', size: 4, target: null },
    ],
  };
  const after = {
    entries: [
      { path: 'same.txt', kind: 'file', mode: 0o644, sha256: 'same', size: 4, target: null },
      { path: 'changed.txt', kind: 'file', mode: 0o644, sha256: 'new', size: 3, target: null },
      { path: 'added.txt', kind: 'file', mode: 0o644, sha256: 'new-file', size: 8, target: null },
      { path: 'mode.txt', kind: 'file', mode: 0o755, sha256: 'mode', size: 4, target: null },
      { path: 'type.txt', kind: 'directory', mode: 0o755, sha256: null, size: 0, target: null },
    ],
  };
  const diff = diffTrees(before, after);
  assert.equal(diff.changed, true);
  assert.equal(diff.added[0].path, 'added.txt');
  assert.equal(diff.modified[0].path, 'changed.txt');
  assert.equal(diff.deleted[0].path, 'deleted.txt');
  assert.equal(diff.modeChanged[0].path, 'mode.txt');
  assert.equal(diff.typeChanged[0].path, 'type.txt');
  assert.deepEqual(diff.changes.map((change) => change.change).sort(), ['add', 'delete', 'mode', 'modify', 'type']);
});

test('tree diff optionally detects content-identical file renames', () => {
  const before = { entries: [{ path: 'old.txt', kind: 'file', mode: 0o644, sha256: 'hash', size: 4, target: null }] };
  const after = { entries: [{ path: 'new.txt', kind: 'file', mode: 0o644, sha256: 'hash', size: 4, target: null }] };
  const withoutRename = diffTrees(before, after);
  assert.equal(withoutRename.renamed.length, 0);
  assert.equal(withoutRename.added.length, 1);
  const withRename = diffTrees(before, after, { detectRenames: true });
  assert.equal(withRename.renamed.length, 1);
  assert.deepEqual({ from: withRename.renamed[0].from, to: withRename.renamed[0].to }, { from: 'old.txt', to: 'new.txt' });
  assert.equal(withRename.added.length, 0);
  assert.equal(withRename.deleted.length, 0);
});
