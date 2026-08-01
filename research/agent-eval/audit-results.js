#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../..');
const { contentId, sha256Bytes, stableJson } = require(path.join(ROOT, 'scripts/lib/sg-evidence-utils.js'));
const { validateExperimentSpec, aggregate } = require(path.join(ROOT, 'scripts/lib/sg-experiment.js'));
const { validateTaskManifest } = require(path.join(ROOT, 'scripts/lib/agent-task-manifest.js'));
const { readRuntimeEvidence } = require(path.join(ROOT, 'scripts/lib/sg-runtime-evidence.js'));
const { readVisualEvidence } = require(path.join(ROOT, 'scripts/lib/sg-visual-evidence.js'));
const { snapshotTree } = require(path.join(ROOT, 'scripts/lib/sg-tree-snapshot.js'));

function assert(condition, message) { if (!condition) throw new Error(message); }
function equal(left, right, message) { assert(stableJson(left) === stableJson(right), message); }

for (const task of ['field-update', 'alias-relation', 'pattern-c-runtime']) {
  const file = path.join(__dirname, 'tasks', task, 'task.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  const result = validateTaskManifest(manifest, { taskFile: file, verifyFiles: true, verifyTree: true });
  assert(result.valid, `${task} manifest: ${JSON.stringify(result.issues)}`);
}

let taskRuns = 0;
let artifacts = 0;
for (const name of ['scripted', 'claude']) {
  const resultRoot = path.join(__dirname, 'results', name);
  const reportFile = path.join(resultRoot, 'experiment.json');
  const rawFile = path.join(resultRoot, 'experiment.raw.json');
  const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  const raw = JSON.parse(fs.readFileSync(rawFile, 'utf8'));
  const specFile = path.join(__dirname, name === 'scripted' ? 'experiment-scripted.json' : 'experiment-claude.json');
  const specBytes = fs.readFileSync(specFile);
  const spec = JSON.parse(specBytes);
  const validation = validateExperimentSpec(spec);
  assert(validation.valid, `${name} spec: ${validation.errors.join('; ')}`);
  assert(report.resultId === contentId('experiment-result', report, ['resultId']), `${name} relocated resultId`);
  assert(raw.resultId === contentId('experiment-result', raw, ['resultId']), `${name} raw resultId`);
  assert(report.specSha256 === sha256Bytes(specBytes), `${name} spec digest`);
  assert(report.taskSetSha256 === sha256Bytes(stableJson(spec.tasks)), `${name} task-set digest`);
  equal(report.summary, aggregate(report.trials, spec.agent.kind), `${name} aggregate`);
  equal(report.summary, raw.summary, `${name} summary changed during relocation`);
  const audit = JSON.parse(fs.readFileSync(path.join(resultRoot, 'relocation-audit.json'), 'utf8'));
  assert(audit.auditId === contentId('relocation-audit', audit, ['auditId']), `${name} relocation auditId`);
  assert(audit.raw.resultId === raw.resultId && audit.relocated.resultId === report.resultId, `${name} relocation ids`);
  assert(audit.raw.sha256 === sha256Bytes(fs.readFileSync(rawFile)), `${name} raw relocation digest`);
  assert(audit.relocated.sha256 === sha256Bytes(fs.readFileSync(reportFile)), `${name} relocated digest`);
  for (const trial of report.trials) {
    if (!trial.runId) continue;
    assert(trial.artifactPath === `trials/${trial.trialId}/task-run.json`, `${trial.trialId} non-portable artifactPath`);
    const runFile = path.join(resultRoot, trial.artifactPath);
    const run = JSON.parse(fs.readFileSync(runFile, 'utf8'));
    taskRuns += 1;
    assert(run.runId === trial.runId && run.runId === contentId('task-run', run, ['runId']), `${trial.trialId} runId`);
    assert(run.task.sourceUnchanged, `${trial.trialId} source drift`);
    for (const artifact of run.artifacts) {
      const file = path.resolve(path.dirname(runFile), artifact.path);
      const relative = path.relative(path.dirname(runFile), file);
      assert(relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), `${trial.trialId} artifact escape`);
      assert(sha256Bytes(fs.readFileSync(file)) === artifact.sha256, `${trial.trialId} artifact ${artifact.path}`);
      artifacts += 1;
    }
    if (run.patch) assert(run.patch.auditId === contentId('patch-audit', run.patch, ['auditId']), `${trial.trialId} patch auditId`);
    for (const grade of run.grades) assert(grade.gradeId === contentId('grade', grade, ['gradeId']), `${trial.trialId} gradeId`);
    const runtimeFile = path.join(path.dirname(runFile), 'runtime-evidence.json');
    if (fs.existsSync(runtimeFile)) assert(readRuntimeEvidence(runtimeFile).validation.status === 'passed', `${trial.trialId} runtime evidence`);
    const visualFile = path.join(path.dirname(runFile), 'visual-evidence.json');
    if (fs.existsSync(visualFile)) assert(readVisualEvidence(visualFile).validation.status === 'passed', `${trial.trialId} visual evidence`);
  }
  console.log(`${name}: ${report.summary.passed}/${report.summary.validTrials} valid passes; ${report.summary.claimLevel}`);
}

const policy = JSON.parse(fs.readFileSync(path.join(__dirname, 'results', 'policy-negative', 'result.json'), 'utf8'));
assert(policy.verdict === 'policy-violation' && policy.sourceUnchanged, 'policy negative control');
const tooling = JSON.parse(fs.readFileSync(path.join(__dirname, 'results', 'executed-tooling', 'execution-bundle.json'), 'utf8'));
const toolingTree = 'sha256:' + snapshotTree(path.join(__dirname, 'results', 'executed-tooling', 'scripts'), { errorOnSpecialFile: true, exclude: false }).treeSha256;
assert(tooling.scriptsTreeSha256 === toolingTree, 'executed tooling tree digest');
console.log(`verified ${taskRuns} TaskRuns, ${artifacts} artifacts, relocation audits, evidence, policy control, and executed tooling`);
