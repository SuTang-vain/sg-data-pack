'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const CLI = path.join(__dirname, '..', 'scripts', 'sg-pack-rules.js');

function run(directory, args = []) {
  return spawnSync(process.execPath, [CLI, directory, ...args], { encoding: 'utf8' });
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-pack-rules-cli-'));
  const dataDir = path.join(root, 'lib', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'data.json'), JSON.stringify({ entities: { a: { name: 'A', kind: 'person' } } }));
  fs.writeFileSync(path.join(dataDir, 'data-rules.json'), JSON.stringify({
    rulesVersion: '1.0',
    libId: 'cli-demo',
    profile: {},
    rules: [
      { id: 'pass', level: 'hard', subject: 'pack', rule: 'passes', source: 'observed', check: 'true' },
      { id: 'soft', level: 'soft', subject: 'pack', rule: 'softly fails', source: 'observed', check: 'false' },
    ],
  }));
  return root;
}

test('rules CLI selects one rule while preserving legacy full execution and strict semantics', () => {
  const root = fixture();
  const selected = run(root, ['--rule', 'pass']);
  assert.equal(selected.status, 0, selected.stderr);
  assert.match(selected.stdout, /rules: 1 \| passed: 1/);

  const full = run(root);
  assert.equal(full.status, 0, full.stderr);
  assert.match(full.stdout, /rules: 2 \| passed: 1 \| hard-fail: 0 \| soft-fail: 1/);

  const strict = run(root, ['--strict']);
  assert.equal(strict.status, 1);
  assert.match(strict.stderr, /Strict mode/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('rules CLI returns exit 2 for unknown, duplicate, or malformed options and rule ids', () => {
  const root = fixture();
  for (const args of [['--unknown'], ['--strict', '--strict'], ['--rule', 'pass', '--rule', 'soft'], ['--rule'], ['--rule', 'missing'], ['--unexpected', 'x']]) {
    const result = run(root, args);
    assert.equal(result.status, 2, `${args.join(' ')} should exit 2`);
  }
  fs.rmSync(root, { recursive: true, force: true });
});

test('rules CLI validates the complete rules document before a selection', () => {
  const root = fixture();
  const rulesPath = path.join(root, 'lib', 'data', 'data-rules.json');
  const document = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
  document.rules[1].level = 'invalid';
  fs.writeFileSync(rulesPath, JSON.stringify(document));
  const result = run(root, ['--rule', 'pass']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Rules-file structural check failed/);
  fs.rmSync(root, { recursive: true, force: true });
});
