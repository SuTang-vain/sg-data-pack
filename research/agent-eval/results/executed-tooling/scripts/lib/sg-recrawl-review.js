'use strict';

/*
 * Pure helpers shared by recrawl-skeleton and candidate-pack.
 * No filesystem, process, or clock access belongs in this module.
 */
const crypto = require('node:crypto');
require('./sg-data-loader.js');

const OBSERVATION_VERSION = '1.0';
const REVIEWABLE = new Set(['gap', 'conflict', 'unsupported']);
const OBSERVATION_META_FIELDS = new Set(['sourceUrl', 'origin', 'fetchedAt', 'confidence']);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sha256(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  return 'sha256:' + crypto.createHash('sha256').update(bytes).digest('hex');
}

function stableJson(value) {
  return JSON.stringify(value);
}

function normalizeRecords(rawRecords) {
  if (!Array.isArray(rawRecords)) throw new Error('records.json must contain an array of names or record objects');
  return rawRecords.map((record, inputIndex) => {
    if (typeof record === 'string') {
      if (!record.trim()) throw new Error(`records[${inputIndex}] must contain a non-empty name`);
      return {
        inputIndex,
        crawledName: record.trim(),
        fields: {},
        raw: record,
      };
    }
    if (!isObject(record)) throw new Error(`records[${inputIndex}] must be a string or object`);
    const { crawledName, name, ...fields } = record;
    const resolvedName = crawledName || name;
    if (typeof resolvedName !== 'string' || !resolvedName.trim()) {
      throw new Error(`records[${inputIndex}] must contain crawledName or name`);
    }
    return {
      inputIndex,
      crawledName: resolvedName.trim(),
      fields,
      raw: record,
    };
  });
}

function resolveResolution(pack, name) {
  if (isObject(pack.entities) && Object.prototype.hasOwnProperty.call(pack.entities, name)) {
    return { status: 'hit', entityId: name, via: 'id' };
  }
  const alias = isObject(pack.aliases) ? pack.aliases[name] : undefined;
  if (alias === undefined) return { status: 'miss', via: 'none' };
  const entityId = isObject(alias) ? alias.id : alias;
  if (entityId && isObject(pack.entities) && Object.prototype.hasOwnProperty.call(pack.entities, entityId)) {
    const resolution = { status: 'hit', entityId, via: 'alias' };
    if (isObject(alias) && alias.context !== undefined) resolution.aliasContext = alias.context;
    return resolution;
  }
  return { status: 'miss', via: 'invalid-alias' };
}

function normalizeName(value) {
  return String(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\s·・\-_.'"()（）]+/g, '');
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = new Uint16Array(n + 1);
  for (let j = 0; j <= n; j += 1) dp[j] = j;
  for (let i = 1; i <= m; i += 1) {
    let previous = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const saved = dp[j];
      dp[j] = Math.min(
        dp[j] + 1,
        dp[j - 1] + 1,
        previous + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      previous = saved;
    }
  }
  return dp[n];
}

function pairScore(a, b) {
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.startsWith(right) || right.startsWith(left)) {
    return 0.6 + 0.35 * (Math.min(left.length, right.length) / Math.max(left.length, right.length));
  }
  if (left.includes(right) || right.includes(left)) {
    return Math.min(left.length, right.length) / Math.max(left.length, right.length) * 0.95;
  }
  return 1 - levenshtein(left, right) / Math.max(left.length, right.length);
}

function similarity(a, b) {
  const full = pairScore(a, b);
  const leftTokens = String(a).split(/[\s·・\-_]+/).filter(Boolean);
  const rightTokens = String(b).split(/[\s·・\-_]+/).filter(Boolean);
  let best = 0;
  for (const left of leftTokens) for (const right of rightTokens) best = Math.max(best, pairScore(left, right));
  return Math.max(full, best * 0.9);
}

function mappedField(pack, field) {
  const fieldMap = pack.meta && pack.meta.recrawlFieldMap;
  if (isObject(fieldMap) && Object.prototype.hasOwnProperty.call(fieldMap, field) && typeof fieldMap[field] === 'string' && fieldMap[field]) {
    return fieldMap[field];
  }
  return field;
}

function nameField(pack, id, entity) {
  const fields = pack.kindNameFields;
  const field = isObject(fields) && Object.prototype.hasOwnProperty.call(fields, entity.kind) ? fields[entity.kind] : null;
  return (typeof field === 'string' && entity[field]) || entity.name || id;
}

function buildSurfaces(pack) {
  const surfaces = [];
  for (const [id, entity] of Object.entries(pack.entities || {})) {
    surfaces.push({ id, text: id, via: 'id' });
    const display = nameField(pack, id, entity);
    if (display && display !== id) surfaces.push({ id, text: display, via: 'name' });
  }
  for (const [alias, target] of Object.entries(pack.aliases || {})) {
    const id = target && typeof target === 'object' ? target.id : target;
    if (id && (pack.entities || {})[id]) surfaces.push({ id, text: alias, via: 'alias' });
  }
  return surfaces;
}

