'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const RECRAWL = path.join(__dirname, '..', 'scripts', 'sg-pack-recrawl-skeleton.js');

function runRecrawl(pack, records) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-recrawl-'));
  const packPath = path.join(dir, 'pack.json');
  const recordsPath = path.join(dir, 'records.json');
  const outDir = path.join(dir, 'out');
  fs.writeFileSync(packPath, JSON.stringify(pack));
  fs.writeFileSync(recordsPath, JSON.stringify(records));
  const result = spawnSync(process.execPath, [RECRAWL, packPath, recordsPath, '--out', outDir, '--fetchedAt', '2026-07-29'], { encoding: 'utf8' });
  let report = null;
  const reportPath = path.join(outDir, 'review-report.json');
  if (fs.existsSync(reportPath)) report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  fs.rmSync(dir, { recursive: true, force: true });
  return { result, report };
}

function basePack(overrides) {
  return Object.assign({
    schemaVersion: '1.3',
    meta: { id: 'demo', title: 'Demo' },
    entities: { p1: { kind: 'person', name: 'Alice', actor: 'Alice Actor' } },
    aliases: { Alice: 'p1' },
  }, overrides || {});
}

test('recrawl classifies an absent unrelated field as a gap, not actor conflict', () => {
  const { result, report } = runRecrawl(basePack(), [{ crawledName: 'Alice', birth: '1990-01-01' }]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(report.hits[0].crossCheck.conflict.length, 0);
  assert.equal(report.hits[0].crossCheck.gap.length, 1);
  assert.equal(report.hits[0].crossCheck.gap[0].baselineField, 'birth');
});

test('recrawl uses meta.recrawlFieldMap for explicit cross-field comparison', () => {
  const pack = basePack({
    meta: { id: 'demo', title: 'Demo', recrawlFieldMap: { birthDate: 'birth' } },
    entities: { p1: { kind: 'person', name: 'Alice', birth: '1990-01-01' } },
  });
  const { result, report } = runRecrawl(pack, [{ crawledName: 'Alice', birthDate: '1990-01-01' }]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(report.hits[0].crossCheck.agree, ['birthDate']);
});

test('recrawl resolves contextual alias objects', () => {
  const pack = basePack({ aliases: { 'Alice A.': { id: 'p1', context: 'cast' } } });
  const { result, report } = runRecrawl(pack, ['Alice A.']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(report.hits[0].id, 'p1');
});

test('recrawl rejects malformed records with exit 2', () => {
  const { result, report } = runRecrawl(basePack(), [{ actor: 'Nobody' }]);
  assert.equal(result.status, 2);
  assert.equal(report, null);
  assert.match(result.stderr, /must contain crawledName or name/);
});
