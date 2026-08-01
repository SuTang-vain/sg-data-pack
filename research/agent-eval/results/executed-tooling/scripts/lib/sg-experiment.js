'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { runTask, writeAtomic } = require('./sg-task-runner.js');
const { readTaskManifest } = require('./agent-task-manifest.js');
const { contentId, stableJson, sha256Bytes, safeRelative, isDigest } = require('./sg-evidence-utils.js');

function wilson(successes, total, z = 1.959963984540054) {
  if (!Number.isInteger(successes) || !Number.isInteger(total) || total < 0 || successes < 0 || successes > total) throw new Error('invalid Wilson interval counts');
  if (total === 0) return { lower: null, upper: null };
  const p = successes / total;
  const denominator = 1 + z * z / total;
  const center = (p + z * z / (2 * total)) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * total)) / total) / denominator;
  return { lower: Math.max(0, center - margin), upper: Math.min(1, center + margin) };
}

function validateExperimentSpec(spec) {
  const errors = [];
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return { valid: false, errors: ['experiment spec must be an object'] };
  const allowed = new Set(['experimentVersion', 'experimentId', 'title', 'agent', 'tasks', 'repetitions', 'seed']);
  for (const key of Object.keys(spec)) if (!allowed.has(key)) errors.push(`unknown experiment field: ${key}`);
  if (spec.experimentVersion !== '1.0') errors.push('experimentVersion must be 1.0');
  if (typeof spec.title !== 'string' || !spec.title) errors.push('title is required');
  if (!spec.agent || typeof spec.agent !== 'object' || Array.isArray(spec.agent)) errors.push('agent must be an object');
  else {
    for (const key of Object.keys(spec.agent)) if (!['kind', 'provider', 'model', 'argv', 'adapter', 'infraExitCodes'].includes(key)) errors.push(`unknown agent field: ${key}`);
    if (!['scripted', 'ai'].includes(spec.agent.kind)) errors.push('agent.kind must be scripted or ai');
    for (const field of ['provider', 'model']) if (typeof spec.agent[field] !== 'string' || !spec.agent[field]) errors.push(`agent.${field} is required`);
    if (!Array.isArray(spec.agent.argv) || !spec.agent.argv.length || spec.agent.argv.some((item) => typeof item !== 'string' || item.includes('\0'))) errors.push('agent.argv must be a non-empty safe string array');
    else if (!spec.agent.argv.some((item) => item.includes('{adapter}'))) errors.push('agent.argv must invoke the content-bound {adapter}');
    if (!spec.agent.adapter || typeof spec.agent.adapter !== 'object' || Array.isArray(spec.agent.adapter)) errors.push('agent.adapter is required');
    else {
      for (const key of Object.keys(spec.agent.adapter)) if (!['path', 'sha256'].includes(key)) errors.push(`unknown agent.adapter field: ${key}`);
      try { safeRelative(spec.agent.adapter.path, 'agent.adapter.path'); } catch (error) { errors.push(error.message); }
      if (!isDigest(spec.agent.adapter.sha256)) errors.push('agent.adapter.sha256 must be sha256:<hex>');
    }
    if (spec.agent.infraExitCodes !== undefined && (!Array.isArray(spec.agent.infraExitCodes) || !spec.agent.infraExitCodes.length || spec.agent.infraExitCodes.some((item) => !Number.isInteger(item) || item < 1 || item > 255) || new Set(spec.agent.infraExitCodes).size !== spec.agent.infraExitCodes.length)) errors.push('agent.infraExitCodes must be a non-empty array of unique exit codes from 1 to 255');
  }
  if (!Array.isArray(spec.tasks) || !spec.tasks.length) errors.push('tasks must be a non-empty array');
  const ids = new Set();
  for (const [index, task] of (spec.tasks || []).entries()) {
    if (!task || typeof task !== 'object' || Array.isArray(task)) { errors.push(`tasks[${index}] must be an object`); continue; }
    for (const key of Object.keys(task)) if (!['id', 'manifest', 'taskId', 'manifestSha256'].includes(key)) errors.push(`tasks[${index}] unknown field: ${key}`);
    if (typeof task.id !== 'string' || !/^[a-z][a-z0-9-]{1,63}$/.test(task.id)) errors.push(`tasks[${index}].id must be a stable slug`);
    else if (ids.has(task.id)) errors.push(`duplicate task id: ${task.id}`); else ids.add(task.id);
    try { safeRelative(task.manifest, `tasks[${index}].manifest`); } catch (error) { errors.push(error.message); }
    if (!isDigest(task.taskId)) errors.push(`tasks[${index}].taskId must be sha256:<hex>`);
    if (!isDigest(task.manifestSha256)) errors.push(`tasks[${index}].manifestSha256 must be sha256:<hex>`);
  }
  if (!Number.isInteger(spec.repetitions) || spec.repetitions < 1 || spec.repetitions > 100) errors.push('repetitions must be 1..100');
  if (!['string', 'number'].includes(typeof spec.seed) || typeof spec.seed === 'number' && !Number.isSafeInteger(spec.seed)) errors.push('seed must be a string or safe integer');
  const material = { ...spec }; delete material.experimentId;
  const expectedId = contentId('experiment', material, []);
  if (spec.experimentId !== expectedId) errors.push(`experimentId mismatch (expected ${expectedId})`);
  return { valid: errors.length === 0, errors, expectedId };
}

