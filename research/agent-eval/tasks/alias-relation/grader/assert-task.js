#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const [, , workspace, task] = process.argv;
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}
function equivalent(left, right) { return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right)); }
if (!workspace || !['field-update', 'alias-relation', 'pattern-c'].includes(task)) {
  console.error('hidden grader received invalid trusted arguments');
  process.exit(3);
}
let expected;
try {
  expected = JSON.parse(fs.readFileSync(path.join(__dirname, 'expected-data.json'), 'utf8'));
} catch (error) {
  console.error('hidden expected candidate is unavailable: ' + error.message);
  process.exit(3);
}
try {
  const candidate = JSON.parse(fs.readFileSync(path.join(workspace, 'lib/data/data.json'), 'utf8'));
  if (!equivalent(candidate, expected)) throw new Error('candidate data.json differs from the complete hidden expected candidate');
  if (task === 'pattern-c') {
    const script = fs.readFileSync(path.join(workspace, 'lib/data/data.js'), 'utf8');
    const match = /^\s*(?:\/\/[^\n]*\n\s*)?globalThis\.SG_DATA_PACK\s*=\s*([\s\S]*);\s*$/.exec(script);
    if (!match) throw new Error('data.js must contain only a generated SG_DATA_PACK JSON assignment');
    const mirrored = JSON.parse(match[1]);
    if (!equivalent(mirrored, expected)) throw new Error('data.js does not exactly mirror the complete expected data.json');
  }
  console.log(task + ': complete hidden candidate passed');
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
