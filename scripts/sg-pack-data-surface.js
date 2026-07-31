#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { readDataSurfaceManifest } = require('./lib/sg-data-surface-import.js');

const args = process.argv.slice(2);
const file = args[0];
const outIndex = args.indexOf('--out');
const out = outIndex >= 0 ? args[outIndex + 1] : null;
const allowReviewRequired = args.includes('--allow-review-required');

if (!file || (outIndex >= 0 && !out)) {
  console.error('Usage: sg-data-pack data-surface-import <manifest.json> [--out report.json] [--allow-review-required]');
  process.exit(2);
}

try {
  const report = readDataSurfaceManifest(path.resolve(file));
  const serialized = JSON.stringify(report, null, 2) + '\n';
  if (out) fs.writeFileSync(path.resolve(out), serialized);
  else process.stdout.write(serialized);
  if (report.reviewRequired && !allowReviewRequired) {
    console.error(`Data Surface import blocked: ${report.blockers.join('; ')}`);
    process.exit(1);
  }
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
