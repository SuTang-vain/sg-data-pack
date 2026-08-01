'use strict';
/*
 * contract-consistency.test.js — structural contract parity checks
 *
 * Guards the v1.3 policy shared by the JSON Schema, runtime loader,
 * generated TypeScript declarations, docs, and CI.
 *
 * Run: node --test tests/*.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function readJson(rel) { return JSON.parse(read(rel)); }

require(path.join(ROOT, 'scripts', 'lib', 'sg-data-loader.js'));
const loader = globalThis.SGDataLoader;
const schema = readJson('scripts/lib/data-pack.schema.json');

function definition(ref) {
  return ref.split('/').slice(1).reduce((value, key) => value[key], schema);
}

test('schema and runtime support the same Data Pack versions', () => {
  assert.deepEqual(schema.properties.schemaVersion.enum, loader.SCHEMA_VERSIONS);
  assert.match(schema.title, /SG Data Pack v1\.3/);
  assert.match(read('references/data-pack-contract.md'), /Data Pack v1\.3 Contract/);
});

test('extract defaults generated packs to v1.3', () => {
  const src = read('scripts/sg-pack-extract.js');
  assert.match(src, /\|\|\s*'1\.3'/, "extract must default to '1.3'");
  assert.match(src, /SG Data Pack v1\.3/, 'generated library schema title must say v1.3');
});

test('entity display fields are enforced by runtime kindNameFields, not a hard-coded schema name', () => {
  const entitySchema = Object.values(schema.properties.entities.patternProperties)[0];
  assert.deepEqual(entitySchema.required, ['kind']);

  const collection = readJson('research/fixtures/v1.3/collection/data.json');
  const result = loader.validate(collection);
  assert.deepEqual(result.errors, []);
  assert.equal(collection.kindNameFields.work, 'title');
  assert.ok(Object.values(collection.entities).every((entity) => entity.kind === 'work' && entity.title && !entity.name));
});

test('v1.3 alias, relation, and stage-ref structures are declared in the schema', () => {
  const aliasValue = schema.properties.aliases.additionalProperties;
  const contextual = aliasValue.oneOf.find((entry) => entry.type === 'object');
  assert.deepEqual(contextual.required, ['id']);
  assert.ok(contextual.properties.context);

  const relation = schema.properties.relations.items;
  assert.ok(relation.properties.id);
  assert.ok(relation.properties.scope);

  const stageRef = schema.properties.stages.items.properties.relations.items;
  assert.ok(stageRef.properties.id);
  assert.ok(stageRef.properties.type);
});

test('relation registries require non-empty display labels', () => {
  for (const registry of ['relationTypes', 'heroRelTypes']) {
    const entry = schema.properties[registry].additionalProperties;
    assert.deepEqual(entry.required, ['label']);
    assert.equal(entry.properties.label.minLength, 1);
  }
});

test('provenance and asset fields remain optional at the formal contract layer', () => {
  assert.equal(definition(schema.properties.provenance.properties.entities.additionalProperties.$ref).required, undefined);
  assert.equal(schema.properties.assets.additionalProperties.required, undefined);
});

test('derivations declare both pack paths and presentation impacts', () => {
  const derivation = schema.properties.derivations.additionalProperties;
  assert.ok(derivation.properties.alsoTouches);
  assert.ok(derivation.properties.affects);
  assert.deepEqual(derivation.required, ['kind', 'source', 'consumers', 'note']);
});

test('README and SKILL define and use the same SK command variable', () => {
  for (const rel of ['README.md', 'SKILL.md']) {
    const src = read(rel);
    assert.match(src, /\bSK=/, `${rel} must define SK`);
    assert.doesNotMatch(src, /\bSKILL=.*scripts\/sg-data-pack/, `${rel} must not define the unused SKILL variable`);
    assert.match(src, /node "\$SK"/, `${rel} must quote and use $SK`);
  }
});

test('CI covers the documented Node 18 baseline and Node 22', () => {
  const workflow = read('.github/workflows/smoke.yml');
  assert.match(workflow, /node-version:\s*\[18, 22\]/);
  assert.match(workflow, /node --test tests\/\*\.test\.js/);
});

test('candidate review contract and CLI are documented consistently', () => {
  const cli = read('scripts/sg-data-pack');
  assert.match(cli, /candidate <baseline\.json>/);
  assert.match(read('README.md'), /candidate .*review-report/);
  assert.match(read('SKILL.md'), /candidate .*review-report/);
  assert.match(read('references/review-candidate-contract.md'), /decisionsVersion/);
  const provEntry = definition(schema.properties.provenance.properties.entities.additionalProperties.$ref);
  assert.ok(provEntry.properties.fieldOrigins, 'schema must expose fieldOrigins');
  const types = read('scripts/sg-pack-types.js');
  assert.match(types, /fieldOrigins\?: Record<string, SgProvenanceEntry>/);
});

test('RunReport contract and public CLI expose the unified report command', () => {
  const reportSchema = readJson('scripts/lib/run-report.schema.json');
  assert.equal(reportSchema.properties.reportVersion.const, '1.0');
  assert.deepEqual(reportSchema.properties.run.required, ['id', 'command', 'exitCode', 'libId', 'mode', 'outcome', 'maturity']);
  const cli = read('scripts/sg-data-pack');
  assert.match(cli, /case 'report'/);
  assert.match(cli, /report <libDir>/);
  assert.match(read('README.md'), /node "\$SK" report/);
  assert.match(read('SKILL.md'), /node "\$SK" report/);
  assert.match(read('references/run-report-contract.md'), /NOT_ASSESSED/);
});

test('Agent task, grader, evidence, TaskRun, and experiment contracts are exposed consistently', () => {
  const cli = read('scripts/sg-data-pack');
  for (const command of ['task', 'grade', 'evidence', 'experiment', 'compile']) assert.match(cli, new RegExp(`case '${command}'`));
  const taskSchema = readJson('scripts/lib/agent-task.schema.json');
  assert.equal(taskSchema.properties.taskVersion.const, '1.0');
  assert.deepEqual(taskSchema.$defs.grader.required, ['id', 'spec', 'sha256', 'treeSha256', 'weight']);
  assert.equal(readJson('scripts/lib/task-run.schema.json').properties.runVersion.const, '1.0');
  assert.equal(readJson('scripts/lib/experiment.schema.json').properties.experimentVersion.const, '1.0');
  for (const rel of ['README.md', 'SKILL.md']) {
    const source = read(rel);
    assert.match(source, /node "\$SK" task/);
    assert.match(source, /node "\$SK" experiment/);
    assert.match(source, /NOT_ASSESSED|not-assessed/);
  }
  for (const rel of [
    'references/agent-task-contract.md', 'references/patch-execution-contract.md',
    'references/grader-contract.md', 'references/task-run-contract.md',
    'references/runtime-visual-evidence-contract.md', 'references/agent-experiment-contract.md',
  ]) assert.ok(read(rel).length > 100, `${rel} must be substantive`);
});

test('CLI help aliases print usage and exit successfully', () => {
  const cli = path.join(ROOT, 'scripts', 'sg-data-pack');
  for (const flag of ['--help', '-h', 'help']) {
    const result = spawnSync(process.execPath, [cli, flag], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${flag} must exit successfully`);
    assert.match(result.stdout, /Usage:/);
    assert.match(result.stdout, /candidate/);
  }
});
