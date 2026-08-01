#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { gradeWorkspace } = require('./lib/sg-grader.js');

const [, , specArg, workspaceArg, ...args] = process.argv;
const usage = 'Usage: sg-data-pack grade <grader.json> <workspace> [--artifacts dir] [--task-id id] [--tree sha256:...] [--out grade.json] [--json]';
if (!specArg || !workspaceArg || specArg.startsWith('--') || workspaceArg.startsWith('--')) { console.error(usage); process.exit(2); }
const values = new Set(['--artifacts', '--task-id', '--tree', '--out']);
const booleans = new Set(['--json']);
const options = {};
for (let index = 0; index < args.length; index += 1) {
  const name = args[index];
  if (booleans.has(name)) { if (options[name]) { console.error(`Duplicate option: ${name}`); process.exit(2); } options[name] = true; continue; }
  if (!values.has(name)) { console.error(`Unknown option: ${name}`); process.exit(2); }
  const value = args[index + 1];
  if (!value || value.startsWith('--')) { console.error(`${name} requires a value`); process.exit(2); }
  if (options[name]) { console.error(`Duplicate option: ${name}`); process.exit(2); }
  options[name] = value; index += 1;
}
try {
  const spec = JSON.parse(fs.readFileSync(path.resolve(specArg), 'utf8'));
  const report = gradeWorkspace({
    spec, workspaceRoot: path.resolve(workspaceArg),
    artifactRoot: options['--artifacts'] ? path.resolve(options['--artifacts']) : null,
    taskId: options['--task-id'] || null, treeSha256: options['--tree'] || null,
  });
  const serialized = JSON.stringify(report, null, 2) + '\n';
  if (options['--out']) fs.writeFileSync(path.resolve(options['--out']), serialized);
  if (options['--json'] || !options['--out']) process.stdout.write(serialized);
  else console.log(`grade: ${report.verdict} (${report.score}/${report.maximumScore})`);
  process.exit(report.verdict === 'passed' ? 0 : 1);
} catch (error) { console.error('grade: ' + error.message); process.exit(error.code === 'INVALID_GRADER_SPEC' ? 2 : 3); }
