'use strict';

/*
 * Pure Review Decisions -> Candidate Pack builder.
 * File I/O, output paths, and process exit codes belong to sg-pack-candidate.js.
 */
const { sha256, buildCandidateReview, verifyCandidateReview } = require('./sg-recrawl-review.js');
const { buildDiff } = require('./sg-pack-diff.js');
require('./sg-data-loader.js');

const loader = globalThis.SGDataLoader;
const SUPPORTED_ACTIONS = new Set(['apply', 'keep', 'map-alias', 'reject']);
const RESERVED_FIELDS = new Set(['kind', '__proto__', 'prototype', 'constructor']);
const RESERVED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

class CandidateError extends Error {
  constructor(message, exitCode = 2) {
    super(message);
    this.name = 'CandidateError';
    this.exitCode = exitCode;
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function sameValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function requireString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new CandidateError(`${label} must be a non-empty string`);
  return value;
}

function validateConfidence(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new CandidateError(`${label} must be a number between 0 and 1`);
  }
}

function pathText(section, id, field) {
  return `${section}.${id}.${field}`;
}

function validateReportShape(report) {
  if (!isObject(report)) throw new CandidateError('review report must be an object');
  const review = report.candidateReview;
  if (!isObject(review)) throw new CandidateError('review report is missing candidateReview');
  if (!Array.isArray(review.observations) || !Array.isArray(review.reviewItems)) {
    throw new CandidateError('candidateReview observations and reviewItems must be arrays');
  }
  if (new Set(review.reviewItems.map((item) => item && item.itemId)).size !== review.reviewItems.length) {
    throw new CandidateError('candidate review contains duplicate review item ids');
  }
  const allItemMap = new Map();
  const reviewItemMap = new Map();
  const observationMap = new Map();
  for (const observation of review.observations) {
    if (!isObject(observation) || typeof observation.recordId !== 'string') throw new CandidateError('candidate observation has an invalid recordId');
    if (observationMap.has(observation.recordId)) throw new CandidateError(`duplicate candidate observation: ${observation.recordId}`);
    observationMap.set(observation.recordId, observation);
    if (observation.resolution && observation.resolution.status === 'hit') {
      if (!Array.isArray(observation.checks)) throw new CandidateError(`${observation.recordId}.checks must be an array`);
      for (const check of observation.checks) {
        if (!isObject(check) || typeof check.itemId !== 'string') throw new CandidateError(`${observation.recordId} has an invalid field check`);
        if (allItemMap.has(check.itemId)) throw new CandidateError(`duplicate candidate check: ${check.itemId}`);
        allItemMap.set(check.itemId, { type: 'field', observation, check });
      }
    }
    if (observation.resolution && observation.resolution.status === 'miss') {
      const identityId = `${observation.recordId}:identity`;
      if (allItemMap.has(identityId)) throw new CandidateError(`duplicate candidate identity: ${identityId}`);
      allItemMap.set(identityId, { type: 'identity', observation });
    }
  }
  for (const item of review.reviewItems) {
    if (!isObject(item) || typeof item.itemId !== 'string') throw new CandidateError('candidate review item has an invalid itemId');
    if (!allItemMap.has(item.itemId)) throw new CandidateError(`review item does not resolve to an observation: ${item.itemId}`);
    const source = allItemMap.get(item.itemId);
    if (source.type === 'field' && source.check.classification !== item.classification) {
      throw new CandidateError(`review item classification mismatch: ${item.itemId}`);
    }
    if (source.type === 'identity' && item.classification !== 'miss') {
      throw new CandidateError(`identity review item must be classified as miss: ${item.itemId}`);
    }
    reviewItemMap.set(item.itemId, source);
  }
  for (const [itemId, source] of allItemMap) {
    const requiresReview = source.type === 'identity' ||
      (source.type === 'field' && ['gap', 'conflict', 'unsupported'].includes(source.check.classification));
    if (requiresReview && !reviewItemMap.has(itemId)) {
      throw new CandidateError(`candidate review omitted required item: ${itemId}`);
    }
  }
  return { review, itemMap: reviewItemMap, allItemMap, observationMap };
}

