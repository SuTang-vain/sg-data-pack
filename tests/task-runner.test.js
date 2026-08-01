'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  sha256,
  computeTaskId,
  computeTreeSha256,
} = require('../scripts/lib/agent-task-manifest.js');
const { snapshotTree } = require('../scripts/lib/sg-tree-snapshot.js');
const { runTask } = require('../scripts/lib/sg-task-runner.js');

function setup(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-task-runner-'));
  const source = path.join(root, 'source');
  fs.mkdirSync(path.join(source, 'lib', 'data'), { recursive: true });
  fs.writeFileSync(path.join(source, 'lib', 'data', 'data.json'), JSON.stringify({
    schemaVersion: '1.3', meta: { id: 'task-fixture', title: 'Task fixture' },
    entities: { alice: { kind: 'person', name: 'Alice', summary: 'old' } },
    aliases: { Alice: 'alice' }, stages: [{ key: 'main', name: 'Main', entities: ['alice'] }],
  }, null, 2) + '\n');
  const expectedSummaryArgv = options.mutatingGrader || options.failingMutatingGrader
    ? [process.execPath, '-e', `const fs=require('fs');fs.appendFileSync('./lib/data/data.json','\\n');process.exit(${options.failingMutatingGrader ? 1 : 0})`]
    : options.mutatingSourceGrader
      ? [process.execPath, '-e', `require('fs').appendFileSync(${JSON.stringify(path.join(source, 'lib', 'data', 'data.json'))},'\\n')`]
      : [process.execPath, '-e', "const p=require('./lib/data/data.json');process.exit(p.entities.alice.summary==='new'?0:1)"];
  const grader = {
    graderVersion: '1.0', graderId: 'task-fixture-grader', checks: [
      { id: 'pack-contract', type: 'data-pack-contract', weight: 1, required: true, path: 'lib/data/data.json', strict: true },
      { id: 'expected-summary', type: 'command', weight: 2, required: true, argv: expectedSummaryArgv, expectedExit: 0 },
    ],
  };

  const graderDir = path.join(root, 'grader');
  fs.mkdirSync(graderDir);
  const graderFile = path.join(graderDir, 'spec.json');
  fs.writeFileSync(graderFile, JSON.stringify(grader, null, 2));
  const instructions = 'Change Alice summary from old to new. Modify only lib/data/data.json and emit a unified diff.';
  const manifest = {
    taskVersion: '1.0', taskId: null,
    instructions: { text: instructions, sha256: sha256(instructions) },
    source: { root: 'source', revision: 'fixture-v1', treeSha256: computeTreeSha256(source) },
    inputs: [{ id: 'data-pack', path: 'lib/data/data.json', role: 'source', sha256: sha256(fs.readFileSync(path.join(source, 'lib/data/data.json'))) }],
    filePolicy: {
      allowed: [{ pattern: 'lib/data/data.json', operations: ['modify'] }], forbidden: ['.git/**'], denyPrecedence: true,
      allowSymlinks: false, allowHardlinks: false, maxChangedFiles: 1, maxPatchBytes: 20000,
    },
    patchPolicy: { format: 'unified-diff', fuzz: 0, allowBinary: false },
    graders: [{ id: 'task-grader', spec: 'grader/spec.json', sha256: sha256(fs.readFileSync(graderFile)), treeSha256: computeTreeSha256(graderDir), weight: 1 }],
    evidence: { runtime: [], visual: [] },
    execution: { timeoutMs: 30000, network: 'off', maxOutputBytes: 65536 },
  };
  manifest.taskId = computeTaskId(manifest);
  const taskFile = path.join(root, 'task.json');
  fs.writeFileSync(taskFile, JSON.stringify(manifest, null, 2) + '\n');
  return { root, source, taskFile };
}

function scriptedAgent(root, directMutation = false) {
  const file = path.join(root, directMutation ? 'mutating-agent.js' : 'patch-agent.js');
  fs.writeFileSync(file, directMutation ? `
const fs=require('fs'),path=require('path');
const [workspace,patch]=process.argv.slice(2);
const data=path.join(workspace,'lib/data/data.json');
fs.writeFileSync(data,fs.readFileSync(data,'utf8').replace('"summary": "old"','"summary": "new"'));
fs.writeFileSync(patch,'not used');
` : `
const fs=require('fs'),path=require('path');
const workspace=process.argv[2],patch=process.argv[3];
const source=fs.readFileSync(path.join(workspace,'lib/data/data.json'),'utf8').trimEnd().split('\\n');
const body=[];
for(const line of source){
  if(line.includes('"summary": "old"')){
    body.push('-'+line);
    body.push('+'+line.replace('"summary": "old"','"summary": "new"'));
  } else body.push(' '+line);
}
fs.writeFileSync(patch,[
'diff --git a/lib/data/data.json b/lib/data/data.json',
'--- a/lib/data/data.json','+++ b/lib/data/data.json',
'@@ -1,'+source.length+' +1,'+source.length+' @@',...body,''
].join('\\n'));
`);
  return file;
}

