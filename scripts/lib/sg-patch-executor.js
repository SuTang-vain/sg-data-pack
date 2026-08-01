'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runCommand } = require('./sg-command-runner.js');
const { safeRelativePath, matchesGlob, assertNoSymlinkComponents } = require('./sg-path-policy.js');
const { snapshotTree, diffTrees } = require('./sg-tree-snapshot.js');
const { sha256Bytes, contentId } = require('./sg-evidence-utils.js');

class PatchError extends Error {
  constructor(message, kind = 'patch-invalid', details = null) {
    super(message);
    this.name = 'PatchError';
    this.kind = kind;
    this.details = details;
  }
}

function stripPatchPrefix(value) {
  if (value === '/dev/null') return null;
  const withoutTimestamp = value.split('\t')[0].trim();
  return withoutTimestamp.replace(/^[ab]\//, '');
}

function gitFileMode(statMode) {
  return '100' + (statMode & 0o777).toString(8).padStart(3, '0');
}

function parseModeHeaders(lines, from, to) {
  const modes = {};
  for (let index = from; index < to; index += 1) {
    const match = /^(new file mode|deleted file mode) ([0-7]{6})$/.exec(lines[index]);
    if (!match) continue;
    const field = match[1] === 'new file mode' ? 'newFileMode' : 'deletedFileMode';
    if (modes[field]) throw new PatchError(`duplicate ${match[1]} header at line ${index + 1}`);
    modes[field] = match[2];
  }
  if (modes.newFileMode && modes.newFileMode !== '100644') throw new PatchError(`new file mode ${modes.newFileMode} is not supported`, 'policy-not-supported');
  return modes;
}

function parseUnifiedDiff(bytes) {
  const text = Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes);
  if (text.includes('\0')) throw new PatchError('patch contains a NUL byte');
  if (/^(GIT binary patch|Binary files .* differ)$/m.test(text)) throw new PatchError('binary patches are not supported', 'policy-not-supported');
  if (/^(rename from|rename to|old mode|new mode|new file mode 160000|deleted file mode 160000)/m.test(text)) throw new PatchError('renames, mode changes, and submodules are not supported', 'policy-not-supported');
  if (!text.startsWith('diff --git ')) throw new PatchError('patch must begin with a diff --git header');
  const lines = text.split(/\r?\n/);
  const operations = [];
  let pendingGit = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith('diff --git ')) {
      const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      if (!match) throw new PatchError(`unsupported diff header at line ${index + 1}`);
      pendingGit = { oldPath: match[1], newPath: match[2], line: index + 1 };
      continue;
    }
    if (!line.startsWith('--- ')) continue;
    if (index + 1 >= lines.length || !lines[index + 1].startsWith('+++ ')) throw new PatchError(`missing +++ header after line ${index + 1}`);
    if (!pendingGit) throw new PatchError(`file header is missing its diff --git header at line ${index + 1}`);
    const modes = parseModeHeaders(lines, pendingGit.line, index);
    const oldPath = stripPatchPrefix(line.slice(4));
    const newPath = stripPatchPrefix(lines[index + 1].slice(4));
    if (!oldPath && !newPath) throw new PatchError(`invalid /dev/null pair at line ${index + 1}`);
    if (oldPath && newPath && oldPath !== newPath) throw new PatchError('renames are not supported', 'policy-not-supported', { oldPath, newPath });
    const target = safeRelativePath(newPath || oldPath);
    if (pendingGit) {
      if (safeRelativePath(pendingGit.oldPath) !== (oldPath || target) || safeRelativePath(pendingGit.newPath) !== (newPath || target)) {
        throw new PatchError(`diff --git and file headers disagree near line ${index + 1}`);
      }
    }
    const operation = oldPath === null ? 'add' : newPath === null ? 'delete' : 'modify';
    if (operation === 'add' && modes.deletedFileMode) throw new PatchError(`add entry has a deleted file mode header: ${target}`);
    if (operation === 'delete' && modes.newFileMode) throw new PatchError(`delete entry has a new file mode header: ${target}`);
    if (operation === 'modify' && (modes.newFileMode || modes.deletedFileMode)) throw new PatchError(`modify entry must not contain add/delete mode headers: ${target}`);
    let hunks = 0;
    let cursor = index + 2;
    while (cursor < lines.length && !lines[cursor].startsWith('diff --git ') && !lines[cursor].startsWith('--- ')) {
      if (lines[cursor].startsWith('@@ ')) hunks += 1;
      cursor += 1;
    }
    if (hunks === 0) throw new PatchError(`patch entry has no hunks: ${target}`);
    operations.push({ operation, path: target, oldPath, newPath, hunks, modes, headerLine: index + 1 });
    pendingGit = null;
  }
  if (!operations.length) throw new PatchError('patch contains no unified diff file entries');
  const seen = new Set();
  for (const operation of operations) {
    if (seen.has(operation.path)) throw new PatchError(`patch contains duplicate file entries: ${operation.path}`);
    seen.add(operation.path);
  }
  return { text, operations };
}

