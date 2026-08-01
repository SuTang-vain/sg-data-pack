'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateGraderSpec, gradeWorkspace } = require('../scripts/lib/sg-grader.js');

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-grader-'));
  fs.mkdirSync(path.join(root, 'lib', 'data'), { recursive: true });
  fs.writeFileSync(path.join(root, 'lib', 'data', 'data.json'), JSON.stringify({
    schemaVersion: '1.3', meta: { id: 'grader-fixture', title: 'Grader fixture' },
    entities: { alice: { kind: 'person', name: 'Alice' } },
    aliases: { Alice: 'alice' },
    stages: [{ key: 'main', name: 'Main', entities: ['alice'] }],
  }));
  fs.writeFileSync(path.join(root, 'lib', 'data', 'rules.json'), JSON.stringify({
    rulesVersion: '1.0', libId: 'grader-fixture', profile: {},
    rules: [{ id: 'one-entity', level: 'hard', subject: 'entities.*', rule: 'one entity', source: 'observed', check: 'Object.keys(entities).length === 1' }],
  }));
  return root;
}

function spec(checks) { return { graderVersion: '1.0', graderId: 'fixture-grader', checks }; }

test('grader combines Data Pack, library rules, and command checks into one scored report', () => {
  const root = workspace();
  try {
    const report = gradeWorkspace({ workspaceRoot: root, taskId: 'sha256:' + 'a'.repeat(64), treeSha256: 'sha256:' + 'b'.repeat(64), spec: spec([
      { id: 'pack-contract', type: 'data-pack-contract', weight: 2, required: true, path: 'lib/data/data.json', strict: true },
      { id: 'library-rules', type: 'library-rules', weight: 1, required: true, rulesPath: 'lib/data/rules.json', dataPath: 'lib/data/data.json', strict: true },
      { id: 'node-check', type: 'command', weight: 1, required: true, argv: [process.execPath, '-e', 'process.exit(0)'], expectedExit: 0 },
    ]) });
    assert.equal(report.verdict, 'passed');
    assert.equal(report.score, 4);
    assert.equal(report.maximumScore, 4);
    assert.equal(report.summary.passed, 3);
    assert.match(report.gradeId, /^grade:[0-9a-f]{64}$/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('required not-assessed evidence fails the verdict without being mislabeled as a test failure', () => {
  const root = workspace();
  try {
    const report = gradeWorkspace({ workspaceRoot: root, spec: spec([
      { id: 'runtime-mount', type: 'runtime-evidence', weight: 1, required: true, path: 'artifacts/runtime.json', scenarioId: 'mount-default' },
    ]) });
    assert.equal(report.verdict, 'failed');
    assert.equal(report.results[0].status, 'not-assessed');
    assert.equal(report.summary.requiredIncomplete, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('command timeout is a candidate failure and cannot leave the valid denominator', () => {
  const root = workspace();
  try {
    const report = gradeWorkspace({ workspaceRoot: root, spec: spec([
      { id: 'timeout-check', type: 'command', weight: 1, required: true, argv: [process.execPath, '-e', 'setTimeout(function(){}, 10000)'], timeoutMs: 20 },
    ]) });
    assert.equal(report.verdict, 'failed');
    assert.equal(report.results[0].status, 'failed');
    assert.equal(report.score, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('candidate extraction process.exit is contained in a worker and graded as failed', () => {
  const root = workspace();
  try {
    fs.writeFileSync(path.join(root, 'extract.config.js'), 'process.exit(7);\n');
    const report = gradeWorkspace({ workspaceRoot: root, spec: spec([
      { id: 'extract-check', type: 'extract-equivalence', weight: 1, required: true, configPath: 'extract.config.js', timeoutMs: 1000 },
    ]) });
    assert.equal(report.verdict, 'failed');
    assert.equal(report.results[0].status, 'failed');
    assert.equal(report.results[0].evidence.exitCode, 1);
    assert.equal(report.results[0].evidence.supervisor.workerExitCode, 7);
    assert.equal(report.results[0].evidence.supervisor.protocolOk, false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('candidate cannot forge a passing extraction result through stdout', () => {
  const root = workspace();
  try {
    const forged = { ok: true, validation: { errors: [], warnings: [] }, equivalence: { diffs: [], coverage: { complete: true } }, consumedFiles: {} };
    fs.writeFileSync(path.join(root, 'extract.config.js'), `process.stdout.write('SG_EXTRACTION_RESULT:' + ${JSON.stringify(JSON.stringify(forged))} + '\\n'); process.exit(0);\n`);
    const report = gradeWorkspace({ workspaceRoot: root, spec: spec([
      { id: 'extract-check', type: 'extract-equivalence', weight: 1, required: true, configPath: 'extract.config.js', timeoutMs: 1000 },
    ]) });
    assert.equal(report.verdict, 'failed');
    assert.equal(report.results[0].status, 'failed');
    assert.equal(report.results[0].evidence.supervisor.protocolOk, false);
    assert.equal(report.results[0].evidence.supervisor.subjectStdoutBytes > 0, true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('grader spec rejects unknown fields, duplicate ids, and shell-string commands', () => {
  const result = validateGraderSpec({ graderVersion: '1.0', graderId: 'fixture-grader', unknown: true, checks: [
    { id: 'same-id', type: 'command', weight: 1, required: true, argv: 'node test.js' },
    { id: 'same-id', type: 'unknown', weight: 1, required: true },
  ] });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => /unknown grader field/.test(error)));
  assert.ok(result.errors.some((error) => /duplicate/.test(error)));
  assert.ok(result.errors.some((error) => /argv/.test(error)));
});
