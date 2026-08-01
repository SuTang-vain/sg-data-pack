'use strict';
/*
 * loader.test.js — SGDataLoader contract tests (E1-E16 + W1-W8)
 *
 * Covers the P0 contract gaps that were verified in the read-only audit:
 *   - E11 must collect asset refs from domain (not just entities/contents)
 *   - alias {id, context} form must resolve at runtime via resolveId
 *   - E12 stage-relation candidates must canonicalize endpoints via resolveId
 *   - E16 must validate derivations.alsoTouches (and affects) source paths
 *   - provenance entries missing `origin` must surface a warning (W7)
 *   - schema/loader/docs version markers are v1.3
 *
 * Run: node --test tests/
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Load the UMD loader into the test realm (it attaches globalThis.SGDataLoader).
require(path.join(__dirname, '..', 'scripts', 'lib', 'sg-data-loader.js'));
const { validate, resolveId, assertValid } = globalThis.SGDataLoader;

/* ---------- minimal pack factory ---------- */
function basePack(overrides) {
  return Object.assign({
    schemaVersion: '1.3',
    meta: { id: 'demo', title: 'Demo' },
    entities: { a: { kind: 'person', name: 'A' }, b: { kind: 'person', name: 'B' } },
    aliases: {},
    relationTypes: { friend: { label: 'Friend' } },
    relations: [],
    stages: [],
    contents: {},
    domain: {},
    assets: {},
  }, overrides || {});
}

function errorsOf(pack) { return validate(pack).errors; }
function warningsOf(pack) { return validate(pack).warnings; }
function hasError(list, needle) { return list.some((e) => e.includes(needle)); }
function hasWarning(list, needle) { return list.some((w) => w.includes(needle)); }

/* ============================================================ */
/* E1-E15 happy path: a well-formed pack passes with no errors  */
/* ============================================================ */
test('a well-formed pack passes validation with no errors', () => {
  const pack = basePack({
    relations: [{ a: 'a', b: 'b', type: 'friend', label: 'A-B' }],
    stages: [{ key: 's1', name: 'Stage 1', entities: ['a', 'b'] }],
  });
  const r = validate(pack);
  assert.equal(r.errors.length, 0, 'unexpected errors:\n  ' + r.errors.join('\n  '));
});

test('E1 rejects an unknown schemaVersion', () => {
  assert.ok(hasError(errorsOf(basePack({ schemaVersion: '9.9' })), 'E1'));
});

test('E1 accepts all supported schemaVersions', () => {
  for (const v of ['1.0', '1.1', '1.2', '1.3']) {
    assert.equal(errorsOf(basePack({ schemaVersion: v })).length, 0, `v${v} should pass`);
  }
});

test('E3/W1/W6 use one kindNameFields display field without legacy name/title fallbacks', () => {
  const pack = basePack({
    kindNameFields: { work: 'title' },
    entities: {
      a: { kind: 'work', title: 'Same title', name: 'Different legacy name' },
      b: { kind: 'work', title: 'Same title', name: 'Another legacy name' },
    },
  });
  const result = validate(pack);
  assert.deepEqual(result.errors, []);
  assert.ok(hasWarning(result.warnings, 'W1: entity "a" (Same title)'));
  assert.ok(hasWarning(result.warnings, 'W6: entities "a" and "b"'));

  const legacyOnly = basePack({
    kindNameFields: { work: 'title' },
    entities: { a: { kind: 'work', name: 'Only legacy name' } },
  });
  assert.ok(hasError(errorsOf(legacyOnly), 'entities.a.title'));

  const legacyCollisionOnly = basePack({
    kindNameFields: { work: 'title' },
    entities: {
      a: { kind: 'work', title: 'Alpha', name: 'Same legacy name' },
      b: { kind: 'work', title: 'Beta', name: 'Same legacy name' },
    },
  });
  assert.ok(!hasWarning(warningsOf(legacyCollisionOnly), 'W6'));
});