function policyForPath(filePolicy, operation, relativePath) {
  const forbidden = (filePolicy.forbidden || []).find((pattern) => matchesGlob(relativePath, pattern));
  if (forbidden) return { allowed: false, reason: `forbidden by ${forbidden}`, deniedBy: forbidden, allowedBy: null };
  const allowed = (filePolicy.allowed || []).find((entry) => entry.operations.includes(operation) && matchesGlob(relativePath, entry.pattern));
  if (!allowed) return { allowed: false, reason: `no allowed ${operation} rule matches ${relativePath}`, deniedBy: null, allowedBy: null };
  return { allowed: true, reason: null, deniedBy: null, allowedBy: allowed.pattern };
}

function validatePatchPolicy(parsed, patchBytes, manifest, workspaceRoot) {
  const violations = [];
  if (patchBytes.length > manifest.filePolicy.maxPatchBytes) violations.push(`patch bytes ${patchBytes.length} exceed maxPatchBytes ${manifest.filePolicy.maxPatchBytes}`);
  if (parsed.operations.length > manifest.filePolicy.maxChangedFiles) violations.push(`patch changes ${parsed.operations.length} files; maxChangedFiles is ${manifest.filePolicy.maxChangedFiles}`);
  for (const operation of parsed.operations) {
    const policy = policyForPath(manifest.filePolicy, operation.operation, operation.path);
    if (operation.operation === 'add' && operation.modes.newFileMode !== '100644') violations.push(`add ${operation.path} must declare new file mode 100644`);
    if (operation.operation === 'delete' && !operation.modes.deletedFileMode) violations.push(`delete ${operation.path} must declare its deleted file mode`);
    operation.policy = policy;
    if (!policy.allowed) violations.push(`${operation.operation} ${operation.path}: ${policy.reason}`);
    const target = path.resolve(workspaceRoot, operation.path);
    try { assertNoSymlinkComponents(target, { root: workspaceRoot }); }
    catch (error) { violations.push(`${operation.path}: ${error.message}`); }
    if (operation.operation === 'add' && fs.existsSync(target)) violations.push(`add target already exists: ${operation.path}`);
    if (operation.operation !== 'add' && !fs.existsSync(target)) violations.push(`${operation.operation} target does not exist: ${operation.path}`);
    if (fs.existsSync(target)) {
      const stat = fs.lstatSync(target);
      if (!stat.isFile() || stat.isSymbolicLink()) violations.push(`patch target must be a regular non-symlink file: ${operation.path}`);
      if (manifest.filePolicy.allowHardlinks === false && stat.nlink > 1) violations.push(`hardlinked patch target is forbidden: ${operation.path}`);
      if (operation.operation === 'delete' && operation.modes.deletedFileMode && gitFileMode(stat.mode) !== operation.modes.deletedFileMode) violations.push(`delete mode for ${operation.path} does not match baseline: expected ${gitFileMode(stat.mode)}, received ${operation.modes.deletedFileMode}`);
    }
  }
  return { allowed: violations.length === 0, violations, operations: parsed.operations };
}