function validateDecisions(decisions, reviewId, itemMap) {
  if (!isObject(decisions) || decisions.decisionsVersion !== '1.0') {
    throw new CandidateError('review decisions must use decisionsVersion "1.0"');
  }
  if (decisions.reportId !== reviewId) throw new CandidateError('review decisions reportId does not match candidate review report');
  requireString(decisions.reviewedBy, 'reviewedBy');
  requireString(decisions.reviewedAt, 'reviewedAt');
  if (!Array.isArray(decisions.decisions)) throw new CandidateError('review decisions must contain a decisions array');
  const seen = new Set();
  for (const decision of decisions.decisions) {
    if (!isObject(decision)) throw new CandidateError('each review decision must be an object');
    requireString(decision.itemId, 'decision.itemId');
    if (seen.has(decision.itemId)) throw new CandidateError(`duplicate decision for review item: ${decision.itemId}`);
    seen.add(decision.itemId);
    if (!itemMap.has(decision.itemId)) throw new CandidateError(`decision references unknown review item: ${decision.itemId}`);
    requireString(decision.action, `decision ${decision.itemId}.action`);
    if (!SUPPORTED_ACTIONS.has(decision.action)) throw new CandidateError(`unsupported decision action: ${decision.action}`);
  }
  const expected = [...itemMap.keys()];
  const missing = expected.filter((itemId) => !seen.has(itemId));
  const extra = [...seen].filter((itemId) => !itemMap.has(itemId));
  if (missing.length || extra.length) {
    throw new CandidateError(
      `review decisions are incomplete (missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'})`,
      1,
    );
  }
  return decisions;
}

function checkCurrentBaseline(entity, check, entityId) {
  const exists = hasOwn(entity, check.baselineField);
  const current = exists ? entity[check.baselineField] : undefined;
  if (exists !== Boolean(check.baselineExists) || !sameValue(current, check.baseline)) {
    throw new CandidateError(`stale entity field at ${pathText('entities', entityId, check.baselineField)}`, 1);
  }
}

function displayField(pack, entity) {
  const fields = pack.kindNameFields;
  return isObject(fields) && hasOwn(fields, entity.kind) && fields[entity.kind] ? fields[entity.kind] : 'name';
}

function validateAliasTarget(pack, entityId) {
  if (typeof entityId !== 'string' || !hasOwn(pack.entities || {}, entityId)) {
    throw new CandidateError(`map-alias target must be an existing entity: ${entityId}`);
  }
}

function aliasValue(target, context) {
  if (context === undefined) return target;
  if (typeof context !== 'string' || !context.trim()) throw new CandidateError('alias context must be a non-empty string');
  return { id: target, context };
}

function applyAlias(pack, observation, decision, audit) {
  const alias = observation.crawledName;
  const target = decision.entityId;
  validateAliasTarget(pack, target);
  if (RESERVED_KEYS.has(alias)) throw new CandidateError(`reserved alias key is not allowed: ${alias}`);
  if (hasOwn(pack.entities, alias)) throw new CandidateError(`alias collides with entity id: ${alias}`);
  if (hasOwn(pack.aliases || {}, alias)) {
    const current = pack.aliases[alias];
    const currentId = isObject(current) ? current.id : current;
    if (currentId !== target) throw new CandidateError(`existing alias points to a different entity: ${alias}`);
    const requested = aliasValue(target, decision.context);
    if (decision.context !== undefined && !sameValue(current, requested)) {
      throw new CandidateError(`existing alias has different reviewed context: ${alias}`);
    }
    audit.result = 'noop-already-applied';
    audit.before = current;
    audit.after = current;
    return;
  }
  if (!isObject(pack.aliases)) pack.aliases = {};
  const next = aliasValue(target, decision.context);
  pack.aliases[alias] = next;
  audit.result = 'applied';
  audit.before = null;
  audit.after = next;
}

function mergeFieldOrigin(entityProvenance, check, decision, context) {
  if (!isObject(entityProvenance)) entityProvenance = {};
  if (!isObject(entityProvenance.fieldOrigins)) entityProvenance.fieldOrigins = {};
  const field = check.baselineField;
  const origin = {
    origin: context.review.origin,
    sourceUrl: context.review.sourceUrl,
    fetchedAt: context.review.fetchedAt,
    confidence: decision.confidence,
    note: decision.note || `Applied reviewed crawl field ${check.crawledField}`,
    reportId: context.review.reportId,
    recordId: context.observation.recordId,
    itemId: check.itemId,
    reviewedBy: context.decisions.reviewedBy,
    reviewedAt: context.decisions.reviewedAt,
  };
  entityProvenance.fieldOrigins[field] = origin;
  return entityProvenance;
}