test('E3 rejects an entity missing its name field', () => {
  assert.ok(hasError(errorsOf(basePack({ entities: { a: { kind: 'person' } } })), 'E3'));
});

test('E3 rejects reserved or non-slug entity ids', () => {
  const reserved = JSON.parse('{"constructor":{"kind":"person","name":"A"}}');
  assert.ok(hasError(errorsOf(basePack({ entities: reserved })), 'safe stable slug'));
  assert.ok(hasError(errorsOf(basePack({ entities: { 'Bad ID': { kind: 'person', name: 'A' } } })), 'safe stable slug'));
});

test('E3 reports a malformed entity without crashing warning checks', () => {
  const pack = basePack({ entities: { a: null } });
  assert.doesNotThrow(() => validate(pack));
  assert.ok(hasError(errorsOf(pack), 'entities.a must be an object'));
});

test('E4 rejects an alias pointing to a non-existent entity', () => {
  assert.ok(hasError(errorsOf(basePack({ aliases: { ghost: 'nope' } })), 'E4'));
});

test('E4 rejects reserved alias keys', () => {
  const aliases = JSON.parse('{"constructor":"a"}');
  assert.ok(hasError(errorsOf(basePack({ aliases })), 'reserved object key'));
});

test('E5 flags a dangling relation endpoint', () => {
  assert.ok(hasError(errorsOf(basePack({ relations: [{ a: 'a', b: 'ghost', type: 'friend' }] })), 'E5'));
});

test('E5 reports a malformed master relation without crashing stage resolution', () => {
  const pack = basePack({
    relations: [null],
    stages: [{ key: 's1', name: 'S1', entities: ['a', 'b'], relations: [{ a: 'a', b: 'b' }] }],
  });
  assert.doesNotThrow(() => validate(pack));
  assert.ok(hasError(errorsOf(pack), 'relations[0] must be an object'));
});

test('E6 rejects an unregistered relation type', () => {
  assert.ok(hasError(errorsOf(basePack({ relations: [{ a: 'a', b: 'b', type: 'unknown' }] })), 'E6'));
});

test('E6 rejects a relation type registry entry without a label', () => {
  const pack = basePack({ relationTypes: { friend: {} } });
  assert.ok(hasError(errorsOf(pack), 'relationTypes.friend.label'));
});

test('E7 flags a dangling stage entity reference', () => {
  assert.ok(hasError(errorsOf(basePack({ stages: [{ key: 's', name: 'S', entities: ['ghost'] }] })), 'E7'));
});

test('E8 rejects out-of-range layout coordinates', () => {
  assert.ok(hasError(errorsOf(basePack({
    stages: [{ key: 's', name: 'S', entities: ['a'], layout: { a: [1.5, 0.5] } }],
  })), 'E8'));
});

test('E14 rejects a sameAs pair referencing a missing entity', () => {
  assert.ok(hasError(errorsOf(basePack({ sameAs: [['a', 'ghost']] })), 'E14'));
});

test('E15 rejects a provenance key pointing at a missing record', () => {
  assert.ok(hasError(errorsOf(basePack({ provenance: { entities: { ghost: {} } } })), 'E15'));
});

test('E15 handles malformed master relations without crashing provenance checks', () => {
  const pack = basePack({
    relations: [null],
    provenance: { relations: { 'a::b': { origin: 'test' } } },
  });
  assert.doesNotThrow(() => validate(pack));
  assert.ok(hasError(errorsOf(pack), 'E15'));
});

test('W1 warns about an unreferenced entity', () => {
  // only `a` is referenced by the relation; `b` is unreferenced
  const pack = basePack({ relations: [{ a: 'a', b: 'a', type: 'friend' }] });
  assert.ok(hasWarning(warningsOf(pack), 'W1'));
});

