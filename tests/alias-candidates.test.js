'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'sg-pack-alias-candidates.js');

test('alias-candidates resolves contextual alias objects as direct hits', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-alias-'));
  try {
    const pack = path.join(dir, 'pack.json');
    const names = path.join(dir, 'names.json');
    fs.writeFileSync(pack, JSON.stringify({ entities: { a: { kind: 'person', name: 'Alice' } }, aliases: { 'Alice A.': { id: 'a', context: 'cast' } } }));
    fs.writeFileSync(names, JSON.stringify(['Alice A.']));
    const r = spawnSync(process.execPath, [SCRIPT, pack, names, '--json'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), [{ name: 'Alice A.', status: 'hit', id: 'a' }]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
