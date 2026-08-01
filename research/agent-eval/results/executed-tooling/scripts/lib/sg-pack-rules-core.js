'use strict';

/* Structured, reusable data-rules evaluator. The legacy CLI renders this result. */

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateRulesDocument(rulesDoc) {
  const errors = [];
  if (!isObject(rulesDoc)) return ['rules document must be an object'];
  if (rulesDoc.rulesVersion !== '1.0') errors.push('rulesVersion must be "1.0"');
  if (typeof rulesDoc.libId !== 'string' || !rulesDoc.libId) errors.push('libId must be a non-empty string');
  if (!isObject(rulesDoc.profile)) errors.push('profile is required');
  if (!Array.isArray(rulesDoc.rules) || !rulesDoc.rules.length) errors.push('rules must be a non-empty array');
  const ids = new Set();
  (Array.isArray(rulesDoc.rules) ? rulesDoc.rules : []).forEach((rule, index) => {
    const at = `rules[${index}]`;
    if (!isObject(rule)) {
      errors.push(`${at} must be an object`);
      return;
    }
    for (const field of ['id', 'level', 'subject', 'rule', 'source']) {
      if (typeof rule[field] !== 'string' || !rule[field]) errors.push(`${at}.${field} must be a non-empty string`);
    }
    if (rule.level && !['hard', 'soft'].includes(rule.level)) errors.push(`${at}.level must be "hard" or "soft"`);
    if (rule.source && !['observed', 'extracted', 'human'].includes(rule.source)) errors.push(`${at}.source must be observed/extracted/human`);
    if (rule.check !== undefined && rule.check !== null && typeof rule.check !== 'string') errors.push(`${at}.check must be a JS expression string or null`);
    if (rule.id) {
      if (ids.has(rule.id)) errors.push(`${at}.id "${rule.id}" is duplicated`);
      ids.add(rule.id);
    }
  });
  return errors;
}

function emptyCounts() {
  return { total: 0, passed: 0, failed: 0, errors: 0, noCheck: 0, hardFail: 0, softFail: 0 };
}

function executeRules(rulesDoc, pack, options = {}) {
  /* Validate the complete document before applying a selection. A malformed
   * unselected rule must never disappear behind --rule. */
  const structuralErrors = validateRulesDocument(rulesDoc);
  if (structuralErrors.length) {
    return {
      libId: rulesDoc && rulesDoc.libId,
      structuralErrors,
      unknownRuleIds: [],
      results: [],
      counts: emptyCounts(),
      passed: false,
    };
  }
  const requestedRuleIds = options.ruleIds === undefined ? null : options.ruleIds;
  if (requestedRuleIds !== null && (!Array.isArray(requestedRuleIds) || requestedRuleIds.some(id => typeof id !== 'string' || !id))) {
    return {
      libId: rulesDoc.libId,
      profile: rulesDoc.profile,
      structuralErrors: [],
      selectionErrors: ['ruleIds must be an array of non-empty strings'],
      unknownRuleIds: [],
      results: [],
      counts: emptyCounts(),
      passed: false,
    };
  }
  const requestedSet = requestedRuleIds === null ? null : new Set(requestedRuleIds);
  const knownIds = new Set(rulesDoc.rules.map(rule => rule.id));
  const unknownRuleIds = requestedRuleIds === null ? [] : [...requestedSet].filter(id => !knownIds.has(id));
  if (unknownRuleIds.length) {
    return {
      libId: rulesDoc.libId,
      profile: rulesDoc.profile,
      structuralErrors: [],
      selectionErrors: [],
      unknownRuleIds,
      results: [],
      counts: emptyCounts(),
      passed: false,
    };
  }
  const selectedRules = requestedSet === null ? rulesDoc.rules : rulesDoc.rules.filter(rule => requestedSet.has(rule.id));
  pack = pack || {};
  const scope = {
    entities: pack.entities || {}, relations: pack.relations || [], stages: pack.stages || [],
    contents: pack.contents || {}, domain: pack.domain || {}, assets: pack.assets || {},
    aliases: pack.aliases || {}, relationTypes: pack.relationTypes || {}, heroRelTypes: pack.heroRelTypes || {},
    attributeTypes: pack.attributeTypes || {}, attributeSources: pack.attributeSources || [],
    kindNameFields: pack.kindNameFields || {}, meta: pack.meta || {}, sameAs: pack.sameAs || [],
    provenance: pack.provenance || {}, derivations: pack.derivations || {}, pack,
  };
  const keys = Object.keys(scope);
  const results = [];
  for (const rule of selectedRules) {
    const base = {
      id: rule.id,
      level: rule.level,
      subject: rule.subject,
      rule: rule.rule,
      rationale: rule.rationale || null,
      evidence: rule.evidence || null,
      source: rule.source,
      repairHint: rule.repairHint || null,
      coveredBy: rule.coveredBy === undefined ? null : rule.coveredBy,
    };
    if (!rule.check) {
      results.push({ ...base, status: 'no-check', passed: null });
      continue;
    }
    try {
      const fn = new Function(...keys, '"use strict"; return (' + rule.check + ');');
      const passed = Boolean(fn(...keys.map((key) => scope[key])));
      results.push({ ...base, status: passed ? 'passed' : 'failed', passed });
    } catch (error) {
      results.push({ ...base, status: 'error', passed: false, exception: { name: error.name, message: error.message } });
    }
  }
  const counts = {
    total: results.length,
    passed: results.filter((item) => item.status === 'passed').length,
    failed: results.filter((item) => item.status === 'failed').length,
    errors: results.filter((item) => item.status === 'error').length,
    noCheck: results.filter((item) => item.status === 'no-check').length,
    hardFail: results.filter((item) => item.passed === false && item.level === 'hard').length,
    softFail: results.filter((item) => item.passed === false && item.level === 'soft').length,
  };
  return {
    libId: rulesDoc.libId,
    profile: rulesDoc.profile,
    structuralErrors: [],
    selectionErrors: [],
    unknownRuleIds: [],
    results,
    counts,
    passed: counts.hardFail === 0 && counts.errors === 0,
  };
}

module.exports = { validateRulesDocument, executeRules };
