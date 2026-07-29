#!/usr/bin/env node
/*
 * sg-pack-recrawl-skeleton.js - one-command recrawl normalization pipeline.
 *
 * Input:  an existing Data Pack (baseline) + a list of crawled records (JSON
 *         array of {crawledName, ...fields} or newline-separated names).
 * Output: a recrawl review skeleton:
 *   - hits:    names that resolve via existing aliases (auto-confirmed)
 *   - misses:  names with ranked alias candidates (awaiting confirmation)
 *   - crossCheck: for hits, compares crawled fields vs baseline (agree/conflict/gap)
 *   - review-report.json: agree / autoMergeable / needsHumanReview split
 *
 * Usage:
 *   sg-data-pack recrawl-skeleton <data.json> <records.json> [--out <dir>] [--source <url>] [--fetchedAt <date>]
 *
 * records.json format (flexible):
 *   [{"crawledName":"Kim Ji-soo","birth":"1995-01-03",...}, ...]   OR
 *   ["Kim Ji-soo","Jennie Kim",...]                                 (names only, no crossCheck)
 *
 * Exit: 0 = skeleton written, 1 = misses found (review needed), 2 = usage error.
 *
 * After review: extend pack.aliases with confirmed mappings, then run the gate.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const [, , packPath, recordsPath, ...rest] = process.argv;
if (!packPath || !recordsPath) {
  console.error('Usage: sg-data-pack recrawl-skeleton <data.json> <records.json> [--out <dir>] [--source <url>] [--fetchedAt <date>]');
  process.exit(2);
}
const flag = (n) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : null; };
const outDir = flag('--out') || '.';
const source = flag('--source') || '(unspecified)';
const fetchedAt = flag('--fetchedAt') || new Date().toISOString().slice(0, 10);

function loadJson(file, label) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { console.error(label + ': ' + e.message); process.exit(2); }
}
const pack = loadJson(packPath, 'Invalid data.json');
const rawRecords = loadJson(recordsPath, 'Invalid records.json');
if (!Array.isArray(rawRecords)) {
  console.error('records.json must contain an array of names or record objects');
  process.exit(2);
}

// normalize records to {crawledName, fields}; reject malformed rows early so
// a bad crawl payload cannot silently become an unresolved empty-name miss.
let records;
try {
  records = rawRecords.map((r, i) => {
    if (typeof r === 'string') {
      if (!r.trim()) throw new Error(`records[${i}] must contain a non-empty name`);
      return { crawledName: r.trim(), fields: {} };
    }
    if (!r || typeof r !== 'object' || Array.isArray(r)) {
      throw new Error(`records[${i}] must be a string or object`);
    }
    const { crawledName, name, ...fields } = r;
    const resolvedName = crawledName || name;
    if (typeof resolvedName !== 'string' || !resolvedName.trim()) {
      throw new Error(`records[${i}] must contain crawledName or name`);
    }
    return { crawledName: resolvedName.trim(), fields };
  });
} catch (e) {
  console.error('Invalid records.json: ' + e.message);
  process.exit(2);
}

/* ---------- alias resolution (inline, from sg-data-loader) ---------- */
function resolveAlias(p, n) {
  if (!Object.prototype.hasOwnProperty.call(p.aliases || {}, n)) return null;
  return p.aliases[n];
}
function resolveId(p, n) {
  if (Object.prototype.hasOwnProperty.call(p.entities || {}, n)) return n;
  let via = resolveAlias(p, n);
  if (via && typeof via === 'object') via = via.id;
  return via && Object.prototype.hasOwnProperty.call(p.entities || {}, via) ? via : null;
}

/* ---------- similarity (from alias-candidates) ---------- */
function normalize(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[\s·・\-_.'"()（）]+/g, '');
}
function lev(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const dp = new Uint16Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) { let prev = dp[0]; dp[0] = i;
    for (let j = 1; j <= n; j++) { const t = dp[j]; dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
  }
  return dp[n];
}
function pairScore(a, b) {
  const na = normalize(a), nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.startsWith(nb) || nb.startsWith(na)) return 0.6 + 0.35 * (Math.min(na.length, nb.length) / Math.max(na.length, nb.length));
  if (na.includes(nb) || nb.includes(na)) return Math.min(na.length, nb.length) / Math.max(na.length, nb.length) * 0.95;
  return 1 - lev(na, nb) / Math.max(na.length, nb.length);
}
function similarity(a, b) {
  const full = pairScore(a, b);
  const ta = String(a).split(/[\s·・\-_]+/).filter(Boolean);
  const tb = String(b).split(/[\s·・\-_]+/).filter(Boolean);
  let best = 0;
  for (const x of ta) for (const y of tb) best = Math.max(best, pairScore(x, y));
  return Math.max(full, best * 0.9);
}

