'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  runEquivalence,
  validateExtractionConfig,
  localAssetPath,
} = require('../scripts/lib/sg-pack-extract-core.js');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'sg-data-pack');
const FIXTURE = path.join(ROOT, 'tests', 'fixtures', 'integration', 'qinshihuang-0716-ts');

function config(overrides = {}) {
  return {
    libId: 'fixture',
    libDir: '/tmp/fixture',
    engineFile: 'lib/src/fixture.js',
    globalName: 'FixtureLibrary',
    literals: [{ key: 'items', pattern: /=/ }],
    buildPack() { return {}; },
    equivalence: [{ lit: 'items', from: 'items' }],
    ...overrides,
  };
}

function copyFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-extract-safety-'));
  const libDir = path.join(dir, 'library');
  fs.cpSync(FIXTURE, libDir, { recursive: true });
  return { dir, libDir, configPath: path.join(libDir, 'extract.config.js') };
}

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 24 });
}

test('extraction config requires complete and non-duplicated equivalence coverage', () => {
  assert.throws(() => validateExtractionConfig(config({ equivalence: [] })), /lack equivalence coverage/);
  assert.throws(() => validateExtractionConfig(config({ equivalence: [{ lit: 'missing', from: 'items' }] })), /unknown literal/);
  assert.throws(() => validateExtractionConfig(config({ equivalence: [
    { lit: 'items', from: 'items' },
    { lit: 'items', from: 'copy' },
  ] })), /duplicate equivalence coverage/);
  assert.doesNotThrow(() => validateExtractionConfig(config({
    equivalence: [],
    equivalenceIgnore: [{ lit: 'items', reason: 'Renderer-only value covered by VR-1' }],
  })));
});

test('equivalence rejects a missing restored property instead of passing undefined against undefined', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-equivalence-'));
  const engine = path.join(directory, 'engine.js');
  fs.writeFileSync(engine, 'globalThis.EquivalenceFixture = { __fromPack: function () { return {}; } };\n');
  try {
    assert.throws(() => runEquivalence({
      libDir: directory,
      engineFile: 'engine.js',
      globalName: 'EquivalenceFixture',
      literals: [{ key: 'items' }],
      equivalence: [{ lit: 'items', from: 'missing' }],
    }, { items: undefined }, {}), /did not return equivalence field/);
  } finally {
    delete globalThis.EquivalenceFixture;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('extract refuses divergent existing data unless force is explicit and compare-existing detects drift', () => {
  const fixture = copyFixture();
  try {
    const initial = run(['extract', fixture.configPath]);
    assert.equal(initial.status, 0, initial.stderr);
    const dataFile = path.join(fixture.libDir, 'lib', 'data', 'data.json');
    const pack = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    pack.entities.lisi.name = 'manual canonical edit';
    fs.writeFileSync(dataFile, JSON.stringify(pack, null, 2) + '\n');

    const check = run(['extract', fixture.configPath, '--check']);
    assert.equal(check.status, 0, check.stderr);
    assert.equal(JSON.parse(fs.readFileSync(dataFile, 'utf8')).entities.lisi.name, 'manual canonical edit');

    const drift = run(['extract', fixture.configPath, '--compare-existing']);
    assert.equal(drift.status, 1);
    assert.match(drift.stderr, /OUTPUT-DRIFT/);

    const refused = run(['extract', fixture.configPath]);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /Refusing to overwrite/);
    assert.equal(JSON.parse(fs.readFileSync(dataFile, 'utf8')).entities.lisi.name, 'manual canonical edit');

    const forced = run(['extract', fixture.configPath, '--force']);
    assert.equal(forced.status, 0, forced.stderr);
    assert.equal(JSON.parse(fs.readFileSync(dataFile, 'utf8')).entities.lisi.name, '李斯');
  } finally {
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('asset resolver supports a configured physical root and rejects traversal', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-asset-root-'));
  const root = path.join(directory, 'public', 'media');
  fs.mkdirSync(root, { recursive: true });
  const file = path.join(root, 'portrait.png');
  fs.writeFileSync(file, 'png');
  try {
    assert.equal(localAssetPath(directory, 'assets/portrait.png', 'public/media'), file);
    assert.throws(() => localAssetPath(directory, 'assets/../../secret.png', 'public/media'), /escapes assetDir/);
    assert.throws(() => localAssetPath(directory, 'portrait.png', '../outside'), /escapes libDir/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
