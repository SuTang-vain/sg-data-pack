#!/usr/bin/env node
/*
 * sg-pack-validate.js — standalone Data Pack validation CLI
 * Usage: node sg-pack-validate.js <path/to/data.json> [--strict] [--verify-hash]
 *   --strict:      warnings also fail (exit 1)
 *   --verify-hash: recompute sha1 of local assets and compare against the manifest
 */
'use strict';
const fs = require('fs');
const path = require('path');

require(path.join(__dirname, 'lib', 'sg-data-loader.js'));

const file = process.argv[2];
const strict = process.argv.includes('--strict');
const verifyHash = process.argv.includes('--verify-hash');
if (!file) { console.error('Usage: node sg-pack-validate.js <data.json> [--strict] [--verify-hash]'); process.exit(2); }

let pack;
try {
  pack = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (e) {
  console.error('JSON parse failed: ' + e.message);
  process.exit(1);
}

const r = globalThis.SGDataLoader.validate(pack);

/* --verify-hash: recompute sha1 of local assets and compare (detects replaced/tampered files) */
if (verifyHash && pack.assets && typeof pack.assets === 'object') {
  const crypto = require('crypto');
  const libBase = path.resolve(path.dirname(file), '..'); // <lib>/lib
  for (const [p, a] of Object.entries(pack.assets)) {
    if (!a || !a.hash || /^https?:\/\//i.test(p)) continue;
    const abs = path.join(libBase, 'assets', p.replace(/^(\.\.\/)?assets\//, ''));
    try {
      const actual = 'sha1:' + crypto.createHash('sha1').update(fs.readFileSync(abs)).digest('hex');
      if (actual !== a.hash) r.errors.push('hash mismatch: ' + p + ' (manifest ' + a.hash.slice(0, 14) + '… vs actual ' + actual.slice(0, 14) + '…)');
    } catch (_) {
      r.errors.push('hash check failed (file unreadable): ' + p);
    }
  }
}

r.errors.forEach(e => console.error('[ERROR] ' + e));
r.warnings.forEach(w => console.warn('[warn]  ' + w));

if (r.errors.length) { console.error('✖ Validation failed: ' + r.errors.length + ' error(s)'); process.exit(1); }
if (strict && r.warnings.length) { console.error('✖ Strict mode: ' + r.warnings.length + ' warning(s)'); process.exit(1); }
console.log('✔ Validation passed (' + r.warnings.length + ' warning(s))');
