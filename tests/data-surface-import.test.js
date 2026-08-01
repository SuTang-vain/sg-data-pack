'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const {
  DATA_PACK_FIELDS,
  importDataSurfaceManifest,
  validateDataSurfaceManifest,
} = require('../scripts/lib/sg-data-surface-import.js');

const CLI = path.join(__dirname, '..', 'scripts', 'sg-data-pack');

function runCli(args) {
  return spawnSync(process.execPath, [CLI, 'data-surface-import', ...args], { encoding: 'utf8' });
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  return value;
}

function canonicalDigest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function manifest(overrides = {}) {
  return {
    schemaVersion: '1.0',
    kind: 'data-surface-manifest',
    identity: {
      contractVersion: '1.0',
      sourceRoot: 'fixture/library',
      sourceHash: 'a'.repeat(64),
      sourceHashKind: 'source-content',
      fixtureHash: 'b'.repeat(64),
      fixtureHashKind: 'fixture-content',
      configurationHash: 'c'.repeat(64),
      configurationHashKind: 'configuration-content',
      skillVersions: { 'data-surface-manifest': '1.0.0' },
    },
    library: { sourceRoot: 'fixture/library', framework: 'vue-sfc' },
    surfaces: [{
      id: 'api:sfc:login:getUserInfo',
      owner: { componentId: 'sfc:login', componentName: 'LoginForm', componentFile: 'src/views/login.vue' },
      source: { primary: 'reviewed-api-fixture', api: { responsibilityId: 'api:1', method: 'POST', path: '/login', responsePath: 'data', bodyHash: 'd'.repeat(64), reviewed: true, transportPrefixes: ['/api'] } },
      shape: { kind: 'record', itemKind: 'record', cardinality: 1, evidence: ['reviewed fixture'] },
      fields: [{ path: 'name', type: 'string', consumers: ['template:name'] }],
      consumers: [{ componentId: 'sfc:login', componentName: 'LoginForm', componentFile: 'src/views/login.vue', targetBinding: 'user', responsePath: 'data', renderedFields: ['name'] }],
      injection: { kind: 'state-binding', target: 'user', sourcePath: 'data', reviewed: true },
      references: [],
      evidence: [{ source: 'src/views/login.vue', detail: 'fixture consumed by reviewed response flow', confidence: 'high' }],
      unresolved: [],
      reviewRequired: false,
    }],
    unresolved: [],
    metrics: { surfaces: 1, apiSurfaces: 1, staticSurfaces: 0, reviewedFixtures: 1, fields: 1, references: 0, unresolved: 0 },
    reviewRequired: false,
    ...overrides,
  };
}

test('Data Surface importer accepts a ready interface manifest without generating Data Pack fields', () => {
  const input = manifest();
  assert.equal(validateDataSurfaceManifest(input).valid, true);
  const report = importDataSurfaceManifest(input, { requireReady: true });
  assert.equal(report.kind, 'data-surface-import-report');
  assert.equal(report.status, 'ready');
  assert.equal(report.dataPackGenerationAllowed, true);
  assert.equal(report.surfaces.length, 1);
  assert.deepEqual(report.surfaces[0].evidence, input.surfaces[0].evidence);
  assert.equal(report.source.digest, canonicalDigest(input));
  assert.equal(report.review.policyNotices.length, 0);
  for (const key of ['entities', 'aliases', 'relations', 'stages', 'contents', 'adapters']) {
    assert.equal(Object.prototype.hasOwnProperty.call(report, key), false);
  }
});

test('Data Surface importer keeps review-required manifests auditable but blocks generation', () => {
  const input = manifest({
    reviewRequired: true,
    unresolved: [{ source: 'src/views/login.vue', reason: 'field ownership requires review' }],
    metrics: { surfaces: 1, apiSurfaces: 1, staticSurfaces: 0, reviewedFixtures: 1, fields: 1, references: 0, unresolved: 1 },
  });
  const report = importDataSurfaceManifest(input);
  assert.equal(report.status, 'review-required');
  assert.equal(report.dataPackGenerationAllowed, false);
  assert.equal(report.blockers.length > 0, true);
  assert.equal(Array.isArray(report.review.policyNotices), true);
  assert.throws(() => importDataSurfaceManifest(input, { requireReady: true }), /requires review/);
});

