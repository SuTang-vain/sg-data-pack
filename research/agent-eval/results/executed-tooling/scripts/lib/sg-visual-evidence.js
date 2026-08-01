'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { contentId, isDigest, verifyArtifacts } = require('./sg-evidence-utils.js');

function validateVisualEvidence(evidence, options = {}) {
  const errors = [];
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return { valid: false, errors: ['visual evidence must be an object'], status: 'not-assessed' };
  if (evidence.evidenceVersion !== '1.0') errors.push('visual evidenceVersion must be 1.0');
  if (evidence.kind !== 'visual-evidence') errors.push('visual kind must be visual-evidence');
  for (const field of ['referenceTreeSha256', 'candidateTreeSha256', 'configurationSha256']) if (!isDigest(evidence[field])) errors.push(`visual ${field} must be sha256:<hex>`);
  if (!evidence.producer || typeof evidence.producer.name !== 'string' || typeof evidence.producer.version !== 'string') errors.push('visual producer name/version are required');
  if (!evidence.thresholds || typeof evidence.thresholds !== 'object') errors.push('visual thresholds are required');
  else {
    if (typeof evidence.thresholds.maxPixelDiffRatio !== 'number' || evidence.thresholds.maxPixelDiffRatio < 0 || evidence.thresholds.maxPixelDiffRatio > 1) errors.push('visual maxPixelDiffRatio must be between 0 and 1');
    if (typeof evidence.thresholds.minComputedStyleScore !== 'number' || evidence.thresholds.minComputedStyleScore < 0 || evidence.thresholds.minComputedStyleScore > 1) errors.push('visual minComputedStyleScore must be between 0 and 1');
    if (typeof evidence.thresholds.minCoverage !== 'number' || evidence.thresholds.minCoverage < 0 || evidence.thresholds.minCoverage > 1) errors.push('visual minCoverage must be between 0 and 1');
  }
  if (!Array.isArray(evidence.scenarios) || !evidence.scenarios.length) errors.push('visual scenarios must be a non-empty array');
  if (!Array.isArray(evidence.artifacts) || !evidence.artifacts.length) errors.push('visual artifacts must be a non-empty array');
  const artifactIds = verifyArtifacts(evidence.artifacts, options.baseDir, errors);
  const artifactById = new Map((evidence.artifacts || []).filter((item) => item && typeof item.id === 'string').map((item) => [item.id, item]));
  const scenarioIds = new Set();
  const scenarioResults = [];
  for (const [index, scenario] of (evidence.scenarios || []).entries()) {
    const scenarioErrors = [];
    if (!scenario || typeof scenario !== 'object' || typeof scenario.id !== 'string' || !scenario.id) scenarioErrors.push(`scenarios[${index}].id is required`);
    else if (scenarioIds.has(scenario.id)) scenarioErrors.push(`scenarios[${index}].id is duplicated`);
    else scenarioIds.add(scenario.id);
    if (!scenario || !scenario.viewport || !Number.isInteger(scenario.viewport.width) || scenario.viewport.width <= 0 || !Number.isInteger(scenario.viewport.height) || scenario.viewport.height <= 0) scenarioErrors.push(`scenarios[${index}].viewport width/height must be positive integers`);
    for (const field of ['pixelDiffRatio', 'computedStyleScore', 'coverage']) if (!scenario || typeof scenario[field] !== 'number' || !Number.isFinite(scenario[field]) || scenario[field] < 0 || scenario[field] > 1) scenarioErrors.push(`scenarios[${index}].${field} must be a finite number between 0 and 1`);
    if (!scenario || !Number.isInteger(scenario.stabilityFailures) || scenario.stabilityFailures < 0) scenarioErrors.push(`scenarios[${index}].stabilityFailures must be a non-negative integer`);
    const refs = [];
    for (const field of ['referenceArtifact', 'candidateArtifact', 'diffArtifact']) {
      const id = scenario && scenario[field];
      const artifact = artifactById.get(id);
      if (typeof id !== 'string' || !artifactIds.has(id)) scenarioErrors.push(`scenarios[${index}].${field} must reference a verified artifact`);
      else if (typeof artifact.mediaType !== 'string' || !artifact.mediaType.startsWith('image/')) scenarioErrors.push(`scenarios[${index}].${field} must reference an image artifact`);
      refs.push(id);
    }
    if (new Set(refs).size !== refs.length) scenarioErrors.push(`scenarios[${index}] reference, candidate, and diff artifacts must be distinct`);
    const thresholdFailed = scenario && evidence.thresholds && (
      scenario.pixelDiffRatio > evidence.thresholds.maxPixelDiffRatio
      || scenario.computedStyleScore < evidence.thresholds.minComputedStyleScore
      || scenario.coverage < evidence.thresholds.minCoverage
      || Number(scenario.stabilityFailures || 0) > 0
    );
    errors.push(...scenarioErrors);
    scenarioResults.push({ id: scenario && scenario.id || `scenario-${index + 1}`, status: scenarioErrors.length ? 'not-assessed' : thresholdFailed ? 'failed' : 'passed', errors: scenarioErrors });
  }
  const expectedId = contentId('visual', evidence, ['evidenceId']);
  if (evidence.evidenceId !== expectedId) errors.push(`visual evidenceId mismatch (expected ${expectedId})`);
  const complete = errors.length === 0 && scenarioResults.length > 0 && scenarioResults.every((item) => item.status !== 'not-assessed');
  return {
    valid: errors.length === 0,
    errors,
    status: !complete ? 'not-assessed' : scenarioResults.some((item) => item.status === 'failed') ? 'failed' : 'passed',
    scenarios: scenarioResults,
    summary: {
      total: scenarioResults.length,
      passed: scenarioResults.filter((item) => item.status === 'passed').length,
      failed: scenarioResults.filter((item) => item.status === 'failed').length,
      notAssessed: scenarioResults.filter((item) => item.status === 'not-assessed').length,
    },
  };
}

function readVisualEvidence(file) {
  const evidence = JSON.parse(fs.readFileSync(file, 'utf8'));
  const validation = validateVisualEvidence(evidence, { baseDir: path.dirname(path.resolve(file)) });
  return { evidence, validation };
}

module.exports = { validateVisualEvidence, readVisualEvidence };