/* ============================================================ */
/* P0-3: E11 must collect asset refs from domain.works          */
/* (current loader only walks entities/contents; this is RED)   */
/* ============================================================ */
test('E11 flags an unregistered asset referenced in domain.works', () => {
  const pack = basePack({
    domain: { works: [{ title: 'W', img: '../assets/missing.png' }] },
    assets: {},   // nothing registered
  });
  assert.ok(hasError(errorsOf(pack), 'E11'), 'domain.works asset refs must be covered by E11');
});

test('E11 passes when the domain asset is registered', () => {
  const pack = basePack({
    domain: { works: [{ title: 'W', img: '../assets/x.png' }] },
    assets: { '../assets/x.png': { exists: true, bytes: 1, hash: 'sha1:abc' } },
  });
  assert.ok(!hasError(errorsOf(pack), 'E11'));
});

/* ============================================================ */
/* P0-4: alias {id, context} form must resolve via resolveId     */
/* (E4 unpacks target.id for validation, but resolveId returns  */
/*  the raw object — runtime resolution is broken. RED.)         */
/* ============================================================ */
test('resolveId resolves an alias declared in {id, context} form', () => {
  const pack = basePack({
    aliases: { '金智秀': { id: 'a', context: '成员' } },
  });
  assert.equal(resolveId(pack, '金智秀'), 'a', '{id,context} alias must resolve to the canonical id');
});

test('E5 does not flag a relation whose endpoint is a {id,context} alias', () => {
  const pack = basePack({
    aliases: { '金智秀': { id: 'a', context: '成员' } },
    relations: [{ a: '金智秀', b: 'b', type: 'friend' }],
  });
  assert.ok(!hasError(errorsOf(pack), 'E5'), '{id,context} alias must not be treated as dangling');
});

/* ============================================================ */
/* P0-5: E12 stage-relation candidates must canonicalize         */
/* (current loader filters by r.a === ref.a raw string; an alias*/
/*  on one side misses. RED.)                                    */
/* ============================================================ */
test('E12 resolves a stage relation ref whose endpoint is an alias', () => {
  const pack = basePack({
    aliases: { '金智秀': 'a' },
    relationTypes: { friend: { label: 'F' }, rival: { label: 'R' } },
    relations: [
      { a: 'a', b: 'b', type: 'friend', label: 'A-B' },
      { a: 'a', b: 'b', type: 'rival', label: 'A-B rival', scope: ['s1'] },
    ],
    stages: [{
      key: 's1', name: 'S1', entities: ['a', 'b'],
      relations: [{ a: '金智秀', b: 'b', type: 'rival' }],
    }],
  });
  assert.ok(!hasError(errorsOf(pack), 'E12'), 'alias endpoints must be canonicalized before candidate matching');
});

test('E12 rejects a wrong type even when the endpoint pair has one master edge', () => {
  const pack = basePack({
    relationTypes: { friend: { label: 'Friend' }, rival: { label: 'Rival' } },
    relations: [{ a: 'a', b: 'b', type: 'friend', label: 'A-B' }],
    stages: [{
      key: 's1', name: 'S1', entities: ['a', 'b'],
      relations: [{ a: 'a', b: 'b', type: 'rival' }],
    }],
  });
  assert.ok(hasError(errorsOf(pack), 'E12'), 'an explicit stage-ref type must always match');
});

test('E12 rejects a scoped edge outside its active stage even when it is the only candidate', () => {
  const pack = basePack({
    relations: [{ a: 'a', b: 'b', type: 'friend', label: 'A-B', scope: ['s2'] }],
    stages: [
      { key: 's1', name: 'S1', entities: ['a', 'b'], relations: [{ a: 'a', b: 'b' }] },
      { key: 's2', name: 'S2', entities: ['a', 'b'] },
    ],
  });
  assert.ok(hasError(errorsOf(pack), 'E12'), 'a scoped edge must not resolve in another stage');
});

test('E12 rejects a reserved-name scope that is not a declared stage', () => {
  const pack = basePack({ relations: [{ a: 'a', b: 'b', type: 'friend', scope: ['constructor'] }] });
  assert.ok(hasError(errorsOf(pack), 'non-existent stage "constructor"'));
});

