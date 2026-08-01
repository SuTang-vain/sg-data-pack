'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { contentId, sha256Bytes } = require('../scripts/lib/sg-evidence-utils.js');
const { snapshotTree } = require('../scripts/lib/sg-tree-snapshot.js');
const { wilson, validateExperimentSpec, aggregate, runExperiment } = require('../scripts/lib/sg-experiment.js');

const ROOT = path.join(__dirname, '..');
const TASK = path.join(ROOT, 'research', 'agent-eval', 'tasks', 'field-update');
const AGENT = path.join(ROOT, 'research', 'agent-eval', 'providers', 'scripted-patch-agent.js');

function withId(spec) {
  const material = { ...spec }; delete material.experimentId;
  spec.experimentId = contentId('experiment', material, []);
  return spec;
}

test('Wilson interval and aggregate preserve denominators and harness-only claims', () => {
  const interval = wilson(8, 10);
  assert.ok(interval.lower < 0.8 && interval.upper > 0.8);
  const summary = aggregate([
    { verdict: 'passed', durationMs: 10, agentExitCode: 0, patchStatus: 'applied', gradeVerdicts: ['passed'], runtimeRequired: 0, visualRequired: 0, runtimeStatuses: [], visualStatuses: [], providerMetadata: null },
    { verdict: 'grader-failed', durationMs: 20, agentExitCode: 0, patchStatus: 'applied', gradeVerdicts: ['failed'], runtimeRequired: 1, visualRequired: 1, runtimeStatuses: ['failed'], visualStatuses: ['not-assessed'], providerMetadata: null },
    { verdict: 'infra-error', durationMs: 1, agentExitCode: null, patchStatus: null, gradeVerdicts: [], runtimeRequired: 1, visualRequired: 1, runtimeStatuses: [], visualStatuses: [], providerMetadata: null },
  ], 'scripted');
  assert.equal(summary.validTrials, 2);
  assert.equal(summary.passRate, 0.5);
  assert.deepEqual(summary.stages.runtimePassed, { passed: 0, total: 1 });
  assert.equal(summary.claimLevel, 'harness-only');

  const preconditionFailure = aggregate([
    { verdict: 'patch-invalid', durationMs: 5, agentExitCode: 0, patchStatus: 'rejected', gradeVerdicts: [], runtimeRequired: 1, visualRequired: 1, runtimeStatuses: [], visualStatuses: [], providerMetadata: null },
  ], 'ai');
  assert.deepEqual(preconditionFailure.stages.runtimePassed, { passed: 0, total: 1 });
  assert.deepEqual(preconditionFailure.stages.visualPassed, { passed: 0, total: 1 });
  assert.equal(preconditionFailure.claimLevel, 'ai-task-contract-not-demonstrated');
});

test('experiment rejects stale ids and unsafe task paths', () => {
  const spec = withId({
    experimentVersion: '1.0', experimentId: null, title: 'fixture',
    agent: { kind: 'scripted', provider: 'fixture', model: 'v1', argv: [process.execPath, '{adapter}'], adapter: { path: 'agent.js', sha256: 'sha256:' + 'a'.repeat(64) } },
    tasks: [{ id: 'one', manifest: '../escape.json' }], repetitions: 1, seed: 1,
  });
  const result = validateExperimentSpec(spec);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => /escape/.test(error)));
  spec.tasks[0].manifest = 'task/task.json';
  assert.equal(validateExperimentSpec(spec).valid, false, 'task changes make the old experimentId stale');
});

test('two experiment trials rebuild from the same immutable baseline', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-experiment-test-'));
  try {
    const taskDir = path.join(directory, 'task');
    fs.cpSync(TASK, taskDir, { recursive: true });
    const agentFile = path.join(directory, 'agent.js');
    fs.copyFileSync(AGENT, agentFile);
    const source = path.join(taskDir, 'source');
    const before = snapshotTree(source).treeSha256;
    const taskFile = path.join(taskDir, 'task.json');
    const taskManifest = JSON.parse(fs.readFileSync(taskFile, 'utf8'));
    const spec = withId({
      experimentVersion: '1.0', experimentId: null, title: 'repeat fixture',
      agent: { kind: 'scripted', provider: 'fixture', model: 'v1', argv: [process.execPath, '{adapter}', '{workspace}', '{patch}', '{prompt}'], adapter: { path: 'agent.js', sha256: sha256Bytes(fs.readFileSync(agentFile)) } },
      tasks: [{ id: 'field-update', manifest: 'task/task.json', taskId: taskManifest.taskId, manifestSha256: sha256Bytes(fs.readFileSync(taskFile)) }], repetitions: 2, seed: 'fixed',
    });
    const specFile = path.join(directory, 'experiment.json');
    fs.writeFileSync(specFile, JSON.stringify(spec, null, 2));
    const physicalOutputParent = path.join(directory, 'physical-output');
    const outputAlias = path.join(directory, 'output-alias');
    fs.mkdirSync(physicalOutputParent);
    fs.symlinkSync(physicalOutputParent, outputAlias, 'dir');
    const report = runExperiment({ specFile, outputRoot: path.join(outputAlias, 'output') });
    assert.equal(report.summary.totalTrials, 2);
    assert.equal(report.summary.passed, 2);
    assert.equal(report.summary.claimLevel, 'harness-only');
    assert.equal(snapshotTree(source).treeSha256, before);
    assert.notEqual(report.trials[0].runId, report.trials[1].runId, 'trial id and durations keep runs independently auditable');
    assert.equal(fs.existsSync(path.join(physicalOutputParent, 'output', 'EXPERIMENT.md')), true);
    for (const trial of report.trials) {
      assert.equal(trial.artifactPath, `trials/${trial.trialId}/task-run.json`);
      assert.equal(fs.existsSync(path.join(physicalOutputParent, 'output', trial.artifactPath)), true);
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
