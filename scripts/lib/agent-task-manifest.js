'use strict';

/**
 * Read-only AgentTaskManifest v1 contract helpers.
 *
 * This module intentionally does not depend on the path-policy package. It is a
 * small, self-contained boundary for validating an already materialized task
 * description and (optionally) checking the files it names.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const TASK_VERSION = '1.0';
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const TOP_LEVEL_FIELDS = [
  'taskVersion', 'taskId', 'instructions', 'source', 'inputs',
  'filePolicy', 'patchPolicy', 'graders', 'evidence', 'execution',
];
const INSTRUCTION_FIELDS = ['text', 'sha256'];
const SOURCE_FIELDS = ['root', 'revision', 'treeSha256'];
const INPUT_FIELDS = ['id', 'path', 'role', 'sha256'];
const FILE_POLICY_FIELDS = [
  'allowed', 'forbidden', 'denyPrecedence', 'allowSymlinks',
  'allowHardlinks', 'maxChangedFiles', 'maxPatchBytes',
];
const ALLOWED_FIELDS = ['pattern', 'operations'];
const PATCH_POLICY_FIELDS = ['format', 'fuzz', 'allowBinary'];
const GRADER_FIELDS = ['id', 'spec', 'weight', 'sha256', 'treeSha256'];
const EVIDENCE_FIELDS = ['runtime', 'visual'];
const EXECUTION_FIELDS = ['timeoutMs', 'network', 'maxOutputBytes'];

// Bounds are deliberately finite so an otherwise valid JSON number cannot
// disable a runner's resource gate through an unbounded integer.
const RESOURCE_LIMITS = Object.freeze({
  timeoutMs: 24 * 60 * 60 * 1000,
  maxOutputBytes: 1024 * 1024 * 1024,
  maxChangedFiles: 1000000,
  maxPatchBytes: 1024 * 1024 * 1024,
});

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function ownKeys(value) {
  return isObject(value) ? Object.keys(value) : [];
}

function issue(issues, pathName, message) {
  issues.push({ path: pathName, message });
}

function checkExactKeys(value, allowed, pathName, issues) {
  if (!isObject(value)) return;
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) issue(issues, `${pathName}.${key}`, 'unknown field');
  }
}

function requireObject(value, pathName, issues) {
  if (!isObject(value)) {
    issue(issues, pathName, 'must be an object');
    return false;
  }
  return true;
}

function requireArray(value, pathName, issues) {
  if (!Array.isArray(value)) {
    issue(issues, pathName, 'must be an array');
    return false;
  }
  return true;
}

function requireString(value, pathName, issues, options = {}) {
  if (typeof value !== 'string' || (options.nonEmpty !== false && value.length === 0)) {
    issue(issues, pathName, options.message || (options.nonEmpty === false ? 'must be a string' : 'must be a non-empty string'));
    return false;
  }
  if (value.includes('\0')) issue(issues, pathName, 'must not contain NUL');
  return true;
}

function requireDigest(value, pathName, issues) {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) {
    issue(issues, pathName, 'must be a sha256:<64 lowercase hex> digest');
    return false;
  }
  return true;
}

/**
 * Canonical JSON sorts object keys recursively and preserves array order.
 * JSON.stringify supplies the stable compact UTF-8 material that is hashed.
 */
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isObject(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

function withoutTaskId(manifest) {
  if (!isObject(manifest)) return manifest;
  const material = { ...manifest };
  delete material.taskId;
  return material;
}

function computeTaskId(manifest) {
  if (!isObject(manifest)) throw new TypeError('manifest must be an object');
  return sha256(canonicalJson(withoutTaskId(manifest)));
}

function validateSafeRelativePath(value, pathName, issues, options = {}) {
  if (!requireString(value, pathName, issues)) return false;
  if (value.includes('\\')) issue(issues, pathName, 'must use POSIX separators and must not contain backslash');
  if (options.allowGlob !== true && /[*?{}\[\]]/.test(value)) issue(issues, pathName, 'must be a concrete path, not a glob pattern');
  if (path.posix.isAbsolute(value) || /^\/+/.test(value) || /^[A-Za-z]:/.test(value)) {
    issue(issues, pathName, 'must be a relative path');
  }
  const segments = value.split('/');
  if (segments.some((segment) => segment === '..')) issue(issues, pathName, 'must not contain .. path segments');
  if (segments.some((segment) => segment === '')) issue(issues, pathName, 'must not contain empty path segments');
  const dotSegments = segments.filter((segment) => segment === '.');
  if (dotSegments.length && !(options.allowDot === 'self' && value === '.')) {
    issue(issues, pathName, 'must not contain . path segments');
  }
  return true;
}

function checkDuplicateStrings(values, pathName, issues) {
  const seen = new Map();
  values.forEach((value, index) => {
    if (typeof value !== 'string') return;
    if (seen.has(value)) issue(issues, `${pathName}[${index}]`, `duplicate value; first occurrence is ${pathName}[${seen.get(value)}]`);
    else seen.set(value, index);
  });
}

function checkDuplicateIds(items, pathName, issues) {
  const seen = new Map();
  items.forEach((item, index) => {
    if (!isObject(item) || typeof item.id !== 'string') return;
    if (seen.has(item.id)) issue(issues, `${pathName}[${index}].id`, `duplicate id; first occurrence is ${pathName}[${seen.get(item.id)}].id`);
    else seen.set(item.id, index);
  });
}

function validateInstructions(value, issues) {
  if (!requireObject(value, 'instructions', issues)) return;
  checkExactKeys(value, INSTRUCTION_FIELDS, 'instructions', issues);
  requireString(value.text, 'instructions.text', issues);
  requireDigest(value.sha256, 'instructions.sha256', issues);
  if (typeof value.text === 'string' && typeof value.sha256 === 'string' && DIGEST_PATTERN.test(value.sha256)) {
    const expected = sha256(Buffer.from(value.text, 'utf8'));
    if (expected !== value.sha256) issue(issues, 'instructions.sha256', `digest does not match instructions.text (expected ${expected})`);
  }
}

function validateSource(value, issues) {
  if (!requireObject(value, 'source', issues)) return;
  checkExactKeys(value, SOURCE_FIELDS, 'source', issues);
  validateSafeRelativePath(value.root, 'source.root', issues, { allowDot: 'self' });
  requireString(value.revision, 'source.revision', issues);
  requireDigest(value.treeSha256, 'source.treeSha256', issues);
}

function validateInputs(value, issues) {
  if (!requireArray(value, 'inputs', issues)) return;
  checkDuplicateIds(value, 'inputs', issues);
  value.forEach((input, index) => {
    const base = `inputs[${index}]`;
    if (!requireObject(input, base, issues)) return;
    checkExactKeys(input, INPUT_FIELDS, base, issues);
    requireString(input.id, `${base}.id`, issues);
    validateSafeRelativePath(input.path, `${base}.path`, issues);
    requireString(input.role, `${base}.role`, issues);
    requireDigest(input.sha256, `${base}.sha256`, issues);
  });
}

function validateFilePolicy(value, issues) {
  if (!requireObject(value, 'filePolicy', issues)) return;
  checkExactKeys(value, FILE_POLICY_FIELDS, 'filePolicy', issues);
  if (!requireArray(value.allowed, 'filePolicy.allowed', issues)) return;
  if (!requireArray(value.forbidden, 'filePolicy.forbidden', issues)) return;
  if (value.denyPrecedence !== true) issue(issues, 'filePolicy.denyPrecedence', 'must be true');
  if (value.allowSymlinks !== false) issue(issues, 'filePolicy.allowSymlinks', 'must be false');
  if (value.allowHardlinks !== false) issue(issues, 'filePolicy.allowHardlinks', 'must be false');
  validateResourceInteger(value.maxChangedFiles, 'filePolicy.maxChangedFiles', RESOURCE_LIMITS.maxChangedFiles, issues);
  validateResourceInteger(value.maxPatchBytes, 'filePolicy.maxPatchBytes', RESOURCE_LIMITS.maxPatchBytes, issues);

  const patterns = [];
  value.allowed.forEach((rule, index) => {
    const base = `filePolicy.allowed[${index}]`;
    if (!requireObject(rule, base, issues)) return;
    checkExactKeys(rule, ALLOWED_FIELDS, base, issues);
    validateSafeRelativePath(rule.pattern, `${base}.pattern`, issues, { allowDot: true, allowGlob: true });
    if (!requireArray(rule.operations, `${base}.operations`, issues)) return;
    if (rule.operations.length === 0) issue(issues, `${base}.operations`, 'must contain at least one operation');
    checkDuplicateStrings(rule.operations, `${base}.operations`, issues);
    rule.operations.forEach((operation, operationIndex) => {
      if (!['add', 'modify', 'delete'].includes(operation)) issue(issues, `${base}.operations[${operationIndex}]`, 'must be add, modify, or delete');
    });
    if (typeof rule.pattern === 'string') patterns.push({ pattern: rule.pattern, index });
  });
  const seenPatterns = new Map();
  patterns.forEach(({ pattern, index }) => {
    if (seenPatterns.has(pattern)) issue(issues, `filePolicy.allowed[${index}].pattern`, `duplicate pattern; first occurrence is ${seenPatterns.get(pattern).path}`);
    else seenPatterns.set(pattern, { path: `filePolicy.allowed[${index}].pattern`, index });
  });
  checkDuplicateStrings(value.forbidden, 'filePolicy.forbidden', issues);
  value.forbidden.forEach((pattern, index) => {
    validateSafeRelativePath(pattern, `filePolicy.forbidden[${index}]`, issues, { allowDot: true, allowGlob: true });
    if (typeof pattern === 'string' && seenPatterns.has(pattern)) {
      issue(issues, `filePolicy.forbidden[${index}]`, `duplicate pattern; first occurrence is ${seenPatterns.get(pattern).path}`);
    } else if (typeof pattern === 'string') {
      seenPatterns.set(pattern, { path: `filePolicy.forbidden[${index}]`, index });
    }
  });
}

function validatePatchPolicy(value, issues) {
  if (!requireObject(value, 'patchPolicy', issues)) return;
  checkExactKeys(value, PATCH_POLICY_FIELDS, 'patchPolicy', issues);
  if (value.format !== 'unified-diff') issue(issues, 'patchPolicy.format', 'must be unified-diff');
  if (value.fuzz !== 0) issue(issues, 'patchPolicy.fuzz', 'must be 0');
  if (value.allowBinary !== false) issue(issues, 'patchPolicy.allowBinary', 'must be false');
}

function validateGraders(value, issues) {
  if (!requireArray(value, 'graders', issues)) return;
  checkDuplicateIds(value, 'graders', issues);
  value.forEach((grader, index) => {
    const base = `graders[${index}]`;
    if (!requireObject(grader, base, issues)) return;
    checkExactKeys(grader, GRADER_FIELDS, base, issues);
    requireString(grader.id, `${base}.id`, issues);
    if (!hasOwn(grader, 'spec') || grader.spec === undefined || grader.spec === null) issue(issues, `${base}.spec`, 'is required and must not be null');
    if (typeof grader.spec === 'string') validateSafeRelativePath(grader.spec, `${base}.spec`, issues);
    else issue(issues, `${base}.spec`, 'must be a relative path to a grader spec');
    requireDigest(grader.sha256, `${base}.sha256`, issues);
    requireDigest(grader.treeSha256, `${base}.treeSha256`, issues);
    if (typeof grader.weight !== 'number' || !Number.isFinite(grader.weight) || grader.weight <= 0) issue(issues, `${base}.weight`, 'must be a finite number greater than 0');
  });
}

function validateEvidence(value, issues) {
  if (!requireObject(value, 'evidence', issues)) return;
  checkExactKeys(value, EVIDENCE_FIELDS, 'evidence', issues);
  for (const kind of EVIDENCE_FIELDS) {
    if (!requireArray(value[kind], `evidence.${kind}`, issues)) continue;
    checkDuplicateStrings(value[kind], `evidence.${kind}`, issues);
    value[kind].forEach((scenarioId, index) => requireString(scenarioId, `evidence.${kind}[${index}]`, issues));
  }
}

function validateResourceInteger(value, pathName, maximum, issues) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    issue(issues, pathName, `must be an integer from 0 to ${maximum}`);
  }
}

