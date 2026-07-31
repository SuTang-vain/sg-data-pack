#!/usr/bin/env node
/*
 * sg-pack-candidate.js — apply explicit Review Decisions to a Data Pack.
 *
 * Usage:
 *   sg-data-pack candidate <baseline.json> <review-report.json> <review-decisions.json>
 *     --out <candidate.json> --records <records.json> [--audit <audit.json>] [--strict] [--force]
 *
 * Exit code: 0 = candidate written; 1 = review/data gate failed; 2 = usage/input error.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { buildCandidate, CandidateError } = require('./lib/sg-pack-candidate.js');

const [, , baselinePath, reportPath, decisionsPath, ...flags] = process.argv;
if (!baselinePath || !reportPath || !decisionsPath) {
  console.error('Usage: sg-data-pack candidate <baseline.json> <review-report.json> <review-decisions.json> --out <candidate.json> --records <records.json> [--audit <audit.json>] [--strict] [--force]');
  process.exit(2);
}

function flag(name) {
  const index = flags.indexOf(name);
  if (index < 0) return null;
  if (index + 1 >= flags.length || flags[index + 1].startsWith('--')) {
    console.error(`${name} requires a value`);
    process.exit(2);
  }
  return flags[index + 1];
}

const outPath = flag('--out');
const auditPath = flag('--audit') || (outPath ? `${outPath}.audit.json` : null);
const recordsPath = flag('--records');
const strict = flags.includes('--strict');
const force = flags.includes('--force');
if (!outPath) {
  console.error('candidate requires --out <candidate.json>');
  process.exit(2);
}
if (!recordsPath) {
  console.error('candidate requires --records <records.json> to bind the review report to its crawl input');
  process.exit(2);
}

function resolve(file) { return path.resolve(file); }
function canonicalPath(file) {
  let absolute = resolve(file);
  const missing = [];
  while (!fs.existsSync(absolute)) {
    const parent = path.dirname(absolute);
    if (parent === absolute) break;
    missing.unshift(path.basename(absolute));
    absolute = parent;
  }
  try { absolute = fs.realpathSync(absolute); } catch (_) { /* checked below by input reads */ }
  return path.join(absolute, ...missing);
}
function sameFile(left, right) {
  const canonicalLeft = canonicalPath(left);
  const canonicalRight = canonicalPath(right);
  const caseInsensitiveFs = process.platform === 'darwin' || process.platform === 'win32';
  if (canonicalLeft === canonicalRight || (caseInsensitiveFs && canonicalLeft.toLowerCase() === canonicalRight.toLowerCase())) return true;
  try {
    const a = fs.statSync(left);
    const b = fs.statSync(right);
    return a.dev === b.dev && a.ino === b.ino;
  } catch (_) {
    return false;
  }
}
const inputPaths = [baselinePath, reportPath, decisionsPath, recordsPath].filter(Boolean).map(resolve);
const outputPaths = [outPath, auditPath].map(resolve);
if (sameFile(outputPaths[0], outputPaths[1])) {
  console.error('candidate and audit output paths must be different');
  process.exit(2);
}
if (outputPaths.some((output) => inputPaths.some((input) => sameFile(output, input)))) {
  console.error('candidate output paths must not overwrite an input file');
  process.exit(2);
}

function acquireOutputLock(paths) {
  const caseInsensitiveFs = process.platform === 'darwin' || process.platform === 'win32';
  const lockPaths = [...new Set(paths.map((file) => {
    const canonical = canonicalPath(file);
    return caseInsensitiveFs ? canonical.toLowerCase() : canonical;
  }))]
    .sort()
    .map((target) => path.join(
      os.tmpdir(),
      'sg-data-pack-candidate-' + crypto.createHash('sha256').update(target).digest('hex') + '.lock',
    ));
  const acquired = [];
  const release = () => {
    for (const lockPath of acquired.splice(0)) {
      try { fs.unlinkSync(lockPath); } catch (_) { /* already released */ }
    }
  };
  try {
    for (const lockPath of lockPaths) {
      let acquiredOne = false;
      for (let attempt = 0; attempt < 2 && !acquiredOne; attempt += 1) {
        try {
          let fd;
          try {
            fd = fs.openSync(lockPath, 'wx', 0o600);
            fs.writeFileSync(fd, String(process.pid));
          } finally {
            if (fd !== undefined) fs.closeSync(fd);
          }
          acquired.push(lockPath);
          acquiredOne = true;
        } catch (error) {
          if (error.code !== 'EEXIST') throw error;
          let owner = null;
          try { owner = Number(fs.readFileSync(lockPath, 'utf8')); } catch (_) { /* raced with cleanup */ }
          if (!owner) throw new Error('candidate output is locked by another process');
          try {
            process.kill(owner, 0);
            throw new Error('candidate output is locked by process ' + owner);
          } catch (probeError) {
            if (probeError.message.indexOf('locked by process') !== -1 || probeError.code !== 'ESRCH') throw probeError;
            try { fs.unlinkSync(lockPath); } catch (_) { throw new Error('candidate output is locked by another process'); }
          }
        }
      }
      if (!acquiredOne) throw new Error('candidate output lock could not be acquired');
    }
    let released = false;
    return () => { if (!released) { released = true; release(); } };
  } catch (error) {
    release();
    throw error;
  }
}
let releaseOutputLock;
try { releaseOutputLock = acquireOutputLock(outputPaths); }
catch (error) { console.error('candidate: ' + error.message); process.exit(2); }
process.on('exit', () => { if (releaseOutputLock) releaseOutputLock(); });

