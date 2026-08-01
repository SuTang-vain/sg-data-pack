#!/usr/bin/env node
/*
 * sg-pack-extract.js — SG Data Pack extraction / validation / equivalence testing
 *
 * Usage:
 *   node sg-pack-extract.js <path/to/config.js>
 *   node sg-pack-extract.js <path/to/config.js> --check
 *
 * The shared core defaults generated packs with: config.schemaVersion || '1.3'.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { runExtraction, deepEqual } = require('./lib/sg-pack-extract-core.js');

const [name, ...args] = process.argv.slice(2);
const allowedFlags = new Set(['--check', '--compare-existing', '--check-output', '--force']);
const seen = new Set();
if (!name || name.startsWith('--')) {
  console.error('Usage: node sg-pack-extract.js <path/to/config.js> [--check] [--compare-existing|--check-output] [--force]');
  process.exit(2);
}
for (const flag of args) {
  if (!allowedFlags.has(flag)) {
    console.error('Unknown option: ' + flag);
    process.exit(2);
  }
  if (seen.has(flag)) {
    console.error('Duplicate option: ' + flag);
    process.exit(2);
  }
  seen.add(flag);
}
if (seen.has('--compare-existing') && seen.has('--check-output')) {
  console.error('--compare-existing and --check-output are aliases; use only one');
  process.exit(2);
}
const compareExisting = seen.has('--compare-existing') || seen.has('--check-output');
const checkOnly = seen.has('--check') || compareExisting;
const force = seen.has('--force');
if (force && checkOnly) {
  console.error('--force is only valid when writing extract outputs');
  process.exit(2);
}
const configPath = path.resolve(process.cwd(), name.endsWith('.js') ? name : name + '.config.js');
if (!fs.existsSync(configPath)) {
  console.error('Config file not found: ' + configPath);
  process.exit(2);
}

let extraction;
try {
  extraction = runExtraction(configPath);
} catch (error) {
  console.error('Extraction failed: ' + error.message);
  process.exit(error.kind === 'input' ? 2 : 1);
}
const { config, defaults, pack, validation, equivalence } = extraction;

console.log('== [' + config.libId + '] 1/4 Slicing engine default-data literals');
for (const spec of config.literals) {
  const value = defaults[spec.key];
  const count = Array.isArray(value) ? value.length : Object.keys(value || {}).length;
  console.log('   - ' + spec.key + ': ' + count + ' entries');
}

console.log('== 2/4 Building spec-compliant Data Pack');
const missing = Object.entries(pack.assets || {}).filter(([, asset]) => !asset.exists);
console.log('   - entities: ' + Object.keys(pack.entities || {}).length +
  ', relations: ' + (pack.relations || []).length +
  ', stages: ' + (pack.stages || []).length +
  ', assets: ' + Object.keys(pack.assets || {}).length + (missing.length ? ' (missing ' + missing.length + ')' : ''));

console.log('== 3/4 SGDataLoader validation' + (config.domainChecks ? ' + domain library-level checks' : ''));
validation.errors.forEach((error) => console.error('   [ERROR] ' + error));
validation.warnings.forEach((warning) => console.warn('   [warn]  ' + warning));
if (validation.errors.length) {
  console.error('Validation failed; aborting.');
  process.exit(1);
}

console.log('== 4/4 Equivalence test (fromPack(pack) vs engine defaults)');
if (equivalence.diffs.length) {
  equivalence.diffs.slice(0, 20).forEach((diff) => console.error('   [DIFF] ' + diff));
  console.error('Equivalence test failed: ' + equivalence.diffs.length + ' differences; aborting.');
  process.exit(1);
}
const coverage = equivalence.coverage || { extracted: [], mapped: [], ignored: [], unmapped: [], complete: false };
console.log('   - all ' + equivalence.comparisons + ' deep comparisons passed; configured equivalence surface is lossless');
console.log('   - coverage: ' + coverage.mapped.length + ' mapped, ' + coverage.ignored.length + ' explicitly ignored, ' + coverage.unmapped.length + ' unmapped');

const dataDir = path.join(config.libDir, 'lib', 'data');
const dataPath = path.join(dataDir, 'data.json');
let existingDiffs = null;
if (compareExisting) {
  if (!fs.existsSync(dataPath)) {
    console.log('== Existing output drift: NOT_ASSESSED (data.json does not exist)');
  } else {
    try {
      const existing = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      existingDiffs = deepEqual(existing, pack, '$', []);
    } catch (error) {
      console.error('Existing data.json cannot be compared: ' + error.message);
      process.exit(2);
    }
    if (existingDiffs.length) {
      existingDiffs.slice(0, 20).forEach((diff) => console.error('   [OUTPUT-DRIFT] ' + diff));
      console.error('Existing output drift detected: ' + existingDiffs.length + ' differences');
      process.exit(1);
    }
    console.log('== Existing output drift: passed (data.json matches the fresh in-memory pack)');
  }
}

function assertOutputPathSafe(directory, files) {
  if (fs.existsSync(directory) && fs.lstatSync(directory).isSymbolicLink()) throw new Error('data output directory must not be a symlink');
  for (const file of files) {
    if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new Error('extract output must not be a symlink: ' + file);
  }
}

function atomicWriteSet(outputs) {
  const temporary = outputs.map(({ file, bytes }) => ({
    file,
    bytes,
    temp: path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`),
    backup: null,
  }));
  const installed = [];
  try {
    for (const output of temporary) {
      let fd;
      try {
        fd = fs.openSync(output.temp, 'wx', 0o600);
        fs.writeFileSync(fd, output.bytes);
        fs.fsyncSync(fd);
      } finally {
        if (fd !== undefined) fs.closeSync(fd);
      }
    }
    for (const output of temporary) {
      if (!fs.existsSync(output.file)) continue;
      output.backup = `${output.file}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.bak`;
      fs.renameSync(output.file, output.backup);
    }
    for (const output of temporary) {
      fs.renameSync(output.temp, output.file);
      installed.push(output.file);
    }
    for (const output of temporary) if (output.backup) fs.unlinkSync(output.backup);
  } catch (error) {
    for (const output of temporary) { try { if (fs.existsSync(output.temp)) fs.unlinkSync(output.temp); } catch (_) { /* absent */ } }
    for (const file of installed) { try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch (_) { /* absent */ } }
    const rollbackErrors = [];
    for (const output of temporary) {
      if (!output.backup) continue;
      try { if (fs.existsSync(output.backup)) fs.renameSync(output.backup, output.file); } catch (rollbackError) { rollbackErrors.push(rollbackError.message); }
    }
    if (rollbackErrors.length) throw new Error(error.message + '; rollback incomplete: ' + rollbackErrors.join('; '));
    throw error;
  }
}

