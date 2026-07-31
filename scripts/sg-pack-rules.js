#!/usr/bin/env node
/*
 * sg-pack-rules.js — library-level data-rules executor
 *
 * Usage:
 *   node sg-pack-rules.js <libDir> [--strict]
 *   node sg-pack-rules.js <path/to/data-rules.json> [--strict]
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { executeRules } = require('./lib/sg-pack-rules-core.js');

const arg = process.argv[2];
const strict = process.argv.includes('--strict');
if (!arg) {
  console.error('Usage: node sg-pack-rules.js <libDir | data-rules.json> [--strict]');
  process.exit(2);
}

let rulesFile;
let dataFile;
if (fs.existsSync(arg) && fs.statSync(arg).isDirectory()) {
  rulesFile = path.join(arg, 'lib', 'data', 'data-rules.json');
  dataFile = path.join(arg, 'lib', 'data', 'data.json');
} else {
  rulesFile = path.resolve(process.cwd(), arg);
  dataFile = path.join(path.dirname(rulesFile), 'data.json');
}
for (const file of [rulesFile, dataFile]) {
  if (!fs.existsSync(file)) {
    console.error('File not found: ' + file);
    process.exit(2);
  }
}

let rulesDoc;
let pack;
try { rulesDoc = JSON.parse(fs.readFileSync(rulesFile, 'utf8')); }
catch (error) { console.error('data-rules.json parse failed: ' + error.message); process.exit(1); }
try { pack = JSON.parse(fs.readFileSync(dataFile, 'utf8')); }
catch (error) { console.error('data.json parse failed: ' + error.message); process.exit(1); }

const result = executeRules(rulesDoc, pack);
if (result.structuralErrors.length) {
  result.structuralErrors.forEach((error) => console.error('[STRUCT] ' + error));
  console.error('✖ Rules-file structural check failed: ' + result.structuralErrors.length + ' error(s)');
  process.exit(1);
}

for (const item of result.results) {
  if (item.status === 'passed' || item.status === 'no-check') continue;
  if (item.status === 'error') {
    console.error('[ERROR] ' + item.id + ' (' + item.level + '): check threw — ' + item.exception.message);
    continue;
  }
  const hint = (item.subject ? '\n         → subject: ' + item.subject : '') +
    (item.repairHint ? '\n         → repair: ' + item.repairHint : '');
  if (item.level === 'hard') console.error('[FAIL]  ' + item.id + ' (hard): ' + item.rule + hint);
  else console.warn('[softfail] ' + item.id + ' (soft): ' + item.rule + hint);
}

const counts = result.counts;
console.log('── ' + result.libId + ' ──────────────────');
console.log('rules: ' + counts.total + ' | passed: ' + counts.passed + ' | hard-fail: ' + counts.hardFail + ' | soft-fail: ' + counts.softFail + ' | exec-error: ' + counts.errors + ' | no-check: ' + counts.noCheck);
if (counts.hardFail || counts.errors) {
  console.error('✖ Rules check failed');
  process.exit(1);
}
if (strict && counts.softFail) {
  console.error('✖ Strict mode: ' + counts.softFail + ' soft failure(s)');
  process.exit(1);
}
console.log('✔ Rules check passed');
