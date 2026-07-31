#!/usr/bin/env node
/*
 * sg-pack-report.js — unified user-facing Library Evolution Report.
 *
 * Usage:
 *   sg-data-pack report <libDir> [--config config.js] [--baseline old.json]
 *     [--review review-report.json] [--audit candidate-audit.json]
 *     [--strict] [--verify-hash] [--out report-dir] [--json]
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { buildReport, diagnosticFinding, assurance, change, sha256 } = require('./lib/sg-run-report.js');
const { inspectPack } = require('./lib/sg-pack-inspect.js');
const { executeRules } = require('./lib/sg-pack-rules-core.js');
const { buildDiff } = require('./lib/sg-pack-diff.js');
const { ExtractionError } = require('./lib/sg-pack-extract-core.js');
const { validateReportShape } = require('./lib/sg-pack-candidate.js');
require('./lib/sg-data-loader.js');
const loader = globalThis.SGDataLoader;
const { sha256: reviewSha256, stableJson: reviewStableJson } = require('./lib/sg-recrawl-review.js');
const { renderJson, renderTerminalSummary, renderMarkdown } = require('./lib/sg-report-renderer.js');

const [, , libDirArg, ...args] = process.argv;
const usage = 'Usage: sg-data-pack report <libDir> [--config config.js] [--baseline old.json] [--review review-report.json] [--audit candidate-audit.json] [--strict] [--verify-hash] [--out report-dir] [--json]';
if (!libDirArg || libDirArg.startsWith('--')) {
  console.error(usage);
  process.exit(2);
}

const valueFlags = new Set(['--config', '--baseline', '--review', '--audit', '--out']);
const booleanFlags = new Set(['--strict', '--verify-hash', '--json']);
const options = {};
for (let index = 0; index < args.length; index += 1) {
  const name = args[index];
  if (booleanFlags.has(name)) {
    if (Object.prototype.hasOwnProperty.call(options, name)) {
      console.error(`Duplicate option: ${name}`);
      process.exit(2);
    }
    options[name] = true;
    continue;
  }
  if (!valueFlags.has(name)) {
    console.error(`Unknown option: ${name}`);
    process.exit(2);
  }
  if (Object.prototype.hasOwnProperty.call(options, name)) {
    console.error(`Duplicate option: ${name}`);
    process.exit(2);
  }
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    console.error(`${name} requires a value`);
    process.exit(2);
  }
  options[name] = value;
  index += 1;
}

const libDir = path.resolve(libDirArg);
const configPath = options['--config'] ? path.resolve(options['--config']) : null;
const baselinePath = options['--baseline'] ? path.resolve(options['--baseline']) : null;
const reviewPath = options['--review'] ? path.resolve(options['--review']) : null;
const auditPath = options['--audit'] ? path.resolve(options['--audit']) : null;
const outDir = options['--out'] ? path.resolve(options['--out']) : null;
const strict = Boolean(options['--strict']);
const verifyHash = Boolean(options['--verify-hash']);
const asJson = Boolean(options['--json']);
const dataFile = path.join(libDir, 'lib', 'data', 'data.json');
const rulesFile = path.join(libDir, 'lib', 'data', 'data-rules.json');
const guideFile = path.join(libDir, 'lib', 'data', 'DATA-GUIDE.md');

function canonicalPath(file) {
  let absolute = path.resolve(file);
  const missing = [];
  while (!fs.existsSync(absolute)) {
    const parent = path.dirname(absolute);
    if (parent === absolute) break;
    missing.unshift(path.basename(absolute));
    absolute = parent;
  }
  try { absolute = fs.realpathSync(absolute); } catch (_) { /* input reads report the concrete error */ }
  return path.join(absolute, ...missing);
}

function sameFile(left, right) {
  const a = canonicalPath(left);
  const b = canonicalPath(right);
  const insensitive = process.platform === 'darwin' || process.platform === 'win32';
  if (a === b || (insensitive && a.toLowerCase() === b.toLowerCase())) return true;
  try {
    const leftStat = fs.statSync(left);
    const rightStat = fs.statSync(right);
    return leftStat.dev === rightStat.dev && leftStat.ino === rightStat.ino;
  } catch (_) {
    return false;
  }
}

if (outDir) {
  const outputs = [path.join(outDir, 'report.json'), path.join(outDir, 'REPORT.md')];
  const inputs = [dataFile, rulesFile, guideFile, configPath, baselinePath, reviewPath, auditPath].filter(Boolean);
  const libraryRoot = canonicalPath(libDir);
  const outputRoot = canonicalPath(outDir);
  const relativeLibraryOutput = path.relative(libraryRoot, outputRoot);
  const insideLibrary = relativeLibraryOutput === '' || (!relativeLibraryOutput.startsWith('..' + path.sep) && relativeLibraryOutput !== '..' && !path.isAbsolute(relativeLibraryOutput));
  if (insideLibrary || sameFile(outputs[0], outputs[1]) || outputs.some((output) => inputs.some((input) => sameFile(output, input)))) {
    console.error('report output paths must be outside the source library and must not overwrite an input file');
    process.exit(2);
  }
}

