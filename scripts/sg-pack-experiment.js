#!/usr/bin/env node
'use strict';
const path = require('node:path');
const { runExperiment } = require('./lib/sg-experiment.js');

const [, , specArg, ...args] = process.argv;
if (!specArg || specArg.startsWith('--')) { console.error('Usage: sg-data-pack experiment <experiment.json> --out <dir> [--json]'); process.exit(2); }
let out = null;
let json = false;
for (let index = 0; index < args.length; index += 1) {
  const name = args[index];
  if (name === '--json') { if (json) { console.error('Duplicate option: --json'); process.exit(2); } json = true; continue; }
  if (name !== '--out') { console.error('Unknown option: ' + name); process.exit(2); }
  if (out) { console.error('Duplicate option: --out'); process.exit(2); }
  out = args[index + 1];
  if (!out || out.startsWith('--')) { console.error('--out requires a value'); process.exit(2); }
  index += 1;
}
if (!out) { console.error('experiment requires --out <dir>'); process.exit(2); }
try {
  const report = runExperiment({ specFile: path.resolve(specArg), outputRoot: path.resolve(out) });
  if (json) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  else {
    console.log(`Experiment ${report.experimentId}`);
    console.log(`pass rate: ${report.summary.passRate === null ? 'N/A' : (report.summary.passRate * 100).toFixed(1) + '%'} (${report.summary.passed}/${report.summary.validTrials})`);
    console.log(`claim level: ${report.summary.claimLevel}`);
    console.log(`report: ${path.resolve(out, 'EXPERIMENT.md')}`);
  }
  process.exit(report.summary.infraErrors || report.summary.invalidTrials ? 3 : report.summary.passed === report.summary.validTrials ? 0 : 1);
} catch (error) { console.error('experiment: ' + error.message); process.exit(2); }
