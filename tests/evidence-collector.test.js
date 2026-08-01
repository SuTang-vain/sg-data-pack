'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sha256Bytes, contentId } = require('../scripts/lib/sg-evidence-utils.js');
const { validateRuntimeEvidence } = require('../scripts/lib/sg-runtime-evidence.js');
const { validateVisualEvidence } = require('../scripts/lib/sg-visual-evidence.js');

function directory() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-evidence-')); }
function artifact(root, id, file, content, mediaType = 'text/plain') {
  fs.writeFileSync(path.join(root, file), content);
  return { id, path: file, mediaType, sha256: sha256Bytes(content) };
}

test('runtime evidence passes only with complete assertions and verified artifacts', () => {
  const root = directory();
  try {
    const evidence = {
      evidenceVersion: '1.0',
      kind: 'runtime-evidence',
      scenarioId: 'mount-default',
      subjectTreeSha256: sha256Bytes('tree'),
      producer: { name: 'fixture-runtime', version: '1.0.0' },
      environment: { node: process.version },
      assertions: [{ id: 'mounted', status: 'passed', message: '#mount rendered' }],
      consoleErrors: [], pageErrors: [], networkFailures: [],
      artifacts: [artifact(root, 'runtime-log', 'runtime.log', 'mounted\n')],
    };
    evidence.evidenceId = contentId('runtime', evidence, ['evidenceId']);
    const result = validateRuntimeEvidence(evidence, { baseDir: root });
    assert.equal(result.valid, true);
    assert.equal(result.status, 'passed');
    evidence.artifacts[0].sha256 = sha256Bytes('tampered');
    assert.equal(validateRuntimeEvidence(evidence, { baseDir: root }).status, 'not-assessed');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('runtime evidence never treats a missing assertion surface as passed', () => {
  const root = directory();
  try {
    const evidence = {
      evidenceVersion: '1.0', kind: 'runtime-evidence', scenarioId: 'missing',
      subjectTreeSha256: sha256Bytes('tree'), producer: { name: 'fixture', version: '1' },
      environment: {}, assertions: [], consoleErrors: [], pageErrors: [], networkFailures: [],
      artifacts: [artifact(root, 'runtime-log', 'runtime.log', 'no assertions\n')],
    };
    evidence.evidenceId = contentId('runtime', evidence, ['evidenceId']);
    const result = validateRuntimeEvidence(evidence, { baseDir: root });
    assert.equal(result.valid, true);
    assert.equal(result.status, 'not-assessed');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('pathless artifacts cannot be used to pass runtime or visual evidence', () => {
  const root = directory();
  try {
    const runtime = {
      evidenceVersion: '1.0', kind: 'runtime-evidence', scenarioId: 'mount-default',
      subjectTreeSha256: sha256Bytes('tree'), producer: { name: 'fixture', version: '1' }, environment: {},
      assertions: [{ id: 'mounted', status: 'passed' }], consoleErrors: [], pageErrors: [], networkFailures: [],
      artifacts: [{ id: 'runtime-log', sha256: sha256Bytes('claimed bytes'), mediaType: 'text/plain' }],
    };
    runtime.evidenceId = contentId('runtime', runtime, ['evidenceId']);
    const runtimeResult = validateRuntimeEvidence(runtime, { baseDir: root });
    assert.equal(runtimeResult.status, 'not-assessed');
    assert.ok(runtimeResult.errors.some((error) => /path/.test(error)));

    const visual = {
      evidenceVersion: '1.0', kind: 'visual-evidence',
      referenceTreeSha256: sha256Bytes('reference-tree'), candidateTreeSha256: sha256Bytes('candidate-tree'), configurationSha256: sha256Bytes('config'),
      producer: { name: 'fixture', version: '1' }, thresholds: { maxPixelDiffRatio: 0, minComputedStyleScore: 1, minCoverage: 1 },
      scenarios: [{ id: 'desktop', viewport: { width: 100, height: 100 }, pixelDiffRatio: 0, computedStyleScore: 1, coverage: 1, stabilityFailures: 0, referenceArtifact: 'reference', candidateArtifact: 'candidate', diffArtifact: 'diff' }],
      artifacts: ['reference', 'candidate', 'diff'].map((id) => ({ id, sha256: sha256Bytes(id), mediaType: 'image/png' })),
    };
    visual.evidenceId = contentId('visual', visual, ['evidenceId']);
    const visualResult = validateVisualEvidence(visual, { baseDir: root });
    assert.equal(visualResult.status, 'not-assessed');
    assert.ok(visualResult.errors.some((error) => /path/.test(error)));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('visual evidence recomputes scenario gates instead of trusting a producer verdict', () => {
  const root = directory();
  try {
    const artifacts = [
      artifact(root, 'reference', 'reference.png', 'reference', 'image/png'),
      artifact(root, 'candidate', 'candidate.png', 'candidate', 'image/png'),
      artifact(root, 'diff', 'diff.png', 'diff', 'image/png'),
    ];
    const evidence = {
      evidenceVersion: '1.0', kind: 'visual-evidence',
      referenceTreeSha256: sha256Bytes('reference-tree'),
      candidateTreeSha256: sha256Bytes('candidate-tree'),
      configurationSha256: sha256Bytes('config'),
      producer: { name: 'fixture-visual', version: '1.0.0' },
      thresholds: { maxPixelDiffRatio: 0.02, minComputedStyleScore: 0.98, minCoverage: 1 },
      scenarios: [{
        id: 'desktop', viewport: { width: 1280, height: 720 },
        pixelDiffRatio: 0.01, computedStyleScore: 0.99, coverage: 1, stabilityFailures: 0,
        referenceArtifact: 'reference', candidateArtifact: 'candidate', diffArtifact: 'diff',
      }],
      artifacts,
    };
    evidence.evidenceId = contentId('visual', evidence, ['evidenceId']);
    assert.equal(validateVisualEvidence(evidence, { baseDir: root }).status, 'passed');
    evidence.scenarios[0].pixelDiffRatio = 0.03;
    evidence.evidenceId = contentId('visual', evidence, ['evidenceId']);
    assert.equal(validateVisualEvidence(evidence, { baseDir: root }).status, 'failed');
    evidence.scenarios[0].diffArtifact = 'missing';
    evidence.evidenceId = contentId('visual', evidence, ['evidenceId']);
    assert.equal(validateVisualEvidence(evidence, { baseDir: root }).status, 'not-assessed');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
