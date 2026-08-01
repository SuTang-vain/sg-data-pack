'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { contentId, isDigest, verifyArtifacts } = require('./sg-evidence-utils.js');

function validateRuntimeEvidence(evidence, options = {}) {
  const errors = [];
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return { valid: false, errors: ['runtime evidence must be an object'], status: 'not-assessed' };
  if (evidence.evidenceVersion !== '1.0') errors.push('runtime evidenceVersion must be 1.0');
  if (evidence.kind !== 'runtime-evidence') errors.push('runtime kind must be runtime-evidence');
  if (typeof evidence.scenarioId !== 'string' || !evidence.scenarioId) errors.push('runtime scenarioId is required');
  if (!isDigest(evidence.subjectTreeSha256)) errors.push('runtime subjectTreeSha256 must be sha256:<hex>');
  if (!evidence.producer || typeof evidence.producer !== 'object' || typeof evidence.producer.name !== 'string' || typeof evidence.producer.version !== 'string') errors.push('runtime producer name/version are required');
  if (!evidence.environment || typeof evidence.environment !== 'object') errors.push('runtime environment is required');
  if (!Array.isArray(evidence.assertions)) errors.push('runtime assertions must be an array');
  if (!Array.isArray(evidence.consoleErrors)) errors.push('runtime consoleErrors must be an array');
  if (!Array.isArray(evidence.pageErrors)) errors.push('runtime pageErrors must be an array');
  if (!Array.isArray(evidence.networkFailures)) errors.push('runtime networkFailures must be an array');
  if (!Array.isArray(evidence.artifacts) || !evidence.artifacts.length) errors.push('runtime artifacts must be a non-empty array');
  const assertionIds = new Set();
  for (const [index, assertion] of (evidence.assertions || []).entries()) {
    if (!assertion || typeof assertion !== 'object' || typeof assertion.id !== 'string' || !assertion.id || !['passed', 'failed'].includes(assertion.status)) errors.push(`runtime assertions[${index}] must have id and passed|failed status`);
    else if (assertionIds.has(assertion.id)) errors.push(`runtime assertion id is duplicated: ${assertion.id}`);
    else assertionIds.add(assertion.id);
  }
  verifyArtifacts(evidence.artifacts, options.baseDir, errors);
  const expectedId = contentId('runtime', evidence, ['evidenceId']);
  if (evidence.evidenceId !== expectedId) errors.push(`runtime evidenceId mismatch (expected ${expectedId})`);
  const failures = (evidence.assertions || []).filter((item) => item.status === 'failed').length
    + (evidence.consoleErrors || []).length
    + (evidence.pageErrors || []).length
    + (evidence.networkFailures || []).length;
  const complete = errors.length === 0 && (evidence.assertions || []).length > 0;
  return {
    valid: errors.length === 0,
    errors,
    status: !complete ? 'not-assessed' : failures ? 'failed' : 'passed',
    summary: {
      assertions: (evidence.assertions || []).length,
      passed: (evidence.assertions || []).filter((item) => item.status === 'passed').length,
      failed: failures,
    },
  };
}

function readRuntimeEvidence(file) {
  const evidence = JSON.parse(fs.readFileSync(file, 'utf8'));
  const validation = validateRuntimeEvidence(evidence, { baseDir: path.dirname(path.resolve(file)) });
  return { evidence, validation };
}

module.exports = { validateRuntimeEvidence, readRuntimeEvidence };
