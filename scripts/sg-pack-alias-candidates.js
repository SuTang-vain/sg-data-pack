#!/usr/bin/env node
/*
 * sg-pack-alias-candidates.js — alias candidate generator for crawl normalization.
 *
 * Input: a Data Pack + a list of crawled names (JSON array or newline text).
 * For each name: report HIT (resolves to a stable id via aliases) or MISS with
 * candidate ids ranked by similarity (normalized Levenshtein over entity ids,
 * entity display names per kindNameFields/name, and existing alias keys).
 *
 * Usage:
 *   sg-data-pack alias-candidates <data.json> <names.json|names.txt> [--json] [--top <n>]
 *
 * Exit: 0 = all names hit, 1 = misses found (review candidates and extend aliases),
 *       2 = usage/io error.
 *
 * Workflow: run after a crawl, before writing any reference. Extend the pack's
 * aliases with confirmed mappings only — candidates are suggestions, not truth.
 */
'use strict';
const fs = require('fs');

const [, , packPath, namesPath, ...rest] = process.argv;
if (!packPath || !namesPath) {
  console.error('Usage: sg-data-pack alias-candidates <data.json> <names.json|names.txt> [--json] [--top <n>]');
  process.exit(2);
}
const asJson = rest.includes('--json');
const topN = (() => { const i = rest.indexOf('--top'); return i >= 0 ? parseInt(rest[i + 1], 10) : 3; })();

function load(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch (e) { console.error(`Cannot read ${p}: ${e.message}`); process.exit(2); }
}
const pack = JSON.parse(load(packPath));
const raw = load(namesPath).trim();
const names = raw.startsWith('[') ? JSON.parse(raw) : raw.split('\n').map((s) => s.trim()).filter(Boolean);

/* ---------- similarity ---------- */
function normalize(s) {
  return String(s).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // strip accents (Rosé -> rose)
    .replace(/[\s·・\-_.'"()（）]+/g, '');                      // strip separators
}
function lev(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const dp = new Uint16Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]; dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const t = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return dp[n];
}
function pairScore(a, b) {
  const na = normalize(a), nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  // prefix match (Roseanne ⊃ Rosé, 程兵 ⊃ 程) — strong signal for name variants
  if (na.startsWith(nb) || nb.startsWith(na)) {
    return 0.6 + 0.35 * (Math.min(na.length, nb.length) / Math.max(na.length, nb.length));
  }
  if (na.includes(nb) || nb.includes(na)) return Math.min(na.length, nb.length) / Math.max(na.length, nb.length) * 0.95;
  return 1 - lev(na, nb) / Math.max(na.length, nb.length);
}
function similarity(a, b) {
  const full = pairScore(a, b);
  // token-level: multi-word names match on their strongest token pair
  const ta = String(a).split(/[\s·・\-_]+/).filter(Boolean);
  const tb = String(b).split(/[\s·・\-_]+/).filter(Boolean);
  let best = 0;
  for (const x of ta) for (const y of tb) best = Math.max(best, pairScore(x, y));
  return Math.max(full, best * 0.9);
}

/* ---------- candidate surface ---------- */
const nameField = (id, e) => {
  const knf = (pack.kindNameFields || {})[e.kind];
  return (knf && e[knf]) || e.name || id;
};
const surface = []; // [{id, text, via}]
for (const [id, e] of Object.entries(pack.entities || {})) {
  surface.push({ id, text: id, via: 'id' });
  const dn = nameField(id, e);
  if (dn && dn !== id) surface.push({ id, text: dn, via: 'name' });
}
for (const [alias, id] of Object.entries(pack.aliases || {})) {
  surface.push({ id, text: alias, via: 'alias' });
}

const resolve = (name) => {
  if ((pack.entities || {})[name]) return name;
  const via = (pack.aliases || {})[name];
  return via && (pack.entities || {})[via] ? via : null;
};

/* ---------- run ---------- */
const results = [];
let misses = 0;
for (const name of names) {
  const hit = resolve(name);
  if (hit) { results.push({ name, status: 'hit', id: hit }); continue; }
  misses++;
  const scored = new Map(); // id -> best {score, via, text}
  for (const s of surface) {
    const sc = similarity(name, s.text);
    const cur = scored.get(s.id);
    if (!cur || sc > cur.score) scored.set(s.id, { score: sc, via: s.via, text: s.text });
  }
  const candidates = [...scored.entries()]
    .map(([id, v]) => ({ id, score: +v.score.toFixed(3), matchedOn: `${v.via}:"${v.text}"` }))
    .filter((c) => c.score >= 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
  results.push({ name, status: 'miss', candidates });
}

if (asJson) {
  console.log(JSON.stringify(results, null, 2));
} else {
  for (const r of results) {
    if (r.status === 'hit') console.log(`HIT   ${r.name} -> ${r.id}`);
    else {
      console.log(`MISS  ${r.name}`);
      for (const c of r.candidates) console.log(`        ${c.score}  ${c.id}  (${c.matchedOn})`);
      if (!r.candidates.length) console.log('        (no candidates above 0.50 — likely a genuinely new entity)');
    }
  }
  console.log(`\n${names.length} names: ${names.length - misses} hit, ${misses} miss`);
}
process.exit(misses ? 1 : 0);
