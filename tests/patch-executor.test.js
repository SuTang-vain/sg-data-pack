'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { snapshotTree } = require('../scripts/lib/sg-tree-snapshot.js');
const { parseUnifiedDiff, applyPatch } = require('../scripts/lib/sg-patch-executor.js');

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-patch-'));
  fs.mkdirSync(path.join(root, 'lib', 'data'), { recursive: true });
  fs.writeFileSync(path.join(root, 'lib', 'data', 'data.json'), '{"value":"old"}\n');
  fs.writeFileSync(path.join(root, 'README.md'), 'protected\n');
  return root;
}

function manifest(overrides = {}) {
  return {
    taskId: 'sha256:' + 'a'.repeat(64),
    filePolicy: {
      allowed: [{ pattern: 'lib/data/data.json', operations: ['modify'] }],
      forbidden: ['.git/**', 'README.md'],
      allowHardlinks: false,
      maxChangedFiles: 1,
      maxPatchBytes: 10000,
      ...overrides,
    },
    patchPolicy: { format: 'unified-diff', fuzz: 0, allowBinary: false },
  };
}

const GOOD_PATCH = Buffer.from([
  'diff --git a/lib/data/data.json b/lib/data/data.json',
  '--- a/lib/data/data.json',
  '+++ b/lib/data/data.json',
  '@@ -1 +1 @@',
  '-{"value":"old"}',
  '+{"value":"new"}',
  '',
].join('\n'));

test('patch executor applies an exact allowed patch and records before/after tree digests', () => {
  const root = workspace();
  try {
    const result = applyPatch({ manifest: manifest(), workspaceRoot: root, patchBytes: GOOD_PATCH });
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'lib/data/data.json'), 'utf8')).value, 'new');
    assert.equal(result.audit.status, 'applied');
    assert.notEqual(result.audit.beforeTreeSha256, result.audit.afterTreeSha256);
    assert.deepEqual(result.audit.actualOperations.map((item) => `${item.operation}:${item.path}`), ['modify:lib/data/data.json']);
    assert.equal(result.audit.capabilities.osSandbox, false);
    assert.match(result.audit.auditId, /^patch-audit:[0-9a-f]{64}$/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('forbidden patch is rejected before apply and keeps the workspace byte-identical', () => {
  const root = workspace();
  const before = snapshotTree(root).treeSha256;
  const patch = Buffer.from([
    'diff --git a/README.md b/README.md',
    '--- a/README.md', '+++ b/README.md', '@@ -1 +1 @@', '-protected', '+changed', '',
  ].join('\n'));
  try {
    assert.throws(() => applyPatch({ manifest: manifest(), workspaceRoot: root, patchBytes: patch }), (error) => {
      assert.equal(error.kind, 'policy-violation');
      assert.equal(error.audit.status, 'rejected');
      assert.ok(error.audit.preflight.violations.some((item) => /forbidden/.test(item)));
      return true;
    });
    assert.equal(snapshotTree(root).treeSha256, before);
    assert.equal(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), 'protected\n');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('stale hunk fails git apply check without changing the workspace', () => {
  const root = workspace();
  const before = snapshotTree(root).treeSha256;
  const stale = Buffer.from(GOOD_PATCH.toString('utf8').replace('"old"', '"missing"'));
  try {
    assert.throws(() => applyPatch({ manifest: manifest(), workspaceRoot: root, patchBytes: stale }), (error) => {
      assert.equal(error.kind, 'patch-invalid');
      assert.equal(error.audit.commands.check.exitCode, 1);
      return true;
    });
    assert.equal(snapshotTree(root).treeSha256, before);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('allowed add cannot introduce an executable file mode', () => {
  const root = workspace();
  const executable = Buffer.from([
    'diff --git a/lib/data/new.sh b/lib/data/new.sh',
    'new file mode 100755',
    '--- /dev/null',
    '+++ b/lib/data/new.sh',
    '@@ -0,0 +1 @@',
    '+echo unsafe',
    '',
  ].join('\n'));
  try {
    assert.throws(() => applyPatch({
      manifest: manifest({ allowed: [{ pattern: 'lib/data/new.sh', operations: ['add'] }] }),
      workspaceRoot: root,
      patchBytes: executable,
    }), (error) => error.kind === 'policy-not-supported' && /100755/.test(error.message));
    assert.equal(fs.existsSync(path.join(root, 'lib', 'data', 'new.sh')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('patch parser rejects traversal, binary patches, renames, and duplicate file entries', () => {
  assert.throws(() => parseUnifiedDiff('diff --git a/../secret b/../secret\n--- a/../secret\n+++ b/../secret\n@@ -1 +1 @@\n-a\n+b\n'), /parent traversal/);
  assert.throws(() => parseUnifiedDiff('GIT binary patch\n'), (error) => error.kind === 'policy-not-supported');
  assert.throws(() => parseUnifiedDiff('diff --git a/a b/b\nrename from a\nrename to b\n'), (error) => error.kind === 'policy-not-supported');
  assert.throws(() => parseUnifiedDiff(GOOD_PATCH.toString('utf8') + GOOD_PATCH.toString('utf8')), /duplicate file entries/);
});
