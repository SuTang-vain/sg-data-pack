'use strict';

/* Read-only Data Pack inventory, validation, and local asset integrity collector. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
require('./sg-data-loader.js');

const loader = globalThis.SGDataLoader;

function sha256Bytes(bytes) {
  return 'sha256:' + crypto.createHash('sha256').update(bytes).digest('hex');
}

function sha1File(file) {
  return 'sha1:' + crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
}

function sha256File(file) {
  return 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function countObject(value) {
  return isObject(value) ? Object.keys(value).length : 0;
}

function packInventory(pack) {
  return {
    entities: countObject(pack.entities),
    aliases: countObject(pack.aliases),
    relationTypes: countObject(pack.relationTypes),
    heroRelTypes: countObject(pack.heroRelTypes),
    relations: Array.isArray(pack.relations) ? pack.relations.length : 0,
    stages: Array.isArray(pack.stages) ? pack.stages.length : 0,
    contents: countObject(pack.contents),
    domainKeys: countObject(pack.domain),
    assets: countObject(pack.assets),
    sameAs: Array.isArray(pack.sameAs) ? pack.sameAs.length : 0,
    provenanceEntities: countObject(pack.provenance && pack.provenance.entities),
    derivations: countObject(pack.derivations),
  };
}

function readPack(file) {
  const bytes = fs.readFileSync(file);
  return { bytes, digest: sha256Bytes(bytes), pack: JSON.parse(bytes.toString('utf8')) };
}

function assetFilePath(dataFile, assetKey, assetRoot) {
  if (typeof assetKey !== 'string' || !assetKey || /[\u0000-\u001f\u007f]/.test(assetKey)) {
    throw new Error('unsafe asset path');
  }
  const root = assetRoot
    ? path.resolve(assetRoot)
    : path.resolve(path.dirname(dataFile), '..', 'assets');
  const relative = assetKey.replace(/^(\.\.\/)?assets\//, '');
  if (path.isAbsolute(relative) || /^[A-Za-z]:[\\/]/.test(relative)) throw new Error('asset path must be relative');
  const resolved = path.resolve(root, relative);
  const fromRoot = path.relative(root, resolved);
  if (fromRoot === '..' || fromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(fromRoot)) {
    throw new Error('asset path escapes the asset root');
  }
  const rootStat = fs.lstatSync(root);
  if (rootStat.isSymbolicLink()) throw new Error('asset root must not be a symlink');
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('asset path contains a symlink component');
  }
  const physicalRoot = fs.realpathSync(root);
  const physicalFile = fs.realpathSync(resolved);
  const physicalRelative = path.relative(physicalRoot, physicalFile);
  if (physicalRelative === '..' || physicalRelative.startsWith(`..${path.sep}`) || path.isAbsolute(physicalRelative)) {
    throw new Error('asset symlink escapes the asset root');
  }
  return physicalFile;
}

function inspectAssets(pack, dataFile, options = {}) {
  const consumedFiles = options.consumedFiles || null;
  const checked = [];
  const missing = [];
  const mismatches = [];
  const skipped = [];
  if (!options.verifyHash) {
    return {
      enabled: false,
      checked,
      missing,
      mismatches,
      skipped: Object.keys(isObject(pack.assets) ? pack.assets : {}).map((assetKey) => ({ path: assetKey, reason: 'verification-not-requested' })),
      summary: { checked: 0, passed: 0, missing: 0, mismatches: 0, skipped: Object.keys(isObject(pack.assets) ? pack.assets : {}).length },
    };
  }
  const assets = isObject(pack.assets) ? pack.assets : {};
  for (const [assetKey, manifest] of Object.entries(assets)) {
    if (!manifest || !manifest.hash) {
      skipped.push({ path: assetKey, reason: 'missing-manifest-hash' });
      continue;
    }
    if (/^(https?:|data:)/i.test(assetKey)) {
      skipped.push({ path: assetKey, reason: 'remote-or-data-uri' });
      continue;
    }
    let file = null;
    try {
      file = assetFilePath(dataFile, assetKey, options.assetRoot);
      if (consumedFiles) consumedFiles[file] = sha256File(file);
      const actualHash = sha1File(file);
      const item = { path: assetKey, file, expected: manifest.hash, actual: actualHash, status: actualHash === manifest.hash ? 'passed' : 'mismatch' };
      checked.push(item);
      if (actualHash !== manifest.hash) mismatches.push(item);
    } catch (error) {
      const item = { path: assetKey, file, expected: manifest.hash, status: 'missing', error: error.message };
      missing.push(item);
    }
  }
  return {
    enabled: Boolean(options.verifyHash),
    checked,
    missing,
    mismatches,
    skipped,
    summary: {
      checked: checked.length,
      passed: checked.filter((item) => item.status === 'passed').length,
      missing: missing.length,
      mismatches: mismatches.length,
      skipped: skipped.length,
    },
  };
}

function inspectPack({ dataFile, verifyHash = false, assetRoot } = {}) {
  if (!dataFile) throw new Error('dataFile is required');
  const loaded = readPack(dataFile);
  const validation = loader.validate(loaded.pack);
  const consumedFiles = { [path.resolve(dataFile)]: loaded.digest };
  const assets = inspectAssets(loaded.pack, dataFile, { verifyHash, assetRoot, consumedFiles });
  return {
    dataFile: path.resolve(dataFile),
    digest: loaded.digest,
    pack: loaded.pack,
    inventory: packInventory(loaded.pack),
    validation,
    assets,
    consumedFiles,
  };
}

module.exports = { sha256Bytes, packInventory, readPack, inspectAssets, inspectPack };