function validateExecution(value, issues) {
  if (!requireObject(value, 'execution', issues)) return;
  checkExactKeys(value, EXECUTION_FIELDS, 'execution', issues);
  if (!Number.isSafeInteger(value.timeoutMs) || value.timeoutMs < 1 || value.timeoutMs > RESOURCE_LIMITS.timeoutMs) {
    issue(issues, 'execution.timeoutMs', `must be an integer from 1 to ${RESOURCE_LIMITS.timeoutMs}`);
  }
  if (value.network !== 'off') issue(issues, 'execution.network', 'must be off');
  if (!Number.isSafeInteger(value.maxOutputBytes) || value.maxOutputBytes < 1 || value.maxOutputBytes > RESOURCE_LIMITS.maxOutputBytes) {
    issue(issues, 'execution.maxOutputBytes', `must be an integer from 1 to ${RESOURCE_LIMITS.maxOutputBytes}`);
  }
}

function resolveTaskFile(taskFile) {
  if (typeof taskFile !== 'string' || taskFile.length === 0) return null;
  return path.resolve(taskFile);
}

function resolveSourceRoot(manifest, options = {}) {
  if (!isObject(manifest) || !isObject(manifest.source) || typeof manifest.source.root !== 'string') return null;
  const taskFile = resolveTaskFile(options.taskFile);
  if (taskFile) return path.resolve(path.dirname(taskFile), manifest.source.root);
  if (typeof options.sourceRoot === 'string' && options.sourceRoot.length > 0) return path.resolve(options.sourceRoot);
  return null;
}

