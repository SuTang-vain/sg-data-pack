'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { readTaskManifest, validateTaskManifest, resolveSourceRoot, computeTreeSha256, sha256: taskSha256 } = require('./agent-task-manifest.js');
const { runCommand } = require('./sg-command-runner.js');
const { snapshotTree } = require('./sg-tree-snapshot.js');
const { applyPatch, PatchError } = require('./sg-patch-executor.js');
const { gradeWorkspace, validateGraderSpec } = require('./sg-grader.js');
const { sha256Bytes, contentId, safeRelative } = require('./sg-evidence-utils.js');
const { canonicalPath } = require('./sg-path-policy.js');

function ensureOutsideSource(sourceRoot, artifactRoot) {
  const source = fs.realpathSync(sourceRoot);
  const output = path.resolve(artifactRoot);
  const relative = path.relative(source, output);
  if (relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))) throw new Error('artifact root must be outside source root');
}

function writeAtomic(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`);
  let fd;
  try {
    fd = fs.openSync(temp, 'wx', 0o600);
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    fs.renameSync(temp, file);
  } catch (error) {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(temp); } catch (_) { /* absent */ }
    throw error;
  }
}

function artifact(root, id, file, mediaType) {
  const bytes = fs.readFileSync(file);
  return { id, path: path.relative(root, file).split(path.sep).join('/'), mediaType, bytes: bytes.length, sha256: sha256Bytes(bytes) };
}

function mediaTypeFor(file) {
  if (file.endsWith('.json')) return 'application/json';
  if (file.endsWith('.png')) return 'image/png';
  if (file.endsWith('.html')) return 'text/html';
  if (file.endsWith('.diff') || file.endsWith('.patch')) return 'text/x-diff';
  if (file.endsWith('.md')) return 'text/markdown';
  return 'text/plain';
}

function collectOutputArtifacts(root, current) {
  const known = new Set(current.map((item) => item.path));
  const files = [];
  const unsupported = [];
  function walk(directory) {
    for (const name of fs.readdirSync(directory).sort()) {
      const file = path.join(directory, name);
      const relative = path.relative(root, file).split(path.sep).join('/');
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) unsupported.push(`${relative}: symlink`);
      else if (stat.isDirectory()) walk(file);
      else if (stat.isFile() && stat.nlink > 1) unsupported.push(`${relative}: hardlink`);
      else if (stat.isFile()) files.push(file);
      else unsupported.push(`${relative}: unsupported filesystem entry`);
    }
  }
  walk(root);
  for (const file of files) {
    const relative = path.relative(root, file).split(path.sep).join('/');
    if (relative === 'task-run.json' || known.has(relative)) continue;
    const id = 'generated-' + relative.replace(/[^A-Za-z0-9._-]+/g, '-');
    current.push(artifact(root, id, file, mediaTypeFor(file)));
    known.add(relative);
  }
  current.sort((left, right) => left.path.localeCompare(right.path));
  return unsupported;
}

function replaceTokens(argv, values) {
  return argv.map((argument) => Object.entries(values).reduce((value, [token, replacement]) => value.split(token).join(replacement), argument));
}

function agentResult(run) {
  return {
    provider: null, model: null, argv: run.argv, cwd: run.cwd,
    exitCode: run.exitCode, signal: run.signal, timedOut: run.timedOut, durationMs: run.durationMs,
    stdoutSha256: sha256Bytes(run.stdout || ''), stderrSha256: sha256Bytes(run.stderr || ''),
    stdout: run.stdout, stderr: run.stderr,
    stdoutTruncated: run.stdoutTruncated, stderrTruncated: run.stderrTruncated, error: run.error || null,
  };
}

function loadGraderSpec(reference, taskDir) {
  if (reference && typeof reference === 'object' && !Array.isArray(reference)) return { spec: reference, root: taskDir };
  const relative = safeRelative(reference, 'grader spec path');
  const file = path.resolve(taskDir, relative);
  const fromRoot = path.relative(taskDir, file);
  if (fromRoot === '..' || fromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(fromRoot)) throw new Error('grader spec escapes task directory');
  return { spec: JSON.parse(fs.readFileSync(file, 'utf8')), root: path.dirname(file), file };
}

function buildRun(report) {
  const material = { ...report };
  delete material.runId;
  report.runId = contentId('task-run', material, []);
  return report;
}

function verifyFileBinding(binding) {
  try {
    const stat = fs.lstatSync(binding.file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('must be a regular non-symlink file');
    if (stat.nlink > 1) throw new Error('hardlinks are not allowed');
    const actual = taskSha256(fs.readFileSync(binding.file));
    return actual === binding.sha256 ? null : `digest mismatch: expected ${binding.sha256}, received ${actual}`;
  } catch (error) { return error.message; }
}

function integrityIssues({ absoluteTask, taskFileSha256, loadedGraders, externalBindings }) {
  const issues = [];
  const taskIssue = verifyFileBinding({ file: absoluteTask, sha256: taskFileSha256 });
  if (taskIssue) issues.push(`task manifest: ${taskIssue}`);
  for (const loaded of loadedGraders) {
    const specIssue = verifyFileBinding({ file: loaded.file, sha256: loaded.reference.sha256 });
    if (specIssue) issues.push(`grader ${loaded.reference.id} spec: ${specIssue}`);
    try {
      const actualTree = computeTreeSha256(loaded.root);
      if (actualTree !== loaded.reference.treeSha256) issues.push(`grader ${loaded.reference.id} tree digest mismatch: expected ${loaded.reference.treeSha256}, received ${actualTree}`);
    } catch (error) { issues.push(`grader ${loaded.reference.id} tree: ${error.message}`); }
  }
  for (const binding of externalBindings) {
    const bindingIssue = verifyFileBinding(binding);
    if (bindingIssue) issues.push(`${binding.id}: ${bindingIssue}`);
  }
  return issues;
}

function captureTrustedTools() {
  const originalScriptsRoot = path.resolve(__dirname, '..');
  const original = snapshotTree(originalScriptsRoot, { errorOnSpecialFile: true, exclude: false });
  return { originalScriptsRoot, originalTreeSha256: original.treeSha256 };
}

function stageTrustedTools(parent, captured) {
  const current = snapshotTree(captured.originalScriptsRoot, { errorOnSpecialFile: true, exclude: false });
  if (current.treeSha256 !== captured.originalTreeSha256) throw new Error('original tool scripts changed before staging');
  const toolRoot = path.join(parent, 'trusted-tools');
  const scriptsRoot = path.join(toolRoot, 'scripts');
  fs.mkdirSync(toolRoot, { recursive: true });
  fs.cpSync(captured.originalScriptsRoot, scriptsRoot, { recursive: true, dereference: false, verbatimSymlinks: true });
  const staged = snapshotTree(scriptsRoot, { errorOnSpecialFile: true, exclude: false });
  if (staged.treeSha256 !== captured.originalTreeSha256) throw new Error('staged tool scripts tree digest mismatch');
  return { ...captured, toolRoot, scriptsRoot, stagedTreeSha256: staged.treeSha256 };
}

function verifyTrustedTools(tools) {
  const issues = [];
  try {
    const original = snapshotTree(tools.originalScriptsRoot, { errorOnSpecialFile: true, exclude: false });
    if (original.treeSha256 !== tools.originalTreeSha256) issues.push(`original tool scripts changed: expected ${tools.originalTreeSha256}, received ${original.treeSha256}`);
  } catch (error) { issues.push('original tool scripts: ' + error.message); }
  if (tools.scriptsRoot) {
    try {
      const staged = snapshotTree(tools.scriptsRoot, { errorOnSpecialFile: true, exclude: false });
      if (staged.treeSha256 !== tools.stagedTreeSha256) issues.push(`staged tool scripts changed: expected ${tools.stagedTreeSha256}, received ${staged.treeSha256}`);
    } catch (error) { issues.push('staged tool scripts: ' + error.message); }
  }
  return issues;
}

function stageGraders(loadedGraders, parent) {
  const stagingRoot = path.join(parent, 'trusted-graders');
  fs.mkdirSync(stagingRoot, { recursive: true });
  return loadedGraders.map((loaded) => {
    const root = path.join(stagingRoot, loaded.reference.id);
    fs.cpSync(loaded.root, root, { recursive: true, dereference: false, verbatimSymlinks: true });
    const treeSha256 = computeTreeSha256(root);
    if (treeSha256 !== loaded.reference.treeSha256) throw new Error(`staged grader ${loaded.reference.id} tree digest mismatch`);
    const relativeSpec = path.relative(loaded.root, loaded.file);
    const file = path.join(root, relativeSpec);
    const specIssue = verifyFileBinding({ file, sha256: loaded.reference.sha256 });
    if (specIssue) throw new Error(`staged grader ${loaded.reference.id} spec ${specIssue}`);
    const spec = JSON.parse(fs.readFileSync(file, 'utf8'));
    const validation = validateGraderSpec(spec);
    if (!validation.valid) throw new Error(`staged grader ${loaded.reference.id} is invalid: ${validation.errors.join('; ')}`);
    return { reference: loaded.reference, root, file, spec };
  });
}

function runTask({ taskFile, agentArgv, artifactRoot, agent = {}, keepWorkspace = false, trialId = null, integrityInputs = [] } = {}) {
  if (!taskFile || !Array.isArray(agentArgv) || !agentArgv.length || !artifactRoot) throw new Error('taskFile, non-empty agentArgv, and artifactRoot are required');
  if (!Array.isArray(integrityInputs) || integrityInputs.some((binding) => !binding || typeof binding.id !== 'string' || typeof binding.file !== 'string' || typeof binding.sha256 !== 'string')) throw new TypeError('integrityInputs must contain id, file, and sha256 bindings');
  const initialExternalIssues = integrityInputs.map((binding) => ({ binding, issue: verifyFileBinding(binding) })).filter((item) => item.issue);
  if (initialExternalIssues.length) {
    const error = new Error('task integrity input validation failed: ' + initialExternalIssues.map((item) => `${item.binding.id}: ${item.issue}`).join('; '));
    error.kind = 'input-error';
    throw error;
  }
  const infraExitCodes = agent.infraExitCodes === undefined ? [] : agent.infraExitCodes;
  if (!Array.isArray(infraExitCodes) || infraExitCodes.some((value) => !Number.isInteger(value) || value < 1 || value > 255) || new Set(infraExitCodes).size !== infraExitCodes.length) throw new TypeError('agent.infraExitCodes must contain unique exit codes from 1 to 255');
  const absoluteTask = path.resolve(taskFile);
  const taskDir = path.dirname(absoluteTask);
  const taskFileSha256 = taskSha256(fs.readFileSync(absoluteTask));
  const manifest = readTaskManifest(absoluteTask);
  const validation = validateTaskManifest(manifest, { taskFile: absoluteTask, verifyFiles: true, verifyTree: true });
  if (!validation.valid) {
    const error = new Error('task input validation failed: ' + validation.issues.map((item) => `${item.path}: ${item.message}`).join('; '));
    error.kind = 'input-error';
    throw error;
  }
  const loadedGraders = manifest.graders.map((reference) => {
    const loaded = loadGraderSpec(reference.spec, taskDir);
    if (!loaded.file || taskSha256(fs.readFileSync(loaded.file)) !== reference.sha256) {
      const error = new Error(`grader ${reference.id} spec digest mismatch`);
      error.kind = 'input-error';
      throw error;
    }
    if (computeTreeSha256(loaded.root) !== reference.treeSha256) {
      const error = new Error(`grader ${reference.id} tree digest mismatch`);
      error.kind = 'input-error';
      throw error;
    }
    const graderValidation = validateGraderSpec(loaded.spec);
    if (!graderValidation.valid) {
      const error = new Error(`grader ${reference.id} is invalid: ${graderValidation.errors.join('; ')}`);
      error.kind = 'input-error';
      throw error;
    }
    return { reference, ...loaded };
  });
  const trustedToolsCapture = captureTrustedTools();
  const sourceRoot = resolveSourceRoot(manifest, { taskFile: absoluteTask });
  const requestedOutputRoot = path.resolve(artifactRoot);
  if (fs.existsSync(requestedOutputRoot) && fs.lstatSync(requestedOutputRoot).isSymbolicLink()) throw new Error('artifact root must not be a symlink');
  const outputRoot = canonicalPath(requestedOutputRoot);
  ensureOutsideSource(sourceRoot, outputRoot);
  if (fs.existsSync(outputRoot) && fs.readdirSync(outputRoot).length) throw new Error('artifact root must not already contain files');
  fs.mkdirSync(outputRoot, { recursive: true });
  const sourceBefore = snapshotTree(sourceRoot, { errorOnSpecialFile: true, exclude: false });
  const workspaceParent = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-agent-task-'));
  const workspaceRoot = path.join(workspaceParent, 'workspace');
  try {
    fs.cpSync(sourceRoot, workspaceRoot, { recursive: true, dereference: false, verbatimSymlinks: true });
    const workspaceBeforeAgent = snapshotTree(workspaceRoot, { errorOnSpecialFile: true, exclude: false });
  const patchPath = path.join(outputRoot, 'agent.patch');
  const promptPath = path.join(outputRoot, 'TASK.md');
  writeAtomic(promptPath, Buffer.from(manifest.instructions.text + '\n', 'utf8'));
  const promptSha256 = sha256Bytes(fs.readFileSync(promptPath));
  const values = { '{workspace}': workspaceRoot, '{patch}': patchPath, '{prompt}': promptPath, '{taskId}': manifest.taskId, '{artifacts}': outputRoot };
  const argv = replaceTokens(agentArgv, values);
  const agentRun = runCommand({ argv, cwd: workspaceRoot, allowedRoot: workspaceParent, timeoutMs: manifest.execution.timeoutMs, maxOutputBytes: manifest.execution.maxOutputBytes, env: {}, envAllowlist: ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'LC_CTYPE'] });
  const agentAudit = agentResult(agentRun);
  agentAudit.provider = agent.provider || null;
  agentAudit.model = agent.model || null;
  try { agentAudit.providerMetadata = agentRun.stdout.trim() ? JSON.parse(agentRun.stdout.trim().split('\n').pop()) : null; }
  catch (_) { agentAudit.providerMetadata = null; }
  let workspaceAfterAgent = null;
  let sourceAfterAgent = null;
  let verdict = 'passed';
  let patchAudit = null;
  const grades = [];
  const secondaryErrors = [];
  let termination = { kind: 'completed', processExitCode: 0, semanticVerdict: 'passed' };
  const artifactList = [artifact(outputRoot, 'task-prompt', promptPath, 'text/markdown')];

  try {
    try {
      workspaceAfterAgent = snapshotTree(workspaceRoot, { errorOnSpecialFile: true, exclude: false });
      sourceAfterAgent = snapshotTree(sourceRoot, { errorOnSpecialFile: true, exclude: false });
    } catch (snapshotError) {
      const error = new Error('agent created an unsupported filesystem entry: ' + snapshotError.message);
      error.kind = 'policy-violation';
      throw error;
    }
    if (!fs.existsSync(promptPath) || fs.lstatSync(promptPath).isSymbolicLink() || !fs.lstatSync(promptPath).isFile() || fs.lstatSync(promptPath).nlink > 1 || sha256Bytes(fs.readFileSync(promptPath)) !== promptSha256) {
      const error = new Error('agent modified the immutable task prompt artifact');
      error.kind = 'policy-violation';
      throw error;
    }
    const agentArtifactNames = fs.readdirSync(outputRoot).sort();
    if (agentArtifactNames.some((name) => !['TASK.md', 'agent.patch'].includes(name))) {
      const error = new Error('agent wrote undeclared files into the artifact root: ' + agentArtifactNames.filter((name) => !['TASK.md', 'agent.patch'].includes(name)).join(', '));
      error.kind = 'policy-violation';
      throw error;
    }
    if (sourceAfterAgent.treeSha256 !== sourceBefore.treeSha256) {
      const error = new Error('agent modified the source root outside the disposable workspace');
      error.kind = 'policy-violation';
      throw error;
    }
    if (workspaceAfterAgent.treeSha256 !== workspaceBeforeAgent.treeSha256) {
      const error = new Error('agent modified the workspace directly; it must emit only a patch');
      error.kind = 'policy-violation';
      throw error;
    }
    const postAgentIntegrityIssues = [
      ...integrityIssues({ absoluteTask, taskFileSha256, loadedGraders, externalBindings: integrityInputs }),
      ...verifyTrustedTools(trustedToolsCapture),
    ];
    if (postAgentIntegrityIssues.length) {
      const error = new Error('immutable task inputs changed during agent execution: ' + postAgentIntegrityIssues.join('; '));
      error.kind = 'policy-violation';
      throw error;
    }
    if (agentRun.error || agentRun.exitCode !== 0) {
      const error = new Error(agentRun.timedOut ? 'agent command timed out' : 'agent command failed');
      error.kind = agentRun.timedOut || agentRun.error || new Set(agent.infraExitCodes || []).has(agentRun.exitCode) ? 'infra-error' : 'agent-failed';
      throw error;
    }
    if (!fs.existsSync(patchPath)) {
      const error = new Error('agent did not produce the required unified diff');
      error.kind = 'agent-failed';
      throw error;
    }
    if (fs.lstatSync(patchPath).isSymbolicLink() || !fs.lstatSync(patchPath).isFile() || fs.lstatSync(patchPath).nlink > 1) {
      const error = new Error('agent.patch must be a regular non-symlink, non-hardlinked file');
      error.kind = 'policy-violation';
      throw error;
    }
    const patchBytes = fs.readFileSync(patchPath);
    artifactList.push(artifact(outputRoot, 'agent-patch', patchPath, 'text/x-diff'));
    const applied = applyPatch({ manifest, workspaceRoot, patchBytes, taskId: manifest.taskId, timeoutMs: manifest.execution.timeoutMs });
    patchAudit = applied.audit;
    const patchAuditPath = path.join(outputRoot, 'patch-audit.json');
    writeAtomic(patchAuditPath, Buffer.from(JSON.stringify(patchAudit, null, 2) + '\n'));
    artifactList.push(artifact(outputRoot, 'patch-audit', patchAuditPath, 'application/json'));
    const candidateTreeSha256 = 'sha256:' + applied.after.treeSha256;
    let trustedTools;
    let stagedGraders;
    try {
      trustedTools = stageTrustedTools(workspaceParent, trustedToolsCapture);
      stagedGraders = stageGraders(loadedGraders, workspaceParent);
    } catch (stagingError) {
      const error = new Error('trusted grader staging failed: ' + stagingError.message);
      error.kind = 'policy-violation';
      throw error;
    }
    for (const loadedGrader of stagedGraders) {
      const { reference } = loadedGrader;
      const preGradeToolIssues = verifyTrustedTools(trustedTools);
      if (preGradeToolIssues.length) {
        const error = new Error('trusted tool integrity failed before grading: ' + preGradeToolIssues.join('; '));
        error.kind = 'policy-violation';
        throw error;
      }
      if (computeTreeSha256(loadedGrader.root) !== reference.treeSha256) {
        const error = new Error(`staged grader ${reference.id} changed before invocation`);
        error.kind = 'policy-violation';
        throw error;
      }
      const grade = gradeWorkspace({ spec: loadedGrader.spec, graderRoot: loadedGrader.root, workspaceRoot, artifactRoot: outputRoot, toolRoot: trustedTools.toolRoot, taskId: manifest.taskId, treeSha256: candidateTreeSha256, timeoutMs: manifest.execution.timeoutMs, maxOutputBytes: manifest.execution.maxOutputBytes });
      grade.manifestWeight = reference.weight;
      grade.gradeId = contentId('grade', grade, ['gradeId']);
      grades.push(grade);
      const gradeFile = path.join(outputRoot, `grade-${reference.id}.json`);
      writeAtomic(gradeFile, Buffer.from(JSON.stringify(grade, null, 2) + '\n'));
      artifactList.push(artifact(outputRoot, `grade-${reference.id}`, gradeFile, 'application/json'));
      const postGradeToolIssues = verifyTrustedTools(trustedTools);
      if (postGradeToolIssues.length) {
        const error = new Error('trusted tool integrity failed during grading: ' + postGradeToolIssues.join('; '));
        error.kind = 'policy-violation';
        throw error;
      }
      if (computeTreeSha256(loadedGrader.root) !== reference.treeSha256) {
        const error = new Error(`staged grader ${reference.id} changed during invocation`);
        error.kind = 'policy-violation';
        throw error;
      }
    }
    const postGraderIntegrityIssues = integrityIssues({ absoluteTask, taskFileSha256, loadedGraders, externalBindings: integrityInputs });
    if (postGraderIntegrityIssues.length) {
      const error = new Error('immutable task inputs changed during grading: ' + postGraderIntegrityIssues.join('; '));
      error.kind = 'policy-violation';
      throw error;
    }
    let workspaceAfterGraders;
    try {
      workspaceAfterGraders = snapshotTree(workspaceRoot, { errorOnSpecialFile: true, exclude: false });
    } catch (snapshotError) {
      const error = new Error('grader created an unsupported filesystem entry: ' + snapshotError.message);
      error.kind = 'policy-violation';
      throw error;
    }
    if (workspaceAfterGraders.treeSha256 !== applied.after.treeSha256) {
      const error = new Error('grader modified the immutable candidate workspace');
      error.kind = 'policy-violation';
      throw error;
    }
    if (!grades.length || grades.some((grade) => grade.verdict === 'failed')) {
      verdict = 'grader-failed';
      termination = { kind: 'completed', processExitCode: 1, semanticVerdict: verdict };
    } else if (grades.some((grade) => grade.verdict === 'infra-error')) {
      verdict = 'infra-error';
      termination = { kind: 'infrastructure-error', processExitCode: 3, semanticVerdict: verdict, message: 'one or more grader checks had an infrastructure error' };
    }
  } catch (error) {
    if (error.audit) {
      patchAudit = error.audit;
      const patchAuditPath = path.join(outputRoot, 'patch-audit.json');
      writeAtomic(patchAuditPath, Buffer.from(JSON.stringify(patchAudit, null, 2) + '\n'));
      artifactList.push(artifact(outputRoot, 'patch-audit', patchAuditPath, 'application/json'));
    }
    const candidateFailureObserved = grades.some((grade) => grade.verdict === 'failed');
    if (candidateFailureObserved) {
      secondaryErrors.push({ kind: error.kind || 'post-grade-error', message: error.message });
      verdict = 'grader-failed';
      termination = { kind: 'completed', processExitCode: 1, semanticVerdict: verdict, message: 'candidate failure observed; additional post-grade error: ' + error.message };
    } else {
      verdict = error.kind === 'policy-not-supported' ? 'patch-invalid' : error.kind || (error instanceof PatchError ? 'patch-invalid' : 'infra-error');
      if (!['agent-failed', 'patch-invalid', 'policy-violation', 'input-error', 'infra-error'].includes(verdict)) verdict = 'patch-invalid';
      termination = { kind: verdict === 'infra-error' ? 'infrastructure-error' : 'completed', processExitCode: verdict === 'infra-error' ? 3 : verdict === 'input-error' ? 2 : 1, semanticVerdict: verdict, message: error.message };
    }
  }

  const unsupportedArtifacts = collectOutputArtifacts(outputRoot, artifactList);
  if (unsupportedArtifacts.length && verdict !== 'policy-violation') {
    const message = 'trusted grader output contains unsupported artifacts: ' + unsupportedArtifacts.join(', ');
    if (grades.some((grade) => grade.verdict === 'failed') || verdict === 'grader-failed') {
      secondaryErrors.push({ kind: 'unsupported-artifact', message });
      verdict = 'grader-failed';
      termination = { kind: 'completed', processExitCode: 1, semanticVerdict: verdict, message: 'candidate failure observed; additional post-grade error: ' + message };
    } else {
      verdict = 'policy-violation';
      termination = { kind: 'completed', processExitCode: 1, semanticVerdict: verdict, message };
    }
  }
  let sourceFinal = null;
  let sourceFinalError = null;
  try { sourceFinal = snapshotTree(sourceRoot, { errorOnSpecialFile: true, exclude: false }); }
  catch (error) { sourceFinalError = error.message; }
  const preserveCandidateFailure = (kind, message) => {
    if (grades.some((grade) => grade.verdict === 'failed') || verdict === 'grader-failed') {
      secondaryErrors.push({ kind, message });
      verdict = 'grader-failed';
      termination = { kind: 'completed', processExitCode: 1, semanticVerdict: verdict, message: 'candidate failure observed; additional final integrity error: ' + message };
    } else {
      verdict = 'policy-violation';
      termination = { kind: 'completed', processExitCode: 1, semanticVerdict: verdict, message };
    }
  };
  if (!sourceFinal) preserveCandidateFailure('source-snapshot', 'source root final snapshot failed: ' + sourceFinalError);
  else if (sourceFinal.treeSha256 !== sourceBefore.treeSha256) preserveCandidateFailure('source-drift', 'source root changed during task execution');
  const finalIntegrityIssues = integrityIssues({ absoluteTask, taskFileSha256, loadedGraders, externalBindings: integrityInputs });
  if (finalIntegrityIssues.length) preserveCandidateFailure('immutable-input-drift', 'immutable task inputs changed during task execution: ' + finalIntegrityIssues.join('; '));
  const report = buildRun({
    runVersion: '1.0', runId: null,
    task: {
      taskId: manifest.taskId,
      taskFileSha256,
      sourceRevision: manifest.source.revision,
      contractTreeSha256: manifest.source.treeSha256,
      runnerSnapshotBeforeSha256: 'sha256:' + sourceBefore.treeSha256,
      runnerSnapshotFinalSha256: sourceFinal ? 'sha256:' + sourceFinal.treeSha256 : null,
      sourceUnchanged: Boolean(sourceFinal && sourceBefore.treeSha256 === sourceFinal.treeSha256),
      sourceFinalError,
      trialId,
    },
    agent: agentAudit,
    patch: patchAudit,
    grades,
    secondaryErrors,
    artifacts: artifactList,
    verdict,
    termination,
    capabilities: { sourceCopy: true, disposableWorkspace: true, completeSecuritySnapshots: true, postAgentSourceTreeCheck: true, postPatchTreePolicy: true, postGraderTreeCheck: true, verifiedGraderStaging: true, verifiedToolStaging: true, candidateExtractionWorker: true, osSandbox: false, filesystemIsolation: false, networkIsolation: false, processIsolation: false, maliciousAgentGraderSecrecy: false },
  });
  const runFile = path.join(outputRoot, 'task-run.json');
  writeAtomic(runFile, Buffer.from(JSON.stringify(report, null, 2) + '\n'));
    if (keepWorkspace) report.workspaceRoot = workspaceRoot;
    return { report, runFile, workspaceRoot: keepWorkspace ? workspaceRoot : null };
  } finally {
    if (!keepWorkspace) fs.rmSync(workspaceParent, { recursive: true, force: true });
  }
}

module.exports = { runTask, loadGraderSpec, writeAtomic };
