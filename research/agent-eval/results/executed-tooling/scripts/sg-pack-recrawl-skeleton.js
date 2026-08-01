#!/usr/bin/env node
/*
 * sg-pack-recrawl-skeleton.js - one-command recrawl normalization pipeline.
 *
 * Input:  an existing Data Pack (baseline) + a list of crawled records (JSON
 *         array of {crawledName, ...fields} or newline-separated names).
 * Output: a recrawl review skeleton:
 *   - hits:    names that resolve via existing aliases (auto-confirmed)
 *   - misses:  names with ranked alias candidates (awaiting confirmation)
 *   - crossCheck: for hits, compares crawled fields vs baseline (agree/conflict/gap)
 *   - review-report.json: agree / autoMergeable / needsHumanReview split
 *
 * Usage:
 *   sg-data-pack recrawl-skeleton <data.json> <records.json> [--out <dir>] [--source <url>] [--fetchedAt <date>] [--candidate-ready --origin <origin>]
 *
 * Exit: 0 = skeleton written, 1 = misses found (review needed), 2 = usage error.
 *
 * After review: extend pack.aliases with confirmed mappings, then run the gate.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const review = require('./lib/sg-recrawl-review.js');

const [, , packPath, recordsPath, ...rest] = process.argv;
if (!packPath || !recordsPath) {
  console.error('Usage: sg-data-pack recrawl-skeleton <data.json> <records.json> [--out <dir>] [--source <url>] [--fetchedAt <date>]');
  process.exit(2);
}

function flag(name) {
  const index = rest.indexOf(name);
  if (index < 0) return null;
  if (index + 1 >= rest.length || rest[index + 1].startsWith('--')) {
    console.error(`${name} requires a value`);
    process.exit(2);
  }
  return rest[index + 1];
}

const outDir = flag('--out') || '.';
const source = flag('--source') || '(unspecified)';
const origin = flag('--origin');
const fetchedAt = flag('--fetchedAt') || new Date().toISOString().slice(0, 10);
const candidateReady = rest.includes('--candidate-ready');

function loadJson(file, label) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { console.error(label + ': ' + error.message); process.exit(2); }
}

let packBytes;
let recordsBytes;
try {
  packBytes = fs.readFileSync(packPath);
  recordsBytes = fs.readFileSync(recordsPath);
} catch (error) {
  console.error('Cannot read recrawl input: ' + error.message);
  process.exit(2);
}
const pack = loadJson(packPath, 'Invalid data.json');
const rawRecords = loadJson(recordsPath, 'Invalid records.json');
let records;
try {
  records = review.normalizeRecords(rawRecords);
} catch (error) {
  console.error('Invalid records.json: ' + error.message);
  process.exit(2);
}

const legacy = review.buildLegacyProjection(pack, rawRecords);
const { summary, hits, misses, autoMergeable, needsHumanReview } = legacy;
const report = {
  source,
  fetchedAt,
  baseline: packPath,
  summary,
  hits,
  misses,
  autoMergeable,
  needsHumanReview,
};

if (candidateReady) {
  try {
    report.candidateReview = review.buildCandidateReview({
      pack,
      rawRecords,
      baselineBytes: packBytes,
      recordsBytes,
      origin,
      sourceUrl: source,
      fetchedAt,
    });
  } catch (error) {
    console.error('Invalid candidate-ready options: ' + error.message);
    process.exit(2);
  }
}

function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`,
  );
  let fd;
  try {
    fd = fs.openSync(temp, 'wx');
    fs.writeFileSync(fd, content, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temp, file);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(temp); } catch (_) { /* already renamed or never created */ }
  }
}

const reportPath = path.join(outDir, 'review-report.json');
try {
  atomicWrite(reportPath, JSON.stringify(report, null, 2) + '\n');
} catch (error) {
  console.error('Could not write review report: ' + error.message);
  process.exit(2);
}

console.log(`recrawl-skeleton: ${records.length} records -> ${hits.length} hits, ${misses.length} misses`);
console.log(`  cross-check: ${report.autoMergeable.length} auto-mergeable (gap fill), ${report.needsHumanReview.length} needs human review (conflict)`);
if (misses.length) {
  console.log('\nmisses (extend pack.aliases after confirmation):');
  for (const miss of misses) {
    console.log(`  ${miss.crawledName}`);
    for (const candidate of miss.candidates) console.log(`      ${candidate.score}  ${candidate.id}  (${candidate.matchedOn})`);
    if (!miss.candidates.length) console.log('      (no candidates - likely a genuinely new entity)');
  }
}
console.log(`\nwrote ${reportPath}`);
process.exit(misses.length ? 1 : 0);
