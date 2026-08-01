'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { runCommand } = require('./sg-command-runner.js');
const { executeRules } = require('./sg-pack-rules-core.js');
const { readRuntimeEvidence } = require('./sg-runtime-evidence.js');
const { readVisualEvidence } = require('./sg-visual-evidence.js');
const { contentId, sha256Bytes, safeRelative } = require('./sg-evidence-utils.js');
require('./sg-data-loader.js');

const CHECK_TYPES = new Set(['data-pack-contract', 'library-rules', 'extract-equivalence', 'command', 'runtime-evidence', 'visual-evidence']);
const CHECK_FIELDS = new Set(['id', 'type', 'weight', 'required', 'path', 'scenarioId', 'rulesPath', 'dataPath', 'configPath', 'argv', 'cwd', 'expectedExit', 'infraExitCodes', 'timeoutMs', 'maxOutputBytes', 'strict', 'ruleIds']);

function isObject(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function resolveInRoot(root, value, label) {
  const relative = safeRelative(value, label);
  const file = path.resolve(root, relative);
  const fromRoot = path.relative(root, file);
  if (fromRoot === '..' || fromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(fromRoot)) throw new Error(`${label} escapes workspace`);
  return file;
}

function validateGraderSpec(spec) {
  const errors = [];
  if (!isObject(spec)) return { valid: false, errors: ['grader spec must be an object'] };
  for (const field of Object.keys(spec)) if (!['graderVersion', 'graderId', 'title', 'checks'].includes(field)) errors.push(`unknown grader field: ${field}`);
  if (spec.graderVersion !== '1.0') errors.push('graderVersion must be 1.0');
  if (typeof spec.graderId !== 'string' || !/^[a-z][a-z0-9-]{1,63}$/.test(spec.graderId)) errors.push('graderId must be a stable slug');
  if (!Array.isArray(spec.checks) || !spec.checks.length) errors.push('checks must be a non-empty array');
  const ids = new Set();
  for (const [index, check] of (spec.checks || []).entries()) {
    if (!isObject(check)) { errors.push(`checks[${index}] must be an object`); continue; }
    for (const field of Object.keys(check)) if (!CHECK_FIELDS.has(field)) errors.push(`checks[${index}] unknown field: ${field}`);
    if (typeof check.id !== 'string' || !/^[a-z][a-z0-9-]{1,63}$/.test(check.id)) errors.push(`checks[${index}].id must be a stable slug`);
    else if (ids.has(check.id)) errors.push(`duplicate check id: ${check.id}`); else ids.add(check.id);
    if (!CHECK_TYPES.has(check.type)) errors.push(`checks[${index}].type is unsupported`);
    if (typeof check.weight !== 'number' || !Number.isFinite(check.weight) || check.weight <= 0) errors.push(`checks[${index}].weight must be greater than 0`);
    if (typeof check.required !== 'boolean') errors.push(`checks[${index}].required must be boolean`);
    if (check.type === 'command' && (!Array.isArray(check.argv) || !check.argv.length || check.argv.some((item) => typeof item !== 'string'))) errors.push(`checks[${index}].argv must be a non-empty string array`);
    if (check.infraExitCodes !== undefined && (check.type !== 'command' || !Array.isArray(check.infraExitCodes) || !check.infraExitCodes.length || check.infraExitCodes.some((item) => !Number.isInteger(item) || item < 1 || item > 255) || new Set(check.infraExitCodes).size !== check.infraExitCodes.length)) errors.push(`checks[${index}].infraExitCodes must be a non-empty array of unique exit codes from 1 to 255 for a command check`);
    if (['runtime-evidence', 'visual-evidence'].includes(check.type) && (typeof check.scenarioId !== 'string' || !check.scenarioId)) errors.push(`checks[${index}].scenarioId is required for evidence checks`);
    if (check.scenarioId !== undefined && !['runtime-evidence', 'visual-evidence'].includes(check.type)) errors.push(`checks[${index}].scenarioId is only valid for evidence checks`);
    const requiredPaths = check.type === 'library-rules' ? ['rulesPath', 'dataPath'] : check.type === 'extract-equivalence' ? ['configPath'] : ['data-pack-contract', 'runtime-evidence', 'visual-evidence'].includes(check.type) ? ['path'] : [];
    for (const field of requiredPaths) {
      try { safeRelative(check[field], `checks[${index}].${field}`); } catch (error) { errors.push(error.message); }
    }
    if (check.cwd !== undefined) { try { safeRelative(check.cwd, `checks[${index}].cwd`); } catch (error) { errors.push(error.message); } }
  }
  return { valid: errors.length === 0, errors };
}

function baseResult(check) {
  return { id: check.id, type: check.type, required: check.required, weight: check.weight, status: 'infra-error', score: 0, findings: [], evidence: {} };
}

function gradePackContract(check, root) {
  const result = baseResult(check);
  try {
    const pack = readJson(resolveInRoot(root, check.path, `${check.id}.path`));
    const validation = globalThis.SGDataLoader.validate(pack);
    const failed = validation.errors.length > 0 || (check.strict && validation.warnings.length > 0);
    result.status = failed ? 'failed' : 'passed';
    result.score = failed ? 0 : check.weight;
    result.evidence = { errors: validation.errors, warnings: validation.warnings, strict: Boolean(check.strict) };
  } catch (error) {
    result.status = 'invalid';
    result.findings.push(error.message);
  }
  return result;
}

function gradeRules(check, root) {
  const result = baseResult(check);
  try {
    const rules = readJson(resolveInRoot(root, check.rulesPath, `${check.id}.rulesPath`));
    const pack = readJson(resolveInRoot(root, check.dataPath, `${check.id}.dataPath`));
    const execution = executeRules(rules, pack, { ruleIds: check.ruleIds });
    if (execution.structuralErrors.length || (execution.selectionErrors || []).length || (execution.unknownRuleIds || []).length) result.status = 'invalid';
    else if (!execution.results.length || execution.results.every((item) => item.status === 'no-check')) result.status = 'not-assessed';
    else {
      const failed = execution.counts.hardFail > 0 || execution.counts.errors > 0 || (check.strict && execution.counts.softFail > 0);
      result.status = failed ? 'failed' : 'passed';
    }
    result.score = result.status === 'passed' ? check.weight : 0;
    result.evidence = execution;
  } catch (error) {
    result.status = 'invalid';
    result.findings.push(error.message);
  }
  return result;
}

function gradeExtraction(check, root, options) {
  const result = baseResult(check);
  try {
    const configPath = resolveInRoot(root, check.configPath, `${check.id}.configPath`);
    const run = runCommand({
      argv: [process.execPath, path.join(options.toolRoot, 'scripts', 'lib', 'sg-extraction-worker.js'), configPath, root],
      cwd: root,
      allowedRoot: root,
      timeoutMs: check.timeoutMs || options.timeoutMs || 120000,
      maxOutputBytes: check.maxOutputBytes || options.maxOutputBytes || 1048576,
      env: options.env || {},
      envAllowlist: options.envAllowlist,
    });
    let supervisor = null;
    try { supervisor = JSON.parse(run.stdout.trim()); }
    catch (_) { supervisor = null; }
    const workerResult = supervisor && supervisor.protocolOk === true && supervisor.result && typeof supervisor.result === 'object'
      ? supervisor.result
      : null;
    result.evidence = {
      exitCode: run.exitCode, signal: run.signal, timedOut: run.timedOut, durationMs: run.durationMs,
      stdoutSha256: sha256Bytes(run.stdout), stderrSha256: sha256Bytes(run.stderr),
      stdout: run.stdout, stderr: run.stderr, stdoutTruncated: run.stdoutTruncated, stderrTruncated: run.stderrTruncated,
      error: run.error || null, supervisor, worker: workerResult,
    };
    if (run.error && !run.timedOut && run.exitCode === null) result.status = 'infra-error';
    else if (run.timedOut || !workerResult || workerResult.ok !== true) {
      result.status = workerResult && workerResult.kind === 'input' ? 'invalid' : 'failed';
      if (workerResult && workerResult.message) result.findings.push(workerResult.message);
      else result.findings.push(run.timedOut ? 'candidate extraction worker timed out' : 'candidate extraction worker did not return a valid result');
    } else {
      const failed = workerResult.validation.errors.length > 0 || workerResult.equivalence.diffs.length > 0 || !workerResult.equivalence.coverage.complete;
      result.status = failed ? 'failed' : 'passed';
      result.evidence.validation = workerResult.validation;
      result.evidence.equivalence = workerResult.equivalence;
      result.evidence.consumedFiles = workerResult.consumedFiles;
    }
    result.score = result.status === 'passed' ? check.weight : 0;
  } catch (error) {
    result.status = 'invalid';
    result.findings.push(error.message);
  }
  return result;
}

function commandArgv(argv, root, options) {
  const replacements = {
    '{node}': process.execPath,
    '{workspace}': root,
    '{artifacts}': options.artifactRoot || '',
    '{treeSha256}': options.treeSha256 || '',
    '{taskId}': options.taskId || '',
    '{grader}': options.graderRoot || '',
    '{toolRoot}': options.toolRoot || path.resolve(__dirname, '..', '..'),
  };
  return argv.map((argument) => Object.entries(replacements).reduce((value, [token, replacement]) => value.split(token).join(replacement), argument));
}

function gradeCommand(check, root, options) {
  const result = baseResult(check);
  try {
    const cwd = check.cwd ? resolveInRoot(root, check.cwd, `${check.id}.cwd`) : root;
    const run = runCommand({
      argv: commandArgv(check.argv, root, options),
      cwd,
      allowedRoot: root,
      timeoutMs: check.timeoutMs || options.timeoutMs || 120000,
      maxOutputBytes: check.maxOutputBytes || options.maxOutputBytes || 1048576,
      env: options.env || {},
      envAllowlist: options.envAllowlist,
    });
    const expectedExit = check.expectedExit === undefined ? 0 : check.expectedExit;
    const infraExitCodes = new Set(check.infraExitCodes || []);
    if (run.error && !run.timedOut && run.exitCode === null || infraExitCodes.has(run.exitCode)) result.status = 'infra-error';
    else result.status = run.exitCode === expectedExit && !run.timedOut ? 'passed' : 'failed';
    result.score = result.status === 'passed' ? check.weight : 0;
    result.evidence = {
      argv: run.argv, cwd: path.relative(root, run.cwd) || '.', exitCode: run.exitCode, signal: run.signal,
      timedOut: run.timedOut, durationMs: run.durationMs,
      stdoutSha256: sha256Bytes(run.stdout), stderrSha256: sha256Bytes(run.stderr),
      stdout: run.stdout, stderr: run.stderr,
      stdoutTruncated: run.stdoutTruncated, stderrTruncated: run.stderrTruncated, error: run.error || null,
    };
  } catch (error) {
    result.status = 'invalid';
    result.findings.push(error.message);
  }
  return result;
}

function gradeEvidence(check, root, kind, options) {
  const result = baseResult(check);
  try {
    const evidenceRoot = options.artifactRoot ? fs.realpathSync(path.resolve(options.artifactRoot)) : root;
    const file = resolveInRoot(evidenceRoot, check.path, `${check.id}.path`);
    const loaded = kind === 'runtime' ? readRuntimeEvidence(file) : readVisualEvidence(file);
    const expectedTree = options.treeSha256;
    const boundTree = kind === 'runtime' ? loaded.evidence.subjectTreeSha256 : loaded.evidence.candidateTreeSha256;
    if (expectedTree && boundTree !== expectedTree) {
      loaded.validation.errors.push(`evidence tree digest mismatch: expected ${expectedTree}, received ${boundTree}`);
      loaded.validation.valid = false;
      loaded.validation.status = 'not-assessed';
    }
    const scenarioMatched = kind === 'runtime'
      ? loaded.evidence.scenarioId === check.scenarioId
      : Array.isArray(loaded.evidence.scenarios) && loaded.evidence.scenarios.some((scenario) => scenario && scenario.id === check.scenarioId);
    if (!scenarioMatched) {
      loaded.validation.errors.push(`evidence does not contain required scenario: ${check.scenarioId}`);
      loaded.validation.valid = false;
      loaded.validation.status = 'not-assessed';
    }
    result.status = loaded.validation.valid ? loaded.validation.status : 'failed';
    result.score = result.status === 'passed' ? check.weight : 0;
    result.evidence = { scenarioId: check.scenarioId, file: path.relative(evidenceRoot, file), evidenceId: loaded.evidence.evidenceId, validation: loaded.validation };
  } catch (error) {
    result.status = error.code === 'ENOENT' ? 'not-assessed' : 'failed';
    result.findings.push(error.message);
  }
  return result;
}

function gradeWorkspace({ spec, workspaceRoot, graderRoot = null, artifactRoot = null, toolRoot = path.resolve(__dirname, '..', '..'), taskId = null, treeSha256 = null, timeoutMs, maxOutputBytes, env, envAllowlist } = {}) {
  const validation = validateGraderSpec(spec);
  if (!validation.valid) {
    const error = new Error('Invalid GraderSpec: ' + validation.errors.join('; '));
    error.code = 'INVALID_GRADER_SPEC';
    error.errors = validation.errors;
    throw error;
  }
  const root = fs.realpathSync(path.resolve(workspaceRoot));
  const options = { timeoutMs, maxOutputBytes, env, envAllowlist, graderRoot, artifactRoot, toolRoot, taskId, treeSha256 };
  const results = spec.checks.map((check) => {
    if (check.type === 'data-pack-contract') return gradePackContract(check, root);
    if (check.type === 'library-rules') return gradeRules(check, root);
    if (check.type === 'extract-equivalence') return gradeExtraction(check, root, options);
    if (check.type === 'command') return gradeCommand(check, root, options);
    if (check.type === 'runtime-evidence') return gradeEvidence(check, root, 'runtime', options);
    return gradeEvidence(check, root, 'visual', options);
  });
  const requiredIncomplete = results.some((item) => item.required && item.status !== 'passed');
  const infraError = results.some((item) => item.status === 'infra-error');
  const failed = results.some((item) => ['failed', 'invalid'].includes(item.status));
  const requiredNotAssessed = results.some((item) => item.required && item.status === 'not-assessed');
  const candidateFailure = failed || requiredNotAssessed;
  const score = results.reduce((sum, item) => sum + item.score, 0);
  const maximumScore = results.reduce((sum, item) => sum + item.weight, 0);
  const report = {
    gradeVersion: '1.0',
    gradeId: null,
    graderId: spec.graderId,
    taskId,
    treeSha256,
    verdict: candidateFailure ? 'failed' : infraError ? 'infra-error' : requiredIncomplete ? 'failed' : 'passed',
    score,
    maximumScore,
    results,
    summary: {
      total: results.length,
      passed: results.filter((item) => item.status === 'passed').length,
      failed: results.filter((item) => item.status === 'failed').length,
      notAssessed: results.filter((item) => item.status === 'not-assessed').length,
      invalid: results.filter((item) => item.status === 'invalid').length,
      infraErrors: results.filter((item) => item.status === 'infra-error').length,
      requiredIncomplete: results.filter((item) => item.required && item.status !== 'passed').length,
    },
  };
  report.gradeId = contentId('grade', report, ['gradeId']);
  return report;
}

module.exports = { validateGraderSpec, gradeWorkspace };
