'use strict';
/*
 * contract-consistency.test.js — single-source-of-truth checks
 *
 * Ensures the version markers across schema / loader / types generator /
 * contract doc / SKILL do not drift again. All canonical artifacts must
 * agree on v1.3 and the E1-E16 rule set.
 *
 * Run: node --test tests/
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

test('loader version marker is v1.3', () => {
  const src = read('scripts/lib/sg-data-loader.js');
  assert.match(src, /v1\.3/, 'loader header must say v1.3');
});

test('schema title is v1.3', () => {
  const src = read('scripts/lib/data-pack.schema.json');
  assert.match(src, /SG Data Pack v1\.3/, 'schema title must say v1.3');
});

test('contract doc title is v1.3', () => {
  const src = read('references/data-pack-contract.md');
  assert.match(src, /Data Pack v1\.3 Contract/, 'contract doc title must say v1.3');
});

test('extract default schemaVersion is v1.3', () => {
  const src = read('scripts/sg-pack-extract.js');
  assert.match(src, /\|\|\s*'1\.3'/, "extract must default to '1.3'");
  assert.match(src, /SG Data Pack v1\.3/, 'generated library schema title must say v1.3');
});

test('SKILL.md references E1-E16 (not E1-E15)', () => {
  const src = read('SKILL.md');
  assert.match(src, /E1-E16/, 'SKILL.md must reference E1-E16');
  assert.doesNotMatch(src, /E1-E15[^6]/, 'SKILL.md must not reference E1-E15 without the 6');
});

test('loader implements E16 (derivations validation)', () => {
  const src = read('scripts/lib/sg-data-loader.js');
  assert.match(src, /E16/, 'loader must implement E16');
  assert.match(src, /alsoTouches/, 'loader E16 must reference alsoTouches');
});

test('schema declares alsoTouches on derivations', () => {
  const src = read('scripts/lib/data-pack.schema.json');
  assert.match(src, /alsoTouches/, 'schema must declare alsoTouches on derivations');
});

test('types generator emits alsoTouches on SgDerivation', () => {
  const src = read('scripts/sg-pack-types.js');
  assert.match(src, /alsoTouches\?:\s*string\[\]/, 'types generator must emit alsoTouches?: string[]');
});