test('E12 rejects duplicate anonymous master relation identities', () => {
  const pack = basePack({
    relations: [
      { a: 'a', b: 'b', type: 'friend', label: 'First' },
      { a: 'a', b: 'b', type: 'friend', label: 'Duplicate' },
    ],
  });
  assert.ok(hasError(errorsOf(pack), 'duplicated master relation'));
});

test('E12 resolves an alias ref with matching id, type, and scope', () => {
  const pack = basePack({
    aliases: { '甲': 'a' },
    relations: [{ id: 'friend-s1', a: 'a', b: 'b', type: 'friend', label: 'A-B', scope: ['s1'] }],
    stages: [{
      key: 's1', name: 'S1', entities: ['a', 'b'],
      relations: [{ id: 'friend-s1', a: '甲', b: 'b', type: 'friend' }],
    }],
  });
  assert.ok(!hasError(errorsOf(pack), 'E12'));
});

/* ============================================================ */
/* P0-6: E16 must validate derivations.alsoTouches source paths  */
/* (current E16 only checks `source`; alsoTouches is ignored.   */
/*  RED for the invalid-root case.)                             */
/* ============================================================ */
test('E16 flags an alsoTouches path with an invalid root section', () => {
  const pack = basePack({
    derivations: {
      d1: {
        kind: 'repeat', source: 'entities', consumers: ['engine.js'],
        alsoTouches: ['badroot.*.field'], note: 'n',
      },
    },
  });
  assert.ok(hasError(errorsOf(pack), 'E16'), 'alsoTouches with invalid root must be an E16 error');
});

test('E16 accepts a valid alsoTouches path', () => {
  const pack = basePack({
    derivations: {
      d1: {
        kind: 'repeat', source: 'entities', consumers: ['engine.js'],
        alsoTouches: ['entities.*.name'], note: 'n',
      },
    },
  });
  assert.ok(!hasError(errorsOf(pack), 'E16'));
});

/* ============================================================ */
/* P0-10: provenance missing `origin` surfaces a warning (W7)   */
/* (current loader silently accepts empty provenance entries.   */
/*  RED.)                                                        */
/* ============================================================ */
test('E15 rejects out-of-range record provenance confidence and invalid sourceUrl', () => {
  const pack = basePack({ provenance: { entities: { a: { origin: 'crawl:test', confidence: 2, sourceUrl: 'https://' } } } });
  const errors = errorsOf(pack);
  assert.ok(hasError(errors, 'confidence must be a finite number between 0 and 1'));
  assert.ok(hasError(errors, 'sourceUrl must be a valid HTTP(S) URL'));
});

test('W7 warns when a provenance entry lacks origin', () => {
  const pack = basePack({ provenance: { entities: { a: {} } } });
  assert.ok(hasWarning(warningsOf(pack), 'W7'), 'missing origin must produce a W7 warning');
});

test('E2 rejects an out-of-range confidence threshold', () => {
  assert.ok(hasError(errorsOf(basePack({ meta: { id: 'demo', title: 'Demo', confidenceThreshold: 2 } })), 'confidenceThreshold'));
});

test('field-level provenance validates direct entity fields and emits crawl warnings', () => {
  const pack = basePack({
    provenance: {
      entities: {
        a: {
          origin: 'engine-embedded-defaults',
          fieldOrigins: {
            name: { origin: 'crawl:test', sourceUrl: null, confidence: 0.5 },
          },
        },
      },
    },
  });
  const warnings = warningsOf(pack);
  assert.ok(hasWarning(warnings, 'fieldOrigins'), 'field origin warnings should identify the field path');
  assert.ok(hasWarning(warnings, 'W5'));
  assert.ok(hasWarning(warnings, 'W8'));
});

