'use strict';
/*
 * diff.test.js — sg-pack-diff impact-tracking tests
 *
 * Covers the P0 diff gaps verified in the read-only audit:
 *   - sourceMatches must support multi-segment wildcard paths
 *     (e.g. domain.works.WILDCARD.cover), not just shallow patterns
 *   - the diff report must include a `derivations` section (added/removed/changed)
 *   - the diff report must include `assets` section changes (hash/exists/bytes)
 *   - the diff report must include `provenance` section changes
 *
 * Run: node --test tests/
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const DIFF = path.join(__dirname, '..', 'scripts', 'sg-pack-diff.js');

function runDiff(oldPack, newPack) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-diff-'));
  const oldPath = path.join(dir, 'old.json');
  const newPath = path.join(dir, 'new.json');
  fs.writeFileSync(oldPath, JSON.stringify(oldPack));
  fs.writeFileSync(newPath, JSON.stringify(newPack));
  try {
    // diff exits 1 when differences are found — that is expected here, so we
    // capture stdout regardless of exit code. Only a crash (signal/non-JSON
    // output) is treated as a failure.
    const r = spawnSync(process.execPath, [DIFF, oldPath, newPath, '--json'], { encoding: 'utf8', maxBuffer: 1 << 24 });
    if (r.error) throw r.error;
    if (r.signal) throw new Error('diff killed by signal ' + r.signal);
    if (r.status !== 0 && r.status !== 1) throw new Error('diff exit ' + r.status + ': ' + r.stderr);
    return JSON.parse(r.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function basePack(overrides) {
  return Object.assign({
    schemaVersion: '1.3',
    meta: { id: 'demo', title: 'Demo' },
    entities: { a: { kind: 'person', name: 'A' } },
    aliases: {}, relationTypes: {}, relations: [], stages: [],
    contents: {}, domain: {}, assets: {},
  }, overrides || {});
}

test('diff reports an entity field change', () => {
  const oldPack = basePack({ entities: { a: { kind: 'person', name: 'A' } } });
  const newPack = basePack({ entities: { a: { kind: 'person', name: 'A2' } } });
  const r = runDiff(oldPack, newPack);
  assert.ok(r.entities.changed.some((c) => c.id === 'a'));
});

test('diff impact matches a multi-segment wildcard derivation source (domain.works.*.cover)', () => {
  const oldPack = basePack({
    domain: { works: [{ title: 'W', cover: '../assets/old.png' }] },
    derivations: {
      workCover: {
        kind: 'projection', source: 'domain.works.*.cover',
        consumers: ['cover.js'], note: 'cover sync',
      },
    },
  });
  const newPack = basePack({
    domain: { works: [{ title: 'W', cover: '../assets/new.png' }] },
    derivations: oldPack.derivations,
  });
  const r = runDiff(oldPack, newPack);
  assert.ok(r.derivationsImpacted.some((d) => d.name === 'workCover'),
    'changing domain.works[0].cover must hit a derivation whose source is domain.works.*.cover');
});

test('diff includes a derivations section when derivations change', () => {
  const oldPack = basePack({ derivations: { d1: { kind: 'repeat', source: 'entities', consumers: ['e'], note: 'n' } } });
  const newPack = basePack({ derivations: { d1: { kind: 'repeat', source: 'entities', consumers: ['e'], note: 'n2' } } });
  const r = runDiff(oldPack, newPack);
  assert.ok(r.derivations, 'derivations section must appear in the report when they change');
});

test('diff includes an assets section when an asset hash changes', () => {
  const oldPack = basePack({ assets: { 'x.png': { exists: true, hash: 'sha1:old' } } });
  const newPack = basePack({ assets: { 'x.png': { exists: true, hash: 'sha1:new' } } });
  const r = runDiff(oldPack, newPack);
  assert.ok(r.assets, 'assets section must appear when an asset entry changes');
  assert.ok(r.assets.changed.some((c) => c.id === 'x.png'));
});

test('diff includes a provenance section when provenance changes', () => {
  const oldPack = basePack({ provenance: { entities: { a: { origin: 'old', confidence: 1 } } } });
  const newPack = basePack({ provenance: { entities: { a: { origin: 'new', confidence: 1 } } } });
  const r = runDiff(oldPack, newPack);
  assert.ok(r.provenance, 'provenance section must appear when provenance changes');
});

test('diff tracks standard stages by stage.key', () => {
  const oldPack = basePack({ stages: [{ key: 's1', name: 'Before', entities: ['a'] }] });
  const newPack = basePack({ stages: [{ key: 's1', name: 'After', entities: ['a'] }] });
  const r = runDiff(oldPack, newPack);
  assert.ok(r.stages.changed.some((c) => c.id === 's1' && c.fields.includes('name')),
    'a normal stage keyed by `key` must not be collapsed under undefined');
});

test('diff keeps same-pair same-type relations distinct by scope', () => {
  const relations = [
    { a: 'a', b: 'b', type: 'friend', scope: ['s1'], label: 'one' },
    { a: 'a', b: 'b', type: 'friend', scope: ['s2'], label: 'two' },
  ];
  const oldPack = basePack({
    entities: { a: { kind: 'person', name: 'A' }, b: { kind: 'person', name: 'B' } },
    relations,
  });
  const newPack = basePack({
    entities: oldPack.entities,
    relations: [
      { ...relations[0], label: 'changed' },
      relations[1],
    ],
  });
  const r = runDiff(oldPack, newPack);
  assert.equal(r.relations.changed.length, 1);
  assert.match(r.relations.changed[0].id, /scope=s1/);
  assert.ok(r.relations.changed[0].fields.includes('label'));
});

test('domain-only changes count as structural differences', () => {
  const oldPack = basePack({ domain: { config: { mode: 'a' } } });
  const newPack = basePack({ domain: { config: { mode: 'b' } } });
  const r = runDiff(oldPack, newPack);
  assert.ok(r.domain.changed.some((c) => c.id === 'config'));
});

test('attributeTypes changes are included in the report', () => {
  const oldPack = basePack({ attributeTypes: { role: { label: 'Role' } } });
  const newPack = basePack({ attributeTypes: { role: { label: '角色' } } });
  const r = runDiff(oldPack, newPack);
  assert.ok(r.attributeTypes.changed.some((c) => c.id === 'role'));
});
