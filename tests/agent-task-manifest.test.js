'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const {
  canonicalJson,
  computeTaskId,
  computeTreeSha256,
  readTaskManifest,
  sha256,
  validateTaskManifest,
} = require('../scripts/lib/agent-task-manifest.js');

const FIXTURE = path.join(__dirname, 'fixtures', 'agent-tasks', 'ready');
const TASK_FILE = path.join(FIXTURE, 'task.json');

function fixtureManifest() {
  return JSON.parse(fs.readFileSync(TASK_FILE, 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validation(manifest, options = {}) {
  return validateTaskManifest(manifest, { taskFile: TASK_FILE, ...options });
}

test('ready manifest is valid, read-only, and has stable canonical identity', () => {
  const manifest = fixtureManifest();
  const before = JSON.stringify(manifest);
  const result = validation(manifest, { verifyFiles: true, verifyTree: true });
  assert.equal(result.valid, true, result.issues.map((item) => `${item.path}: ${item.message}`).join('\n'));
  assert.equal(result.taskId, computeTaskId(manifest));
  assert.equal(result.sourceRoot, path.join(FIXTURE, 'source'));
  assert.equal(readTaskManifest(TASK_FILE).taskId, manifest.taskId);
  assert.equal(JSON.stringify(manifest), before);
  assert.equal(canonicalJson({ b: { d: 2, c: 1 }, a: 0 }), '{"a":0,"b":{"c":1,"d":2}}');
  assert.equal(computeTreeSha256(path.join(FIXTURE, 'source')), manifest.source.treeSha256);
});

test('taskId tampering is rejected and can be recomputed', () => {
  const manifest = fixtureManifest();
  manifest.taskId = sha256('tampered');
  const result = validation(manifest);
  assert.equal(result.valid, false);
  assert.match(result.issues.find((item) => item.path === 'taskId').message, /does not match canonical/);
  assert.equal(computeTaskId(manifest), fixtureManifest().taskId);
});

test('stale input digest is rejected when files are verified', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-task-stale-'));
  try {
    const taskFile = path.join(directory, 'task.json');
    const source = path.join(directory, 'source');
    fs.mkdirSync(source);
    fs.copyFileSync(path.join(FIXTURE, 'source', 'input.txt'), path.join(source, 'input.txt'));
    const manifest = fixtureManifest();
    manifest.source.root = 'source';
    manifest.source.treeSha256 = sha256('not-the-new-tree');
    manifest.inputs[0].sha256 = sha256('not-the-file');
    manifest.taskId = computeTaskId(manifest);
    fs.writeFileSync(taskFile, JSON.stringify(manifest));
    const result = validateTaskManifest(manifest, { taskFile, verifyFiles: true });
    assert.equal(result.valid, false);
    assert.match(result.issues.find((item) => item.path === 'inputs[0].sha256').message, /stale/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('stale grader spec or hidden grader tree is rejected when files are verified', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-task-grader-stale-'));
  try {
    fs.cpSync(FIXTURE, directory, { recursive: true });
    const taskFile = path.join(directory, 'task.json');
    const manifest = JSON.parse(fs.readFileSync(taskFile, 'utf8'));
    fs.appendFileSync(path.join(directory, 'grader', 'spec.json'), '\n');
    let result = validateTaskManifest(manifest, { taskFile, verifyFiles: true });
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((item) => item.path === 'graders[0].sha256' && /stale/.test(item.message)));
    fs.writeFileSync(path.join(directory, 'grader', 'spec.json'), fs.readFileSync(path.join(FIXTURE, 'grader', 'spec.json')));
    fs.writeFileSync(path.join(directory, 'grader', 'hidden.txt'), 'changed hidden reference');
    result = validateTaskManifest(manifest, { taskFile, verifyFiles: true });
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((item) => item.path === 'graders[0].treeSha256' && /stale/.test(item.message)));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('absolute, traversal, NUL, and backslash paths are rejected', () => {
  const cases = [
    ['/absolute.txt', 'must be a relative path'],
    ['../escape.txt', 'must not contain .. path segments'],
    ['dir/../escape.txt', 'must not contain .. path segments'],
    ['bad\\path.txt', 'must use POSIX separators'],
    ['bad\u0000path.txt', 'must not contain NUL'],
  ];
  for (const [badPath, expected] of cases) {
    const manifest = fixtureManifest();
    manifest.inputs[0].path = badPath;
    manifest.taskId = computeTaskId(manifest);
    const result = validation(manifest);
    assert.equal(result.valid, false, badPath);
    assert.ok(result.issues.some((item) => item.path === 'inputs[0].path' && item.message.includes(expected)), `${badPath}: ${JSON.stringify(result.issues)}`);
  }
});

test('missing digests and duplicate ids/patterns are rejected', () => {
  const missingDigest = fixtureManifest();
  delete missingDigest.inputs[0].sha256;
  missingDigest.taskId = computeTaskId(missingDigest);
  const digestResult = validation(missingDigest);
  assert.ok(digestResult.issues.some((item) => item.path === 'inputs[0].sha256' && item.message.includes('sha256')));

  const duplicateId = fixtureManifest();
  duplicateId.inputs.push(clone(duplicateId.inputs[0]));
  duplicateId.taskId = computeTaskId(duplicateId);
  const idResult = validation(duplicateId);
  assert.ok(idResult.issues.some((item) => item.path === 'inputs[1].id' && item.message.includes('duplicate id')));

  const duplicateGraderId = fixtureManifest();
  duplicateGraderId.graders.push(clone(duplicateGraderId.graders[0]));
  duplicateGraderId.taskId = computeTaskId(duplicateGraderId);
  const graderIdResult = validation(duplicateGraderId);
  assert.ok(graderIdResult.issues.some((item) => item.path === 'graders[1].id' && item.message.includes('duplicate id')));

  const duplicatePattern = fixtureManifest();
  duplicatePattern.filePolicy.allowed.push(clone(duplicatePattern.filePolicy.allowed[0]));
  duplicatePattern.taskId = computeTaskId(duplicatePattern);
  const patternResult = validation(duplicatePattern);
  assert.ok(patternResult.issues.some((item) => item.path === 'filePolicy.allowed[1].pattern' && item.message.includes('duplicate pattern')));
});

test('unknown top-level fields are rejected', () => {
  const manifest = fixtureManifest();
  manifest.notPartOfV1 = true;
  manifest.taskId = computeTaskId(manifest);
  const result = validation(manifest);
  assert.ok(result.issues.some((item) => item.path === '$.notPartOfV1' && item.message === 'unknown field'));
  assert.equal(result.valid, false);
});

test('resource and locked-down policy bounds are enforced', () => {
  const cases = [
    ['execution.timeoutMs', 0],
    ['execution.timeoutMs', 86400001],
    ['execution.maxOutputBytes', 0],
    ['execution.maxOutputBytes', 1073741825],
    ['filePolicy.maxChangedFiles', -1],
    ['filePolicy.maxPatchBytes', 1073741825],
  ];
  for (const [field, value] of cases) {
    const manifest = fixtureManifest();
    const [section, key] = field.split('.');
    manifest[section][key] = value;
    manifest.taskId = computeTaskId(manifest);
    const result = validation(manifest);
    assert.ok(result.issues.some((item) => item.path === field), `${field}: ${JSON.stringify(result.issues)}`);
  }
  for (const [field, value] of [
    ['filePolicy.denyPrecedence', false],
    ['filePolicy.allowSymlinks', true],
    ['filePolicy.allowHardlinks', true],
    ['patchPolicy.fuzz', 1],
    ['patchPolicy.allowBinary', true],
    ['execution.network', 'on'],
  ]) {
    const manifest = fixtureManifest();
    const [section, key] = field.split('.');
    manifest[section][key] = value;
    manifest.taskId = computeTaskId(manifest);
    const result = validation(manifest);
    assert.ok(result.issues.some((item) => item.path === field), `${field}: ${JSON.stringify(result.issues)}`);
  }
});