function isWithinRoot(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function lstatPathParts(root, relativePath) {
  const parts = relativePath.split('/');
  const result = [];
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    result.push({ path: current, stat: fs.lstatSync(current) });
  }
  return result;
}

function verifyGraderFiles(manifest, taskFile, issues) {
  if (!taskFile) {
    issue(issues, '$options.taskFile', 'is required to verify grader files');
    return;
  }
  const taskDir = path.dirname(taskFile);
  const requiredEvidence = { runtime: new Set(), visual: new Set() };
  for (const [index, grader] of manifest.graders.entries()) {
    if (!isObject(grader) || typeof grader.spec !== 'string') continue;
    const specFile = path.resolve(taskDir, ...grader.spec.split('/'));
    if (!isWithinRoot(taskDir, specFile)) {
      issue(issues, `graders[${index}].spec`, 'resolves outside task directory');
      continue;
    }
    try {
      const stat = fs.lstatSync(specFile);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('must be a regular non-symlink file');
      if (stat.nlink > 1) throw new Error('hardlinks are not allowed');
      const bytes = fs.readFileSync(specFile);
      const actual = sha256(bytes);
      if (actual !== grader.sha256) issue(issues, `graders[${index}].sha256`, `digest is stale (actual ${actual})`);
      const actualTree = computeTreeSha256(path.dirname(specFile));
      if (actualTree !== grader.treeSha256) issue(issues, `graders[${index}].treeSha256`, `digest is stale (actual ${actualTree})`);
      const spec = JSON.parse(bytes.toString('utf8'));
      for (const check of Array.isArray(spec.checks) ? spec.checks : []) {
        const match = /^(runtime|visual)-evidence$/.exec(check && check.type);
        if (match && check.required === true && typeof check.scenarioId === 'string' && check.scenarioId) requiredEvidence[match[1]].add(check.scenarioId);
      }
    } catch (error) {
      issue(issues, `graders[${index}].spec`, `cannot verify grader: ${error.message}`);
    }
  }
  for (const kind of ['runtime', 'visual']) {
    const declared = new Set(manifest.evidence && Array.isArray(manifest.evidence[kind]) ? manifest.evidence[kind] : []);
    for (const scenarioId of declared) if (!requiredEvidence[kind].has(scenarioId)) issue(issues, `evidence.${kind}`, `declared scenario has no required grader check: ${scenarioId}`);
    for (const scenarioId of requiredEvidence[kind]) if (!declared.has(scenarioId)) issue(issues, `evidence.${kind}`, `required grader scenario is not declared: ${scenarioId}`);
  }
}

