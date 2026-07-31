'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  sha256, stableJson, diagnosticFinding, assurance, change, buildReport,
} = require('../scripts/lib/sg-run-report.js');
const { renderTerminalSummary, renderJson, renderMarkdown } = require('../scripts/lib/sg-report-renderer.js');

test('RunReport preserves version, deterministic id, and exit semantics', () => {
  const input = {
    command: 'report',
    libId: 'demo',
    mode: 'pack',
    pack: { schemaVersion: '1.3', meta: { id: 'demo' }, entities: { a: { kind: 'person', name: 'A' } } },
    inputs: { dataSha256: sha256(Buffer.from('data')), strict: false },
    assurances: [
      assurance('data-pack-contract', 'Data Pack contract', 'passed', { evidence: 'E1-E16' }),
      assurance('visual-regression', 'Visual regression', 'not-assessed'),
    ],
  };
  const first = buildReport(input);
  const second = buildReport(input);
  assert.equal(first.reportVersion, '1.0');
  assert.equal(first.run.id, second.run.id);
  assert.equal(first.run.command, 'report');
  assert.equal(first.run.exitCode, 0);
  assert.equal(first.run.outcome, 'ready');
  assert.equal(first.run.maturity, 'DATA-VALID');
  assert.equal(first.summary.notAssessed, 1);
});

test('unknown diagnostics retain original value and receive stable finding ids', () => {
  const finding = diagnosticFinding({ value: { source: 'legacy', detail: 'kept' }, phase: 'validate' });
  const report = buildReport({ libId: 'demo', findings: [finding, finding], assurances: [] });
  assert.equal(report.findings[0].code, 'TOOL_DIAGNOSTIC');
  assert.equal(report.findings[0].needsNormalization, true);
  assert.deepEqual(report.findings[0].raw, { source: 'legacy', detail: 'kept' });
  assert.equal(report.findings[0].id, 'F-TOOL_DIAGNOSTIC-1');
  assert.equal(report.findings[1].id, 'F-TOOL_DIAGNOSTIC-2');
});

test('blocking and review findings determine outcome independently from warnings', () => {
  const blocked = buildReport({ findings: [diagnosticFinding({ value: 'E5: dangling', phase: 'validate' })] });
  assert.equal(blocked.run.outcome, 'blocked');
  assert.equal(blocked.run.exitCode, 1);
  const review = buildReport({ findings: [diagnosticFinding({ value: 'gap', phase: 'review', severity: 'warning', status: 'review-required', blocking: true })] });
  assert.equal(review.run.outcome, 'review-required');
  assert.equal(review.run.exitCode, 1);
  const warning = buildReport({ findings: [diagnosticFinding({ value: 'W1: unused', phase: 'validate', severity: 'warning', blocking: false })] });
  assert.equal(warning.run.outcome, 'issues-found');
  assert.equal(warning.run.exitCode, 0);
});

test('terminal, JSON, and Markdown render the same summary counts', () => {
  const report = buildReport({
    libId: 'demo',
    changes: [change({ id: 'c1', section: 'entities', kind: 'updated', title: '更新人物' })],
    assurances: [assurance('data-pack-contract', 'Data Pack contract', 'passed'), assurance('runtime-mount', 'Runtime DOM mount', 'not-assessed')],
  });
  const json = JSON.parse(renderJson(report));
  const terminal = renderTerminalSummary(report);
  const markdown = renderMarkdown(report);
  assert.match(terminal, /1 changes/);
  assert.match(terminal, /1 项未评估/);
  assert.match(markdown, /变更 \*\*1\*\* 项/);
  assert.equal(json.summary.changes, report.summary.changes);
  assert.equal(json.summary.notAssessed, report.summary.notAssessed);
  assert.doesNotMatch(markdown, /undefined/);
});

test('stableJson sorts object keys for deterministic report material', () => {
  assert.equal(stableJson({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}');
});