function aggregate(trials, agentKind) {
  const valid = trials.filter((trial) => !['input-error', 'infra-error'].includes(trial.verdict));
  const passed = valid.filter((trial) => trial.verdict === 'passed').length;
  const durations = valid.map((trial) => trial.durationMs).sort((a, b) => a - b);
  const counts = Object.fromEntries([...new Set(trials.map((trial) => trial.verdict))].sort().map((key) => [key, trials.filter((trial) => trial.verdict === key).length]));
  const stage = (predicate) => ({ passed: valid.filter(predicate).length, total: valid.length });
  const evidenceStage = (field, requirementField) => {
    const required = valid.filter((trial) => trial[requirementField] > 0);
    return {
      passed: required.filter((trial) => trial[field].length === trial[requirementField] && trial[field].every((value) => value === 'passed')).length,
      total: required.length,
    };
  };
  const providerMetadata = trials.map((trial) => trial.providerMetadata).filter(Boolean);
  const actualModels = [...new Set(providerMetadata.flatMap((metadata) => Object.keys(metadata.modelUsage || {})))].sort();
  const usage = providerMetadata.reduce((sum, metadata) => ({
    inputTokens: sum.inputTokens + Number(metadata.usage && metadata.usage.input_tokens || 0),
    outputTokens: sum.outputTokens + Number(metadata.usage && metadata.usage.output_tokens || 0),
    cacheReadInputTokens: sum.cacheReadInputTokens + Number(metadata.usage && metadata.usage.cache_read_input_tokens || 0),
    totalCostUsd: sum.totalCostUsd + Number(metadata.totalCostUsd || 0),
  }), { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, totalCostUsd: 0 });
  const runtimeStage = evidenceStage('runtimeStatuses', 'runtimeRequired');
  const visualStage = evidenceStage('visualStatuses', 'visualRequired');
  return {
    totalTrials: trials.length,
    validTrials: valid.length,
    invalidTrials: trials.filter((trial) => trial.verdict === 'input-error').length,
    infraErrors: trials.filter((trial) => trial.verdict === 'infra-error').length,
    passed,
    passRate: valid.length ? passed / valid.length : null,
    confidence95: wilson(passed, valid.length),
    verdicts: counts,
    stages: {
      agentCompleted: stage((trial) => trial.agentExitCode === 0),
      patchApplied: stage((trial) => trial.patchStatus === 'applied'),
      policyCompliant: stage((trial) => trial.patchStatus === 'applied' && trial.verdict !== 'policy-violation'),
      graderPassed: stage((trial) => trial.gradeVerdicts.length > 0 && trial.gradeVerdicts.every((value) => value === 'passed')),
      runtimePassed: runtimeStage,
      visualPassed: visualStage,
    },
    provider: { actualModels, usage },
    durationMs: {
      mean: durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : null,
      median: durations.length ? durations.length % 2 ? durations[Math.floor(durations.length / 2)] : (durations[durations.length / 2 - 1] + durations[durations.length / 2]) / 2 : null,
    },
    claimLevel: agentKind === 'scripted'
      ? 'harness-only'
      : passed === 0
        ? 'ai-task-contract-not-demonstrated'
        : runtimeStage.total > 0 && runtimeStage.passed === runtimeStage.total && visualStage.total > 0 && visualStage.passed === visualStage.total
          ? 'ai-task-contract-with-runtime-visual-subset'
          : 'ai-static-contract-only',
  };
}

