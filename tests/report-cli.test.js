'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'sg-data-pack');
const FIXTURE = path.join(ROOT, 'tests', 'fixtures', 'integration', 'qinshihuang-0716-ts');

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 24 });
}
function copyFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-report-'));
  const libDir = path.join(dir, 'qinshihuang-0716-ts');
  fs.cpSync(FIXTURE, libDir, { recursive: true });
  return { dir, libDir, config: path.join(libDir, 'extract.config.js') };
}

function assertJsonOutput(result) {
  assert.doesNotMatch(result.stdout, /^(==|SG Data Pack|\s*\[)/m);
  return JSON.parse(result.stdout);
}

test('public report CLI produces a five-section report without modifying the source library', () => {
  const fixture = copyFixture();
  try {
    const extract = run(['extract', fixture.config]);
    assert.equal(extract.status, 0, extract.stderr);
    const before = fs.readdirSync(path.join(fixture.libDir, 'lib', 'data')).sort();
    const dataFile = path.join(fixture.libDir, 'lib', 'data', 'data.json');
    const baseline = path.join(fixture.dir, 'baseline.json');
    fs.copyFileSync(dataFile, baseline);
    const out = path.join(fixture.dir, 'report');
    const reportRun = run(['report', fixture.libDir, '--config', fixture.config, '--baseline', baseline, '--verify-hash', '--out', out, '--json']);
    assert.equal(reportRun.status, 0, `${reportRun.stdout}\n${reportRun.stderr}`);
    const report = assertJsonOutput(reportRun);
    assert.equal(report.reportVersion, '1.0');
    assert.equal(report.run.command, 'report');
    assert.equal(report.run.exitCode, 0);
    assert.equal(report.inventory.entities, 15);
    assert.equal(report.inventory.relations, 11);
    assert.equal(report.inventory.stages, 7);
    assert.equal(report.inventory.assets, 21);
    assert.equal(report.assurances.find((item) => item.id === 'extract-equivalence').status, 'passed');
    assert.equal(report.assurances.find((item) => item.id === 'asset-integrity').status, 'passed');
    assert.equal(report.assurances.find((item) => item.id === 'runtime-mount').status, 'not-assessed');
    assert.equal(report.assurances.find((item) => item.id === 'visual-regression').status, 'not-assessed');
    assert.equal(report.assurances.find((item) => item.id === 'production-crawl').status, 'not-assessed');
    assert.equal(fs.existsSync(path.join(out, 'report.json')), true);
    assert.equal(fs.existsSync(path.join(out, 'REPORT.md')), true);
    const markdown = fs.readFileSync(path.join(out, 'REPORT.md'), 'utf8');
    assert.match(markdown, /发现的问题/);
    assert.match(markdown, /剩余风险/);
    assert.match(markdown, /下一步开发动作/);
    const after = fs.readdirSync(path.join(fixture.libDir, 'lib', 'data')).sort();
    assert.deepEqual(after, before);
  } finally {
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('report distinguishes warning mode from strict mode', () => {
  const fixture = copyFixture();
  try {
    const extract = run(['extract', fixture.config]);
    assert.equal(extract.status, 0, extract.stderr);
    const dataFile = path.join(fixture.libDir, 'lib', 'data', 'data.json');
    const pack = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    pack.provenance.entities.lisi.confidence = 0.1;
    fs.writeFileSync(dataFile, JSON.stringify(pack, null, 2) + '\n');
    const normal = run(['report', fixture.libDir, '--json']);
    const normalReport = assertJsonOutput(normal);
    assert.equal(normal.status, 0);
    assert.equal(normalReport.run.outcome, 'issues-found');
    const strict = run(['report', fixture.libDir, '--strict', '--json']);
    const strictReport = assertJsonOutput(strict);
    assert.equal(strict.status, 1);
    assert.equal(strictReport.run.outcome, 'blocked');
  } finally {
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('report returns input-error and does not create output for malformed optional input', () => {
  const fixture = copyFixture();
  try {
    const extract = run(['extract', fixture.config]);
    assert.equal(extract.status, 0, extract.stderr);
    const badBaseline = path.join(fixture.dir, 'bad-baseline.json');
    const out = path.join(fixture.dir, 'report');
    fs.writeFileSync(badBaseline, '{ not json');
    const result = run(['report', fixture.libDir, '--baseline', badBaseline, '--out', out, '--json']);
    const report = assertJsonOutput(result);
    assert.equal(result.status, 2);
    assert.equal(report.run.outcome, 'input-error');
    assert.equal(fs.existsSync(out), false);
  } finally {
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('report rejects a config belonging to another library', () => {
  const fixture = copyFixture();
  try {
    const extract = run(['extract', fixture.config]);
    assert.equal(extract.status, 0, extract.stderr);
    const other = path.join(fixture.dir, 'other.config.js');
    fs.copyFileSync(fixture.config, other);
    const source = fs.readFileSync(other, 'utf8').replace(/const LIB_DIR = __dirname;/, "const LIB_DIR = '/tmp/other-library';");
    fs.writeFileSync(other, source);
    const result = run(['report', fixture.libDir, '--config', other, '--json']);
    const report = assertJsonOutput(result);
    assert.equal(result.status, 2);
    assert.equal(report.run.outcome, 'input-error');
  } finally {
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('report --json isolates extraction stdout noise', () => {
  const fixture = copyFixture();
  try {
    const extract = run(['extract', fixture.config]);
    assert.equal(extract.status, 0, extract.stderr);
    const source = fs.readFileSync(fixture.config, 'utf8');
    fs.writeFileSync(fixture.config, source.replace("'use strict';", "'use strict';\nconsole.log('noisy extraction config');"));
    const result = run(['report', fixture.libDir, '--config', fixture.config, '--json']);
    const report = assertJsonOutput(result);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(report.assurances.find((item) => item.id === 'extract-equivalence').status, 'passed');
    assert.match(result.stderr, /noisy extraction config/);
  } finally {
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('equivalence runtime failures are blocked rather than input errors', () => {
  const fixture = copyFixture();
  try {
    const extract = run(['extract', fixture.config]);
    assert.equal(extract.status, 0, extract.stderr);
    const source = fs.readFileSync(fixture.config, 'utf8').replace("globalName: 'QinShihuangLibrary'", "globalName: 'MissingLibrary'");
    fs.writeFileSync(fixture.config, source);
    const result = run(['report', fixture.libDir, '--config', fixture.config, '--json']);
    const report = assertJsonOutput(result);
    assert.equal(result.status, 1);
    assert.equal(report.run.outcome, 'blocked');
    assert.ok(report.findings.some((finding) => finding.code === 'EQUIVALENCE_RUNTIME_ERROR'));
  } finally {
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('report rejects a syntactically valid but invalid baseline pack', () => {
  const fixture = copyFixture();
  try {
    const extract = run(['extract', fixture.config]);
    assert.equal(extract.status, 0, extract.stderr);
    const baseline = path.join(fixture.dir, 'invalid-baseline.json');
    fs.writeFileSync(baseline, JSON.stringify({}));
    const result = run(['report', fixture.libDir, '--baseline', baseline, '--json']);
    const report = assertJsonOutput(result);
    assert.equal(result.status, 2);
    assert.equal(report.run.outcome, 'input-error');
    assert.equal(report.assurances.find((item) => item.id === 'baseline-diff').status, 'failed');
  } finally {
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('report output cannot overwrite a consumed input', () => {
  const fixture = copyFixture();
  try {
    const extract = run(['extract', fixture.config]);
    assert.equal(extract.status, 0, extract.stderr);
    const review = path.join(fixture.dir, 'report.json');
    fs.writeFileSync(review, JSON.stringify({ misses: [], autoMergeable: [], needsHumanReview: [] }));
    const result = run(['report', fixture.libDir, '--review', review, '--out', fixture.dir, '--json']);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /must be outside|must not overwrite/);
  } finally {
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('report rejects a candidate-ready review bound to stale Data Pack bytes', () => {
  const fixture = copyFixture();
  try {
    const extract = run(['extract', fixture.config]);
    assert.equal(extract.status, 0, extract.stderr);
    const dataFile = path.join(fixture.libDir, 'lib', 'data', 'data.json');
    const records = path.join(fixture.dir, 'records.json');
    const reviewDir = path.join(fixture.dir, 'review');
    fs.writeFileSync(records, JSON.stringify([{ crawledName: '李斯', occupation: '丞相' }]));
    const recrawl = run([
      'recrawl-skeleton', dataFile, records, '--out', reviewDir, '--candidate-ready',
      '--origin', 'crawl:example.test', '--source', 'https://example.test/cast', '--fetchedAt', '2026-07-31',
    ]);
    assert.equal(recrawl.status, 0, recrawl.stderr);
    const pack = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    pack.entities.lisi.note = 'changed after review';
    fs.writeFileSync(dataFile, JSON.stringify(pack, null, 2) + '\n');
    const result = run(['report', fixture.libDir, '--review', path.join(reviewDir, 'review-report.json'), '--json']);
    const report = assertJsonOutput(result);
    assert.equal(result.status, 2);
    assert.equal(report.run.outcome, 'input-error');
    assert.ok(report.findings.some((finding) => finding.code === 'REVIEW_INPUT_ERROR'));
  } finally {
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('report rejects a Candidate audit bound to different candidate bytes', () => {
  const fixture = copyFixture();
  try {
    const extract = run(['extract', fixture.config]);
    assert.equal(extract.status, 0, extract.stderr);
    const digest = (value) => 'sha256:' + crypto.createHash('sha256').update(value).digest('hex');
    const audit = {
      auditVersion: '1.0', status: 'valid',
      inputs: {
        baselineSha256: digest('baseline'), recordsSha256: digest('records'), reportId: digest('report'),
        decisionsSha256: digest('decisions'), candidateSha256: digest('different-candidate'),
      },
      operations: [], unresolved: [], validation: { errors: [], warnings: [] }, derivationsImpacted: [],
    };
    const auditPath = path.join(fixture.dir, 'audit.json');
    fs.writeFileSync(auditPath, JSON.stringify(audit));
    const result = run(['report', fixture.libDir, '--audit', auditPath, '--json']);
    const report = assertJsonOutput(result);
    assert.equal(result.status, 2);
    assert.equal(report.run.outcome, 'input-error');
    assert.ok(report.findings.some((finding) => finding.code === 'AUDIT_INPUT_ERROR'));
  } finally {
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('report includes legacy recrawl misses and gaps instead of silently ignoring them', () => {
  const fixture = copyFixture();
  try {
    const extract = run(['extract', fixture.config]);
    assert.equal(extract.status, 0, extract.stderr);
    const dataFile = path.join(fixture.libDir, 'lib', 'data', 'data.json');
    const records = path.join(fixture.dir, 'records.json');
    const reviewDir = path.join(fixture.dir, 'review');
    fs.writeFileSync(records, JSON.stringify([{ crawledName: '李斯', occupation: '丞相' }, { crawledName: '未知人物' }]));
    const recrawl = run(['recrawl-skeleton', dataFile, records, '--out', reviewDir, '--fetchedAt', '2026-07-31']);
    assert.equal(recrawl.status, 1);
    const report = run(['report', fixture.libDir, '--review', path.join(reviewDir, 'review-report.json'), '--json']);
    const value = assertJsonOutput(report);
    assert.equal(report.status, 1);
    assert.equal(value.run.outcome, 'review-required');
    assert.ok(value.findings.some((finding) => finding.code === 'RECRAWL_MISS'));
  } finally {
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});