if (!checkOnly) {
  fs.mkdirSync(dataDir, { recursive: true });
  const json = JSON.stringify(pack, null, 2) + '\n';
  if (fs.existsSync(dataPath)) {
    let existing;
    try { existing = JSON.parse(fs.readFileSync(dataPath, 'utf8')); }
    catch (error) { console.error('Existing data.json cannot be safely replaced: ' + error.message); process.exit(2); }
    const diffs = deepEqual(existing, pack, '$', []);
    if (diffs.length && !force) {
      diffs.slice(0, 20).forEach((diff) => console.error('   [OUTPUT-DRIFT] ' + diff));
      console.error('Refusing to overwrite an existing divergent data.json; review the drift or rerun with --force');
      process.exit(1);
    }
  }

  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, 'lib', 'data-pack.schema.json'), 'utf8'));
  schema.$id = 'https://sg.local/' + config.libId + '/data.schema.json';
  schema.title = 'SG Data Pack v1.3 — ' + config.libId + ' data contract';
  if (config.domainSchema) schema.properties.domain = config.domainSchema;
  const outputs = [
    { file: dataPath, bytes: json },
    { file: path.join(dataDir, 'data.js'), bytes: '// @generated by sg-data-pack — do not edit by hand; regenerate from the reviewed Data Pack source\n' + 'globalThis.SG_DATA_PACK = ' + JSON.stringify(pack) + ';\n' },
    { file: path.join(dataDir, 'data.schema.json'), bytes: JSON.stringify(schema, null, 2) + '\n' },
  ];
  try {
    assertOutputPathSafe(dataDir, outputs.map((item) => item.file));
    atomicWriteSet(outputs);
  } catch (error) {
    console.error('Could not install extract outputs: ' + error.message);
    process.exit(2);
  }

  console.log('Written:');
  outputs.forEach((output) => console.log('   - ' + output.file));
}
console.log('✔ [' + config.libId + '] done');