const nameField = (id, e) => {
  const knf = (pack.kindNameFields || {})[e.kind];
  return (knf && e[knf]) || e.name || id;
};
const surface = [];
for (const [id, e] of Object.entries(pack.entities || {})) {
  surface.push({ id, text: id, via: 'id' });
  const dn = nameField(id, e);
  if (dn && dn !== id) surface.push({ id, text: dn, via: 'name' });
}
for (const [alias, target] of Object.entries(pack.aliases || {})) {
  const id = target && typeof target === 'object' ? target.id : target;
  if (id && (pack.entities || {})[id]) surface.push({ id, text: alias, via: 'alias' });
}

function candidatesFor(name, topN) {
  topN = topN || 3;
  const scored = new Map();
  for (const s of surface) {
    const sc = similarity(name, s.text);
    const cur = scored.get(s.id);
    if (!cur || sc > cur.score) scored.set(s.id, { score: sc, via: s.via, text: s.text });
  }
  return [...scored.entries()]
    .map(([id, v]) => ({ id, score: +v.score.toFixed(3), matchedOn: `${v.via}:"${v.text}"` }))
    .filter((c) => c.score >= 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

/* ---------- cross-check fields for hits ---------- */
function crossCheck(id, fields) {
  const e = pack.entities[id];
  if (!e) return { status: 'no-baseline' };
  const result = { agree: [], conflict: [], gap: [] };
  const fieldMap = (pack.meta && pack.meta.recrawlFieldMap) || {};
  for (const [fk, fv] of Object.entries(fields)) {
    if (fk === 'crawledName' || fk === 'name' || fv === undefined || fv === null || fv === '') continue;
    // Only compare a like-for-like baseline field. Domain-specific aliases such
    // as birthDate -> birth can be declared explicitly in meta.recrawlFieldMap;
    // never fall back to actor/role for an unrelated field, which turns gaps
    // into false conflicts.
    const baselineField = fieldMap[fk] || fk;
    const hasBaseline = Object.prototype.hasOwnProperty.call(e, baselineField);
    const bv = hasBaseline ? e[baselineField] : undefined;
    if (!hasBaseline || bv === undefined || bv === null || bv === '' || bv === '待定') {
      if (fv != null) result.gap.push({ field: fk, baselineField, baseline: bv, crawled: fv });
    } else {
      const bvNorm = String(bv).replace(/ 饰$/, '').trim();
      const fvNorm = String(fv).replace(/ 饰$/, '').trim();
      if (bvNorm === fvNorm) result.agree.push(fk);
      else result.conflict.push({ field: fk, baselineField, baseline: bv, crawled: fv });
    }
  }
  return result;
}

/* ---------- run ---------- */
const hits = [], misses = [];
for (const r of records) {
  const id = resolveId(pack, r.crawledName);
  if (id) {
    hits.push({ crawledName: r.crawledName, id, crossCheck: crossCheck(id, r.fields) });
  } else {
    misses.push({ crawledName: r.crawledName, candidates: candidatesFor(r.crawledName) });
  }
}

const review = {
  source, fetchedAt, baseline: packPath,
  summary: { total: records.length, hits: hits.length, misses: misses.length },
  hits,
  misses,
  autoMergeable: hits.filter((h) => h.crossCheck.gap && h.crossCheck.gap.length).map((h) => ({
    id: h.id, crawledName: h.crawledName, gaps: h.crossCheck.gap,
  })),
  needsHumanReview: hits.filter((h) => h.crossCheck.conflict && h.crossCheck.conflict.length).map((h) => ({
    id: h.id, crawledName: h.crawledName, conflicts: h.crossCheck.conflict,
  })),
};

// output
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'review-report.json'), JSON.stringify(review, null, 2) + '\n');

console.log(`recrawl-skeleton: ${records.length} records -> ${hits.length} hits, ${misses.length} misses`);
console.log(`  cross-check: ${review.autoMergeable.length} auto-mergeable (gap fill), ${review.needsHumanReview.length} needs human review (conflict)`);
if (misses.length) {
  console.log('\nmisses (extend pack.aliases after confirmation):');
  for (const m of misses) {
    console.log(`  ${m.crawledName}`);
    for (const c of m.candidates) console.log(`      ${c.score}  ${c.id}  (${c.matchedOn})`);
    if (!m.candidates.length) console.log('      (no candidates - likely a genuinely new entity)');
  }
}
console.log(`\nwrote ${path.join(outDir, 'review-report.json')}`);
process.exit(misses.length ? 1 : 0);
