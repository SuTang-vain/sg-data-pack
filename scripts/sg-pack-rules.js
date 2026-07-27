#!/usr/bin/env node
/*
 * sg-pack-rules.js — library-level data-rules executor
 *
 * Usage:
 *   node sg-pack-rules.js <libDir> [--strict]                # uses <libDir>/lib/data/{data-rules.json,data.json}
 *   node sg-pack-rules.js <path/to/data-rules.json> [--strict]
 *
 * Behavior:
 *   1. Structural check of the rules file (rulesVersion/libId/profile/rules[].id/level/subject/rule/source)
 *   2. Executes every rule's `check` as a JS expression with the pack sections in scope
 *      (entities/relations/stages/contents/domain/assets/aliases/relationTypes/attributeTypes/kindNameFields/pack)
 *   3. hard rule failure -> exit 1; soft rule failure -> warning (exit 1 only with --strict)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const arg = process.argv[2];
const strict = process.argv.includes('--strict');
if (!arg) { console.error('Usage: node sg-pack-rules.js <libDir | data-rules.json> [--strict]'); process.exit(2); }

let rulesFile, dataFile;
if (fs.existsSync(arg) && fs.statSync(arg).isDirectory()) {
  rulesFile = path.join(arg, 'lib', 'data', 'data-rules.json');
  dataFile = path.join(arg, 'lib', 'data', 'data.json');
} else {
  rulesFile = path.resolve(process.cwd(), arg);
  dataFile = path.join(path.dirname(rulesFile), 'data.json');
}
for (const f of [rulesFile, dataFile]) {
  if (!fs.existsSync(f)) { console.error('File not found: ' + f); process.exit(2); }
}

let rulesDoc, pack;
try { rulesDoc = JSON.parse(fs.readFileSync(rulesFile, 'utf8')); }
catch (e) { console.error('data-rules.json parse failed: ' + e.message); process.exit(1); }
try { pack = JSON.parse(fs.readFileSync(dataFile, 'utf8')); }
catch (e) { console.error('data.json parse failed: ' + e.message); process.exit(1); }

/* ---------- structural check ---------- */
const structErrors = [];
if (rulesDoc.rulesVersion !== '1.0') structErrors.push('rulesVersion must be "1.0"');
if (typeof rulesDoc.libId !== 'string' || !rulesDoc.libId) structErrors.push('libId must be a non-empty string');
if (!rulesDoc.profile || typeof rulesDoc.profile !== 'object') structErrors.push('profile is required');
if (!Array.isArray(rulesDoc.rules) || !rulesDoc.rules.length) structErrors.push('rules must be a non-empty array');
const ids = new Set();
(rulesDoc.rules || []).forEach((r, i) => {
  const at = 'rules[' + i + ']';
  for (const f of ['id', 'level', 'subject', 'rule', 'source']) {
    if (typeof r[f] !== 'string' || !r[f]) structErrors.push(at + '.' + f + ' must be a non-empty string');
  }
  if (r.level && !['hard', 'soft'].includes(r.level)) structErrors.push(at + '.level must be "hard" or "soft"');
  if (r.source && !['observed', 'extracted', 'human'].includes(r.source)) structErrors.push(at + '.source must be observed/extracted/human');
  if (r.check !== undefined && r.check !== null && typeof r.check !== 'string') structErrors.push(at + '.check must be a JS expression string or null');
  if (r.id) {
    if (ids.has(r.id)) structErrors.push(at + '.id "' + r.id + '" is duplicated');
    ids.add(r.id);
  }
});
if (structErrors.length) {
  structErrors.forEach(e => console.error('[STRUCT] ' + e));
  console.error('✖ Rules-file structural check failed: ' + structErrors.length + ' error(s)');
  process.exit(1);
}

/* ---------- check execution ---------- */
const scope = {
  entities: pack.entities || {},
  relations: pack.relations || [],
  stages: pack.stages || [],
  contents: pack.contents || {},
  domain: pack.domain || {},
  assets: pack.assets || {},
  aliases: pack.aliases || {},
  relationTypes: pack.relationTypes || {},
  attributeTypes: pack.attributeTypes || {},
  kindNameFields: pack.kindNameFields || {},
  meta: pack.meta || {},
  sameAs: pack.sameAs || [],
  provenance: pack.provenance || {},
  pack
};
const scopeKeys = Object.keys(scope);

let hardFail = 0, softFail = 0, execErr = 0, passed = 0, noCheck = 0;
for (const r of rulesDoc.rules) {
  if (!r.check) { noCheck++; continue; }
  let ok, err = null;
  try {
    const fn = new Function(...scopeKeys, '"use strict"; return (' + r.check + ');');
    ok = !!fn(...scopeKeys.map(k => scope[k]));
  } catch (e) { err = e; ok = false; }
  if (ok) { passed++; continue; }
  if (err) {
    execErr++;
    console.error('[ERROR] ' + r.id + ' (' + r.level + '): check threw — ' + err.message);
    if (r.level === 'hard') hardFail++;
    continue;
  }
  if (r.level === 'hard') { hardFail++; console.error('[FAIL]  ' + r.id + ' (hard): ' + r.rule); }
  else { softFail++; console.warn('[softfail] ' + r.id + ' (soft): ' + r.rule); }
}

const total = rulesDoc.rules.length;
console.log('── ' + rulesDoc.libId + ' ──────────────────');
console.log('rules: ' + total + ' | passed: ' + passed + ' | hard-fail: ' + hardFail + ' | soft-fail: ' + softFail + ' | exec-error: ' + execErr + ' | no-check: ' + noCheck);

if (hardFail || execErr) { console.error('✖ Rules check failed'); process.exit(1); }
if (strict && softFail) { console.error('✖ Strict mode: ' + softFail + ' soft failure(s)'); process.exit(1); }
console.log('✔ Rules check passed');
