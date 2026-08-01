'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateRulesDocument, executeRules } = require('../scripts/lib/sg-pack-rules-core.js');

const pack = {
  schemaVersion: '1.3',
  meta: { id: 'rules-demo' },
  entities: { alice: { kind: 'person', name: 'Alice' } },
  aliases: { Alice: 'alice' },
};

function rule(overrides = {}) {
  return { id: 'demo-rule', level: 'hard', subject: 'entities.*', rule: 'one entity', source: 'observed', check: 'Object.keys(entities).length === 1', ...overrides };
}

test('rules core preserves pass/fail/no-check and hard/soft counts', () => {
  const result = executeRules({ rulesVersion: '1.0', libId: 'rules-demo', profile: {}, rules: [
    rule(), rule({ id: 'soft-rule', level: 'soft', check: 'false' }), rule({ id: 'no-check', check: null }),
  ] }, pack);
  assert.equal(result.counts.total, 3);
  assert.equal(result.counts.passed, 1);
  assert.equal(result.counts.softFail, 1);
  assert.equal(result.counts.noCheck, 1);
  assert.equal(result.passed, true);
  assert.equal(result.results[1].repairHint, null);
});

test('rules core marks execution errors as failures without double counting', () => {
  const result = executeRules({ rulesVersion: '1.0', libId: 'rules-demo', profile: {}, rules: [rule({ check: 'doesNotExist()' })] }, pack);
  assert.equal(result.counts.errors, 1);
  assert.equal(result.counts.hardFail, 1);
  assert.equal(result.passed, false);
  assert.equal(result.results[0].status, 'error');
  assert.match(result.results[0].exception.message, /doesNotExist/);
});

test('rules core rejects structural violations before executing checks', () => {
  const document = { rulesVersion: '2.0', libId: '', profile: {}, rules: [{ id: 'duplicate', level: 'bad' }, { id: 'duplicate', level: 'hard' }] };
  const errors = validateRulesDocument(document);
  assert.ok(errors.some((error) => /rulesVersion/.test(error)));
  assert.ok(errors.some((error) => /libId/.test(error)));
  assert.ok(errors.some((error) => /duplicated/.test(error)));
  const result = executeRules(document, pack);
  assert.equal(result.results.length, 0);
  assert.equal(result.passed, false);
});

test('rules core filters by ruleIds only after validating the complete document', () => {
  const document = { rulesVersion: '1.0', libId: 'rules-demo', profile: {}, rules: [
    rule({ id: 'selected', check: 'true' }),
    rule({ id: 'not-selected', check: 'false' }),
  ] };
  const selected = executeRules(document, pack, { ruleIds: ['selected'] });
  assert.deepEqual(selected.results.map(item => item.id), ['selected']);
  assert.equal(selected.counts.total, 1);
  assert.equal(selected.passed, true);

  const malformed = { ...document, rules: [document.rules[0], { ...document.rules[1], level: 'invalid' }] };
  const rejected = executeRules(malformed, pack, { ruleIds: ['selected'] });
  assert.ok(rejected.structuralErrors.some(error => /rules\[1\]\.level/.test(error)));
  assert.equal(rejected.results.length, 0);
});

test('rules core reports unknown requested rule ids without executing checks', () => {
  const document = { rulesVersion: '1.0', libId: 'rules-demo', profile: {}, rules: [rule()] };
  const result = executeRules(document, pack, { ruleIds: ['missing', 'demo-rule'] });
  assert.deepEqual(result.unknownRuleIds, ['missing']);
  assert.equal(result.counts.total, 0);
  assert.equal(result.results.length, 0);
  assert.equal(result.passed, false);
});

test('rules checks receive heroRelTypes, attributeSources, and derivations in scope', () => {
  const scopedPack = {
    ...pack,
    heroRelTypes: { family: { label: 'Family' } },
    attributeSources: ['entities.*.facts'],
    derivations: { cards: { kind: 'repeat' } },
  };
  const document = { rulesVersion: '1.0', libId: 'rules-demo', profile: {}, rules: [rule({
    check: 'heroRelTypes.family.label === "Family" && attributeSources[0] === "entities.*.facts" && derivations.cards.kind === "repeat"',
  })] };
  assert.equal(executeRules(document, scopedPack).passed, true);
});
