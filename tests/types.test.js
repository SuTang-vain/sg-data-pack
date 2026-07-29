'use strict';
/*
 * types.test.js — sg-pack-types generation tests
 *
 * Covers P0-8: the generated SgDerivation interface must include
 * `alsoTouches?: string[]` (schema declares it, loader E16 checks it,
 * but the TS generator omits it).
 *
 * Run: node --test tests/
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const TYPES = path.join(__dirname, '..', 'scripts', 'sg-pack-types.js');

function generateTypes(pack) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-types-'));
  const packPath = path.join(dir, 'pack.json');
  const outPath = path.join(dir, 'types.d.ts');
  fs.writeFileSync(packPath, JSON.stringify(pack));
  try {
    execFileSync(process.execPath, [TYPES, packPath, '--name', 'Demo', '--out', outPath], { encoding: 'utf8' });
    return fs.readFileSync(outPath, 'utf8');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('SgDerivation includes alsoTouches', () => {
  const pack = {
    schemaVersion: '1.3',
    meta: { id: 'demo', title: 'Demo' },
    entities: { a: { kind: 'person', name: 'A' } },
    aliases: {}, relationTypes: {}, relations: [], stages: [],
    contents: {}, domain: {}, assets: {},
    derivations: {
      d1: {
        kind: 'repeat', source: 'entities', consumers: ['e'],
        alsoTouches: ['entities.*.name'], note: 'n',
      },
    },
  };
  const dts = generateTypes(pack);
  assert.match(dts, /alsoTouches\?:\s*string\[\]/, 'SgDerivation must declare alsoTouches?: string[]');
});

test('SgDerivation includes affects', () => {
  const pack = {
    schemaVersion: '1.3',
    meta: { id: 'demo', title: 'Demo' },
    entities: { a: { kind: 'person', name: 'A' } },
    aliases: {}, relationTypes: {}, relations: [], stages: [],
    contents: {}, domain: {}, assets: {},
    derivations: {
      d1: {
        kind: 'projection', source: 'domain.works', consumers: ['e'],
        affects: ['div.x'], alsoTouches: ['entities.*'], note: 'n',
      },
    },
  };
  const dts = generateTypes(pack);
  assert.match(dts, /affects\?:\s*string\[\]/, 'SgDerivation must declare affects?: string[]');
});

test('contract types include stable relation ids and contextual aliases', () => {
  const pack = {
    schemaVersion: '1.3', meta: { id: 'demo', title: 'Demo' },
    entities: { a: { kind: 'person', name: 'A' } },
    aliases: { Alias: { id: 'a', context: 'pilot' } },
    relationTypes: {}, relations: [], stages: [], contents: {}, domain: {}, assets: {},
  };
  const dts = generateTypes(pack);
  assert.match(dts, /interface SgRelation \{ id\?: string;/);
  assert.match(dts, /aliases: Record<string, string \| \{ id: string; context\?: string;/);
});
