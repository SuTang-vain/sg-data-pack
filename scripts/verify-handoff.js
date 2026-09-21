#!/usr/bin/env node
'use strict';

// Offline acceptance only: never install software, rebuild frozen IDs, or call a provider.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);

if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
  console.log('Usage: node scripts/verify-handoff.js\nOffline CLI, test, saved-evidence and pilot verification. Requires Node >= 18 and Git.');
  process.exit(0);
}
if (args.length) {
  console.error('Unexpected arguments. Usage: node scripts/verify-handoff.js');
  process.exit(2);
}
if (Number(process.versions.node.split('.')[0]) < 18) {
  console.error('Node >= 18 is required.');
  process.exit(2);
}
const git = spawnSync('git', ['--version'], { cwd: ROOT, encoding: 'utf8', timeout: 10000 });
if (git.error || git.status !== 0) {
  console.error('Git must be available on PATH for the patch and repository checks.');
  process.exit(2);
}
console.log(`Handoff verification: ${process.version}; ${process.platform}/${process.arch}; ${git.stdout.trim()}`);

function run(label, argv, capture = false) {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(process.execPath, argv, {
    cwd: ROOT,
    stdio: capture ? 'pipe' : 'inherit',
    encoding: 'utf8',
    maxBuffer: 16 << 20,
    timeout: 300000,
  });
  if (result.error || result.status !== 0) {
    if (capture) process.stderr.write((result.stdout || '') + (result.stderr || ''));
    console.error(`${label} failed: ${result.error ? result.error.message : `exit ${result.status}, signal ${result.signal || 'none'}`}`);
    process.exit(1);
  }
  return result.stdout;
}

run('CLI smoke', [path.join(ROOT, 'scripts', 'sg-data-pack'), '--help']);
const tests = fs.readdirSync(path.join(ROOT, 'tests'))
  .filter((name) => name.endsWith('.test.js')).sort()
  .map((name) => path.join(ROOT, 'tests', name));
if (!tests.length) {
  console.error('No tests found; refusing an empty acceptance run.');
  process.exit(1);
}
// Enumerate paths explicitly instead of relying on shell-specific glob expansion.
run('Complete test suite', ['--test', ...tests]);
run('Frozen tasks, results and artifact digests', [path.join(ROOT, 'research', 'agent-eval', 'audit-results.js')]);
const pilot = JSON.parse(run('Three Data Pack v1.3 pilots', [path.join(ROOT, 'research', 'run-v1.3-pilots.js')], true));
const passed = pilot.pilots.length === 3
  && pilot.pilots.every((p) => p.validation.errors.length === 0 && p.validation.warnings.length === 0)
  // This fixture intentionally changes a cover; diff exit 1 means differences, not a failure.
  && pilot.collectionEvolution.diffExitCode === 1
  && pilot.collectionEvolution.derivationsImpacted.some((d) => d.name === 'carouselItems')
  && pilot.chineseRecrawl.exitCode === 0
  && pilot.chineseRecrawl.needsHumanReview === 0
  && pilot.collectionTemplatize.exitCode === 0
  && pilot.collectionTemplatize.byteExact === true
  && pilot.typeGeneration.exitCode === 0
  && pilot.typeGeneration.containsWorkEntity === true;
if (!passed) {
  console.error('Pilot acceptance failed:\n' + JSON.stringify(pilot, null, 2));
  process.exit(1);
}
console.log('3 pilots passed: validation, evolution diff, recrawl, byte-exact template and type generation.');
console.log('\nHandoff verification PASSED. No provider, live browser experiment, or document rendering was run.');
