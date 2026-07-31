'use strict';

/* Pure RunReport v1.0 builder. It deliberately performs no filesystem or process I/O. */
const crypto = require('node:crypto');

const REPORT_VERSION = '1.0';
const OUTCOMES = new Set(['ready', 'issues-found', 'review-required', 'blocked', 'input-error']);
const MATURITIES = ['UNASSESSED', 'ASSESSED', 'DATA-VALID'];

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function sha256(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  return 'sha256:' + crypto.createHash('sha256').update(bytes).digest('hex');
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function countBy(items, key, value) {
  return items.filter((item) => item && item[key] === value).length;
}

function normalizeMessage(value) {
  if (typeof value === 'string') return { message: value, raw: value };
  if (value instanceof Error) return { message: value.message, raw: { name: value.name, message: value.message } };
  return { message: String(value), raw: value };
}

function diagnosticFinding({ value, phase, category = 'contract', severity = 'error', status = 'open', blocking = severity === 'error', code, title, subject, evidence, expected, actual, repairHint }) {
  const normalized = normalizeMessage(value);
  const parsedCode = code || (/^(E\d+|W\d+):/.exec(normalized.message) || [])[1] || 'TOOL_DIAGNOSTIC';
  const shortMessage = normalized.message.replace(/^(E\d+|W\d+):\s*/, '');
  return {
    code: parsedCode,
    severity,
    status,
    category,
    phase,
    title: title || (parsedCode === 'TOOL_DIAGNOSTIC' ? '工具诊断' : parsedCode),
    subject: subject || null,
    message: shortMessage,
    evidence: evidence || null,
    expected: expected === undefined ? null : expected,
    actual: actual === undefined ? null : actual,
    repairHint: repairHint || null,
    blocking: Boolean(blocking),
    raw: normalized.raw,
    needsNormalization: parsedCode === 'TOOL_DIAGNOSTIC',
  };
}

function withFindingIds(findings) {
  const counts = new Map();
  return findings.map((finding) => {
    const base = String(finding.code || 'TOOL_DIAGNOSTIC').replace(/[^A-Za-z0-9_-]+/g, '-');
    const index = (counts.get(base) || 0) + 1;
    counts.set(base, index);
    return { id: `F-${base}-${index}`, ...finding };
  });
}

function assurance(id, title, status, options = {}) {
  return {
    id,
    title,
    status,
    evidence: options.evidence || null,
    details: options.details || null,
    blocking: options.blocking === undefined ? status === 'failed' : Boolean(options.blocking),
  };
}

function change({ id, section, kind, title, subject, before, after, fields, evidence }) {
  return {
    id,
    section,
    kind: kind || 'updated',
    title: title || `${section} ${kind || 'updated'}`,
    subject: subject || null,
    before: before === undefined ? null : before,
    after: after === undefined ? null : after,
    fields: fields || [],
    evidence: evidence || null,
  };
}

function inventory(pack) {
  const countObject = (value) => value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).length : 0;
  return {
    entities: countObject(pack.entities),
    aliases: countObject(pack.aliases),
    relationTypes: countObject(pack.relationTypes),
    heroRelTypes: countObject(pack.heroRelTypes),
    relations: asArray(pack.relations).length,
    stages: asArray(pack.stages).length,
    contents: countObject(pack.contents),
    domainKeys: countObject(pack.domain),
    assets: countObject(pack.assets),
    sameAs: asArray(pack.sameAs).length,
    provenanceEntities: countObject(pack.provenance && pack.provenance.entities),
    derivations: countObject(pack.derivations),
  };
}

function deriveMaturity(report) {
  if (!report.assurances.length) return 'UNASSESSED';
  const contract = report.assurances.find((item) => item.id === 'data-pack-contract');
  if (contract && contract.status === 'passed') return 'DATA-VALID';
  if (report.assurances.some((item) => item.status === 'passed')) return 'ASSESSED';
  return 'UNASSESSED';
}

function deriveOutcome(report) {
  if (report.inputError) return 'input-error';
  if (report.findings.some((item) => item.blocking && item.status === 'open')) return 'blocked';
  if (report.findings.some((item) => item.status === 'review-required')) return 'review-required';
  if (report.findings.some((item) => item.severity === 'warning' && item.status === 'open')) return 'issues-found';
  if (report.assurances.some((item) => item.status === 'failed')) return 'blocked';
  return 'ready';
}

function buildSummary(report) {
  return {
    findings: report.findings.length,
    errors: countBy(report.findings, 'severity', 'error'),
    warnings: countBy(report.findings, 'severity', 'warning'),
    open: report.findings.filter((item) => ['open', 'review-required'].includes(item.status)).length,
    resolved: countBy(report.findings, 'status', 'resolved'),
    notAssessed: report.assurances.filter((item) => item.status === 'not-assessed').length,
    changes: report.changes.length,
    nextSteps: report.nextSteps.length,
  };
}