test('Data Surface importer rejects every Data Pack v1.3 root field and raw static values', () => {
  for (const field of DATA_PACK_FIELDS) {
    const forbidden = { ...manifest(), [field]: {} };
    const validation = validateDataSurfaceManifest(forbidden);
    assert.equal(validation.valid, false, `${field} must be rejected`);
    assert.ok(validation.issues.some(issue => issue.path === field));
  }
  const raw = manifest({ surfaces: [{ ...manifest().surfaces[0], source: { primary: 'module-static-binding', static: { binding: 'items', value: [{ name: 'raw' }] } } }] });
  assert.equal(validateDataSurfaceManifest(raw).valid, false);
});

test('Data Surface importer requires surface.reviewRequired to be boolean when present', () => {
  const missing = manifest({ surfaces: [{ ...manifest().surfaces[0] }] });
  delete missing.surfaces[0].reviewRequired;
  assert.equal(validateDataSurfaceManifest(missing).valid, true);

  for (const invalid of [null, 0, 'false', [], {}]) {
    const input = manifest({ surfaces: [{ ...manifest().surfaces[0], reviewRequired: invalid }] });
    const validation = validateDataSurfaceManifest(input);
    assert.equal(validation.valid, false);
    assert.ok(validation.issues.some(issue => issue.path === 'surfaces[0].reviewRequired'));
  }
});

test('Data Surface digest binds all canonical manifest evidence', () => {
  const first = manifest();
  const changed = manifest({
    surfaces: [{ ...manifest().surfaces[0], evidence: [{ source: 'changed.vue', detail: 'changed evidence', confidence: 'low' }] }],
  });
  assert.notEqual(importDataSurfaceManifest(first).source.digest, importDataSurfaceManifest(changed).source.digest);
  const reordered = {
    reviewRequired: first.reviewRequired,
    metrics: first.metrics,
    unresolved: first.unresolved,
    surfaces: first.surfaces,
    library: first.library,
    identity: first.identity,
    kind: first.kind,
    schemaVersion: first.schemaVersion,
  };
  assert.equal(importDataSurfaceManifest(first).source.digest, importDataSurfaceManifest(reordered).source.digest);
});

test('data-surface-import CLI writes a review report and preserves the explicit gate', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-data-surface-import-'));
  const input = path.join(directory, 'manifest.json');
  const output = path.join(directory, 'report.json');
  fs.writeFileSync(input, JSON.stringify(manifest({ reviewRequired: true, unresolved: [{ reason: 'review' }], metrics: { surfaces: 1, apiSurfaces: 1, staticSurfaces: 0, reviewedFixtures: 1, fields: 1, references: 0, unresolved: 1 } })));
  const result = runCli([input, '--out', output, '--allow-review-required']);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.equal(report.status, 'review-required');
  assert.equal(report.dataPackGenerationAllowed, false);
  fs.rmSync(directory, { recursive: true, force: true });
});

test('data-surface-import CLI rejects unknown and duplicate flags', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-data-surface-import-flags-'));
  const input = path.join(directory, 'manifest.json');
  fs.writeFileSync(input, JSON.stringify(manifest()));
  for (const args of [[input, '--unknown'], [input, '--allow-review-required', '--allow-review-required'], [input, '--out', path.join(directory, 'a'), '--out', path.join(directory, 'b')], [input, '--out']]) {
    const result = runCli(args);
    assert.equal(result.status, 2, `${args.join(' ')} should be usage error`);
  }
  fs.rmSync(directory, { recursive: true, force: true });
});

test('data-surface-import CLI rejects --out aliases of the input and writes atomically', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-data-surface-import-output-'));
  const input = path.join(directory, 'manifest.json');
  const output = path.join(directory, 'report.json');
  const symlink = path.join(directory, 'manifest-symlink.json');
  const hardlink = path.join(directory, 'manifest-hardlink.json');
  fs.writeFileSync(input, JSON.stringify(manifest()));
  fs.symlinkSync(input, symlink);
  fs.linkSync(input, hardlink);
  for (const alias of [input, symlink, hardlink]) {
    const result = runCli([input, '--out', alias]);
    assert.equal(result.status, 2, `output alias ${alias} must be rejected`);
  }
  const result = runCli([input, '--out', output]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(fs.readFileSync(output, 'utf8')).source.digest, canonicalDigest(manifest()));
  assert.equal(fs.readdirSync(directory).some(file => file.endsWith('.tmp')), false, 'temporary output must be cleaned');
  fs.rmSync(directory, { recursive: true, force: true });
});