function gitMutatingAgent(root) {
  const patchAgent = scriptedAgent(root);
  const file = path.join(root, 'git-mutating-agent.js');
  fs.writeFileSync(file, `
const fs=require('fs'),path=require('path');
const workspace=process.argv[2];
fs.mkdirSync(path.join(workspace,'.git'),{recursive:true});
fs.writeFileSync(path.join(workspace,'.git','config'),'forbidden direct mutation\\n');
require(${JSON.stringify(patchAgent)});
`);
  return file;
}

test('task runner executes patch-only agent, enforces policy, grades candidate, and preserves source', () => {
  const fixture = setup();
  const before = snapshotTree(fixture.source).treeSha256;
  try {
    const agent = scriptedAgent(fixture.root);
    const artifacts = path.join(fixture.root, 'artifacts');
    const result = runTask({
      taskFile: fixture.taskFile,
      agentArgv: [process.execPath, agent, '{workspace}', '{patch}', '{prompt}'],
      artifactRoot: artifacts,
      agent: { provider: 'scripted-fixture', model: 'deterministic-v1' },
    });
    assert.equal(result.report.verdict, 'passed', JSON.stringify(result.report, null, 2));
    assert.equal(result.report.patch.status, 'applied');
    assert.equal(result.report.grades[0].verdict, 'passed');
    assert.equal(result.report.grades[0].score, 3);
    assert.equal(snapshotTree(fixture.source).treeSha256, before);
    assert.equal(JSON.parse(fs.readFileSync(path.join(fixture.source, 'lib/data/data.json'), 'utf8')).entities.alice.summary, 'old');
    assert.equal(fs.existsSync(path.join(artifacts, 'agent.patch')), true);
    assert.equal(fs.existsSync(path.join(artifacts, 'patch-audit.json')), true);
    assert.equal(fs.existsSync(path.join(artifacts, 'grade-task-grader.json')), true);
    assert.equal(fs.existsSync(path.join(artifacts, 'task-run.json')), true);
    assert.equal(result.report.capabilities.osSandbox, false);
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test('task runner keeps post-agent grader mutation in the valid failure denominator', () => {
  const fixture = setup({ mutatingGrader: true });
  try {
    const result = runTask({
      taskFile: fixture.taskFile,
      agentArgv: [process.execPath, scriptedAgent(fixture.root), '{workspace}', '{patch}', '{prompt}'],
      artifactRoot: path.join(fixture.root, 'artifacts'),
      agent: { provider: 'scripted-fixture', model: 'deterministic-v1' },
    });
    assert.equal(result.report.verdict, 'policy-violation');
    assert.match(result.report.termination.message, /grader modified/);
    assert.equal(result.report.patch.status, 'applied');
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test('observed candidate failure survives a later workspace integrity error', () => {
  const fixture = setup({ failingMutatingGrader: true });
  try {
    const result = runTask({
      taskFile: fixture.taskFile,
      agentArgv: [process.execPath, scriptedAgent(fixture.root), '{workspace}', '{patch}', '{prompt}'],
      artifactRoot: path.join(fixture.root, 'artifacts'),
      agent: { provider: 'scripted-fixture', model: 'deterministic-v1' },
    });
    assert.equal(result.report.verdict, 'grader-failed');
    assert.equal(result.report.grades[0].verdict, 'failed');
    assert.equal(result.report.secondaryErrors.length, 1);
    assert.match(result.report.secondaryErrors[0].message, /grader modified/);
    assert.equal(result.report.termination.processExitCode, 1);
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test('final source drift cannot produce a passing TaskRun', () => {
  const fixture = setup({ mutatingSourceGrader: true });
  try {
    const result = runTask({
      taskFile: fixture.taskFile,
      agentArgv: [process.execPath, scriptedAgent(fixture.root), '{workspace}', '{patch}', '{prompt}'],
      artifactRoot: path.join(fixture.root, 'artifacts'),
      agent: { provider: 'scripted-fixture', model: 'deterministic-v1' },
    });
    assert.equal(result.report.verdict, 'policy-violation');
    assert.equal(result.report.task.sourceUnchanged, false);
    assert.match(result.report.termination.message, /source root changed/);
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test('task runner detects direct .git mutation in security snapshots', () => {
  const fixture = setup();
  try {
    const result = runTask({
      taskFile: fixture.taskFile,
      agentArgv: [process.execPath, gitMutatingAgent(fixture.root), '{workspace}', '{patch}', '{prompt}'],
      artifactRoot: path.join(fixture.root, 'artifacts'),
      agent: { provider: 'scripted-fixture', model: 'git-mutating' },
    });
    assert.equal(result.report.verdict, 'policy-violation');
    assert.match(result.report.termination.message, /modified the workspace directly/);
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test('task runner rejects direct workspace mutation even when an agent also emits a patch', () => {
  const fixture = setup();
  const before = snapshotTree(fixture.source).treeSha256;
  try {
    const agent = scriptedAgent(fixture.root, true);
    const result = runTask({
      taskFile: fixture.taskFile,
      agentArgv: [process.execPath, agent, '{workspace}', '{patch}'],
      artifactRoot: path.join(fixture.root, 'artifacts'),
      agent: { provider: 'scripted-fixture', model: 'mutating' },
    });
    assert.equal(result.report.verdict, 'policy-violation');
    assert.match(result.report.termination.message, /modified the workspace directly/);
    assert.equal(result.report.patch, null);
    assert.equal(snapshotTree(fixture.source).treeSha256, before);
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});
