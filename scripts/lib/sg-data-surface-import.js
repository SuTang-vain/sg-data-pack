'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const DATA_PACK_FIELDS = ['entities', 'aliases', 'relations', 'stages', 'contents', 'adapters'];

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function issue(issues, path, message) {
  issues.push({ path, message });
}

function validateSurface(surface, index, issues) {
  const path = `surfaces[${index}]`;
  if (!isObject(surface)) {
    issue(issues, path, 'surface must be an object');
    return;
  }
  if (typeof surface.id !== 'string' || !surface.id) issue(issues, `${path}.id`, 'surface id is required');
  if (!isObject(surface.owner) || typeof surface.owner.componentFile !== 'string') issue(issues, `${path}.owner`, 'component owner is required');
  if (!isObject(surface.source)) issue(issues, `${path}.source`, 'source description is required');
  if (isObject(surface.source?.static) && Object.prototype.hasOwnProperty.call(surface.source.static, 'value')) {
    issue(issues, `${path}.source.static.value`, 'raw business values are not allowed in a Data Surface Manifest');
  }
  if (!isObject(surface.shape)) issue(issues, `${path}.shape`, 'shape is required');
  if (!Array.isArray(surface.fields)) issue(issues, `${path}.fields`, 'fields must be an array');
  if (!Array.isArray(surface.consumers)) issue(issues, `${path}.consumers`, 'consumers must be an array');
  if (!Array.isArray(surface.references)) issue(issues, `${path}.references`, 'references must be an array');
  if (!Array.isArray(surface.unresolved)) issue(issues, `${path}.unresolved`, 'unresolved must be an array');
}

function validateDataSurfaceManifest(manifest) {
  const issues = [];
  if (!isObject(manifest)) return { valid: false, issues: [{ path: '$', message: 'manifest must be an object' }] };
  for (const field of DATA_PACK_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(manifest, field)) issue(issues, field, `Data Pack field ${field} must not be present in the handoff manifest`);
  }
  if (manifest.schemaVersion !== '1.0') issue(issues, 'schemaVersion', 'schemaVersion must be 1.0');
  if (manifest.kind !== 'data-surface-manifest') issue(issues, 'kind', 'kind must be data-surface-manifest');
  if (!isObject(manifest.identity)) issue(issues, 'identity', 'identity is required');
  else {
    if (manifest.identity.contractVersion !== '1.0') issue(issues, 'identity.contractVersion', 'contractVersion must be 1.0');
    if (typeof manifest.identity.sourceRoot !== 'string' || !manifest.identity.sourceRoot) issue(issues, 'identity.sourceRoot', 'sourceRoot is required');
    for (const field of ['sourceHash', 'fixtureHash', 'configurationHash']) {
      if (!HASH_PATTERN.test(manifest.identity[field] || '')) issue(issues, `identity.${field}`, `${field} must be a SHA-256 digest`);
    }
  }
  if (!isObject(manifest.library)) issue(issues, 'library', 'library description is required');
  if (!Array.isArray(manifest.surfaces)) issue(issues, 'surfaces', 'surfaces must be an array');
  else manifest.surfaces.forEach((surface, index) => validateSurface(surface, index, issues));
  if (!Array.isArray(manifest.unresolved)) issue(issues, 'unresolved', 'unresolved must be an array');
  if (!isObject(manifest.metrics)) issue(issues, 'metrics', 'metrics are required');
  else if (Array.isArray(manifest.surfaces) && manifest.metrics.surfaces !== manifest.surfaces.length) issue(issues, 'metrics.surfaces', 'surface count does not match');
  if (typeof manifest.reviewRequired !== 'boolean') issue(issues, 'reviewRequired', 'reviewRequired must be a boolean');
  return { valid: issues.length === 0, issues };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isObject(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  return value;
}

function hashCanonical(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function importDataSurfaceManifest(manifest, options = {}) {
  const validation = validateDataSurfaceManifest(manifest);
  if (!validation.valid) {
    const error = new Error(`invalid Data Surface Manifest: ${validation.issues.map(item => `${item.path}: ${item.message}`).join('; ')}`);
    error.code = 'INVALID_DATA_SURFACE_MANIFEST';
    error.issues = validation.issues;
    throw error;
  }
  const surfaceBlockers = manifest.surfaces
    .filter(surface => surface.reviewRequired || surface.unresolved.length > 0)
    .map(surface => `surface ${surface.id} requires review`);
  const blockers = [
    ...(manifest.reviewRequired ? ['manifest reviewRequired=true'] : []),
    ...(manifest.unresolved.length ? [`manifest has ${manifest.unresolved.length} unresolved evidence records`] : []),
    ...surfaceBlockers,
  ];
  const reviewRequired = blockers.length > 0;
  const report = {
    schemaVersion: '1.0',
    kind: 'data-surface-import-report',
    status: reviewRequired ? 'review-required' : 'ready',
    source: {
      kind: manifest.kind,
      identity: manifest.identity,
      digest: hashCanonical({ identity: manifest.identity, metrics: manifest.metrics, surfaces: manifest.surfaces.map(surface => surface.id) }),
    },
    library: manifest.library,
    surfaces: manifest.surfaces.map(surface => ({
      id: surface.id,
      owner: surface.owner,
      source: surface.source,
      shape: surface.shape,
      fields: surface.fields,
      consumers: surface.consumers,
      injection: surface.injection,
      references: surface.references,
      reviewRequired: surface.reviewRequired,
      unresolved: surface.unresolved,
    })),
    unresolved: manifest.unresolved,
    metrics: manifest.metrics,
    blockers,
    reviewRequired,
    dataPackGenerationAllowed: !reviewRequired,
  };
  if (reviewRequired && options.requireReady) {
    const error = new Error(`Data Surface Manifest requires review: ${blockers.join('; ')}`);
    error.code = 'DATA_SURFACE_REVIEW_REQUIRED';
    error.report = report;
    throw error;
  }
  return report;
}

function readDataSurfaceManifest(file, options) {
  return importDataSurfaceManifest(JSON.parse(fs.readFileSync(file, 'utf8')), options);
}

module.exports = { DATA_PACK_FIELDS, validateDataSurfaceManifest, importDataSurfaceManifest, readDataSurfaceManifest };
