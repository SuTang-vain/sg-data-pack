#!/usr/bin/env node
'use strict';
const path = require('node:path');
const { readRuntimeEvidence } = require('./lib/sg-runtime-evidence.js');
const { readVisualEvidence } = require('./lib/sg-visual-evidence.js');

const [, , kind, fileArg, ...args] = process.argv;
if (!['runtime', 'visual'].includes(kind) || !fileArg || args.some((item) => item !== '--json') || args.filter((item) => item === '--json').length > 1) {
  console.error('Usage: sg-data-pack evidence <runtime|visual> <evidence.json> [--json]');
  process.exit(2);
}
try {
  const loaded = kind === 'runtime' ? readRuntimeEvidence(path.resolve(fileArg)) : readVisualEvidence(path.resolve(fileArg));
  if (args.includes('--json')) process.stdout.write(JSON.stringify(loaded, null, 2) + '\n');
  else {
    console.log(`${kind} evidence: ${loaded.validation.status}`);
    loaded.validation.errors.forEach((error) => console.error('  ' + error));
  }
  process.exit(loaded.validation.status === 'passed' ? 0 : loaded.validation.status === 'failed' || loaded.validation.status === 'not-assessed' ? 1 : 2);
} catch (error) { console.error(`${kind} evidence: ${error.message}`); process.exit(2); }