function verifyInputFiles(manifest, sourceRoot, issues) {
  if (!sourceRoot) {
    issue(issues, '$options.sourceRoot', 'is required when verifyFiles is true');
    return;
  }
  if (!Array.isArray(manifest.inputs)) return;
  if (!isObject(manifest.filePolicy)) return;
  let rootStat;
  try {
    rootStat = fs.lstatSync(sourceRoot);
  } catch (error) {
    issue(issues, 'source.root', `cannot read source root: ${error.message}`);
    return;
  }
  if (rootStat.isSymbolicLink() && manifest.filePolicy.allowSymlinks === false) {
    issue(issues, 'source.root', 'symlinks are not allowed');
    return;
  }
  if (!rootStat.isDirectory()) {
    issue(issues, 'source.root', 'must resolve to a directory');
    return;
  }
  for (const [index, input] of manifest.inputs.entries()) {
    if (!isObject(input) || typeof input.path !== 'string') continue;
    const inputPath = path.resolve(sourceRoot, ...input.path.split('/'));
    if (!isWithinRoot(sourceRoot, inputPath)) {
      issue(issues, `inputs[${index}].path`, 'resolves outside source root');
      continue;
    }
    let parts;
    try {
      parts = lstatPathParts(sourceRoot, input.path);
    } catch (error) {
      issue(issues, `inputs[${index}].path`, `cannot read input: ${error.message}`);
      continue;
    }
    const symlink = parts.find((part) => part.stat.isSymbolicLink());
    if (symlink && manifest.filePolicy.allowSymlinks === false) {
      issue(issues, `inputs[${index}].path`, 'symlinks are not allowed');
      continue;
    }
    const stat = parts[parts.length - 1].stat;
    if (!stat.isFile()) {
      issue(issues, `inputs[${index}].path`, 'must resolve to a regular file');
      continue;
    }
    if (manifest.filePolicy.allowHardlinks === false && stat.nlink > 1) {
      issue(issues, `inputs[${index}].path`, 'hardlinks are not allowed');
      continue;
    }
    let bytes;
    try {
      bytes = fs.readFileSync(inputPath);
    } catch (error) {
      issue(issues, `inputs[${index}].path`, `cannot read input: ${error.message}`);
      continue;
    }
    const actual = sha256(bytes);
    if (actual !== input.sha256) issue(issues, `inputs[${index}].sha256`, `digest is stale (actual ${actual})`);
  }
}