function applyField(pack, observation, check, decision, context, audit) {
  const entityId = observation.resolution.entityId;
  const entity = pack.entities[entityId];
  if (!entity) throw new CandidateError(`field decision references missing entity: ${entityId}`);
  if (decision.action === 'keep') {
    audit.result = 'kept-baseline';
    audit.before = check.baseline;
    audit.after = check.baseline;
    return;
  }
  if (check.classification === 'unsupported') {
    throw new CandidateError(`unsupported review item may only use keep: ${check.itemId}`);
  }
  if (!['gap', 'conflict'].includes(check.classification)) {
    throw new CandidateError(`apply is not valid for ${check.classification}: ${check.itemId}`);
  }
  validateConfidence(decision.confidence, `decision ${decision.itemId}.confidence`);
  const field = check.baselineField;
  if (RESERVED_FIELDS.has(field) || field === displayField(pack, entity)) {
    throw new CandidateError(`cannot update reserved or display entity field: ${field}`);
  }
  if (field.includes('.') || field.includes('[') || field.includes(']')) {
    throw new CandidateError(`nested entity field updates are not supported: ${field}`);
  }
  if (typeof check.crawled !== 'string' || !check.crawled) {
    throw new CandidateError(`applied crawl value must be a non-empty string: ${check.itemId}`);
  }
  const before = hasOwn(entity, field) ? entity[field] : undefined;
  if (before === check.crawled) {
    audit.result = 'noop-already-applied';
    audit.before = before;
    audit.after = before;
    return;
  }
  entity[field] = check.crawled;
  audit.result = 'applied';
  audit.before = before;
  audit.after = check.crawled;
  if (!isObject(pack.provenance)) pack.provenance = {};
  if (!isObject(pack.provenance.entities)) pack.provenance.entities = {};
  let entityProvenance = pack.provenance.entities[entityId];
  if (!entityProvenance) {
    entityProvenance = {
      origin: 'baseline-untracked',
      sourceUrl: null,
      fetchedAt: context.review.fetchedAt,
      confidence: 1,
      note: 'Baseline record had no provenance; reviewed crawl evidence is recorded per field in fieldOrigins.',
    };
  }
  pack.provenance.entities[entityId] = mergeFieldOrigin(entityProvenance, check, decision, context);
  audit.provenance = pack.provenance.entities[entityId].fieldOrigins[field];
}

function validateFieldOperations(baselinePack, itemMap, decisions) {
  const writes = new Map();
  const decisionsByItem = new Map(decisions.decisions.map((decision) => [decision.itemId, decision]));
  for (const [itemId, source] of itemMap) {
    if (source.type !== 'field') continue;
    const entityId = source.observation.resolution.entityId;
    const entity = baselinePack.entities && baselinePack.entities[entityId];
    if (!entity) throw new CandidateError(`field review item references missing entity: ${entityId}`, 1);
    checkCurrentBaseline(entity, source.check, entityId);
    const decision = decisionsByItem.get(itemId);
    if (!decision || decision.action !== 'apply') continue;
    const key = `${entityId}\u0000${source.check.baselineField}`;
    const value = source.check.crawled;
    const current = writes.get(key);
    if (current && current.value !== value) {
      throw new CandidateError(`conflicting reviewed values for entities.${entityId}.${source.check.baselineField}`);
    }
    writes.set(key, { value, itemId });
  }
}

function validateAllowedSections(before, after) {
  const allowed = new Set(['aliases', 'entities', 'provenance']);
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (allowed.has(key)) continue;
    if (!sameValue(before[key], after[key])) throw new CandidateError(`candidate changed unsupported section: ${key}`, 1);
  }
  const beforeAliases = before.aliases || {};
  const afterAliases = after.aliases || {};
  for (const key of Object.keys(beforeAliases)) {
    if (!sameValue(beforeAliases[key], afterAliases[key])) throw new CandidateError(`candidate rewrote existing alias: ${key}`, 1);
  }
  const beforeEntities = before.entities || {};
  const afterEntities = after.entities || {};
  for (const id of Object.keys(beforeEntities)) {
    if (!hasOwn(afterEntities, id)) throw new CandidateError(`candidate removed entity: ${id}`, 1);
    const fields = new Set([...Object.keys(beforeEntities[id]), ...Object.keys(afterEntities[id])]);
    for (const field of fields) {
      if (field === 'kind' || field === 'name') {
        if (!sameValue(beforeEntities[id][field], afterEntities[id][field])) throw new CandidateError(`candidate changed protected entity field: entities.${id}.${field}`, 1);
      }
    }
  }
  for (const id of Object.keys(afterEntities)) {
    if (!hasOwn(beforeEntities, id)) throw new CandidateError(`candidate added entity: ${id}`, 1);
  }
}