function buildRunId({ libId, mode, inputs, inventory: packInventory }) {
  return sha256(stableJson({ libId, mode, inputs, inventory: packInventory }));
}

function exitCodeForOutcome(outcome) {
  if (outcome === 'input-error') return 2;
  if (['blocked', 'review-required'].includes(outcome)) return 1;
  return 0;
}

function buildNextSteps(report) {
  const steps = [];
  const add = (id, priority, owner, title, reason, command, doneWhen, blocking = false) => {
    if (!steps.some((step) => step.id === id)) steps.push({ id, priority, owner, title, reason, command, doneWhen, blocking });
  };
  if (report.findings.some((item) => item.status === 'review-required')) {
    add('review-open-items', 'P0', 'reviewer', '处理待人工复核项', '存在 gap、conflict、unsupported 或 identity miss。', 'node "$SK" candidate ...', '每个 review item 都有明确 decision，Candidate audit 状态为 valid。', true);
  }
  if (report.findings.some((item) => item.severity === 'error' && item.status === 'open')) {
    add('fix-blocking-findings', 'P0', 'component-developer', '修复阻断性数据问题', 'Data Pack contract 或规则存在阻断 finding。', 'node "$SK" validate <data.json> --strict --verify-hash', 'errors 为 0，且 strict validation 通过。', true);
  }
  if (report.assurances.some((item) => item.id === 'extract-equivalence' && item.status === 'not-assessed')) {
    add('run-equivalence', 'P1', 'component-developer', '运行引擎等价性校验', '当前报告没有 extract config，尚未证明 __fromPack 无损还原默认数据。', 'node "$SK" extract <extract.config.js> --check', '所有 deep comparisons passed。');
  }
  if (report.assurances.some((item) => item.id === 'runtime-mount' && item.status === 'not-assessed')) {
    add('add-runtime-mount', 'P1', 'component-developer', '补充 runtime mount 回归', '当前只验证数据合同，没有验证真实 DOM mount。', '运行组件库 runtime mount test', '页面可 mount，控制台无 Data Pack 错误。');
  }
  if (report.assurances.some((item) => item.id === 'visual-regression' && item.status === 'not-assessed')) {
    add('add-visual-regression', 'P2', 'component-developer', '补充视觉回归', '当前没有截图或浏览器视觉证据。', '运行 visual regression 测试', '关键场景截图 diff 通过。');
  }
  if (report.impacts.length) {
    add('review-derivation-impact', 'P1', 'component-developer', '复核 derivation 影响面', '数据变化会影响引擎 consumer 或展示区域。', 'node "$SK" diff <old.json> <new.json> --json', '每个 impacted derivation 都完成相应回归。');
  }
  return steps;
}

function buildReport(input = {}) {
  const pack = input.pack || {};
  const libId = input.libId || (pack.meta && pack.meta.id) || 'unknown-library';
  const mode = input.mode || 'pack';
  const rawFindings = asArray(input.findings);
  const findings = withFindingIds(rawFindings);
  const report = {
    reportVersion: REPORT_VERSION,
    run: {
      id: null,
      command: input.command || 'report',
      exitCode: null,
      libId,
      mode,
      outcome: 'ready',
      maturity: 'UNASSESSED',
    },
    inputs: input.inputs || {},
    summary: null,
    inventory: input.inventory || inventory(pack),
    findings,
    changes: asArray(input.changes),
    assurances: asArray(input.assurances),
    coverage: asArray(input.coverage && input.coverage.length ? input.coverage : input.assurances),
    risks: asArray(input.risks),
    nextSteps: [],
    operations: asArray(input.operations),
    impacts: asArray(input.impacts),
    artifacts: asArray(input.artifacts),
    raw: input.raw || {},
    inputError: Boolean(input.inputError),
  };
  report.nextSteps = asArray(input.nextSteps).concat(buildNextSteps(report));
  report.summary = buildSummary(report);
  report.run.maturity = deriveMaturity(report);
  report.run.outcome = deriveOutcome(report);
  report.run.exitCode = exitCodeForOutcome(report.run.outcome);
  report.run.id = buildRunId({ libId, mode, inputs: report.inputs, inventory: report.inventory });
  delete report.inputError;
  return report;
}

module.exports = {
  REPORT_VERSION,
  OUTCOMES,
  MATURITIES,
  sha256,
  stableJson,
  diagnosticFinding,
  withFindingIds,
  assurance,
  change,
  inventory,
  buildSummary,
  exitCodeForOutcome,
  buildReport,
};
