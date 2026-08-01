#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { validateTaskManifest, readTaskManifest } = require('./lib/agent-task-manifest.js');
const { runTask } = require('./lib/sg-task-runner.js');

const [, , action, taskArg, ...args] = process.argv;
const usage = [
  'Usage:',
  '  sg-data-pack task validate <task.json> [--shape-only] [--json]',
  '  sg-data-pack task inspect <task.json> [--json]',
  '  sg-data-pack task run <task.json> --agent-command <exe> [--agent-arg <arg>]... --artifacts <dir> [--provider name] [--model name] [--json]',
].join('\n');
if (!action || !taskArg || !['validate', 'inspect', 'run'].includes(action)) { console.error(usage); process.exit(2); }

function parse(allowedValue, allowedBoolean, repeatable = new Set()) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (allowedBoolean.has(name)) {
      if (Object.prototype.hasOwnProperty.call(options, name)) throw new Error(`Duplicate option: ${name}`);
      options[name] = true;
      continue;
    }
    if (!allowedValue.has(name)) throw new Error(`Unknown option: ${name}`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
    if (repeatable.has(name)) {
      if (!options[name]) options[name] = [];
      options[name].push(value);
    } else {
      if (Object.prototype.hasOwnProperty.call(options, name)) throw new Error(`Duplicate option: ${name}`);
      options[name] = value;
    }
    index += 1;
  }
  return options;
}

let options;
try {
  options = action === 'run'
    ? parse(new Set(['--agent-command', '--agent-arg', '--artifacts', '--provider', '--model']), new Set(['--json', '--keep-workspace']), new Set(['--agent-arg']))
    : parse(new Set(), new Set(['--json', '--shape-only']));
} catch (error) { console.error(error.message); process.exit(2); }
const taskFile = path.resolve(taskArg);

try {
  if (action === 'validate' || action === 'inspect') {
    const manifest = JSON.parse(fs.readFileSync(taskFile, 'utf8'));
    const validation = validateTaskManifest(manifest, {
      taskFile,
      verifyFiles: !options['--shape-only'],
      verifyTree: !options['--shape-only'],
    });
    if (options['--json']) process.stdout.write(JSON.stringify({ manifest: action === 'inspect' ? manifest : undefined, validation }, null, 2) + '\n');
    else {
      console.log(`Agent task ${manifest.taskId || '<missing>'}: ${validation.valid ? 'valid' : 'invalid'}`);
      console.log(`source: ${validation.sourceRoot || 'not resolved'}`);
      validation.issues.forEach((item) => console.error(`  ${item.path}: ${item.message}`));
    }
    process.exit(validation.valid ? 0 : 2);
  }
  if (!options['--agent-command'] || !options['--artifacts']) throw new Error('task run requires --agent-command and --artifacts');
  readTaskManifest(taskFile);
  const agentArgv = [options['--agent-command'], ...(options['--agent-arg'] || [])];
  const result = runTask({
    taskFile,
    agentArgv,
    artifactRoot: path.resolve(options['--artifacts']),
    agent: { provider: options['--provider'] || null, model: options['--model'] || null },
    keepWorkspace: Boolean(options['--keep-workspace']),
  });
  if (options['--json']) process.stdout.write(JSON.stringify(result.report, null, 2) + '\n');
  else {
    console.log(`TaskRun ${result.report.runId}`);
    console.log(`verdict: ${result.report.verdict}`);
    console.log(`patch: ${result.report.patch ? result.report.patch.status : 'not produced'}`);
    result.report.grades.forEach((grade) => console.log(`grade ${grade.graderId}: ${grade.verdict} (${grade.score}/${grade.maximumScore})`));
    console.log(`report: ${result.runFile}`);
  }
  process.exit(result.report.termination.processExitCode);
} catch (error) {
  console.error(`task ${action}: ${error.message}`);
  process.exit(error.kind === 'input-error' || error.code && /MANIFEST/.test(error.code) ? 2 : 3);
}