function safeRelative(file) {
  return path.relative(process.cwd(), path.resolve(file)) || path.basename(file);
}

function readInput(file, label) {
  let bytes;
  try {
    bytes = fs.readFileSync(file);
  } catch (error) {
    throw new Error(`${label} cannot be read: ${error.message}`);
  }
  try {
    return { value: JSON.parse(bytes.toString('utf8')), bytes, digest: sha256(bytes) };
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function digestFile(file, label) {
  try {
    return sha256(fs.readFileSync(file));
  } catch (error) {
    throw new Error(`${label} cannot be read: ${error.message}`);
  }
}

function recordConsumed(inputs, file, digest) {
  if (!inputs.consumedFiles) inputs.consumedFiles = {};
  inputs.consumedFiles[canonicalPath(file)] = digest;
}

function runExtractionIsolated(configPath, expectedLibDir, expectedLibId) {
  const result = spawnSync(process.execPath, [
    path.join(__dirname, 'lib', 'sg-pack-extract-report-worker.js'),
    configPath,
    expectedLibDir,
    expectedLibId || '',
  ], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw new ExtractionError(result.error.message, 'input');
  if (result.stdout) process.stderr.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  const payloadText = result.output && result.output[3] ? String(result.output[3]) : '';
  if (!payloadText) throw new ExtractionError('extraction worker returned no structured result', 'gate');
  let payload;
  try { payload = JSON.parse(payloadText); }
  catch (error) { throw new ExtractionError(`extraction worker returned invalid result: ${error.message}`, 'gate'); }
  if (!payload.ok) throw new ExtractionError(payload.error.message, payload.error.kind || 'gate');
  return payload.result;
}

function addValidationFindings(findings, validation, phase, strictMode) {
  for (const error of validation.errors || []) {
    findings.push(diagnosticFinding({ value: error, phase, severity: 'error', category: 'contract', blocking: true }));
  }
  for (const warning of validation.warnings || []) {
    findings.push(diagnosticFinding({ value: warning, phase, severity: 'warning', category: 'contract', blocking: strictMode }));
  }
}

function addAssetFindings(findings, assets) {
  for (const item of assets.mismatches || []) {
    findings.push(diagnosticFinding({
      value: `asset hash mismatch: ${item.path}`,
      code: 'ASSET_HASH_MISMATCH', phase: 'validate', category: 'asset', severity: 'error', blocking: true,
      title: '资源文件与清单 hash 不一致', subject: item.path, expected: item.expected, actual: item.actual, evidence: item,
      repairHint: '确认文件来源后重新生成资产清单；不要在未复核内容的情况下只改 hash。',
    }));
  }
  for (const item of assets.missing || []) {
    findings.push(diagnosticFinding({
      value: `asset verification failed: ${item.path} (${item.error})`,
      code: 'ASSET_UNREADABLE', phase: 'validate', category: 'asset', severity: 'error', blocking: true,
      title: '资源文件无法校验', subject: item.path, expected: item.expected, evidence: item,
      repairHint: '修正 assets 路径或补齐文件，再重新运行 --verify-hash。',
    }));
  }
}

function findingCode(classification) {
  return {
    conflict: 'RECRAWL_CONFLICT', gap: 'RECRAWL_GAP', miss: 'RECRAWL_MISS', unsupported: 'RECRAWL_UNSUPPORTED',
  }[classification] || 'RECRAWL_REVIEW';
}

function addReviewFinding(findings, risks, item, resolved) {
  const classification = item.classification || 'review';
  const itemId = item.itemId || `legacy:${classification}:${item.index}`;
  const status = resolved.has(itemId) ? 'resolved' : 'review-required';
  findings.push(diagnosticFinding({
    value: `${classification} requires an explicit review decision`,
    code: findingCode(classification), phase: 'review', category: classification === 'miss' ? 'identity' : 'review',
    severity: 'warning', status, blocking: status === 'review-required',
    title: status === 'resolved' ? `${classification} 已完成人工复核` : `${classification} 待人工复核`,
    subject: itemId, evidence: item,
  }));
  if (status !== 'resolved') {
    risks.push({
      id: `risk-${itemId}`, severity: 'high', status: 'open', title: `${classification} review item`,
      reason: `review item ${itemId} 尚未被有效 Candidate audit 覆盖。`, itemId,
    });
  }
  return status;
}

function validateCandidateReview(review) {
  if (!review || typeof review !== 'object' || review.version !== '1.0') throw new Error('candidateReview.version must be "1.0"');
  if (!Array.isArray(review.observations) || !Array.isArray(review.reviewItems)) throw new Error('candidateReview observations and reviewItems must be arrays');
  if (typeof review.reportId !== 'string') throw new Error('candidateReview.reportId is required');
  for (const field of ['baselineSha256', 'recordsSha256']) {
    if (typeof review[field] !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(review[field])) throw new Error(`candidateReview.${field} must be a SHA-256 digest`);
  }
  const { reportId, ...withoutId } = review;
  if (reportId !== reviewSha256(reviewStableJson(withoutId))) throw new Error('candidateReview.reportId does not match report contents');
  const ids = review.reviewItems.map((item) => item && item.itemId);
  if (ids.some((id) => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) throw new Error('candidateReview contains invalid or duplicate itemId values');
  try { validateReportShape({ candidateReview: review }); }
  catch (error) { throw new Error(`candidateReview shape is invalid: ${error.message}`); }
  return review;
}

function collectReview(report, resolved, findings, risks) {
  let items;
  if (report.candidateReview) {
    const review = validateCandidateReview(report.candidateReview);
    items = review.reviewItems;
  } else {
    if (!Array.isArray(report.misses) || !Array.isArray(report.autoMergeable) || !Array.isArray(report.needsHumanReview)) {
      throw new Error('review report must contain candidateReview or the legacy misses/autoMergeable/needsHumanReview arrays');
    }
    items = [];
    report.misses.forEach((entry, index) => items.push({ itemId: `legacy:miss:${index}`, index, kind: 'identity', classification: 'miss', ...entry }));
    report.autoMergeable.forEach((entry, recordIndex) => (entry.gaps || []).forEach((gap, fieldIndex) => items.push({ itemId: `legacy:gap:${recordIndex}:${fieldIndex}`, index: `${recordIndex}:${fieldIndex}`, kind: 'field', classification: 'gap', entityId: entry.id, ...gap })));
    report.needsHumanReview.forEach((entry, recordIndex) => (entry.conflicts || []).forEach((conflict, fieldIndex) => items.push({ itemId: `legacy:conflict:${recordIndex}:${fieldIndex}`, index: `${recordIndex}:${fieldIndex}`, kind: 'field', classification: 'conflict', entityId: entry.id, ...conflict })));
  }
  const statuses = items.map((item) => addReviewFinding(findings, risks, item, resolved));
  const open = statuses.filter((status) => status === 'review-required').length;
  const classifications = items.reduce((counts, item) => {
    counts[item.classification] = (counts[item.classification] || 0) + 1;
    return counts;
  }, {});
  return {
    assurance: assurance('crawl-review', 'Crawl review', open ? 'review-required' : 'passed', {
      blocking: Boolean(open), evidence: `${items.length} review items / ${open} unresolved`, details: classifications,
    }),
    total: items.length,
    open,
    reportId: report.candidateReview && report.candidateReview.reportId,
    baselineSha256: report.candidateReview && report.candidateReview.baselineSha256,
  };
}

function validateAudit(audit, strictMode, expected = {}) {
  if (!audit || typeof audit !== 'object' || audit.auditVersion !== '1.0') throw new Error('candidate audit must use auditVersion "1.0"');
  if (!audit.inputs || typeof audit.inputs !== 'object') throw new Error('candidate audit inputs are required');
  for (const field of ['baselineSha256', 'recordsSha256', 'reportId', 'decisionsSha256', 'candidateSha256']) {
    if (typeof audit.inputs[field] !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(audit.inputs[field])) throw new Error(`candidate audit inputs.${field} must be a SHA-256 digest`);
  }
  if (expected.candidateSha256 && audit.inputs.candidateSha256 !== expected.candidateSha256) throw new Error('candidate audit candidateSha256 does not match current Data Pack');
  if (expected.baselineSha256 && audit.inputs.baselineSha256 !== expected.baselineSha256) throw new Error('candidate audit baselineSha256 does not match reviewed baseline');
  if (expected.reportId && audit.inputs.reportId !== expected.reportId) throw new Error('candidate audit reportId does not match supplied review report');
  if (!audit.validation || !Array.isArray(audit.validation.errors) || !Array.isArray(audit.validation.warnings)) throw new Error('candidate audit validation errors/warnings must be arrays');
  if (!Array.isArray(audit.operations) || !Array.isArray(audit.unresolved) || !Array.isArray(audit.derivationsImpacted)) throw new Error('candidate audit operations/unresolved/derivationsImpacted must be arrays');
  const allowedResults = new Set(['applied', 'noop-already-applied', 'kept-baseline', 'rejected']);
  const operationIds = new Set();
  for (const operation of audit.operations) {
    if (!operation || typeof operation.itemId !== 'string' || !operation.itemId || !allowedResults.has(operation.result)) throw new Error('candidate audit contains an invalid operation');
    if (operationIds.has(operation.itemId)) throw new Error(`candidate audit contains a duplicate operation: ${operation.itemId}`);
    operationIds.add(operation.itemId);
  }
  const unresolvedIds = new Set();
  for (const unresolved of audit.unresolved) {
    const itemId = typeof unresolved === 'string' ? unresolved : unresolved && unresolved.itemId;
    if (typeof itemId !== 'string' || !itemId) throw new Error('candidate audit contains an invalid unresolved item');
    if (unresolvedIds.has(itemId) || operationIds.has(itemId)) throw new Error(`candidate audit item appears more than once: ${itemId}`);
    unresolvedIds.add(itemId);
  }
  if (expected.itemIds) {
    const expectedIds = new Set(expected.itemIds);
    const observedIds = new Set([...operationIds, ...unresolvedIds]);
    if (expectedIds.size !== observedIds.size || [...expectedIds].some((itemId) => !observedIds.has(itemId))) {
      throw new Error('candidate audit operations/unresolved do not exactly cover review items');
    }
  }
  const failed = audit.status !== 'valid' || audit.validation.errors.length > 0 || unresolvedIds.size > 0 || (strictMode && audit.validation.warnings.length > 0);
  return { failed, resolved: new Set(failed ? [] : operationIds) };
}

function stageMap(stages) {
  return Object.fromEntries((stages || []).map((stage, index) => [stage && (stage.key || stage.id) || `#${index}`, stage]));
}

function pairMap(pairs) {
  return Object.fromEntries((pairs || []).map((pair) => [JSON.stringify([...pair].sort()), pair]));
}

function relationKey(relation) {
  if (relation && relation.id) return `id:${relation.id}`;
  const scope = Array.isArray(relation && relation.scope) ? [...new Set(relation.scope)].sort().join('|') : '*';
  return `${relation && relation.a}::${relation && relation.b}::${relation && relation.type}::scope=${scope}`;
}

function relationMap(relations) {
  const map = {};
  const seen = {};
  for (const relation of relations || []) {
    const base = relationKey(relation);
    seen[base] = (seen[base] || 0) + 1;
    map[seen[base] === 1 ? base : `${base}#${seen[base]}`] = relation;
  }
  return map;
}

function sectionMap(pack, section) {
  if (section === 'relations') return relationMap(pack.relations);
  if (section === 'stages') return stageMap(pack.stages);
  if (section === 'sameAs') return pairMap(pack.sameAs);
  return pack[section] && typeof pack[section] === 'object' && !Array.isArray(pack[section]) ? pack[section] : {};
}

function collectChanges(diff, oldPack, newPack) {
  const changes = [];
  for (const [section, sectionDiff] of Object.entries(diff)) {
    if (!sectionDiff || typeof sectionDiff !== 'object' || !Array.isArray(sectionDiff.added)) continue;
    const beforeMap = sectionMap(oldPack, section);
    const afterMap = sectionMap(newPack, section);
    for (const id of sectionDiff.added) changes.push(change({ id: `add-${section}-${id}`, section, kind: 'added', title: `新增 ${section} 记录`, subject: id, after: afterMap[id] === undefined ? id : afterMap[id] }));
    for (const id of sectionDiff.removed) changes.push(change({ id: `remove-${section}-${id}`, section, kind: 'removed', title: `移除 ${section} 记录`, subject: id, before: beforeMap[id] === undefined ? id : beforeMap[id] }));
    for (const item of sectionDiff.changed || []) changes.push(change({ id: `change-${section}-${item.id}`, section, kind: 'updated', title: `更新 ${section} 记录`, subject: item.id, before: beforeMap[item.id], after: afterMap[item.id], fields: item.fields }));
  }
  if (diff.stages && diff.stages.orderChanged) {
    changes.push(change({
      id: 'reorder-stages', section: 'stages', kind: 'reordered', title: '调整 stage 顺序', subject: 'stages',
      before: (oldPack.stages || []).map((stage, index) => stage && (stage.key || stage.id) || `#${index}`),
      after: (newPack.stages || []).map((stage, index) => stage && (stage.key || stage.id) || `#${index}`),
    }));
  }
  return changes;
}

function reportMode() {
  if (auditPath) return 'candidate';
  if (reviewPath) return 'review';
  if (baselinePath) return 'evolution';
  if (configPath) return 'integration';
  return 'pack';
}

function collectReport() {
  const findings = [];
  const changes = [];
  const assurances = [];
  const risks = [];
  const operations = [];
  const impacts = [];
  const artifacts = [];
  const raw = {};
  const inputs = { strict, verifyHash };
  let pack = {};
  let packInspection = null;
  let libId = path.basename(libDir);
  let inputError = false;
  let baselineInput = null;
  let reviewInput = null;
  let auditInput = null;
  let auditState = { failed: false, resolved: new Set() };

  try {
    if (!fs.existsSync(libDir) || !fs.statSync(libDir).isDirectory()) throw new Error(`library directory not found: ${libDir}`);
    packInspection = inspectPack({ dataFile, verifyHash });
    pack = packInspection.pack;
    libId = pack && pack.meta && pack.meta.id || libId;
    inputs.dataFile = safeRelative(dataFile);
    inputs.dataSha256 = packInspection.digest;
    inputs.consumedFiles = Object.fromEntries(Object.entries(packInspection.consumedFiles || {}).map(([file, digest]) => [canonicalPath(file), digest]));
    raw.validation = packInspection.validation;
    raw.assets = packInspection.assets;
    addValidationFindings(findings, packInspection.validation, 'validate', strict);
    addAssetFindings(findings, packInspection.assets);
    const contractFailed = packInspection.validation.errors.length > 0 || (strict && packInspection.validation.warnings.length > 0);
    assurances.push(assurance('data-pack-contract', 'Data Pack contract', contractFailed ? 'failed' : 'passed', {
      evidence: `SGDataLoader; ${packInspection.validation.errors.length} errors / ${packInspection.validation.warnings.length} warnings${strict ? ' (strict)' : ''}`,
      details: { errors: packInspection.validation.errors.length, warnings: packInspection.validation.warnings.length, strict }, blocking: contractFailed,
    }));
    const missingManifestHashes = packInspection.assets.skipped.filter((item) => item.reason === 'missing-manifest-hash');
    const assetFailed = verifyHash && (packInspection.assets.mismatches.length > 0 || packInspection.assets.missing.length > 0);
    const assetUnassessed = verifyHash && missingManifestHashes.length > 0;
    if (assetUnassessed) {
      risks.push({ id: 'risk-asset-manifest-hash', severity: 'medium', status: 'open', title: '部分资源没有 manifest hash', reason: `${missingManifestHashes.length} 个资源没有可比对的 SHA-1，完整资源完整性未评估。`, assets: missingManifestHashes });
    }
    assurances.push(assurance('asset-integrity', 'Asset integrity', !verifyHash ? 'not-assessed' : assetFailed ? 'failed' : assetUnassessed ? 'not-assessed' : 'passed', {
      evidence: verifyHash ? `${packInspection.assets.summary.checked} files checked` : 'verify hash not requested',
      details: packInspection.assets.summary, blocking: assetFailed,
    }));
    artifacts.push({ id: 'data-json', type: 'input', path: safeRelative(dataFile), digest: packInspection.digest });
  } catch (error) {
    inputError = true;
    findings.push(diagnosticFinding({ value: error, phase: 'validate', category: 'contract', severity: 'error', blocking: true, code: 'INPUT_ERROR', title: '无法读取 Data Pack' }));
    assurances.push(assurance('data-pack-contract', 'Data Pack contract', 'failed', { blocking: true, evidence: error.message }));
    assurances.push(assurance('asset-integrity', 'Asset integrity', 'not-assessed', { blocking: false, evidence: 'Data Pack input unavailable' }));
  }

  if (baselinePath) {
    try {
      baselineInput = readInput(baselinePath, 'baseline Data Pack');
      const baselineValidation = loader.validate(baselineInput.value);
      if (baselineValidation.errors.length || (strict && baselineValidation.warnings.length)) {
        throw new Error(`baseline Data Pack is invalid: ${[...baselineValidation.errors, ...(strict ? baselineValidation.warnings : [])].join('; ')}`);
      }
      if (packInspection && baselineInput.value.meta.id !== pack.meta.id) {
        throw new Error(`baseline meta.id does not match current Data Pack: ${baselineInput.value.meta.id}`);
      }
      inputs.baseline = safeRelative(baselinePath);
      inputs.baselineSha256 = baselineInput.digest;
      recordConsumed(inputs, baselinePath, baselineInput.digest);
      artifacts.push({ id: 'baseline-data', type: 'input', path: safeRelative(baselinePath), digest: baselineInput.digest });
    } catch (error) {
      baselineInput = null;
      inputError = true;
      findings.push(diagnosticFinding({ value: error, phase: 'diff', category: 'contract', severity: 'error', blocking: true, code: 'DIFF_INPUT_ERROR', title: '无法读取 baseline Data Pack' }));
    }
  }
  if (reviewPath) {
    try {
      reviewInput = readInput(reviewPath, 'review report');
      inputs.review = safeRelative(reviewPath);
      inputs.reviewSha256 = reviewInput.digest;
      recordConsumed(inputs, reviewPath, reviewInput.digest);
      artifacts.push({ id: 'review-report', type: 'input', path: safeRelative(reviewPath), digest: reviewInput.digest });
    } catch (error) {
      reviewInput = null;
      inputError = true;
      findings.push(diagnosticFinding({ value: error, phase: 'review', category: 'review', severity: 'error', blocking: true, code: 'REVIEW_INPUT_ERROR', title: '无法读取 review report' }));
    }
  }
  if (auditPath) {
    try {
      auditInput = readInput(auditPath, 'candidate audit');
      auditState = validateAudit(auditInput.value, strict, {
        candidateSha256: packInspection && packInspection.digest,
        baselineSha256: baselineInput && baselineInput.digest,
        reportId: reviewInput && reviewInput.value && reviewInput.value.candidateReview && reviewInput.value.candidateReview.reportId,
        itemIds: reviewInput && reviewInput.value && reviewInput.value.candidateReview && reviewInput.value.candidateReview.reviewItems
          ? reviewInput.value.candidateReview.reviewItems.map((item) => item.itemId)
          : null,
      });
      inputs.audit = safeRelative(auditPath);
      inputs.auditSha256 = auditInput.digest;
      recordConsumed(inputs, auditPath, auditInput.digest);
      artifacts.push({ id: 'candidate-audit', type: 'input', path: safeRelative(auditPath), digest: auditInput.digest });
    } catch (error) {
      auditInput = null;
      inputError = true;
      findings.push(diagnosticFinding({ value: error, phase: 'candidate', category: 'review', severity: 'error', blocking: true, code: 'AUDIT_INPUT_ERROR', title: '无法读取 Candidate audit' }));
    }
  }

  if (packInspection && fs.existsSync(rulesFile)) {
    try {
      const rulesInput = readInput(rulesFile, 'data-rules.json');
      inputs.rules = safeRelative(rulesFile);
      inputs.rulesSha256 = rulesInput.digest;
      recordConsumed(inputs, rulesFile, rulesInput.digest);
      artifacts.push({ id: 'data-rules', type: 'input', path: safeRelative(rulesFile), digest: rulesInput.digest });
      const rulesResult = executeRules(rulesInput.value, pack);
      raw.rules = rulesResult;
      for (const error of rulesResult.structuralErrors) findings.push(diagnosticFinding({ value: error, phase: 'rules', category: 'rule', severity: 'error', blocking: true, code: 'RULES_STRUCTURE', title: '规则文件结构错误' }));
      for (const result of rulesResult.results) {
        if (result.status === 'failed' || result.status === 'error') {
          const isBlocking = result.level === 'hard' || result.status === 'error' || strict;
          findings.push(diagnosticFinding({
            value: result.exception ? result.exception.message : result.rule, phase: 'rules', category: 'rule',
            severity: result.level === 'hard' || result.status === 'error' ? 'error' : 'warning', blocking: isBlocking,
            code: result.id, title: result.status === 'error' ? '规则执行错误' : '库级规则未通过', subject: result.subject,
            evidence: result.evidence, repairHint: result.repairHint,
          }));
        }
        if (result.status === 'no-check') risks.push({ id: `risk-rule-${result.id}`, severity: 'medium', status: 'open', title: `规则 ${result.id} 没有 executable check`, reason: '规则只能作为文档提示，不能被自动验证。' });
      }
      for (const [index, note] of ((rulesResult.profile && rulesResult.profile.dataShapeNotes) || []).entries()) {
        risks.push({ id: `risk-library-boundary-${index + 1}`, severity: 'low', status: 'monitored', title: '组件库开发边界', reason: note, source: 'data-rules.json profile.dataShapeNotes' });
      }
      const rulesFailed = rulesResult.structuralErrors.length > 0 || rulesResult.counts.hardFail > 0 || rulesResult.counts.errors > 0 || (strict && rulesResult.counts.softFail > 0);
      assurances.push(assurance('library-rules', 'Library rules', rulesFailed ? 'failed' : 'passed', {
        evidence: `${rulesResult.counts.passed}/${rulesResult.counts.total} executable rules passed`, details: rulesResult.counts, blocking: rulesFailed,
      }));
    } catch (error) {
      inputError = true;
      findings.push(diagnosticFinding({ value: error, phase: 'rules', category: 'rule', severity: 'error', blocking: true, code: 'RULES_INPUT_ERROR', title: '无法读取 library rules' }));
      assurances.push(assurance('library-rules', 'Library rules', 'failed', { blocking: true, evidence: error.message }));
    }
  } else {
    assurances.push(assurance('library-rules', 'Library rules', 'not-assessed', { blocking: false, evidence: packInspection ? 'data-rules.json not found' : 'Data Pack input unavailable' }));
    risks.push({ id: 'risk-no-rules', severity: 'medium', status: 'open', title: 'Library rules 未评估', reason: packInspection ? '组件库特定约束没有被自动评估。' : 'Data Pack 输入不可用。' });
  }

  if (fs.existsSync(guideFile)) {
    try {
      const digest = digestFile(guideFile, 'DATA-GUIDE.md');
      inputs.dataGuide = safeRelative(guideFile);
      inputs.dataGuideSha256 = digest;
      recordConsumed(inputs, guideFile, digest);
      artifacts.push({ id: 'data-guide', type: 'input', path: safeRelative(guideFile), digest });
    } catch (error) {
      inputError = true;
      findings.push(diagnosticFinding({ value: error, phase: 'coverage', category: 'contract', severity: 'error', blocking: true, code: 'GUIDE_INPUT_ERROR', title: '无法读取 DATA-GUIDE' }));
    }
  }

  if (configPath) {
    try {
      const configDigest = digestFile(configPath, 'extract config');
      inputs.config = safeRelative(configPath);
      inputs.configSha256 = configDigest;
      recordConsumed(inputs, configPath, configDigest);
      artifacts.push({ id: 'extract-config', type: 'input', path: safeRelative(configPath), digest: configDigest });
      const extraction = runExtractionIsolated(configPath, libDir, libId);
      const extractionFiles = Object.fromEntries(Object.entries(extraction.consumedFiles || {}).sort(([left], [right]) => left.localeCompare(right)));
      inputs.consumedFiles = Object.fromEntries(Object.entries({ ...inputs.consumedFiles, ...extractionFiles }).sort(([left], [right]) => left.localeCompare(right)));
      inputs.extractionFiles = extractionFiles;
      raw.extraction = { inventory: extraction.inventory, validation: extraction.validation, equivalence: extraction.equivalence, consumedFiles: extraction.consumedFiles };
      addValidationFindings(findings, extraction.validation, 'extract', strict);
      if (extraction.equivalence.diffs.length) findings.push(diagnosticFinding({
        value: `__fromPack equivalence has ${extraction.equivalence.diffs.length} differences`, phase: 'extract', category: 'equivalence', severity: 'error', blocking: true,
        code: 'EQUIVALENCE', title: '引擎数据无法无损还原', evidence: extraction.equivalence.diffs,
      }));
      const extractionFailed = extraction.validation.errors.length > 0 || extraction.equivalence.diffs.length > 0 || (strict && extraction.validation.warnings.length > 0);
      assurances.push(assurance('extract-equivalence', 'Extract / deep equivalence', extractionFailed ? 'failed' : 'passed', {
        evidence: `${extraction.equivalence.comparisons} deep comparisons`, details: { diffs: extraction.equivalence.diffs.length, warnings: extraction.validation.warnings.length }, blocking: extractionFailed,
      }));
    } catch (error) {
      const isInputError = !(error instanceof ExtractionError) || error.kind === 'input';
      if (isInputError) inputError = true;
      findings.push(diagnosticFinding({
        value: error, phase: 'extract', category: 'equivalence', severity: 'error', blocking: true,
        code: isInputError ? 'EXTRACT_INPUT_ERROR' : 'EQUIVALENCE_RUNTIME_ERROR',
        title: isInputError ? 'extract 配置或输入无效' : 'extract/equivalence 执行失败',
      }));
      assurances.push(assurance('extract-equivalence', 'Extract / deep equivalence', 'failed', { blocking: true, evidence: error.message }));
    }
  } else {
    assurances.push(assurance('extract-equivalence', 'Extract / deep equivalence', 'not-assessed', { blocking: false, evidence: 'extract config not provided' }));
  }

  if (baselineInput && packInspection) {
    try {
      const diff = buildDiff(baselineInput.value, pack, { old: baselinePath, new: dataFile });
      raw.diff = diff;
      changes.push(...collectChanges(diff, baselineInput.value, pack));
      impacts.push(...(diff.derivationsImpacted || []));
      assurances.push(assurance('baseline-diff', 'Baseline diff', 'passed', { evidence: `${diff.total} structural differences`, details: { total: diff.total }, blocking: false }));
    } catch (error) {
      inputError = true;
      findings.push(diagnosticFinding({ value: error, phase: 'diff', category: 'contract', severity: 'error', blocking: true, code: 'DIFF_INPUT_ERROR', title: '无法生成 baseline diff' }));
      assurances.push(assurance('baseline-diff', 'Baseline diff', 'failed', { blocking: true, evidence: error.message }));
    }
  } else {
    assurances.push(assurance('baseline-diff', 'Baseline diff', baselinePath ? 'failed' : 'not-assessed', { blocking: Boolean(baselinePath), evidence: baselinePath ? 'baseline or current Data Pack input unavailable' : 'baseline not provided' }));
  }

  let auditValid = false;
  if (auditInput) {
    const audit = auditInput.value;
    raw.audit = audit;
    operations.push(...audit.operations);
    impacts.push(...audit.derivationsImpacted);
    for (const operation of audit.operations) {
      changes.push(change({
        id: `operation-${operation.itemId}`, section: 'candidate', kind: operation.result, title: `Candidate ${operation.result}`,
        subject: operation.target, before: operation.before, after: operation.after, evidence: operation.provenance || operation.note,
      }));
    }
    for (const error of audit.validation.errors) findings.push(diagnosticFinding({ value: error, phase: 'candidate', category: 'contract', severity: 'error', blocking: true, code: 'CANDIDATE_VALIDATION', title: 'Candidate validation 未通过' }));
    for (const warning of audit.validation.warnings) findings.push(diagnosticFinding({ value: warning, phase: 'candidate', category: 'contract', severity: 'warning', blocking: strict, code: 'CANDIDATE_WARNING', title: 'Candidate validation warning' }));
    auditValid = !auditState.failed;
    assurances.push(assurance('candidate-audit', 'Candidate audit', auditValid ? 'passed' : 'failed', {
      evidence: `${audit.operations.length} operations / ${audit.unresolved.length} unresolved`, details: audit.validation, blocking: !auditValid,
    }));
  } else {
    assurances.push(assurance('candidate-audit', 'Candidate audit', auditPath ? 'failed' : 'not-assessed', { blocking: Boolean(auditPath), evidence: auditPath ? 'candidate audit input unavailable' : 'candidate audit not provided' }));
  }

  if (reviewInput) {
    try {
      const reviewResult = collectReview(reviewInput.value, auditState.resolved, findings, risks);
      if (auditInput && reviewResult.reportId && auditInput.value.inputs.reportId !== reviewResult.reportId) {
        throw new Error('candidate audit reportId does not match the supplied review report');
      }
      const expectedReviewBaseline = baselineInput
        ? baselineInput.digest
        : auditInput
          ? auditInput.value.inputs.baselineSha256
          : packInspection && packInspection.digest;
      if (reviewResult.baselineSha256 && expectedReviewBaseline && reviewResult.baselineSha256 !== expectedReviewBaseline) {
        throw new Error('candidateReview baselineSha256 does not match the reviewed Data Pack bytes');
      }
      raw.review = reviewInput.value;
      raw.reviewSummary = { total: reviewResult.total, unresolved: reviewResult.open };
      assurances.push(reviewResult.assurance);
    } catch (error) {
      inputError = true;
      findings.push(diagnosticFinding({ value: error, phase: 'review', category: 'review', severity: 'error', blocking: true, code: 'REVIEW_INPUT_ERROR', title: 'review report 与输入不一致' }));
      assurances.push(assurance('crawl-review', 'Crawl review', 'failed', { blocking: true, evidence: error.message }));
    }
  } else {
    assurances.push(assurance('crawl-review', 'Crawl review', reviewPath ? 'failed' : 'not-assessed', { blocking: Boolean(reviewPath), evidence: reviewPath ? 'review report input unavailable' : 'review report not provided' }));
  }

  assurances.push(assurance('runtime-mount', 'Runtime DOM mount', 'not-assessed', { blocking: false, evidence: 'browser/runtime mount test not connected to report collector' }));
  assurances.push(assurance('visual-regression', 'Visual regression', 'not-assessed', { blocking: false, evidence: 'visual regression test not connected to report collector' }));
  assurances.push(assurance('production-crawl', 'Production crawl', 'not-assessed', { blocking: false, evidence: reviewInput ? 'supplied crawl review artifact consumed; live production crawl was not re-run' : 'report only consumes supplied crawl artifacts' }));

  for (const finding of findings) {
    if (finding.severity === 'warning' && finding.status === 'open') {
      risks.push({ id: `risk-finding-${risks.length + 1}`, severity: finding.blocking ? 'high' : 'medium', status: 'open', title: finding.title, reason: finding.message, code: finding.code, subject: finding.subject });
    }
  }
  for (const item of assurances.filter((entry) => entry.status === 'not-assessed')) {
    risks.push({ id: `risk-${item.id}`, severity: 'medium', status: 'open', title: `${item.title} 未评估`, reason: item.evidence || '没有对应证据生产器。' });
  }
  for (const impact of impacts) {
    risks.push({ id: `risk-derivation-${impact.name}`, severity: 'medium', status: 'open', title: `Derivation ${impact.name} 受到影响`, reason: (impact.triggers || []).join(', '), consumers: impact.consumers || [] });
  }

  if (outDir) {
    artifacts.push({ id: 'report-json', type: 'output', path: safeRelative(path.join(outDir, 'report.json')), digest: null });
    artifacts.push({ id: 'report-markdown', type: 'output', path: safeRelative(path.join(outDir, 'REPORT.md')), digest: null });
  }
  return buildReport({
    command: 'report', libId, mode: reportMode(), pack, inputError, inputs,
    findings, changes, assurances, coverage: assurances, risks, operations, impacts, artifacts, raw,
  });
}

function writeReportOutputs(directory, report) {
  fs.mkdirSync(directory, { recursive: true });
  const nonce = `${process.pid}.${crypto.randomBytes(6).toString('hex')}`;
  const outputs = [
    { target: path.join(directory, 'report.json'), content: renderJson(report) },
    { target: path.join(directory, 'REPORT.md'), content: renderMarkdown(report) },
  ].map((entry) => ({ ...entry, temp: `${entry.target}.${nonce}.tmp`, backup: `${entry.target}.${nonce}.bak` }));
  const installed = [];
  const backedUp = [];
  try {
    for (const output of outputs) fs.writeFileSync(output.temp, output.content, { encoding: 'utf8', flag: 'wx' });
    for (const output of outputs) {
      if (fs.existsSync(output.target)) {
        fs.renameSync(output.target, output.backup);
        backedUp.push(output);
      }
    }
    for (const output of outputs) {
      fs.renameSync(output.temp, output.target);
      installed.push(output);
    }
    for (const output of backedUp) {
      try { fs.unlinkSync(output.backup); } catch (_) { /* a leftover backup is safer than losing the original */ }
    }
  } catch (error) {
    for (const output of installed) {
      try { fs.unlinkSync(output.target); } catch (_) { /* not installed */ }
    }
    for (const output of backedUp.reverse()) {
      try { fs.renameSync(output.backup, output.target); } catch (_) { /* preserve original error */ }
    }
    throw error;
  } finally {
    for (const output of outputs) {
      try { fs.unlinkSync(output.temp); } catch (_) { /* renamed or never created */ }
      try { fs.unlinkSync(output.backup); } catch (_) { /* restored or never created */ }
    }
  }
}

let report;
let outputWriteError = false;
try {
  report = collectReport();
} catch (error) {
  report = buildReport({
    command: 'report', libId: path.basename(libDir), mode: reportMode(), inputError: true,
    findings: [diagnosticFinding({ value: error, phase: 'report', category: 'contract', severity: 'error', blocking: true, code: 'REPORT_INPUT_ERROR', title: '报告生成失败' })],
    assurances: [], inputs: { strict, verifyHash },
  });
}

if (outDir && report.run.outcome !== 'input-error') {
  try {
    writeReportOutputs(outDir, report);
  } catch (error) {
    outputWriteError = true;
    console.error('report: could not write report outputs: ' + error.message);
  }
}

const reportPath = outDir && report.run.outcome !== 'input-error' ? safeRelative(path.join(outDir, 'REPORT.md')) : null;
if (asJson) process.stdout.write(renderJson(report));
else process.stdout.write(renderTerminalSummary(report, { reportPath }));
process.exitCode = outputWriteError ? 2 : report.run.exitCode;
