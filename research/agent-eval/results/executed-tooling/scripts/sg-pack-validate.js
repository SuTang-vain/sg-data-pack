#!/usr/bin/env node
/*
 * sg-pack-validate.js — standalone Data Pack validation CLI
 * Usage: node sg-pack-validate.js <path/to/data.json> [--strict] [--verify-hash] [--asset-root <dir>]
 *   --strict:      warnings also fail (exit 1)
 *   --verify-hash: recompute sha1 of local assets and compare against the manifest
 *   --asset-root:  physical asset directory override (defaults to <lib>/lib/assets)
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { inspectAssets } = require('./lib/sg-pack-inspect.js');

require(path.join(__dirname, 'lib', 'sg-data-loader.js'));

const [file, ...args] = process.argv.slice(2);
const usage = 'Usage: node sg-pack-validate.js <data.json> [--strict] [--verify-hash] [--asset-root <dir>]';
if (!file || file.startsWith('--')) { console.error(usage); process.exit(2); }
const options = {};
for (let index = 0; index < args.length; index += 1) {
  const name = args[index];
  if (!['--strict', '--verify-hash', '--asset-root'].includes(name)) {
    console.error('Unknown option: ' + name);
    process.exit(2);
  }
  if (Object.prototype.hasOwnProperty.call(options, name)) {
    console.error('Duplicate option: ' + name);
    process.exit(2);
  }
  if (name === '--asset-root') {
    const value = args[index + 1];
    if (!value || value.startsWith('--')) { console.error('--asset-root requires a value'); process.exit(2); }
    options[name] = path.resolve(value);
    index += 1;
  } else options[name] = true;
}
const strict = Boolean(options['--strict']);
const verifyHash = Boolean(options['--verify-hash']);

let pack;
try {
  pack = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (error) {
  console.error('JSON parse failed: ' + error.message);
  process.exit(1);
}

const result = globalThis.SGDataLoader.validate(pack);
if (verifyHash) {
  const assets = inspectAssets(pack, path.resolve(file), { verifyHash: true, assetRoot: options['--asset-root'] });
  for (const item of assets.mismatches) {
    result.errors.push('hash mismatch: ' + item.path + ' (manifest ' + item.expected.slice(0, 14) + '… vs actual ' + item.actual.slice(0, 14) + '…)');
  }
  for (const item of assets.missing) result.errors.push('hash check failed (file unreadable or unsafe): ' + item.path + (item.error ? ' (' + item.error + ')' : ''));
}

result.errors.forEach((error) => console.error('[ERROR] ' + error));
result.warnings.forEach((warning) => console.warn('[warn]  ' + warning));

if (result.errors.length) { console.error('✖ Validation failed: ' + result.errors.length + ' error(s)'); process.exit(1); }
if (strict && result.warnings.length) { console.error('✖ Strict mode: ' + result.warnings.length + ' warning(s)'); process.exit(1); }
console.log('✔ Validation passed (' + result.warnings.length + ' warning(s))');
