'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { runCommand } = require('../scripts/lib/sg-command-runner.js');

function tempDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-command-runner-'));
}

function cleanup(directory) {
  fs.rmSync(directory, { recursive: true, force: true });
}

test('runner executes argv without a shell and returns structured success output', () => {
  const root = tempDirectory();
  try {
    const result = runCommand([process.execPath, '-e', 'process.stdout.write(process.argv[1])', 'hello world'], {
      allowedRoot: root,
      cwd: root,
      envAllowlist: ['PATH'],
    });
    assert.equal(result.exit, 0);
    assert.equal(result.signal, null);
    assert.equal(result.timedOut, false);
    assert.equal(result.stdout, 'hello world');
    assert.equal(result.stderr, '');
    assert.equal(result.truncated, false);
    assert.equal(typeof result.duration, 'number');
  } finally {
    cleanup(root);
  }
});

test('runner accepts the structured object API and reports compatibility fields', () => {
  const root = tempDirectory();
  try {
    const result = runCommand({
      argv: [process.execPath, '-e', 'process.stdout.write("ok")'],
      cwd: root,
      allowedRoot: root,
      timeoutMs: 1000,
      maxOutputBytes: 64,
      envAllowlist: ['PATH'],
    });
    assert.deepEqual(result.argv, [process.execPath, '-e', 'process.stdout.write("ok")']);
    assert.equal(result.cwd, fs.realpathSync(root));
    assert.equal(result.status, 0);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, 'ok');
    assert.equal(result.stdoutTruncated, false);
    assert.equal(result.stderrTruncated, false);
    assert.equal(typeof result.durationMs, 'number');
    assert.equal(result.error, undefined);
  } finally {
    cleanup(root);
  }
});

test('runner does not interpret shell metacharacters', () => {
  const root = tempDirectory();
  try {
    const result = runCommand([process.execPath, '-e', 'process.stdout.write(process.argv[1])', 'a; touch created-by-shell'], {
      allowedRoot: root,
      cwd: root,
    });
    assert.equal(result.exit, 0);
    assert.equal(result.stdout, 'a; touch created-by-shell');
    assert.equal(fs.existsSync(path.join(root, 'created-by-shell')), false);
  } finally {
    cleanup(root);
  }
});

test('runner rejects cwd outside allowed root and rejects non-array argv', () => {
  const root = tempDirectory();
  const outside = tempDirectory();
  try {
    assert.throws(() => runCommand([process.execPath, '-e', ''], { allowedRoot: root, cwd: outside }), /outside allowed root/);
    assert.throws(() => runCommand('node', { allowedRoot: root, cwd: root }), /argv must be a non-empty array/);
    assert.throws(() => runCommand([process.execPath, '-e', ''], { allowedRoot: root, cwd: root, envAllowlist: ['BAD-NAME'] }), /environment variable names/);
  } finally {
    cleanup(root);
    cleanup(outside);
  }
});

test('runner preserves nonzero exit status and stderr', () => {
  const root = tempDirectory();
  try {
    const result = runCommand([process.execPath, '-e', 'process.stderr.write("bad"); process.exit(7)'], {
      allowedRoot: root,
      cwd: root,
    });
    assert.equal(result.exit, 7);
    assert.equal(result.signal, null);
    assert.equal(result.timedOut, false);
    assert.equal(result.stderr, 'bad');
  } finally {
    cleanup(root);
  }
});

test('runner reports timeout and does not hang', () => {
  const root = tempDirectory();
  try {
    const result = runCommand([process.execPath, '-e', 'setTimeout(() => {}, 5000)'], {
      allowedRoot: root,
      cwd: root,
      timeout: 50,
    });
    assert.equal(result.exit, null);
    assert.equal(result.timedOut, true);
    assert.equal(result.signal, 'SIGTERM');
  } finally {
    cleanup(root);
  }
});

test('runner bounds output and marks truncation', () => {
  const root = tempDirectory();
  try {
    const result = runCommand([process.execPath, '-e', 'process.stdout.write("x".repeat(10000))'], {
      allowedRoot: root,
      cwd: root,
      maxBuffer: 128,
    });
    assert.equal(result.exit, null);
    assert.equal(result.truncated, true);
    assert.equal(Buffer.byteLength(result.stdout), 128);
  } finally {
    cleanup(root);
  }
});

test('runner applies an environment allowlist', () => {
  const root = tempDirectory();
  try {
    const result = runCommand([process.execPath, '-e', 'process.stdout.write(JSON.stringify({allowed:process.env.SG_ALLOWED, blocked:process.env.SG_BLOCKED}))'], {
      allowedRoot: root,
      cwd: root,
      env: { SG_ALLOWED: 'yes', SG_BLOCKED: 'no' },
      envAllowlist: ['PATH', 'SG_ALLOWED'],
    });
    assert.equal(result.exit, 0);
    assert.deepEqual(JSON.parse(result.stdout), { allowed: 'yes' });
  } finally {
    cleanup(root);
  }
});
