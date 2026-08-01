'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'sg-data-pack');
function run(args) { return spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: 'utf8' }); }
function pack() {
  return {
    schemaVersion: '1.3', meta: { id: 'compile-fixture', title: 'Compile fixture' },
    entities: { alice: { kind: 'person', name: 'Alice' } }, aliases: { Alice: 'alice' },
    stages: [{ key: 'main', name: 'Main', entities: ['alice'] }],
  };
}

test('compile derives data.js and schema from reviewed data.json and detects drift', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-compile-'));
  const data = path.join(root, 'data.json');
  try {
    fs.writeFileSync(data, JSON.stringify(pack(), null, 2) + '\n');
    const compile = run(['compile', data]);
    assert.equal(compile.status, 0, compile.stderr);
    const script = fs.readFileSync(path.join(root, 'data.js'), 'utf8');
    assert.match(script, /globalThis\.SG_DATA_PACK/);
    assert.match(script, /"compile-fixture"/);
    assert.equal(run(['compile', data, '--check']).status, 0);
    fs.appendFileSync(path.join(root, 'data.js'), '// drift\n');
    const drift = run(['compile', data, '--check']);
    assert.equal(drift.status, 1);
    assert.match(drift.stderr, /output drift/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('compile refuses to erase a custom domain schema without an explicit fragment', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-compile-domain-'));
  const data = path.join(root, 'data.json');
  const fragment = path.join(root, 'domain.fragment.json');
  const schema = path.join(root, 'data.schema.json');
  try {
    const value = pack();
    value.domain = { cardOrder: ['alice'] };
    fs.writeFileSync(data, JSON.stringify(value, null, 2) + '\n');
    fs.writeFileSync(fragment, JSON.stringify({ type: 'object', required: ['cardOrder'], properties: { cardOrder: { type: 'array', items: { type: 'string' } } }, additionalProperties: false }, null, 2) + '\n');
    assert.equal(run(['compile', data, '--domain-schema', fragment]).status, 0);
    const generated = JSON.parse(fs.readFileSync(schema, 'utf8'));
    assert.deepEqual(generated.properties.domain, JSON.parse(fs.readFileSync(fragment, 'utf8')));

    const rejected = run(['compile', data]);
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /custom domain schema/);
    assert.match(rejected.stderr, /--domain-schema/);
    assert.deepEqual(JSON.parse(fs.readFileSync(schema, 'utf8')).properties.domain, generated.properties.domain, 'failed compile must preserve the custom schema');
    assert.equal(run(['compile', data, '--domain-schema', fragment, '--check']).status, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('compile preserves boolean domain schemas', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-compile-boolean-domain-'));
  const data = path.join(root, 'data.json');
  const fragment = path.join(root, 'domain.fragment.json');
  const schema = path.join(root, 'data.schema.json');
  try {
    fs.writeFileSync(data, JSON.stringify(pack(), null, 2) + '\n');
    fs.writeFileSync(fragment, 'false\n');
    const compile = run(['compile', data, '--domain-schema', fragment]);
    assert.equal(compile.status, 0, compile.stderr);
    assert.equal(JSON.parse(fs.readFileSync(schema, 'utf8')).properties.domain, false);
    const rejected = run(['compile', data]);
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /custom domain schema/);
    assert.equal(JSON.parse(fs.readFileSync(schema, 'utf8')).properties.domain, false);
    assert.equal(run(['compile', data, '--domain-schema', fragment, '--check']).status, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('standalone asset hash verification rejects a manifest path escaping the asset root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-validate-asset-'));
  const dataDir = path.join(root, 'lib', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const value = pack();
  value.assets = { '../../../outside.txt': { exists: true, hash: 'sha1:' + '0'.repeat(40) } };
  const data = path.join(dataDir, 'data.json');
  fs.writeFileSync(data, JSON.stringify(value));
  try {
    const result = run(['validate', data, '--verify-hash']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /unreadable or unsafe/);
    assert.match(result.stderr, /escapes the asset root/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
