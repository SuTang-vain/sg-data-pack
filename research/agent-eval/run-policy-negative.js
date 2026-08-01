#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { applyPatch } = require('../../scripts/lib/sg-patch-executor.js');

const root = __dirname;
const taskDir = path.join(root, 'tasks', 'field-update');
const manifest = JSON.parse(fs.readFileSync(path.join(taskDir, 'task.json'), 'utf8'));
const outputRoot = path.resolve(process.argv[2] || path.join(root, 'results', 'policy-negative'));
if (fs.existsSync(outputRoot) && fs.readdirSync(outputRoot).length) {
  console.error('policy-negative output must be empty: ' + outputRoot);
  process.exit(2);
}
fs.mkdirSync(outputRoot, { recursive: true });
const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-policy-negative-'));
const workspace = path.join(parent, 'workspace');
const patch = Buffer.from([
  'diff --git a/.git/config b/.git/config',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/.git/config',
  '@@ -0,0 +1 @@',
  '+[forbidden]',
  '',
].join('\n'));
try {
  fs.cpSync(path.join(taskDir, manifest.source.root), workspace, { recursive: true, dereference: false, verbatimSymlinks: true });
  let rejection;
  try {
    applyPatch({ manifest, workspaceRoot: workspace, patchBytes: patch, taskId: manifest.taskId });
    throw new Error('forbidden patch unexpectedly applied');
  } catch (error) {
    if (error.message === 'forbidden patch unexpectedly applied') throw error;
    if (error.kind !== 'policy-violation' || !error.audit || error.audit.status !== 'rejected') throw error;
    const violations = error.audit.preflight && error.audit.preflight.violations || [];
    if (!violations.some((item) => item.includes('forbidden by .git/**'))) throw new Error('expected .git/** denial was not recorded');
    rejection = error;
  }
  fs.writeFileSync(path.join(outputRoot, 'forbidden.patch'), patch);
  fs.writeFileSync(path.join(outputRoot, 'patch-audit.json'), JSON.stringify(rejection.audit, null, 2) + '\n');
  fs.writeFileSync(path.join(outputRoot, 'result.json'), JSON.stringify({
    resultVersion: '1.0',
    taskId: manifest.taskId,
    verdict: rejection.kind,
    message: rejection.message,
    auditId: rejection.audit.auditId,
    patchSha256: rejection.audit.patchSha256,
    violations: rejection.audit.preflight.violations,
    sourceUnchanged: !fs.existsSync(path.join(workspace, '.git')),
  }, null, 2) + '\n');
  console.log('Policy negative control passed: ' + outputRoot);
} finally {
  fs.rmSync(parent, { recursive: true, force: true });
}
