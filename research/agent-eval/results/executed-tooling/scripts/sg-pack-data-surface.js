#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { readDataSurfaceManifest } = require('./lib/sg-data-surface-import.js');

function usage() {
  return 'Usage: sg-data-pack data-surface-import <manifest.json> [--out report.json] [--allow-review-required]';
}

function parseArgs(argv) {
  let file = null;
  let out = null;
  let allowReviewRequired = false;
  const seen = new Set();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') {
      if (seen.has(arg)) throw new Error('duplicate option: --out');
      seen.add(arg);
      if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) throw new Error('--out requires a value');
      out = argv[++i];
      continue;
    }
    if (arg === '--allow-review-required') {
      if (seen.has(arg)) throw new Error('duplicate option: --allow-review-required');
      seen.add(arg);
      allowReviewRequired = true;
      continue;
    }
    if (arg.startsWith('-')) throw new Error('unknown option: ' + arg);
    if (file !== null) throw new Error('unexpected positional argument: ' + arg);
    file = arg;
  }
  if (!file) throw new Error('manifest path is required');
  return { file, out, allowReviewRequired };
}

function canonicalPath(file) {
  let absolute = path.resolve(file);
  const missing = [];
  while (!fs.existsSync(absolute)) {
    const parent = path.dirname(absolute);
    if (parent === absolute) break;
    missing.unshift(path.basename(absolute));
    absolute = parent;
  }
  try { absolute = fs.realpathSync(absolute); } catch (_) { /* input reads report the concrete error */ }
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

function atomicWrite(file, bytes) {
  const absolute = path.resolve(file);
  const directory = path.dirname(absolute);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(absolute)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`);
  let fd;
  try {
    fd = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporary, absolute);
    try {
      const dirFd = fs.openSync(directory, 'r');
      try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
    } catch (_) { /* directory fsync is not available on every platform */ }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(temporary); } catch (_) { /* renamed or already removed */ }
  }
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  console.error(usage());
  process.exit(2);
}

const inputPath = path.resolve(options.file);
const outputPath = options.out ? path.resolve(options.out) : null;
if (outputPath && sameFile(inputPath, outputPath)) {
  console.error('--out must not be the same file as the input manifest (including symlink or hardlink aliases)');
  process.exit(2);
}

try {
  const report = readDataSurfaceManifest(inputPath, { requireReady: false });
  const serialized = JSON.stringify(report, null, 2) + '\n';
  if (outputPath) atomicWrite(outputPath, serialized);
  else process.stdout.write(serialized);
  if (report.reviewRequired && !options.allowReviewRequired) {
    console.error(`Data Surface import blocked: ${report.blockers.join('; ')}`);
    process.exit(1);
  }
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
