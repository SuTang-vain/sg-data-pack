#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../..');
const { contentId, sha256Bytes } = require(path.join(ROOT, 'scripts/lib/sg-evidence-utils.js'));
const { renderExperiment } = require(path.join(ROOT, 'scripts/lib/sg-experiment.js'));

const directory = path.resolve(process.argv[2] || '');
if (!process.argv[2] || !fs.existsSync(path.join(directory, 'experiment.json'))) {
  console.error('Usage: relocate-results <experiment-result-directory>');
  process.exit(2);
}
const reportFile = path.join(directory, 'experiment.json');
const rawFile = path.join(directory, 'experiment.raw.json');
const rawMarkdown = path.join(directory, 'EXPERIMENT.raw.md');
const auditFile = path.join(directory, 'relocation-audit.json');
if (fs.existsSync(rawFile) || fs.existsSync(rawMarkdown) || fs.existsSync(auditFile)) {
  console.error('Relocation outputs already exist; refusing to overwrite: ' + directory);
  process.exit(2);
}
const rawBytes = fs.readFileSync(reportFile);
const rawReport = JSON.parse(rawBytes);
if (rawReport.resultId !== contentId('experiment-result', rawReport, ['resultId'])) throw new Error('raw ExperimentReport resultId is invalid');
const relocated = JSON.parse(rawBytes);
const transformations = [];
for (const trial of relocated.trials) {
  if (!trial.runId) continue;
  const expected = `trials/${trial.trialId}/task-run.json`;
  const runFile = path.join(directory, expected);
  if (!fs.existsSync(runFile)) throw new Error(`missing TaskRun for ${trial.trialId}: ${runFile}`);
  const run = JSON.parse(fs.readFileSync(runFile, 'utf8'));
  if (run.runId !== trial.runId) throw new Error(`TaskRun id mismatch for ${trial.trialId}`);
  if (trial.artifactPath !== expected) transformations.push({ trialId: trial.trialId, from: trial.artifactPath, to: expected });
  trial.artifactPath = expected;
}
if (!transformations.length) throw new Error('ExperimentReport is already self-contained; no relocation needed');
relocated.resultId = contentId('experiment-result', relocated, ['resultId']);
const relocatedBytes = Buffer.from(JSON.stringify(relocated, null, 2) + '\n');
const audit = {
  auditVersion: '1.0', auditId: null, kind: 'experiment-relocation',
  reason: 'Canonicalize trial TaskRun references after copying an experiment produced through a symlinked output-root spelling.',
  experimentId: relocated.experimentId,
  raw: { resultId: rawReport.resultId, sha256: sha256Bytes(rawBytes), file: 'experiment.raw.json' },
  relocated: { resultId: relocated.resultId, sha256: sha256Bytes(relocatedBytes), file: 'experiment.json' },
  transformations,
  semanticFieldsUnchanged: ['experimentId', 'specSha256', 'taskSetSha256', 'agent', 'seed', 'repetitions', 'summary', 'trial verdicts', 'runIds'],
};
audit.auditId = contentId('relocation-audit', audit, ['auditId']);
fs.renameSync(reportFile, rawFile);
const markdownFile = path.join(directory, 'EXPERIMENT.md');
if (fs.existsSync(markdownFile)) fs.renameSync(markdownFile, rawMarkdown);
fs.writeFileSync(reportFile, relocatedBytes);
fs.writeFileSync(markdownFile, renderExperiment(relocated));
fs.writeFileSync(auditFile, JSON.stringify(audit, null, 2) + '\n');
console.log(`Relocated ${transformations.length} TaskRun references: ${relocated.resultId}`);
