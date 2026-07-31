'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const {
  importDataSurfaceManifest,
  validateDataSurfaceManifest,
} = require('../scripts/lib/sg-data-surface-import.js');

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
  assert.throws(() => importDataSurfaceManifest(input, { requireReady: true }), /requires review/);
});

test('Data Surface importer rejects Data Pack fields and raw static values', () => {
  const forbidden = { ...manifest(), entities: [] };
  assert.equal(validateDataSurfaceManifest(forbidden).valid, false);
  const raw = manifest({ surfaces: [{ ...manifest().surfaces[0], source: { primary: 'module-static-binding', static: { binding: 'items', value: [{ name: 'raw' }] } } }] });
  assert.equal(validateDataSurfaceManifest(raw).valid, false);
});

test('data-surface-import CLI writes a review report and preserves the explicit gate', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-data-surface-import-'));
  const input = path.join(directory, 'manifest.json');
  const output = path.join(directory, 'report.json');
  fs.writeFileSync(input, JSON.stringify(manifest({ reviewRequired: true, unresolved: [{ reason: 'review' }], metrics: { surfaces: 1, apiSurfaces: 1, staticSurfaces: 0, reviewedFixtures: 1, fields: 1, references: 0, unresolved: 1 } })));
  const result = require('node:child_process').spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'sg-data-pack'), 'data-surface-import', input, '--out', output, '--allow-review-required'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.equal(report.status, 'review-required');
  assert.equal(report.dataPackGenerationAllowed, false);
  fs.rmSync(directory, { recursive: true, force: true });
});