test('E15 rejects field-level provenance for an absent entity field', () => {
  const pack = basePack({
    provenance: { entities: { a: { origin: 'test', fieldOrigins: { missing: { origin: 'test' } } } } },
  });
  assert.ok(hasError(errorsOf(pack), 'fieldOrigins."missing"'));
});

/* ============================================================ */
/* assertValid throws on errors, returns warnings on success     */
/* ============================================================ */
test('assertValid throws on validation errors', () => {
  assert.throws(() => assertValid(basePack({ schemaVersion: '9.9' })), /validation failed/);
});

test('assertValid returns warnings on a valid pack', () => {
  const pack = basePack({ relations: [{ a: 'a', b: 'a', type: 'friend' }] }); // b unreferenced → W1
  const r = assertValid(pack);
  assert.ok(r.warnings.length > 0);
});

test('E12 allows a stage relation ref to disambiguate by stable relation id', () => {
  const pack = basePack({
    relationTypes: { friend: { label: 'F' } },
    relations: [
      { id: 'friend-s1', a: 'a', b: 'b', type: 'friend', scope: ['s1'] },
      { id: 'friend-s2', a: 'a', b: 'b', type: 'friend', scope: ['s2'] },
    ],
    stages: [
      { key: 's1', name: 'S1', entities: ['a', 'b'], relations: [{ id: 'friend-s1', a: 'a', b: 'b' }] },
      { key: 's2', name: 'S2', entities: ['a', 'b'] },
    ],
  });
  assert.ok(!hasError(errorsOf(pack), 'E12'));
});

test('E12 rejects duplicate stable relation ids', () => {
  const pack = basePack({
    relations: [
      { id: 'duplicate', a: 'a', b: 'b', type: 'friend' },
      { id: 'duplicate', a: 'b', b: 'a', type: 'friend' },
    ],
  });
  assert.ok(hasError(errorsOf(pack), 'duplicated'));
});

test('E15 accepts provenance keyed by stable relation id', () => {
  const pack = basePack({
    relations: [{ id: 'a-b-friend', a: 'a', b: 'b', type: 'friend' }],
    provenance: { relations: { 'a-b-friend': { origin: 'engine-embedded-defaults', confidence: 1 } } },
  });
  assert.ok(!hasError(errorsOf(pack), 'E15'));
});

test('E15 rejects ambiguous legacy a::b provenance for a multi-edge pair', () => {
  const pack = basePack({
    relationTypes: { friend: { label: 'F' }, rival: { label: 'R' } },
    relations: [
      { a: 'a', b: 'b', type: 'friend', scope: ['s1'] },
      { a: 'a', b: 'b', type: 'rival', scope: ['s2'] },
    ],
    stages: [
      { key: 's1', name: 'S1', entities: ['a', 'b'] },
      { key: 's2', name: 'S2', entities: ['a', 'b'] },
    ],
    provenance: { relations: { 'a::b': { origin: 'crawl:test', sourceUrl: 'https://example.test', confidence: 1 } } },
  });
  assert.ok(hasError(errorsOf(pack), 'ambiguous relation'));
});

test('E16 treats affects as selectors rather than pack paths', () => {
  const pack = basePack({
    derivations: {
      d1: {
        kind: 'projection', source: 'entities.*.name', consumers: ['engine.js'],
        affects: ['.card[data-entity]'], note: 'selector impact',
      },
    },
  });
  assert.ok(!hasError(errorsOf(pack), 'E16'));
});

test('E16 accepts assets and relationTypes as derivation source roots', () => {
  const pack = basePack({
    assets: { 'x.png': { exists: true, hash: 'sha1:x' } },
    derivations: {
      assetProjection: { kind: 'projection', source: 'assets.*.hash', consumers: ['asset.js'], note: 'asset hash' },
      legendProjection: { kind: 'projection', source: 'relationTypes.*.label', consumers: ['legend.js'], note: 'legend label' },
    },
  });
  assert.ok(!hasError(errorsOf(pack), 'E16'));
});