function renderExperiment(report) {
  const p = report.summary.passRate === null ? 'N/A' : `${(report.summary.passRate * 100).toFixed(1)}%`;
  return `# Agent success-rate experiment\n\n- Experiment: \`${report.experimentId}\`\n- Agent: ${report.agent.provider || 'unknown'} / ${report.agent.model || 'unknown'} (${report.agent.kind})\n- Trials: ${report.summary.totalTrials}; valid ${report.summary.validTrials}; infra ${report.summary.infraErrors}\n- Pass rate: **${p}** (Wilson 95% ${report.summary.confidence95.lower === null ? 'N/A' : `${(report.summary.confidence95.lower * 100).toFixed(1)}%–${(report.summary.confidence95.upper * 100).toFixed(1)}%`})\n- Claim level: **${report.summary.claimLevel}**\n- Actual model(s): ${report.summary.provider.actualModels.join(', ') || 'not reported'}\n- Tokens: input ${report.summary.provider.usage.inputTokens}; output ${report.summary.provider.usage.outputTokens}; cache read ${report.summary.provider.usage.cacheReadInputTokens}\n- Recorded provider cost: $${report.summary.provider.usage.totalCostUsd.toFixed(6)}\n\n## Failure taxonomy\n\n${Object.entries(report.summary.verdicts).map(([key, value]) => `- ${key}: ${value}`).join('\n') || '- none'}\n\n## Trials\n\n${report.trials.map((trial) => `- ${trial.trialId}: ${trial.verdict}; patch=${trial.patchStatus || 'none'}; grades=${trial.gradeVerdicts.join(',') || 'none'}`).join('\n')}\n`;
}