function candidatesFor(pack, name, topN = 3, stable = true) {
  const scored = new Map();
  for (const surface of buildSurfaces(pack)) {
    const score = similarity(name, surface.text);
    const current = scored.get(surface.id);
    if (!current || score > current.score || (stable && score === current.score && surface.text < current.text)) {
      scored.set(surface.id, { score, via: surface.via, text: surface.text });
    }
  }
  return [...scored.entries()]
    .map(([id, value]) => ({ id, score: +value.score.toFixed(3), matchedOn: `${value.via}:"${value.text}"`, _text: value.text }))
    .filter((candidate) => candidate.score >= 0.5)
    .sort((a, b) => stable
      ? (b.score - a.score || a.id.localeCompare(b.id) || a._text.localeCompare(b._text))
      : b.score - a.score)
    .slice(0, topN)
    .map(({ _text, ...candidate }) => candidate);
}

function isCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return date.toISOString().slice(0, 10) === value;
}

function isHttpUrl(value) {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname);
  } catch (_) {
    return false;
  }
}

function isEmptyBaseline(value) {
  return value === undefined || value === null || value === '' || value === '待定';
}

function isIgnoredField(field) {
  return field === 'crawledName' || field === 'name';
}

function legacyCrossCheck(pack, id, fields) {
  const entity = pack.entities && pack.entities[id];
  if (!entity) return { status: 'no-baseline' };
  const result = { agree: [], conflict: [], gap: [] };
  for (const [field, crawled] of Object.entries(fields)) {
    if (isIgnoredField(field) || crawled === undefined || crawled === null || crawled === '') continue;
    const baselineField = mappedField(pack, field);
    const hasBaseline = Object.prototype.hasOwnProperty.call(entity, baselineField);
    const baseline = hasBaseline ? entity[baselineField] : undefined;
    if (isEmptyBaseline(baseline)) {
      result.gap.push({ field, baselineField, baseline, crawled });
    } else {
      const baselineNormalized = String(baseline).replace(/ 饰$/, '').trim();
      const crawledNormalized = String(crawled).replace(/ 饰$/, '').trim();
      if (baselineNormalized === crawledNormalized) result.agree.push(field);
      else result.conflict.push({ field, baselineField, baseline, crawled });
    }
  }
  return result;
}

function checkValue(pack, id, field, crawled) {
  const entity = pack.entities[id];
  const baselineField = mappedField(pack, field);
  const baselineExists = Object.prototype.hasOwnProperty.call(entity, baselineField);
  const baseline = baselineExists ? entity[baselineField] : undefined;
  const base = {
    crawledField: field,
    baselineField,
    baselineExists,
    baseline,
    crawled,
  };
  if (OBSERVATION_META_FIELDS.has(field)) return { ...base, classification: 'unsupported', reason: 'crawl metadata is provenance, not an entity field' };
  if (field.includes('.') || field.includes('[') || field.includes(']')) {
    return { ...base, classification: 'unsupported', reason: 'nested field paths are not supported' };
  }
  if (field === '__proto__' || field === 'prototype' || field === 'constructor') {
    return { ...base, classification: 'unsupported', reason: 'reserved object key' };
  }
  if (typeof crawled !== 'string' || crawled === '') {
    return { ...base, classification: 'unsupported', reason: 'only non-empty string observations are supported' };
  }
  if (typeof baseline !== 'undefined' && baseline !== null && typeof baseline !== 'string') {
    return { ...base, classification: 'unsupported', reason: 'baseline field is not a string' };
  }
  if (isEmptyBaseline(baseline)) return { ...base, classification: 'gap' };
  const baselineNormalized = baseline.replace(/ 饰$/, '').trim();
  const crawledNormalized = crawled.replace(/ 饰$/, '').trim();
  return {
    ...base,
    classification: baselineNormalized === crawledNormalized ? 'agree' : 'conflict',
  };
}

function recordId(record) {
  const material = stableJson({ inputIndex: record.inputIndex, crawledName: record.crawledName, fields: record.fields });
  return `r${String(record.inputIndex).padStart(6, '0')}-${sha256(material).slice(7, 19)}`;
}

function itemId(record, suffix) {
  return `${recordId(record)}:${suffix}`;
}

