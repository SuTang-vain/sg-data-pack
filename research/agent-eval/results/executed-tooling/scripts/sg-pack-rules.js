#!/usr/bin/env node
/*
 * sg-pack-rules.js — library-level data-rules executor
 *
 * Usage:
 *   node sg-pack-rules.js <libDir | data-rules.json> [--strict] [--rule <id>]
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { executeRules } = require('./lib/sg-pack-rules-core.js');

const usage = 'Usage: node sg-pack-rules.js <libDir | data-rules.json> [--strict] [--rule <id>]';

function parseArgs(argv) {
  let input = null;
  let strict = false;
  let ruleId = null;
  const seen = new Set();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--strict') {
      if (seen.has(arg)) throw new Error('duplicate option: --strict');
      seen.add(arg);
      strict = true;
      continue;
    }
    if (arg === '--rule') {
      if (seen.has(arg)) throw new Error('duplicate option: --rule');
      seen.add(arg);
      if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) throw new Error('--rule requires an id');
      ruleId = argv[++i];
      continue;
    }
    if (arg.startsWith('-')) throw new Error('unknown option: ' + arg);
    if (input !== null) throw new Error('unexpected positional argument: ' + arg);
    input = arg;
  }
  if (!input) throw new Error('library or rules path is required');
  return { input, strict, ruleId };
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  console.error(usage);
  process.exit(2);
}

let rulesFile;
let dataFile;
if (fs.existsSync(options.input) && fs.statSync(options.input).isDirectory()) {
  rulesFile = path.join(options.input, 'lib', 'data', 'data-rules.json');
  dataFile = path.join(options.input, 'lib', 'data', 'data.json');
} else {
  rulesFile = path.resolve(process.cwd(), options.input);
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

const ruleIds = options.ruleId === null ? undefined : [options.ruleId];
const result = executeRules(rulesDoc, pack, { ruleIds });
if (result.structuralErrors.length) {
  result.structuralErrors.forEach((error) => console.error('[STRUCT] ' + error));
  console.error('✖ Rules-file structural check failed: ' + result.structuralErrors.length + ' error(s)');
  process.exit(1);
}
if (result.selectionErrors && result.selectionErrors.length) {
  result.selectionErrors.forEach((error) => console.error('[SELECT] ' + error));
  process.exit(2);
}
if (result.unknownRuleIds.length) {
  console.error('Unknown rule id: ' + result.unknownRuleIds.join(', '));
  process.exit(2);
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
if (options.strict && counts.softFail) {
  console.error('✖ Strict mode: ' + counts.softFail + ' soft failure(s)');
  process.exit(1);
}
console.log('✔ Rules check passed');
