'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const policy = require('../scripts/lib/sg-path-policy.js');

function tempTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-path-policy-'));
  fs.mkdirSync(path.join(root, 'inside'));
  fs.writeFileSync(path.join(root, 'inside', 'file.txt'), 'same');
  return root;
}

function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

test('safeRelativePath rejects absolute paths and traversal in both separator styles', () => {
  assert.throws(() => policy.safeRelativePath('../outside'), (error) => error.code === 'UNSAFE_RELATIVE_PATH');
  assert.throws(() => policy.safeRelativePath('a/../../outside'), /parent traversal/);
  assert.throws(() => policy.safeRelativePath('..\\outside'), /parent traversal/);
  assert.throws(() => policy.safeRelativePath('/tmp/outside'), /must be relative/);
  assert.throws(() => policy.safeRelativePath('C:\\outside'), /must be relative/);
  assert.equal(policy.safeRelativePath('a\\b.txt'), 'a/b.txt');
  assert.equal(policy.isSafeRelativePath('../outside'), false);
});

test('root containment canonicalizes symlink aliases and rejects escapes', (t) => {
  const root = tempTree();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-path-outside-'));
  try {
    fs.writeFileSync(path.join(outside, 'outside.txt'), 'outside');
    assert.equal(policy.isWithinRoot(root, path.join(root, 'inside', 'file.txt')), true);
    assert.equal(policy.isWithinRoot(root, path.join(outside, 'outside.txt')), false);
    assert.throws(() => policy.assertWithinRoot(root, path.join(outside, 'outside.txt')), /outside allowed root/);
    const alias = path.join(outside, 'root-alias');
    try {
      fs.symlinkSync(root, alias, 'dir');
    } catch (error) {
      t.skip(`symlinks unavailable: ${error.message}`);
      return;
    }
    assert.equal(policy.isWithinRoot(root, path.join(alias, 'inside', 'file.txt')), true);
    assert.equal(policy.canonicalPath(path.join(alias, 'inside', 'file.txt')), policy.canonicalPath(path.join(root, 'inside', 'file.txt')));
  } finally {
    cleanup(root);
    cleanup(outside);
  }
});

test('sameFile identifies canonical aliases and hard links, but not distinct files', (t) => {
  const root = tempTree();
  try {
    const original = path.join(root, 'inside', 'file.txt');
    const hardLink = path.join(root, 'inside', 'hard-link.txt');
    const alias = path.join(root, 'inside', 'alias.txt');
    fs.linkSync(original, hardLink);
    assert.equal(policy.sameFile(original, hardLink), true);
    try {
      fs.symlinkSync(original, alias);
    } catch (error) {
      t.skip(`symlinks unavailable: ${error.message}`);
      return;
    }
    assert.equal(policy.sameFile(original, alias), true);
    assert.equal(policy.sameFile(original, path.join(root, 'inside', 'missing.txt')), false);
  } finally {
    cleanup(root);
  }
});

test('symlink component checks detect a link in an existing parent', (t) => {
  const root = tempTree();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-path-link-target-'));
  try {
    const link = path.join(root, 'linked');
    try {
      fs.symlinkSync(outside, link, 'dir');
    } catch (error) {
      t.skip(`symlinks unavailable: ${error.message}`);
      return;
    }
    assert.equal(policy.hasSymlinkComponent(path.join(link, 'new.txt'), { root }), true);
    assert.equal(policy.symlinkComponent(path.join(link, 'new.txt'), { root }), link);
    assert.throws(() => policy.assertNoSymlinkComponents(path.join(link, 'new.txt'), { root }), /symlink component/);
    assert.equal(policy.hasSymlinkComponent(path.join(root, 'inside', 'file.txt'), { root }), false);
  } finally {
    cleanup(root);
    cleanup(outside);
  }
});

test('glob allow and deny policies support * and ** with deny precedence', () => {
  assert.equal(policy.matchesGlob('src/app.js', 'src/*.js'), true);
  assert.equal(policy.matchesGlob('src/lib/app.js', 'src/*.js'), false);
  assert.equal(policy.matchesGlob('src/lib/app.js', 'src/**/*.js'), true);
  assert.equal(policy.matchesGlob('src/app.js', '**/*.js'), true);
  assert.deepEqual(policy.evaluateGlobPolicy('build/debug/app.js', {
    allow: ['build/**'],
    deny: ['build/debug/**'],
  }), {
    allowed: false,
    path: 'build/debug/app.js',
    deniedBy: 'build/debug/**',
    allowedBy: null,
  });
  assert.equal(policy.isPathAllowed('src/app.js', { allow: ['src/**'], deny: ['**/*.map'] }), true);
  assert.equal(policy.isPathAllowed('src/app.map', { allow: ['src/**'], deny: ['**/*.map'] }), false);
});

test('operationPolicy combines root containment with operation-specific glob rules', () => {
  const root = tempTree();
  try {
    const operations = policy.operationPolicy({
      root,
      operations: {
        read: { allow: ['inside/**'], deny: ['**/*.secret'] },
        write: { allow: ['inside/**'] },
      },
    });
    assert.equal(operations.isAllowed('read', path.join(root, 'inside', 'file.txt')), true);
    assert.equal(operations.isAllowed('read', path.join(root, 'inside', 'file.secret')), false);
    assert.throws(() => operations.assert('write', path.join(root, '..', 'outside.txt')), /outside allowed root/);
    assert.throws(() => operations.assert('read', path.join(root, 'inside', 'file.secret')), /not allowed/);
  } finally {
    cleanup(root);
  }
});