function buildLegacyProjection(pack, rawRecords) {
  const records = normalizeRecords(rawRecords);
  const hits = [];
  const misses = [];
  for (const record of records) {
    const resolution = resolveResolution(pack, record.crawledName);
    if (resolution.status === 'hit') {
      hits.push({
        crawledName: record.crawledName,
        id: resolution.entityId,
        crossCheck: legacyCrossCheck(pack, resolution.entityId, record.fields),
      });
    } else {
      misses.push({ crawledName: record.crawledName, candidates: candidatesFor(pack, record.crawledName, 3, false) });
    }
  }
  return {
    summary: { total: records.length, hits: hits.length, misses: misses.length },
    hits,
    misses,
    autoMergeable: hits.filter((hit) => hit.crossCheck.gap && hit.crossCheck.gap.length).map((hit) => ({
      id: hit.id,
      crawledName: hit.crawledName,
      gaps: hit.crossCheck.gap,
    })),
    needsHumanReview: hits.filter((hit) => hit.crossCheck.conflict && hit.crossCheck.conflict.length).map((hit) => ({
      id: hit.id,
      crawledName: hit.crawledName,
      conflicts: hit.crossCheck.conflict,
    })),
  };
}

function buildCandidateReview({ pack, rawRecords, baselineBytes, recordsBytes, origin, sourceUrl, fetchedAt }) {
  if (typeof origin !== 'string' || !/^crawl:[^\s]+$/.test(origin.trim())) {
    throw new Error('candidate-ready mode requires --origin crawl:<source>');
  }
  if (!isHttpUrl(sourceUrl)) throw new Error('candidate-ready mode requires an HTTP(S) --source URL with a hostname');
  if (!isCalendarDate(fetchedAt)) throw new Error('candidate-ready mode requires a real --fetchedAt YYYY-MM-DD date');
  const records = normalizeRecords(rawRecords);
  const observations = [];
  const reviewItems = [];
  for (const record of records) {
    const resolution = resolveResolution(pack, record.crawledName);
    const observation = {
      recordId: recordId(record),
      inputIndex: record.inputIndex,
      crawledName: record.crawledName,
      rawFields: record.fields,
      resolution,
      checks: [],
    };
    if (resolution.status === 'hit') {
      const legacy = legacyCrossCheck(pack, resolution.entityId, record.fields);
      observation.checks = Object.entries(record.fields)
        .filter(([field]) => !isIgnoredField(field) && !OBSERVATION_META_FIELDS.has(field))
        .map(([field, value]) => ({
          itemId: itemId(record, `field:${field}`),
          ...checkValue(pack, resolution.entityId, field, value),
        }));
      // Keep the legacy calculation as the compatibility source of truth for its projection.
      observation.legacyCrossCheck = legacy;
      for (const check of observation.checks) {
        if (REVIEWABLE.has(check.classification)) {
          reviewItems.push({
            itemId: check.itemId,
            kind: 'field',
            recordId: observation.recordId,
            inputIndex: record.inputIndex,
            entityId: resolution.entityId,
            classification: check.classification,
            crawledField: check.crawledField,
            baselineField: check.baselineField,
            reason: check.reason,
          });
        }
      }
    } else {
      observation.candidates = candidatesFor(pack, record.crawledName);
      observation.checks = [];
      reviewItems.push({
        itemId: itemId(record, 'identity'),
        kind: 'identity',
        recordId: observation.recordId,
        inputIndex: record.inputIndex,
        crawledName: record.crawledName,
        classification: 'miss',
      });
    }
    observations.push(observation);
  }
  const candidateReview = {
    version: OBSERVATION_VERSION,
    baselineSha256: sha256(baselineBytes),
    recordsSha256: sha256(recordsBytes),
    origin: origin.trim(),
    sourceUrl,
    fetchedAt,
    observations,
    reviewItems,
  };
  candidateReview.reportId = sha256(stableJson(candidateReview));
  return candidateReview;
}

function verifyCandidateReview(report, baselineBytes, recordsBytes) {
  const candidateReview = report && report.candidateReview;
  if (!isObject(candidateReview) || candidateReview.version !== OBSERVATION_VERSION) {
    throw new Error('report is not candidate-ready; rerun recrawl-skeleton with --candidate-ready');
  }
  if (candidateReview.baselineSha256 !== sha256(baselineBytes)) throw new Error('baseline SHA-256 does not match candidate review report');
  if (recordsBytes !== undefined && candidateReview.recordsSha256 !== sha256(recordsBytes)) {
    throw new Error('records SHA-256 does not match candidate review report');
  }
  const { reportId, ...withoutId } = candidateReview;
  if (reportId !== sha256(stableJson(withoutId))) throw new Error('candidate review reportId does not match report contents');
  return candidateReview;
}

module.exports = {
  OBSERVATION_VERSION,
  OBSERVATION_META_FIELDS,
  sha256,
  stableJson,
  normalizeRecords,
  resolveResolution,
  candidatesFor,
  legacyCrossCheck,
  checkValue,
  recordId,
  itemId,
  buildLegacyProjection,
  buildCandidateReview,
  verifyCandidateReview,
};
