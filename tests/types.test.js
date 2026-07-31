'use strict';
/*
 * types.test.js — sg-pack-types generation tests
 *
 * Run: node --test tests/*.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const TYPES = path.join(__dirname, '..', 'scripts', 'sg-pack-types.js');

function withPack(pack, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-types-'));
  const packPath = path.join(dir, 'pack.json');
  fs.writeFileSync(packPath, JSON.stringify(pack));
  try {
    return run({ dir, packPath });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function generateTypes(pack) {
  return withPack(pack, ({ dir, packPath }) => {
    const outPath = path.join(dir, 'types.d.ts');
    execFileSync(process.execPath, [TYPES, packPath, '--name', 'Demo', '--out', outPath], { encoding: 'utf8' });
    return fs.readFileSync(outPath, 'utf8');
  });
}

function minimalPack(overrides) {
  return Object.assign({
    schemaVersion: '1.3',
    meta: { id: 'demo', title: 'Demo' },
    entities: { a: { kind: 'person', name: 'A' } },
  }, overrides || {});
}

test('SgDerivation includes alsoTouches and affects', () => {
  const dts = generateTypes(minimalPack({
    derivations: {
      d1: {
        kind: 'projection', source: 'entities', consumers: ['e'],
        affects: ['div.x'], alsoTouches: ['entities.*.name'], note: 'n',
      },
    },
  }));
  assert.match(dts, /alsoTouches\?:\s*string\[\]/);
  assert.match(dts, /affects\?:\s*string\[\]/);
});

test('contract types include stable relation ids and contextual aliases', () => {
  const dts = generateTypes(minimalPack({ aliases: { Alias: { id: 'a', context: 'pilot' } } }));
  assert.match(dts, /interface SgRelation \{ id\?: string;/);
  assert.match(dts, /aliases\?: Record<string, string \| \{ id: string; context\?: string;/);
});

test('generated schemaVersion union matches all supported contract versions', () => {
  const dts = generateTypes(minimalPack());
  const declared = /schemaVersion: ([^;]+);/.exec(dts)[1].match(/'[^']+'/g).map((value) => value.slice(1, -1));
  assert.deepEqual(declared, ['1.0', '1.1', '1.2', '1.3']);
});

test('generated top-level sections follow the schema optionality policy', () => {
  const dts = generateTypes(minimalPack());
  for (const field of ['aliases', 'relationTypes', 'heroRelTypes', 'relations', 'stages', 'attributeTypes', 'attributeSources', 'contents', 'domain', 'assets']) {
    assert.match(dts, new RegExp(`\\n  ${field}\\?:`), `${field} must be optional`);
  }
  assert.match(dts, /\n  schemaVersion:/);
  assert.match(dts, /\n  meta:/);
  assert.match(dts, /\n  entities:/);
});

test('generated relation registry, provenance, and asset fields match the formal contract', () => {
  const dts = generateTypes(minimalPack());
  assert.match(dts, /relationTypes\?: Record<string, \{ label: string;/);
  assert.match(dts, /interface SgProvenanceEntry \{/);
  for (const field of ['origin?: string', 'sourceUrl?: string | null', 'fetchedAt?: string', 'confidence?: number', 'fieldOrigins?: Record<string, SgProvenanceEntry>']) {
    assert.ok(dts.includes(field), `provenance declarations must include ${field}`);
  }
  assert.match(dts, /interface SgAssetEntry \{ exists\?: boolean; bytes\?: number; hash\?: string; sourceUrl\?: string;/);
});

test('types without --out prints the declaration to stdout', () => {
  const stdout = withPack(minimalPack(), ({ packPath }) => (
    execFileSync(process.execPath, [TYPES, packPath, '--name', 'Demo'], { encoding: 'utf8' })
  ));
  assert.match(stdout, /export interface DemoPack/);
  assert.match(stdout, /export interface SgRelation/);
});

test('types rejects an invalid explicit TypeScript interface name', () => {
  const result = withPack(minimalPack(), ({ packPath }) => (
    spawnSync(process.execPath, [TYPES, packPath, '--name', 'Demo-Pack'], { encoding: 'utf8' })
  ));
  assert.equal(result.status, 2);
  assert.match(result.stderr, /valid TypeScript identifier/);
});

test('types rejects flags that are missing their values', () => {
  for (const flag of ['--name', '--out']) {
    const result = withPack(minimalPack(), ({ packPath }) => (
      spawnSync(process.execPath, [TYPES, packPath, flag], { encoding: 'utf8' })
    ));
    assert.equal(result.status, 2);
    assert.match(result.stderr, new RegExp(`${flag} requires a value`));
  }
});
