#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../..');
const { computeTaskId, computeTreeSha256, sha256 } = require(path.join(ROOT, 'scripts/lib/agent-task-manifest.js'));
const { contentId, sha256Bytes } = require(path.join(ROOT, 'scripts/lib/sg-evidence-utils.js'));

const tasksRoot = path.join(__dirname, 'tasks');
const taskDefinitions = [
  {
    id: 'field-update',
    instructions: 'In lib/data/data.json, change only entities.alice.summary from summary-old to exactly summary-new. Preserve the valid Data Pack shape and every unrelated value. Emit a unified diff only.',
    inputs: ['lib/data/data.json'],
    allowed: [{ pattern: 'lib/data/data.json', operations: ['modify'] }],
    grader: 'grader/spec.json',
    evidence: { runtime: [], visual: [] },
  },
  {
    id: 'alias-relation',
    instructions: 'In lib/data/data.json, add alias Alicia that resolves to existing entity alice. Also add exactly one master relation with id alice-bob-friend, a alice, b bob, type friend, and label Friend. Do not create entities or modify existing names. Emit a unified diff only.',
    inputs: ['lib/data/data.json'],
    allowed: [{ pattern: 'lib/data/data.json', operations: ['modify'] }],
    grader: 'grader/spec.json',
    evidence: { runtime: [], visual: [] },
  },
  {
    id: 'pattern-c-runtime',
    instructions: 'Extend the Pattern C card gallery with a third card. In lib/data/data.json add entity gamma with kind card, title Gamma Card, and color #8b5cf6; add alias Gamma Card -> gamma; append gamma to the gallery stage entities and domain.cardOrder. Update lib/data/data.js so SG_DATA_PACK exactly mirrors data.json. Do not modify the engine or HTML. Emit a unified diff only.',
    inputs: ['lib/data/data.json', 'lib/data/data.js', 'lib/src/cards.js', 'lib/examples/index.html'],
    allowed: [
      { pattern: 'lib/data/data.json', operations: ['modify'] },
      { pattern: 'lib/data/data.js', operations: ['modify'] },
    ],
    grader: 'grader/spec.json',
    evidence: { runtime: ['pattern-c-gallery'], visual: ['pattern-c-gallery-desktop'] },
  },
];

for (const definition of taskDefinitions) {
  const directory = path.join(tasksRoot, definition.id);
  const source = path.join(directory, 'source');
  const instructions = { text: definition.instructions, sha256: sha256(definition.instructions) };
  const graderFile = path.join(directory, definition.grader);
  const graderDir = path.dirname(graderFile);
  const manifest = {
    taskVersion: '1.0', taskId: null, instructions,
    source: { root: 'source', revision: `${definition.id}-fixture-v1`, treeSha256: computeTreeSha256(source) },
    inputs: definition.inputs.map((relative, index) => ({ id: `input-${index + 1}`, path: relative, role: index === 0 ? 'canonical-data' : 'integration-input', sha256: sha256(fs.readFileSync(path.join(source, relative))) })),
    filePolicy: {
      allowed: definition.allowed,
      forbidden: ['.git/**', 'lib/src/**', 'lib/examples/**'],
      denyPrecedence: true, allowSymlinks: false, allowHardlinks: false,
      maxChangedFiles: definition.allowed.length, maxPatchBytes: 262144,
    },
    patchPolicy: { format: 'unified-diff', fuzz: 0, allowBinary: false },
    graders: [{ id: 'task-grader', spec: definition.grader, sha256: sha256(fs.readFileSync(graderFile)), treeSha256: computeTreeSha256(graderDir), weight: 1 }],
    evidence: definition.evidence,
    execution: { timeoutMs: 480000, network: 'off', maxOutputBytes: 4194304 },
  };
  manifest.taskId = computeTaskId(manifest);
  fs.writeFileSync(path.join(directory, 'task.json'), JSON.stringify(manifest, null, 2) + '\n');
}

function experiment(kind, provider, model, executable) {
  const spec = {
    experimentVersion: '1.0', experimentId: null,
    title: `${provider} agent task benchmark`,
    agent: {
      kind, provider, model,
      argv: ['{node}', '{adapter}', '{workspace}', '{patch}', '{prompt}'],
      adapter: { path: `providers/${executable}`, sha256: sha256Bytes(fs.readFileSync(path.join(__dirname, 'providers', executable))) },
      ...(kind === 'ai' ? { infraExitCodes: [3] } : {}),
    },
    tasks: taskDefinitions.map((task) => {
      const relative = `tasks/${task.id}/task.json`;
      const file = path.join(__dirname, relative);
      const bytes = fs.readFileSync(file);
      return { id: task.id, manifest: relative, taskId: JSON.parse(bytes).taskId, manifestSha256: sha256Bytes(bytes) };
    }),
    repetitions: 5,
    seed: 'fixed-task-order-v1',
  };
  experimentId(spec);
  return spec;
}
function experimentId(spec) {
  const material = { ...spec }; delete material.experimentId;
  spec.experimentId = contentId('experiment', material, []);
}
fs.writeFileSync(path.join(__dirname, 'experiment-scripted.json'), JSON.stringify(experiment('scripted', 'deterministic-fixture', 'scripted-v1', 'scripted-patch-agent.js'), null, 2) + '\n');
fs.writeFileSync(path.join(__dirname, 'experiment-codex.json'), JSON.stringify(experiment('ai', 'codex-cli-0.139.0', 'gpt-5.5 (provider-reported)', 'codex-patch-agent.js'), null, 2) + '\n');
fs.writeFileSync(path.join(__dirname, 'experiment-claude.json'), JSON.stringify(experiment('ai', 'claude-code-2.1.185', 'sonnet alias (provider metadata recorded)', 'claude-patch-agent.js'), null, 2) + '\n');
console.log('Agent evaluation fixtures regenerated.');