if (!force && outputPaths.some((file) => fs.existsSync(file))) {
  console.error('candidate output already exists; use --force to replace it');
  process.exit(2);
}

function readBytes(file, label) {
  try { return fs.readFileSync(file); }
  catch (error) { throw new CandidateError(`${label}: ${error.message}`, 2); }
}
function parse(bytes, label) {
  try { return JSON.parse(bytes.toString('utf8')); }
  catch (error) { throw new CandidateError(`${label}: ${error.message}`, 2); }
}

let result;
try {
  const baselineBytes = readBytes(baselinePath, 'Cannot read baseline Data Pack');
  const reportBytes = readBytes(reportPath, 'Cannot read review report');
  const decisionsBytes = readBytes(decisionsPath, 'Cannot read review decisions');
  const recordsBytes = recordsPath ? readBytes(recordsPath, 'Cannot read records') : undefined;
  const baselinePack = parse(baselineBytes, 'Invalid baseline Data Pack');
  const report = parse(reportBytes, 'Invalid review report');
  const decisions = parse(decisionsBytes, 'Invalid review decisions');
  const rawRecords = parse(recordsBytes, 'Invalid records');
  if (!report.candidateReview || !report.candidateReview.reportId) {
    throw new CandidateError('review report is not candidate-ready; rerun recrawl-skeleton with --candidate-ready', 2);
  }
  result = buildCandidate({
    baselinePack,
    baselineBytes,
    report,
    decisions,
    decisionsBytes,
    strict,
    recordsBytes,
    rawRecords,
  });
} catch (error) {
  const exitCode = error instanceof CandidateError && error.exitCode ? error.exitCode : 2;
  console.error(`candidate: ${error.message}`);
  process.exit(exitCode);
}

function atomicWritePair(firstPath, firstBytes, secondPath, secondBytes) {
  const tempPaths = [firstPath, secondPath].map((file) => path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`,
  ));
  const backups = [];
  const installed = [];
  const writeTemp = (file, bytes) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let fd;
    try {
      fd = fs.openSync(file, 'wx', 0o600);
      fs.writeFileSync(fd, bytes);
      fs.fsyncSync(fd);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  };
  const cleanupTemps = () => tempPaths.forEach((file) => { try { fs.unlinkSync(file); } catch (_) { /* absent */ } });
  const cleanupInstalled = () => installed.forEach((file) => { try { fs.unlinkSync(file); } catch (_) { /* absent */ } });
  try {
    writeTemp(tempPaths[0], firstBytes);
    writeTemp(tempPaths[1], secondBytes);
    for (const file of [firstPath, secondPath]) {
      if (!fs.existsSync(file)) continue;
      const backup = `${file}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.bak`;
      fs.renameSync(file, backup);
      backups.push({ file, backup });
    }
    fs.renameSync(tempPaths[0], firstPath);
    installed.push(firstPath);
    fs.renameSync(tempPaths[1], secondPath);
    installed.push(secondPath);
    for (const { backup } of backups) { try { fs.unlinkSync(backup); } catch (_) { /* best effort cleanup */ } }
  } catch (error) {
    cleanupTemps();
    cleanupInstalled();
    const rollbackErrors = [];
    for (const { file, backup } of backups) {
      try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch (rollbackError) { rollbackErrors.push(`${file}: ${rollbackError.message}`); }
      try { if (fs.existsSync(backup)) fs.renameSync(backup, file); } catch (rollbackError) { rollbackErrors.push(`${file}: ${rollbackError.message}`); }
    }
    if (rollbackErrors.length) throw new Error(`${error.message}; rollback incomplete: ${rollbackErrors.join('; ')}`);
    throw error;
  }
}

try {
  atomicWritePair(outPath, result.candidateBytes, auditPath, result.auditBytes);
} catch (error) {
  console.error('candidate: could not write outputs: ' + error.message);
  process.exit(2);
}

console.log(`candidate: wrote ${outPath}`);
console.log(`audit: wrote ${auditPath}`);