function validateAppliedDiff(diff, manifest) {
  const violations = [];
  const operations = [];
  for (const change of diff.changes) {
    const structuralEntry = change.after || change.before;
    if (structuralEntry && structuralEntry.kind === 'directory' && ['add', 'delete'].includes(change.change)) continue;
    const operation = change.change;
    if (!['add', 'modify', 'delete'].includes(operation)) {
      violations.push(`${operation} is not supported for ${change.path}`);
      operations.push({ operation, path: change.path, allowed: false, reason: 'operation not supported' });
      continue;
    }
    const entry = operation === 'delete' ? change.before : change.after;
    if (entry && entry.kind !== 'file') violations.push(`${operation} produced non-regular entry: ${change.path}`);
    if (operation === 'add' && entry && entry.mode !== 0o644) violations.push(`add produced unsupported mode ${entry.mode.toString(8)}: ${change.path}`);
    if (operation === 'modify' && change.before && change.after && change.before.mode !== change.after.mode) violations.push(`modify changed file mode: ${change.path}`);
    const policy = policyForPath(manifest.filePolicy, operation, change.path);
    operations.push({ operation, path: change.path, allowed: policy.allowed, reason: policy.reason, before: change.before || null, after: change.after || null });
    if (!policy.allowed) violations.push(`${operation} ${change.path}: ${policy.reason}`);
  }
  if (operations.length > manifest.filePolicy.maxChangedFiles) violations.push(`actual tree changes ${operations.length} files; maxChangedFiles is ${manifest.filePolicy.maxChangedFiles}`);
  return { allowed: violations.length === 0, violations, operations };
}

function capturePatchTargets(root, operations) {
  const originals = new Map();
  for (const operation of operations) {
    const target = path.join(root, operation.path);
    if (!fs.existsSync(target)) originals.set(operation.path, { existed: false });
    else {
      const stat = fs.lstatSync(target);
      originals.set(operation.path, { existed: true, bytes: fs.readFileSync(target), mode: stat.mode & 0o7777 });
    }
  }
  return originals;
}

function restorePatchTargets(root, originals) {
  const errors = [];
  for (const [relative, original] of originals.entries()) {
    const target = path.join(root, relative);
    try {
      if (!original.existed) fs.rmSync(target, { recursive: true, force: true });
      else {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, original.bytes, { mode: original.mode });
        fs.chmodSync(target, original.mode);
      }
    } catch (error) { errors.push(`${relative}: ${error.message}`); }
  }
  if (errors.length) throw new Error('patch rollback incomplete: ' + errors.join('; '));
}

