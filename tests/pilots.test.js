'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'sg-data-pack');
const FIXTURES = path.join(ROOT, 'research', 'fixtures', 'v1.3');
require(path.join(ROOT, 'scripts', 'lib', 'sg-data-loader.js'));

function read(...parts) { return JSON.parse(fs.readFileSync(path.join(...parts), 'utf8')); }
function run(args) { return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', maxBuffer: 1 << 24 }); }

for (const pilot of ['id-based', 'chinese-name', 'collection']) {
  test(`v1.3 ${pilot} pilot validates with zero errors and warnings`, () => {
    const pack = read(FIXTURES, pilot, 'data.json');
    const result = globalThis.SGDataLoader.validate(pack);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
  });
}

test('collection pilot diff reaches carouselItems derivation', () => {
  const r = run([
    'diff',
    path.join(FIXTURES, 'collection', 'data.json'),
    path.join(FIXTURES, 'collection', 'data-v2.json'),
    '--json',
  ]);
  assert.equal(r.status, 1, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.ok(report.entities.changed.some((c) => c.id === 'work-beta' && c.fields.includes('cover')));
  assert.ok(report.derivationsImpacted.some((d) => d.name === 'carouselItems'));
});

test('Chinese-name pilot recrawl resolves aliases and field mapping without review', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-pilot-recrawl-'));
  try {
    const r = run([
      'recrawl-skeleton',
      path.join(FIXTURES, 'chinese-name', 'data.json'),
      path.join(FIXTURES, 'chinese-name', 'records.json'),
      '--out', outDir,
      '--fetchedAt', '2026-07-29',
    ]);
    assert.equal(r.status, 0, r.stderr);
    const report = read(outDir, 'review-report.json');
    assert.deepEqual(report.summary, { total: 2, hits: 2, misses: 0 });
    assert.equal(report.needsHumanReview.length, 0);
    assert.ok(report.hits[0].crossCheck.agree.includes('birthDate'));
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

test('collection pilot templatize remains byte-exact', () => {
  const r = run(['templatize', path.join(FIXTURES, 'collection', 'instances.json')]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /byte-exact verification: OK/);
});