function runExperiment({ specFile, outputRoot } = {}) {
  const absoluteSpec = path.resolve(specFile);
  const specBytes = fs.readFileSync(absoluteSpec);
  const specSha256 = sha256Bytes(specBytes);
  const spec = JSON.parse(specBytes);
  const validation = validateExperimentSpec(spec);
  if (!validation.valid) throw new Error('invalid ExperimentSpec: ' + validation.errors.join('; '));
  const base = path.dirname(absoluteSpec);
  const adapterFile = path.resolve(base, safeRelative(spec.agent.adapter.path, 'agent.adapter.path'));
  const adapterRelative = path.relative(base, adapterFile);
  if (adapterRelative === '..' || adapterRelative.startsWith(`..${path.sep}`) || path.isAbsolute(adapterRelative)) throw new Error('agent adapter escapes experiment directory');
  let adapterBytes;
  try {
    const stat = fs.lstatSync(adapterFile);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('must be a regular non-symlink file');
    adapterBytes = fs.readFileSync(adapterFile);
  } catch (error) { throw new Error('agent adapter cannot be verified: ' + error.message); }
  const actualAdapterSha256 = sha256Bytes(adapterBytes);
  if (actualAdapterSha256 !== spec.agent.adapter.sha256) throw new Error(`agent adapter digest mismatch: expected ${spec.agent.adapter.sha256}, received ${actualAdapterSha256}`);
  const root = path.resolve(outputRoot);
  if (fs.existsSync(root) && fs.readdirSync(root).length) throw new Error('experiment output root must be empty');
  fs.mkdirSync(root, { recursive: true });
  const agentArgv = spec.agent.argv.map((argument) => argument.split('{experimentDir}').join(base).split('{adapter}').join(adapterFile).split('{node}').join(process.execPath));
  const taskDefinitions = spec.tasks.map((task) => {
    const manifestFile = path.resolve(base, task.manifest);
    try {
      const manifestBytes = fs.readFileSync(manifestFile);
      const manifest = readTaskManifest(manifestFile);
      const inputErrors = [];
      const manifestSha256 = sha256Bytes(manifestBytes);
      if (task.taskId !== manifest.taskId) inputErrors.push(`taskId mismatch: expected ${task.taskId}, received ${manifest.taskId}`);
      if (task.manifestSha256 !== manifestSha256) inputErrors.push(`manifest digest mismatch: expected ${task.manifestSha256}, received ${manifestSha256}`);
      return {
        ...task,
        manifestFile,
        runtimeRequired: manifest.evidence.runtime.length,
        visualRequired: manifest.evidence.visual.length,
        inputError: inputErrors.length ? inputErrors.join('; ') : null,
      };
    } catch (error) {
      return { ...task, manifestFile, runtimeRequired: 0, visualRequired: 0, inputError: error.message };
    }
  });
  const trials = [];
  for (const task of taskDefinitions) {
    for (let repetition = 1; repetition <= spec.repetitions; repetition += 1) {
      const trialId = `${task.id}-r${String(repetition).padStart(2, '0')}`;
      const trialRoot = path.join(root, 'trials', trialId);
      const started = process.hrtime.bigint();
      try {
        if (task.inputError) {
          const error = new Error(task.inputError);
          error.kind = 'input-error';
          throw error;
        }
        const currentSpecSha256 = sha256Bytes(fs.readFileSync(absoluteSpec));
        const currentAdapterSha256 = sha256Bytes(fs.readFileSync(adapterFile));
        const currentManifestBytes = fs.readFileSync(task.manifestFile);
        let currentManifest;
        try { currentManifest = JSON.parse(currentManifestBytes); }
        catch (parseError) { currentManifest = null; }
        const perTrialInputErrors = [];
        if (currentSpecSha256 !== specSha256) perTrialInputErrors.push(`experiment spec digest mismatch: expected ${specSha256}, received ${currentSpecSha256}`);
        if (currentAdapterSha256 !== spec.agent.adapter.sha256) perTrialInputErrors.push(`agent adapter digest mismatch: expected ${spec.agent.adapter.sha256}, received ${currentAdapterSha256}`);
        const currentManifestSha256 = sha256Bytes(currentManifestBytes);
        if (currentManifestSha256 !== task.manifestSha256) perTrialInputErrors.push(`task manifest digest mismatch: expected ${task.manifestSha256}, received ${currentManifestSha256}`);
        if (!currentManifest || currentManifest.taskId !== task.taskId) perTrialInputErrors.push(`taskId mismatch: expected ${task.taskId}, received ${currentManifest && currentManifest.taskId}`);
        if (perTrialInputErrors.length) {
          const error = new Error(perTrialInputErrors.join('; '));
          error.kind = 'input-error';
          throw error;
        }
        const result = runTask({
          taskFile: task.manifestFile,
          agentArgv,
          artifactRoot: trialRoot,
          agent: { provider: spec.agent.provider, model: spec.agent.model, infraExitCodes: spec.agent.infraExitCodes || [] },
          trialId,
          integrityInputs: [
            { id: 'experiment-spec', file: absoluteSpec, sha256: specSha256 },
            { id: 'agent-adapter', file: adapterFile, sha256: spec.agent.adapter.sha256 },
          ],
        });
        const report = result.report;
        const results = report.grades.flatMap((grade) => grade.results);
        trials.push({
          trialId, taskSlug: task.id, taskId: task.taskId, runId: report.runId, verdict: report.verdict,
          agentExitCode: report.agent.exitCode, patchStatus: report.patch && report.patch.status,
          gradeVerdicts: report.grades.map((grade) => grade.verdict),
          runtimeRequired: task.runtimeRequired,
          visualRequired: task.visualRequired,
          runtimeStatuses: results.filter((item) => item.type === 'runtime-evidence').map((item) => item.status),
          visualStatuses: results.filter((item) => item.type === 'visual-evidence').map((item) => item.status),
          providerMetadata: report.agent.providerMetadata || null,
          durationMs: Number(process.hrtime.bigint() - started) / 1e6,
          artifactPath: path.relative(root, result.runFile).split(path.sep).join('/'),
        });
      } catch (error) {
        trials.push({ trialId, taskSlug: task.id, taskId: task.taskId, runId: null, verdict: error.kind === 'input-error' ? 'input-error' : 'infra-error', agentExitCode: null, patchStatus: null, gradeVerdicts: [], runtimeRequired: task.runtimeRequired, visualRequired: task.visualRequired, runtimeStatuses: [], visualStatuses: [], providerMetadata: null, durationMs: Number(process.hrtime.bigint() - started) / 1e6, error: error.message, artifactPath: null });
      }
    }
  }
  const report = {
    reportVersion: '1.0', resultId: null, experimentId: spec.experimentId,
    specSha256, seed: spec.seed,
    agent: { kind: spec.agent.kind, provider: spec.agent.provider, model: spec.agent.model },
    taskSetSha256: sha256Bytes(stableJson(spec.tasks)), repetitions: spec.repetitions,
    summary: aggregate(trials, spec.agent.kind), trials,
  };
  report.resultId = contentId('experiment-result', report, ['resultId']);
  writeAtomic(path.join(root, 'experiment.json'), Buffer.from(JSON.stringify(report, null, 2) + '\n'));
  writeAtomic(path.join(root, 'EXPERIMENT.md'), Buffer.from(renderExperiment(report)));
  return report;
}

module.exports = { wilson, validateExperimentSpec, aggregate, renderExperiment, runExperiment };
