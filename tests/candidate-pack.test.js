'use strict';
/*
 * candidate-pack.test.js — explicit Review Decisions -> Candidate Pack contract.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'sg-data-pack');
const BASELINE = path.join(ROOT, 'research', 'fixtures', 'v1.3', 'chinese-name', 'data.json');

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', maxBuffer: 1 << 24 });
}
function read(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); }
function basePack() {
  return {
    schemaVersion: '1.3',
    meta: { id: 'candidate-test', title: 'Candidate test', recrawlFieldMap: { birthDate: 'birth' } },
    entities: {
      alice: { kind: 'person', name: 'Alice', actor: 'Alice Actor' },
      bob: { kind: 'person', name: 'Bob', actor: 'Bob Actor' },
    },
    aliases: { Alice: 'alice', Bob: 'bob' },
    relationTypes: {},
    relations: [],
    stages: [],
    contents: {},
    domain: {},
    assets: {},
  };
}

function makeCase(records, configureDecisions) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-candidate-'));
  const baseline = path.join(dir, 'baseline.json');
  const recordsFile = path.join(dir, 'records.json');
  const reportDir = path.join(dir, 'review');
  const decisionsFile = path.join(dir, 'decisions.json');
  const candidate = path.join(dir, 'candidate.json');
  const audit = path.join(dir, 'audit.json');
  writeJson(baseline, basePack());
  writeJson(recordsFile, records);
  const recrawl = run([
    'recrawl-skeleton', baseline, recordsFile, '--out', reportDir,
    '--candidate-ready', '--origin', 'crawl:candidate-test',
    '--source', 'https://example.test/candidate', '--fetchedAt', '2026-07-31',
  ]);
  assert.ok([0, 1].includes(recrawl.status), recrawl.stderr);
  const reportFile = path.join(reportDir, 'review-report.json');
  const report = read(reportFile);
  const decisions = configureDecisions(report.candidateReview);
  writeJson(decisionsFile, decisions);
  return { dir, baseline, recordsFile, reportFile, decisionsFile, candidate, audit, report, decisions };
}
function cleanup(testCase) { fs.rmSync(testCase.dir, { recursive: true, force: true }); }

function decisionsFor(review, actionFor) {
  return {
    decisionsVersion: '1.0',
    reportId: review.reportId,
    reviewedBy: 'test-reviewer',
    reviewedAt: '2026-07-31T12:00:00Z',
    decisions: review.reviewItems.map((item) => actionFor(item)),
  };
}

test('candidate applies reviewed gap and appends a confirmed alias', () => {
  const c = makeCase([
    { crawledName: 'Alice', occupation: '演员' },
    { crawledName: 'Alicia', actor: 'Alice Actor' },
  ], (review) => decisionsFor(review, (item) => {
    if (item.kind === 'identity') return { itemId: item.itemId, action: 'map-alias', entityId: 'alice', context: 'reviewed-name' };
    return { itemId: item.itemId, action: 'apply', confidence: 0.95, note: 'confirmed by source' };
  }));
  try {
    const result = run([
      'candidate', c.baseline, c.reportFile, c.decisionsFile,
      '--records', c.recordsFile, '--out', c.candidate, '--audit', c.audit,
    ]);
    assert.equal(result.status, 0, result.stderr);
    const pack = read(c.candidate);
    const audit = read(c.audit);
    assert.equal(pack.entities.alice.occupation, '演员');
    assert.deepEqual(pack.aliases.Alicia, { id: 'alice', context: 'reviewed-name' });
    assert.equal(pack.provenance.entities.alice.fieldOrigins.occupation.confidence, 0.95);
    assert.equal(audit.status, 'valid');
    assert.equal(audit.operations.length, 2);
    assert.equal(audit.diff.total, 3);
  } finally { cleanup(c); }
});

test('candidate keeps a conflict without modifying the baseline entity', () => {
  const c = makeCase([{ crawledName: 'Alice', actor: 'Different Actor' }], (review) =>
    decisionsFor(review, (item) => ({ itemId: item.itemId, action: 'keep', note: 'baseline is authoritative' })));
  try {
    const result = run(['candidate', c.baseline, c.reportFile, c.decisionsFile, '--records', c.recordsFile, '--out', c.candidate]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(read(c.candidate).entities.alice.actor, 'Alice Actor');
    assert.equal(read(c.candidate).provenance, undefined);
  } finally { cleanup(c); }
});

test('candidate rejects missing decisions and does not create output', () => {
  const c = makeCase([{ crawledName: 'Alice', occupation: '演员' }], (review) => ({
    decisionsVersion: '1.0', reportId: review.reportId, reviewedBy: 'tester', reviewedAt: '2026-07-31T12:00:00Z', decisions: [],
  }));
  try {
    const result = run(['candidate', c.baseline, c.reportFile, c.decisionsFile, '--records', c.recordsFile, '--out', c.candidate]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /incomplete/);
    assert.equal(fs.existsSync(c.candidate), false);
  } finally { cleanup(c); }
});

test('candidate rejects a stale baseline and preserves an existing output', () => {
  const c = makeCase([{ crawledName: 'Alice', occupation: '演员' }], (review) =>
    decisionsFor(review, (item) => ({ itemId: item.itemId, action: 'apply', confidence: 0.9 })));
  try {
    fs.writeFileSync(c.candidate, 'sentinel\n');
    const changed = read(c.baseline);
    changed.entities.alice.actor = 'stale baseline';
    writeJson(c.baseline, changed);
    const result = run(['candidate', c.baseline, c.reportFile, c.decisionsFile, '--records', c.recordsFile, '--out', c.candidate, '--force']);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /SHA-256/);
    assert.equal(fs.readFileSync(c.candidate, 'utf8'), 'sentinel\n');
  } finally { cleanup(c); }
});

test('candidate rejects tampered report, unsupported entity creation, and output aliasing', () => {
  const c = makeCase([{ crawledName: 'Alicia' }], (review) => decisionsFor(review, (item) => ({
    itemId: item.itemId, action: 'create-entity', entityId: 'new-person', confidence: 1,
  })));
  try {
    const tampered = read(c.reportFile);
    tampered.candidateReview.origin = 'crawl:tampered';
    writeJson(c.reportFile, tampered);
    const tamperResult = run(['candidate', c.baseline, c.reportFile, c.decisionsFile, '--records', c.recordsFile, '--out', c.candidate]);
    assert.equal(tamperResult.status, 2);
    assert.match(tamperResult.stderr, /reportId/);
    assert.equal(fs.existsSync(c.candidate), false);

    // The output path check is performed before any input is read or written.
    const aliasResult = run(['candidate', c.baseline, c.reportFile, c.decisionsFile, '--records', c.recordsFile, '--out', c.baseline]);
    assert.equal(aliasResult.status, 2);
    assert.match(aliasResult.stderr, /must not overwrite/);
  } finally { cleanup(c); }
});

test('candidate refuses an output path that aliases an input through a symlinked parent', (t) => {
  const c = makeCase([{ crawledName: 'Alice', occupation: '演员' }], (review) =>
    decisionsFor(review, (item) => ({ itemId: item.itemId, action: 'apply', confidence: 0.9 })));
  try {
    const link = path.join(c.dir, 'same-dir-link');
    try { fs.symlinkSync(c.dir, link, 'dir'); }
    catch (error) { t.skip(`symlinks unavailable: ${error.message}`); return; }
    const aliasedBaseline = path.join(link, path.basename(c.baseline));
    const result = run([
      'candidate', c.baseline, c.reportFile, c.decisionsFile,
      '--records', c.recordsFile, '--out', aliasedBaseline, '--force',
    ]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /must not overwrite/);
    assert.equal(read(c.baseline).entities.alice.occupation, undefined);
  } finally { cleanup(c); }
});

test('candidate output and audit are deterministic for identical inputs', () => {
  const c = makeCase([{ crawledName: 'Alice', occupation: '演员' }], (review) =>
    decisionsFor(review, (item) => ({ itemId: item.itemId, action: 'apply', confidence: 0.9 })));
  try {
    const first = run(['candidate', c.baseline, c.reportFile, c.decisionsFile, '--records', c.recordsFile, '--out', c.candidate, '--audit', c.audit]);
    assert.equal(first.status, 0, first.stderr);
    const firstCandidate = fs.readFileSync(c.candidate, 'utf8');
    const firstAudit = fs.readFileSync(c.audit, 'utf8');
    const secondCandidate = path.join(c.dir, 'candidate-2.json');
    const secondAudit = path.join(c.dir, 'audit-2.json');
    const second = run(['candidate', c.baseline, c.reportFile, c.decisionsFile, '--records', c.recordsFile, '--out', secondCandidate, '--audit', secondAudit]);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(fs.readFileSync(secondCandidate, 'utf8'), firstCandidate);
    assert.equal(fs.readFileSync(secondAudit, 'utf8'), firstAudit);
  } finally { cleanup(c); }
});
