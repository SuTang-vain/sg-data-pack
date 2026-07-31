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