function collectTreeEntries(root, relative, manifest, entries, issues) {
  let directoryEntries;
  try {
    directoryEntries = fs.readdirSync(path.join(root, relative), { withFileTypes: true });
  } catch (error) {
    issue(issues, 'source.treeSha256', `cannot read source tree: ${error.message}`);
    return;
  }
  directoryEntries.sort((a, b) => Buffer.from(a.name).compare(Buffer.from(b.name)));
  for (const directoryEntry of directoryEntries) {
    const childRelative = relative ? `${relative}/${directoryEntry.name}` : directoryEntry.name;
    const childPath = path.join(root, childRelative);
    let stat;
    try {
      stat = fs.lstatSync(childPath);
    } catch (error) {
      issue(issues, 'source.treeSha256', `cannot stat ${childRelative}: ${error.message}`);
      continue;
    }
    if (stat.isSymbolicLink()) {
      if (manifest.filePolicy.allowSymlinks === false) issue(issues, `source.treeSha256`, `symlinks are not allowed: ${childRelative}`);
      else {
        let target;
        try { target = fs.readlinkSync(childPath); } catch (error) { target = `<unreadable:${error.message}>`; }
        entries.push({ path: childRelative, type: 'symlink', mode: stat.mode & 0o7777, target });
      }
      continue;
    }
    if (stat.isDirectory()) {
      entries.push({ path: childRelative, type: 'directory', mode: stat.mode & 0o7777 });
      collectTreeEntries(root, childRelative, manifest, entries, issues);
      continue;
    }
    if (stat.isFile()) {
      if (manifest.filePolicy.allowHardlinks === false && stat.nlink > 1) issue(issues, 'source.treeSha256', `hardlinks are not allowed: ${childRelative}`);
      try {
        entries.push({ path: childRelative, type: 'file', mode: stat.mode & 0o7777, sha256: sha256(fs.readFileSync(childPath)) });
      } catch (error) {
        issue(issues, 'source.treeSha256', `cannot read ${childRelative}: ${error.message}`);
      }
      continue;
    }
    issue(issues, 'source.treeSha256', `unsupported filesystem entry: ${childRelative}`);
  }
}

function computeTreeSha256(sourceRoot, options = {}) {
  const root = path.resolve(sourceRoot);
  let rootStat;
  try {
    rootStat = fs.lstatSync(root);
  } catch (error) {
    const readError = new Error(`cannot read source tree root: ${error.message}`);
    readError.code = 'TREE_DIGEST_ERROR';
    throw readError;
  }
  if (rootStat.isSymbolicLink() && options.allowSymlinks !== true) {
    const linkError = new Error(`source tree root is a symlink: ${root}`);
    linkError.code = 'TREE_DIGEST_ERROR';
    throw linkError;
  }
  if (!rootStat.isDirectory()) {
    const directoryError = new Error(`source tree root must be a directory: ${root}`);
    directoryError.code = 'TREE_DIGEST_ERROR';
    throw directoryError;
  }
  const entries = [];
  const manifest = { filePolicy: {
    allowSymlinks: options.allowSymlinks === true,
    allowHardlinks: options.allowHardlinks === true,
  } };
  const issues = [];
  collectTreeEntries(root, '', manifest, entries, issues);
  if (issues.length) {
    const error = new Error(`cannot compute source tree digest: ${issues.map((item) => item.message).join('; ')}`);
    error.code = 'TREE_DIGEST_ERROR';
    error.issues = issues;
    throw error;
  }
  return sha256(canonicalJson(entries));
}

