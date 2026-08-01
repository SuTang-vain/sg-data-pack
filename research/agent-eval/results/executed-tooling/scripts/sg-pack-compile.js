#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { sameFile } = require('./lib/sg-path-policy.js');
require('./lib/sg-data-loader.js');

function usage() {
  console.error('Usage: sg-data-pack compile <data.json> [--domain-schema <fragment.json>] [--check]');
  process.exit(2);
}

const argv = process.argv.slice(2);
const fileArg = argv.shift();
if (!fileArg || fileArg.startsWith('--')) usage();
let checkOnly = false;
let domainSchemaArg = null;
while (argv.length) {
  const argument = argv.shift();
  if (argument === '--check' && !checkOnly) checkOnly = true;
  else if (argument === '--domain-schema' && domainSchemaArg === null && argv.length && !argv[0].startsWith('--')) domainSchemaArg = argv.shift();
  else usage();
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}
function equivalent(left, right) { return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right)); }
function readRegularJson(file, label) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const file = path.resolve(fileArg);
const directory = path.dirname(file);
const dataJs = path.join(directory, 'data.js');
const schemaFile = path.join(directory, 'data.schema.json');
const domainSchemaFile = domainSchemaArg === null ? null : path.resolve(domainSchemaArg);
if (sameFile(file, dataJs) || sameFile(file, schemaFile) || sameFile(dataJs, schemaFile)
  || domainSchemaFile && [file, dataJs, schemaFile].some((candidate) => sameFile(domainSchemaFile, candidate))) {
  console.error('compile input and output paths must be distinct');
  process.exit(2);
}
try {
  const pack = readRegularJson(file, 'data.json');
  const validation = globalThis.SGDataLoader.validate(pack);
  if (validation.errors.length) throw new Error('Data Pack is invalid: ' + validation.errors.join('; '));
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, 'lib', 'data-pack.schema.json'), 'utf8'));
  const baseDomainSchema = schema.properties.domain;
  if (domainSchemaFile) {
    const fragment = readRegularJson(domainSchemaFile, 'domain schema fragment');
    if (typeof fragment !== 'boolean' && (!fragment || typeof fragment !== 'object' || Array.isArray(fragment))) throw new Error('domain schema fragment must be a JSON object or boolean schema');
    schema.properties.domain = fragment;
  } else if (fs.existsSync(schemaFile)) {
    const existing = readRegularJson(schemaFile, 'existing data.schema.json');
    const hasExistingDomain = existing && existing.properties && Object.prototype.hasOwnProperty.call(existing.properties, 'domain');
    const existingDomain = hasExistingDomain ? existing.properties.domain : undefined;
    if (hasExistingDomain && !equivalent(existingDomain, baseDomainSchema)) {
      throw new Error(`existing data.schema.json contains a custom domain schema; rerun with --domain-schema <fragment.json> to preserve it (${schemaFile})`);
    }
  }
  schema.$id = `https://sg.local/${pack.meta.id}/data.schema.json`;
  schema.title = `SG Data Pack ${pack.schemaVersion} — ${pack.meta.id} data contract`;
  const outputs = [
    { file: dataJs, bytes: Buffer.from('// @generated from reviewed data.json by sg-data-pack compile\n' + 'globalThis.SG_DATA_PACK = ' + JSON.stringify(pack) + ';\n') },
    { file: schemaFile, bytes: Buffer.from(JSON.stringify(schema, null, 2) + '\n') },
  ];
  for (const output of outputs) if (fs.existsSync(output.file) && fs.lstatSync(output.file).isSymbolicLink()) throw new Error('compile output must not be a symlink: ' + output.file);
  if (checkOnly) {
    const drift = outputs.filter((output) => !fs.existsSync(output.file) || !fs.readFileSync(output.file).equals(output.bytes));
    if (drift.length) {
      drift.forEach((output) => console.error('compile output drift: ' + output.file));
      process.exit(1);
    }
    console.log('✔ Compiled outputs match reviewed data.json');
    process.exit(0);
  }
  const staged = outputs.map((output) => ({ ...output, temp: path.join(directory, `.${path.basename(output.file)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`), backup: null }));
  try {
    for (const output of staged) { fs.writeFileSync(output.temp, output.bytes, { flag: 'wx', mode: 0o600 }); }
    for (const output of staged) if (fs.existsSync(output.file)) { output.backup = `${output.file}.${process.pid}.bak`; fs.renameSync(output.file, output.backup); }
    for (const output of staged) fs.renameSync(output.temp, output.file);
    for (const output of staged) if (output.backup) fs.unlinkSync(output.backup);
  } catch (error) {
    for (const output of staged) { try { fs.rmSync(output.temp, { force: true }); } catch (_) { /* absent */ } }
    for (const output of staged) {
      try { if (output.backup) { fs.rmSync(output.file, { force: true }); fs.renameSync(output.backup, output.file); } } catch (_) { /* reported below */ }
    }
    throw error;
  }
  outputs.forEach((output) => console.log('compiled: ' + output.file));
} catch (error) {
  console.error('compile: ' + error.message);
  process.exit(error instanceof SyntaxError || error.code === 'ENOENT' ? 2 : 1);
}
