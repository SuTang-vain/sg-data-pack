#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'sg-data-pack');
const FIXTURES = path.join(__dirname, 'fixtures', 'v1.3');
require(path.join(ROOT, 'scripts', 'lib', 'sg-data-loader.js'));

function load(...parts) { return JSON.parse(fs.readFileSync(path.join(...parts), 'utf8')); }
function run(args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', maxBuffer: 1 << 24 });
  if (r.error) throw r.error;
  return { exitCode: r.status, stdout: r.stdout, stderr: r.stderr };
}

const pilots = ['id-based', 'chinese-name', 'collection'].map((name) => {
  const pack = load(FIXTURES, name, 'data.json');
  const validation = globalThis.SGDataLoader.validate(pack);
  return {
    name,
    packId: pack.meta.id,
    entities: Object.keys(pack.entities || {}).length,
    relations: (pack.relations || []).length,
    stages: (pack.stages || []).length,
    derivations: Object.keys(pack.derivations || {}).length,
    validation: { errors: validation.errors, warnings: validation.warnings },
  };
});

const diffRun = run([
  'diff',
  path.join(FIXTURES, 'collection', 'data.json'),
  path.join(FIXTURES, 'collection', 'data-v2.json'),
  '--json',
]);
const diff = JSON.parse(diffRun.stdout);

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-v13-pilots-'));
let recrawl;
let generatedTypes;
try {
  const recrawlRun = run([
    'recrawl-skeleton',
    path.join(FIXTURES, 'chinese-name', 'data.json'),
    path.join(FIXTURES, 'chinese-name', 'records.json'),
    '--out', temp,
    '--source', 'https://example.test/pilot',
    '--fetchedAt', '2026-07-29',
  ]);
  recrawl = {
    exitCode: recrawlRun.exitCode,
    report: load(temp, 'review-report.json'),
  };
  const typePath = path.join(temp, 'collection-types.d.ts');
  const typesRun = run([
    'types', path.join(FIXTURES, 'collection', 'data.json'),
    '--name', 'CollectionPilot', '--out', typePath,
  ]);
  generatedTypes = {
    exitCode: typesRun.exitCode,
    bytes: fs.statSync(typePath).size,
    containsWorkEntity: /CollectionPilotWorkEntity/.test(fs.readFileSync(typePath, 'utf8')),
  };
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

const templateRun = run(['templatize', path.join(FIXTURES, 'collection', 'instances.json')]);
const slots = /slots:\s*(\d+)/.exec(templateRun.stdout);

const report = {
  experiment: 'Data Pack v1.3 three-pilot reproducibility experiment',
  executedAt: '2026-07-29',
  node: process.version,
  pilots,
  collectionEvolution: {
    diffExitCode: diffRun.exitCode,
    changedEntities: diff.entities.changed,
    assetAdds: diff.assets.added,
    assetRemovals: diff.assets.removed,
    derivationsImpacted: diff.derivationsImpacted.map((d) => ({ name: d.name, triggers: d.triggers, consumers: d.consumers })),
  },
  chineseRecrawl: {
    exitCode: recrawl.exitCode,
    summary: recrawl.report.summary,
    autoMergeable: recrawl.report.autoMergeable.length,
    needsHumanReview: recrawl.report.needsHumanReview.length,
    agrees: recrawl.report.hits.map((h) => ({ id: h.id, fields: h.crossCheck.agree })),
  },
  collectionTemplatize: {
    exitCode: templateRun.exitCode,
    slots: slots ? Number(slots[1]) : null,
    byteExact: /byte-exact verification: OK/.test(templateRun.stdout),
  },
  typeGeneration: generatedTypes,
};

process.stdout.write(JSON.stringify(report, null, 2) + '\n');