function buildCandidate({ baselinePack, baselineBytes, report, decisions, decisionsBytes, strict = false, recordsBytes, rawRecords }) {
  if (!isObject(baselinePack)) throw new CandidateError('baseline Data Pack must be an object', 2);
  const baselineValidation = loader.validate(baselinePack);
  if (baselineValidation.errors.length) throw new CandidateError(`baseline Data Pack is invalid: ${baselineValidation.errors.join('; ')}`, 1);
  let candidateReview;
  try {
    candidateReview = verifyCandidateReview(report, baselineBytes, recordsBytes);
  } catch (error) {
    throw new CandidateError(error.message, 2);
  }
  let rebuiltReview;
  try {
    rebuiltReview = buildCandidateReview({
      pack: baselinePack,
      rawRecords,
      baselineBytes,
      recordsBytes,
      origin: candidateReview.origin,
      sourceUrl: candidateReview.sourceUrl,
      fetchedAt: candidateReview.fetchedAt,
    });
  } catch (error) {
    throw new CandidateError(`candidate review cannot be reproduced: ${error.message}`, 2);
  }
  if (!sameValue(rebuiltReview, candidateReview)) {
    throw new CandidateError('candidate review does not match a fresh cross-check of baseline and records', 2);
  }
  const reportContext = validateReportShape(report);
  validateDecisions(decisions, candidateReview.reportId, reportContext.itemMap);
  validateFieldOperations(baselinePack, reportContext.itemMap, decisions);

  const candidate = deepClone(baselinePack);
  const auditOperations = [];
  const context = { review: candidateReview, decisions };
  const decisionsByItem = new Map(decisions.decisions.map((decision) => [decision.itemId, decision]));
  for (const itemId of reportContext.itemMap.keys()) {
    const decision = decisionsByItem.get(itemId);
    const source = reportContext.itemMap.get(decision.itemId);
    const audit = {
      decisionId: decision.itemId,
      itemId: decision.itemId,
      action: decision.action,
      target: null,
      result: null,
      before: null,
      after: null,
      note: decision.note || null,
    };
    if (source.type === 'identity') {
      audit.target = `aliases.${source.observation.crawledName}`;
      if (decision.action === 'map-alias') {
        if (source.observation.rawFields && Object.keys(source.observation.rawFields).length) {
          // Identity approval must not silently turn un-cross-checked fields into entity writes.
          audit.note = audit.note || 'Identity mapped; business fields require a follow-up recrawl review.';
        }
        applyAlias(candidate, source.observation, decision, audit);
      } else if (decision.action === 'reject') {
        audit.result = 'rejected';
      } else {
        throw new CandidateError(`identity review item requires map-alias or reject: ${decision.itemId}`);
      }
    } else {
      const check = source.check;
      audit.target = pathText('entities', source.observation.resolution.entityId, check.baselineField);
      if (decision.action === 'map-alias' || decision.action === 'reject') {
        throw new CandidateError(`field review item cannot use ${decision.action}: ${decision.itemId}`);
      }
      applyField(candidate, source.observation, check, decision, { ...context, observation: source.observation }, audit);
    }
    auditOperations.push(audit);
  }

  validateAllowedSections(baselinePack, candidate);
  const validation = loader.validate(candidate);
  if (validation.errors.length) throw new CandidateError(`candidate Data Pack is invalid: ${validation.errors.join('; ')}`, 1);
  if (strict && validation.warnings.length) throw new CandidateError(`strict candidate validation failed: ${validation.warnings.join('; ')}`, 1);

  const candidateBytes = Buffer.from(JSON.stringify(candidate, null, 2) + '\n', 'utf8');
  const diff = buildDiff(baselinePack, candidate, { old: 'baseline', new: 'candidate' });
  const audit = {
    auditVersion: '1.0',
    status: 'valid',
    inputs: {
      baselineSha256: sha256(baselineBytes),
      recordsSha256: sha256(recordsBytes),
      reportId: candidateReview.reportId,
      decisionsSha256: sha256(decisionsBytes),
      candidateSha256: sha256(candidateBytes),
    },
    review: {
      reviewedBy: decisions.reviewedBy,
      reviewedAt: decisions.reviewedAt,
    },
    operations: auditOperations,
    unresolved: [],
    validation: {
      errors: validation.errors,
      warnings: validation.warnings,
    },
    diff: {
      entities: diff.entities,
      aliases: diff.aliases,
      provenance: diff.provenance,
      total: diff.total,
    },
    derivationsImpacted: diff.derivationsImpacted,
  };
  return { candidate, candidateBytes, audit, auditBytes: Buffer.from(JSON.stringify(audit, null, 2) + '\n', 'utf8') };
}

module.exports = {
  CandidateError,
  buildCandidate,
  validateReportShape,
  validateDecisions,
};
