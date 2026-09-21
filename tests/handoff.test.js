'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');

test('handoff verifier documents its offline scope and rejects unknown arguments', () => {
  const verifier = path.join(ROOT, 'scripts', 'verify-handoff.js');
  const help = spawnSync(process.execPath, [verifier, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Offline/);
  const invalid = spawnSync(process.execPath, [verifier, '--run-provider'], { encoding: 'utf8' });
  assert.equal(invalid.status, 2, invalid.stderr);
});

test('every historical TaskRun artifact is tracked so a clean clone can be audited', () => {
  const tracked = new Set(execFileSync('git', ['ls-files', '--cached', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0'));
  const missing = [];
  let checked = 0;
  for (const name of ['scripted', 'claude']) {
    const resultRoot = `research/agent-eval/results/${name}`;
    const report = JSON.parse(fs.readFileSync(path.join(ROOT, resultRoot, 'experiment.json'), 'utf8'));
    for (const trial of report.trials) {
      if (!trial.runId) continue;
      const runPath = path.posix.join(resultRoot, trial.artifactPath);
      const run = JSON.parse(fs.readFileSync(path.join(ROOT, runPath), 'utf8'));
      for (const artifact of run.artifacts) {
        const file = path.posix.join(path.posix.dirname(runPath), artifact.path);
        if (!tracked.has(file)) missing.push(file);
        checked += 1;
      }
    }
  }
  assert.ok(checked > 0, 'expected saved evidence to be checked');
  assert.deepEqual(missing, [], 'Evidence must be committed, not merely present in a local ignored directory');
});