function applyPatch({ manifest, workspaceRoot, patchBytes, taskId = manifest && manifest.taskId, timeoutMs = 120000 } = {}) {
  if (!manifest || !manifest.filePolicy || !manifest.patchPolicy) throw new PatchError('validated task manifest is required', 'input-error');
  if (manifest.patchPolicy.format !== 'unified-diff' || manifest.patchPolicy.fuzz !== 0 || manifest.patchPolicy.allowBinary !== false) throw new PatchError('unsupported patch policy', 'policy-not-supported');
  const root = fs.realpathSync(path.resolve(workspaceRoot));
  const bytes = Buffer.isBuffer(patchBytes) ? patchBytes : Buffer.from(String(patchBytes || ''), 'utf8');
  const before = snapshotTree(root, { errorOnSpecialFile: true, exclude: false });
  let parsed;
  let preflight;
  try {
    parsed = parseUnifiedDiff(bytes);
    preflight = validatePatchPolicy(parsed, bytes, manifest, root);
    if (!preflight.allowed) throw new PatchError('patch violates file policy', 'policy-violation', preflight.violations);
  } catch (error) {
    const audit = buildAudit({ taskId, bytes, before, parsed, preflight, status: 'rejected', failure: error });
    error.audit = audit;
    throw error;
  }
  const originals = capturePatchTargets(root, parsed.operations);
  const patchFile = path.join(os.tmpdir(), `sg-agent-patch-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.diff`);
  fs.writeFileSync(patchFile, bytes, { mode: 0o600, flag: 'wx' });
  let checkRun;
  let applyRun;
  try {
    checkRun = runCommand({ argv: ['git', 'apply', '--check', '--whitespace=error-all', patchFile], cwd: root, allowedRoot: root, timeoutMs, maxOutputBytes: 1048576 });
    if (checkRun.error || checkRun.exitCode !== 0) throw new PatchError('git apply --check rejected the patch', 'patch-invalid', { checkRun });
    applyRun = runCommand({ argv: ['git', 'apply', '--whitespace=error-all', patchFile], cwd: root, allowedRoot: root, timeoutMs, maxOutputBytes: 1048576 });
    if (applyRun.error || applyRun.exitCode !== 0) throw new PatchError('git apply failed after a successful check', 'infra-error', { applyRun });
    const after = snapshotTree(root, { errorOnSpecialFile: true, exclude: false });
    const diff = diffTrees(before, after, { detectRenames: true });
    const postflight = validateAppliedDiff(diff, manifest);
    const declared = parsed.operations.map((item) => `${item.operation}:${item.path}`).sort();
    const actual = postflight.operations.map((item) => `${item.operation}:${item.path}`).sort();
    if (JSON.stringify(declared) !== JSON.stringify(actual)) postflight.violations.push(`declared patch operations do not match actual tree changes; declared=${declared.join(',')} actual=${actual.join(',')}`);
    postflight.allowed = postflight.violations.length === 0;
    if (!postflight.allowed) throw new PatchError('applied patch violates postflight file policy', 'policy-violation', postflight.violations);
    const audit = buildAudit({ taskId, bytes, before, after, parsed, preflight, postflight, checkRun, applyRun, status: 'applied' });
    return { audit, before, after, diff, parsed };
  } catch (error) {
    const current = snapshotTree(root, { errorOnSpecialFile: true, exclude: false });
    if (current.treeSha256 !== before.treeSha256) restorePatchTargets(root, originals);
    const restored = snapshotTree(root, { errorOnSpecialFile: true, exclude: false });
    if (restored.treeSha256 !== before.treeSha256) throw new PatchError('patch rollback did not restore the workspace tree', 'infra-error', { before: before.treeSha256, restored: restored.treeSha256 });
    const audit = buildAudit({ taskId, bytes, before, parsed, preflight, checkRun, applyRun, status: 'rejected', failure: error });
    error.audit = audit;
    throw error;
  } finally {
    try { fs.unlinkSync(patchFile); } catch (_) { /* already absent */ }
  }
}

function summarizeRun(run) {
  if (!run) return null;
  return { argv: run.argv, cwd: run.cwd, exitCode: run.exitCode, signal: run.signal, timedOut: run.timedOut, durationMs: run.durationMs, stdoutSha256: sha256Bytes(run.stdout || ''), stderrSha256: sha256Bytes(run.stderr || ''), error: run.error || null };
}

function buildAudit({ taskId, bytes, before, after = null, parsed = null, preflight = null, postflight = null, checkRun = null, applyRun = null, status, failure = null }) {
  const audit = {
    auditVersion: '1.0', auditId: null, kind: 'patch-audit', taskId,
    status, patchSha256: sha256Bytes(bytes), patchBytes: bytes.length,
    beforeTreeSha256: 'sha256:' + before.treeSha256,
    afterTreeSha256: after ? 'sha256:' + after.treeSha256 : null,
    declaredOperations: parsed ? parsed.operations.map((item) => ({ operation: item.operation, path: item.path, hunks: item.hunks, modes: item.modes, policy: item.policy || null })) : [],
    actualOperations: postflight ? postflight.operations : [],
    preflight: preflight ? { allowed: preflight.allowed, violations: preflight.violations } : null,
    postflight: postflight ? { allowed: postflight.allowed, violations: postflight.violations } : null,
    commands: { check: summarizeRun(checkRun), apply: summarizeRun(applyRun) },
    failure: failure ? { kind: failure.kind || 'infra-error', name: failure.name, message: failure.message, details: failure.details || null } : null,
    capabilities: { osSandbox: false, networkIsolation: false, processIsolation: false, sourceTreeVerifiedByRunner: true, disposableWorkspace: true },
  };
  audit.auditId = contentId('patch-audit', audit, ['auditId']);
  return audit;
}

module.exports = { PatchError, parseUnifiedDiff, policyForPath, validatePatchPolicy, validateAppliedDiff, applyPatch, buildAudit };