function validateTaskManifest(manifest, options = {}) {
  const issues = [];
  if (!isObject(manifest)) return { valid: false, issues: [{ path: '$', message: 'manifest must be an object' }] };
  checkExactKeys(manifest, TOP_LEVEL_FIELDS, '$', issues);
  for (const field of TOP_LEVEL_FIELDS) {
    if (!hasOwn(manifest, field)) issue(issues, field, 'is required');
  }
  if (manifest.taskVersion !== TASK_VERSION) issue(issues, 'taskVersion', 'must be 1.0');
  requireDigest(manifest.taskId, 'taskId', issues);
  validateInstructions(manifest.instructions, issues);
  validateSource(manifest.source, issues);
  validateInputs(manifest.inputs, issues);
  validateFilePolicy(manifest.filePolicy, issues);
  validatePatchPolicy(manifest.patchPolicy, issues);
  validateGraders(manifest.graders, issues);
  validateEvidence(manifest.evidence, issues);
  validateExecution(manifest.execution, issues);

  let expectedTaskId;
  try {
    expectedTaskId = computeTaskId(manifest);
    if (typeof manifest.taskId === 'string' && DIGEST_PATTERN.test(manifest.taskId) && manifest.taskId !== expectedTaskId) {
      issue(issues, 'taskId', `does not match canonical manifest material (expected ${expectedTaskId})`);
    }
  } catch (error) {
    issue(issues, 'taskId', `cannot compute taskId: ${error.message}`);
  }

  const taskFile = resolveTaskFile(options.taskFile);
  const resolvedSourceRoot = resolveSourceRoot(manifest, options);
  if (options.sourceRoot !== undefined) {
    if (typeof options.sourceRoot !== 'string' || options.sourceRoot.length === 0) issue(issues, '$options.sourceRoot', 'must be a non-empty path');
    else if (resolvedSourceRoot && path.resolve(options.sourceRoot) !== resolvedSourceRoot) issue(issues, '$options.sourceRoot', `does not match source.root resolution (${resolvedSourceRoot})`);
  }
  if (options.verifyFiles === true) {
    verifyInputFiles(manifest, resolvedSourceRoot, issues);
    verifyGraderFiles(manifest, taskFile, issues);
  }
  if (options.verifyTree === true) {
    if (!resolvedSourceRoot) issue(issues, '$options.sourceRoot', 'or taskFile is required when verifyTree is true');
    else {
      try {
        const actual = computeTreeSha256(resolvedSourceRoot, {
          allowSymlinks: manifest.filePolicy && manifest.filePolicy.allowSymlinks === true,
          allowHardlinks: manifest.filePolicy && manifest.filePolicy.allowHardlinks === true,
        });
        if (actual !== manifest.source.treeSha256) issue(issues, 'source.treeSha256', `digest is stale (actual ${actual})`);
      } catch (error) {
        issue(issues, 'source.treeSha256', error.message);
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    taskId: manifest.taskId,
    expectedTaskId,
    taskFile,
    sourceRoot: resolvedSourceRoot,
  };
}

function invalidManifestError(result, file) {
  const error = new Error(`invalid AgentTaskManifest${file ? ` ${file}` : ''}: ${result.issues.map((item) => `${item.path}: ${item.message}`).join('; ')}`);
  error.code = 'INVALID_AGENT_TASK_MANIFEST';
  error.issues = result.issues;
  error.validation = result;
  return error;
}

function readTaskManifest(file, options = {}) {
  if (typeof file !== 'string' || file.length === 0) throw new TypeError('manifest file path is required');
  const taskFile = path.resolve(file);
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(taskFile, 'utf8'));
  } catch (error) {
    const readError = new Error(`cannot read AgentTaskManifest ${taskFile}: ${error.message}`);
    readError.code = 'AGENT_TASK_MANIFEST_READ_ERROR';
    readError.cause = error;
    throw readError;
  }
  const result = validateTaskManifest(manifest, { ...options, taskFile });
  if (!result.valid) throw invalidManifestError(result, taskFile);
  return manifest;
}

module.exports = {
  TASK_VERSION,
  DIGEST_PATTERN,
  TOP_LEVEL_FIELDS,
  RESOURCE_LIMITS,
  canonicalize,
  canonicalJson,
  stableJson: canonicalJson,
  sha256,
  computeTaskId,
  computeTreeSha256,
  resolveSourceRoot,
  validateTaskManifest,
  readTaskManifest,
};
