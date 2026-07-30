'use strict';
/*
 * extract-integration.test.js — real engine-level Data Pack integration
 *
 * This test intentionally uses a copied fixture in /tmp. The source fixture remains immutable,
 * while extract, validate, rules, types, and diff exercise the canonical toolchain end to end.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'sg-data-pack');
const FIXTURE = path.join(ROOT, 'tests', 'fixtures', 'integration', 'qinshihuang-0716-ts');

function run(args) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 1 << 24,
  });
  if (result.error) throw result.error;
  return result;
}

function copyFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-qinshihuang-integration-'));
  const libDir = path.join(dir, 'qinshihuang-0716-ts');
  try {
    fs.cpSync(FIXTURE, libDir, { recursive: true });
    return { dir, libDir, config: path.join(libDir, 'extract.config.js') };
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

function assertSuccessful(result, label) {
  assert.equal(result.status, 0, `${label} failed:\n${result.stdout}\n${result.stderr}`);
}

test('real Qinshihuang engine passes extract, strict validation, rules, types, and diff impact', () => {
  assert.equal(fs.existsSync(path.join(FIXTURE, 'lib', 'data', 'data.json')), false, 'source fixture must not contain generated data.json');
  assert.equal(fs.existsSync(path.join(FIXTURE, 'lib', 'data', 'data.js')), false, 'source fixture must not contain generated data.js');
  assert.equal(fs.existsSync(path.join(FIXTURE, 'lib', 'data', 'data.schema.json')), false, 'source fixture must not contain generated data.schema.json');

  const { dir, libDir, config } = copyFixture();
  try {
    const check = run(['extract', config, '--check']);
    assertSuccessful(check, 'extract --check');
    assert.match(check.stdout, /entities: 15, relations: 11, stages: 7, assets: 21/);
    assert.match(check.stdout, /all 1 deep comparisons passed; data is lossless/);
    assert.doesNotMatch(check.stdout + check.stderr, /\[warn\]/);

    const extract = run(['extract', config]);
    assertSuccessful(extract, 'extract');
    const dataPath = path.join(libDir, 'lib', 'data', 'data.json');
    const schemaPath = path.join(libDir, 'lib', 'data', 'data.schema.json');
    const dataJsPath = path.join(libDir, 'lib', 'data', 'data.js');
    assert.equal(fs.existsSync(dataPath), true);
    assert.equal(fs.existsSync(schemaPath), true);
    assert.equal(fs.existsSync(dataJsPath), true);

    const pack = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    assert.equal(Object.keys(pack.entities).length, 15);
    assert.equal(pack.relations.length, 11);
    assert.equal(pack.stages.length, 7);
    assert.equal(Object.keys(pack.assets).length, 21);
    const expectedAssets = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'lib', 'data', 'expected-assets.json'), 'utf8'));
    assert.deepEqual(pack.assets, expectedAssets, 'extract must preserve the committed asset baseline');
    assert.equal(pack.derivations.eventsNameLookupRebuild.source, 'entities.*.name');
    assert.equal(pack.derivations.heroRelDualRegistry, undefined, 'fixture must not claim an unimplemented heroRelTypes consumer');
    assert.match(schema.title, /^SG Data Pack v1\.3/);

    const validate = run(['validate', dataPath, '--strict', '--verify-hash']);
    assertSuccessful(validate, 'validate --strict --verify-hash');
    assert.match(validate.stdout, /Validation passed \(0 warning\(s\)\)/);

    const rules = run(['rules', libDir, '--strict']);
    assertSuccessful(rules, 'rules --strict');
    assert.match(rules.stdout, /hard-fail:\s*0/);
    assert.match(rules.stdout, /soft-fail:\s*0/);
    assert.match(rules.stdout, /exec-error:\s*0/);

    const typesPath = path.join(dir, 'qinshihuang.d.ts');
    const types = run(['types', dataPath, '--name', 'Qinshihuang', '--out', typesPath]);
    assertSuccessful(types, 'types');
    const dts = fs.readFileSync(typesPath, 'utf8');
    assert.match(dts, /QinshihuangPersonEntity/);
    assert.match(dts, /heroRelTypes\?:/);

    const candidatePath = path.join(dir, 'candidate.json');
    const candidate = JSON.parse(JSON.stringify(pack));
    candidate.entities.lisi.name = '李斯（更新）';
    fs.writeFileSync(candidatePath, JSON.stringify(candidate, null, 2) + '\n');
    const diff = run(['diff', dataPath, candidatePath, '--json']);
    assert.equal(diff.status, 1, 'diff status 1 means a business change was found');
    const report = JSON.parse(diff.stdout);
    const impact = report.derivationsImpacted.find((item) => item.name === 'eventsNameLookupRebuild');
    assert.ok(impact, 'entity name change must reach the real __fromPack lookup derivation');
    assert.deepEqual(impact.consumers, ['__fromPack']);

    const tamperedAsset = path.join(libDir, 'lib', 'assets', '李斯.png');
    fs.appendFileSync(tamperedAsset, Buffer.from([0]));
    const tamperedValidation = run(['validate', dataPath, '--strict', '--verify-hash']);
    assert.equal(tamperedValidation.status, 1, 'asset replacement must fail hash verification');
    assert.match(tamperedValidation.stderr, /hash mismatch/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  assert.equal(fs.existsSync(path.join(FIXTURE, 'lib', 'data', 'data.json')), false, 'extract must not write into source fixture');
  assert.equal(fs.existsSync(path.join(FIXTURE, 'lib', 'data', 'data.js')), false, 'extract must not write into source fixture');
  assert.equal(fs.existsSync(path.join(FIXTURE, 'lib', 'data', 'data.schema.json')), false, 'extract must not write into source fixture');
});
