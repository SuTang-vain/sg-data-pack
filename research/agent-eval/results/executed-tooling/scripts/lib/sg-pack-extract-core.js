'use strict';

/* Read-only extraction/equivalence collector used by product reports. */
class ExtractionError extends Error {
  constructor(message, kind = 'gate') {
    super(message);
    this.name = 'ExtractionError';
    this.kind = kind;
  }
}
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const acorn = require('../vendor/acorn.js');
require('./sg-data-loader.js');

function sha1File(file) {
  return 'sha1:' + crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
}

function sha256Bytes(bytes) {
  return 'sha256:' + crypto.createHash('sha256').update(bytes).digest('hex');
}

function sha256File(file) {
  return sha256Bytes(fs.readFileSync(file));
}

function sliceLiteral(source, spec, libDir) {
  const match = spec.pattern.exec(source);
  if (!match) throw new Error(`Failed to locate literal "${spec.key}": pattern did not match`);
  const start = match.index + match[0].length;
  if (spec.json) {
    const end = source.indexOf('</script>', start);
    if (end === -1) throw new Error(`Literal "${spec.key}": closing </script> tag not found`);
    return JSON.parse(source.slice(start, end).trim());
  }
  const node = acorn.parseExpressionAt(source, start, { ecmaVersion: 'latest' });
  const literalSource = source.slice(node.start, node.end);
  const context = spec.ctx || {};
  const fn = new Function(...Object.keys(context), 'return (' + literalSource + ');');
  return fn(...Object.values(context));
}

function sliceLiterals(engineSource, specs, libDir, consumedFiles) {
  const out = {};
  const cache = { __engine__: engineSource };
  for (const spec of specs || []) {
    let source = engineSource;
    if (spec.file) {
      if (!cache[spec.file]) {
        const literalFile = path.resolve(libDir, spec.file);
        const literalBytes = fs.readFileSync(literalFile);
        if (consumedFiles) consumedFiles[literalFile] = sha256Bytes(literalBytes);
        cache[spec.file] = literalBytes.toString('utf8');
      }
      source = cache[spec.file];
    }
    out[spec.key] = sliceLiteral(source, spec, libDir);
  }
  return out;
}

function deepEqual(left, right, pathName = '$', diffs = []) {
  if (left === right) return diffs;
  if (typeof left !== typeof right) {
    diffs.push(`${pathName}: type mismatch ${typeof left} vs ${typeof right}`);
    return diffs;
  }
  if (left === null || right === null || typeof left !== 'object') {
    if (left !== right) diffs.push(`${pathName}: ${JSON.stringify(left)} !== ${JSON.stringify(right)}`);
    return diffs;
  }
  if (Array.isArray(left) !== Array.isArray(right)) {
    diffs.push(`${pathName}: array/object mismatch`);
    return diffs;
  }
  if (Array.isArray(left)) {
    if (left.length !== right.length) diffs.push(`${pathName}: array length ${left.length} vs ${right.length}`);
    const length = Math.max(left.length, right.length);
    for (let i = 0; i < length; i += 1) {
      if (i < left.length && i < right.length) deepEqual(left[i], right[i], `${pathName}[${i}]`, diffs);
    }
    return diffs;
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  for (const key of leftKeys) if (!Object.prototype.hasOwnProperty.call(right, key)) diffs.push(`${pathName}.${key}: missing on right`);
  for (const key of rightKeys) if (!Object.prototype.hasOwnProperty.call(left, key)) diffs.push(`${pathName}.${key}: missing on left`);
  for (const key of leftKeys) if (Object.prototype.hasOwnProperty.call(right, key)) deepEqual(left[key], right[key], `${pathName}.${key}`, diffs);
  return diffs;
}

function resolveAssetRoot(libDir, assetDir = 'lib/assets') {
  if (typeof assetDir !== 'string' || !assetDir || /[\u0000-\u001f\u007f]/.test(assetDir)) throw new Error(`Unsafe assetDir: ${assetDir}`);
  if (path.isAbsolute(assetDir) || /^[A-Za-z]:[\\/]/.test(assetDir)) throw new Error('Extraction config assetDir must be relative to libDir');
  const libraryRoot = path.resolve(libDir);
  const root = path.resolve(libraryRoot, assetDir);
  const relative = path.relative(libraryRoot, root);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`Extraction config assetDir escapes libDir: ${assetDir}`);
  return root;
}

function assetRelativePath(assetPath, assetBase = '') {
  const normalized = assetPath.replace(/\\/g, '/');
  const normalizedBase = typeof assetBase === 'string' ? assetBase.replace(/\\/g, '/') : '';
  if (normalizedBase && normalized.startsWith(normalizedBase)) return normalized.slice(normalizedBase.length);
  return normalized.replace(/^(\.\.\/)?assets\//, '');
}

function localAssetPath(libDir, assetPath, assetDir = 'lib/assets', assetBase = '') {
  if (typeof assetPath !== 'string' || !assetPath || /[\u0000-\u001f\u007f]/.test(assetPath)) throw new Error(`Unsafe asset path: ${assetPath}`);
  const root = resolveAssetRoot(libDir, assetDir);
  const relative = assetRelativePath(assetPath, assetBase);
  if (!relative || path.isAbsolute(relative) || /^[A-Za-z]:[\\/]/.test(relative)) throw new Error(`Asset path must be relative: ${assetPath}`);
  const absolute = path.resolve(root, relative);
  const fromRoot = path.relative(root, absolute);
  if (fromRoot === '..' || fromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(fromRoot)) throw new Error(`Asset path escapes assetDir ${assetDir}: ${assetPath}`);
  if (!fs.existsSync(root)) return absolute;
  if (fs.lstatSync(root).isSymbolicLink()) throw new Error('Asset root must not be a symlink');
  let current = root;
  for (const segment of relative.split(/[\\/]/)) {
    current = path.join(current, segment);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error(`Asset path contains a symlink: ${assetPath}`);
  }
  return absolute;
}

function collectAssets(pack, libDir, consumedFiles, assetDir = 'lib/assets') {
  const found = Object.create(null);
  const assetBase = pack.meta && typeof pack.meta.assetBase === 'string' ? pack.meta.assetBase : '';
  const walk = (value) => {
    if (typeof value === 'string') {
      if (/^(https?:|data:)/i.test(value)) return;
      const match = /(\.\.\/)?assets\/[^\s"'`)]*/.exec(value);
      if (match && /\.(png|jpe?g|webp|gif|svg)$/i.test(match[0])) found[match[0]] = true;
      else if (assetBase && /\.(png|jpe?g|webp|gif|svg)$/i.test(value)) found[assetBase + value] = true;
    } else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  walk(pack);
  for (const assetPath of Object.keys(pack.assets || {})) {
    if (!/^(https?:|data:)/i.test(assetPath)) found[assetPath] = true;
  }
  const assets = {};
  for (const assetPath of Object.keys(found)) {
    const absolute = localAssetPath(libDir, assetPath, assetDir, assetBase);
    try {
      const stat = fs.statSync(absolute);
      if (consumedFiles) consumedFiles[path.resolve(absolute)] = sha256File(absolute);
      assets[assetPath] = { exists: true, bytes: stat.size, hash: sha1File(absolute) };
    } catch (_) {
      assets[assetPath] = { exists: false };
    }
  }
  return assets;
}

function equivalenceCoverage(config) {
  const extracted = (config.literals || []).map((item) => item.key);
  const mapped = (config.equivalence || []).map((item) => item.lit);
  const ignored = (config.equivalenceIgnore || []).map((item) => item.lit);
  return {
    extracted,
    mapped,
    ignored,
    unmapped: extracted.filter((key) => !mapped.includes(key) && !ignored.includes(key)),
    complete: extracted.every((key) => mapped.includes(key) || ignored.includes(key)),
  };
}

function runEquivalence(config, defaults, pack) {
  global.window = globalThis;
  const enginePath = path.resolve(config.libDir, config.engineFile);
  delete require.cache[require.resolve(enginePath)];
  require(enginePath);
  const library = globalThis[config.globalName];
  if (!library || typeof library.__fromPack !== 'function') throw new Error(`Engine does not export __fromPack (${config.globalName}); complete the engine patch first`);
  const restored = library.__fromPack(pack);
  if (!restored || typeof restored !== 'object' || Array.isArray(restored)) throw new Error('__fromPack(pack) must return an object for equivalence checks');
  const diffs = [];
  for (const mapping of config.equivalence || []) {
    if (!Object.prototype.hasOwnProperty.call(defaults, mapping.lit)) throw new Error(`Equivalence literal does not exist: ${mapping.lit}`);
    if (!Object.prototype.hasOwnProperty.call(restored, mapping.from)) throw new Error(`__fromPack(pack) did not return equivalence field: ${mapping.from}`);
    let left = defaults[mapping.lit];
    let right = restored[mapping.from];
    const sorter = config.sortKeys && config.sortKeys[mapping.lit];
    if (sorter) {
      if (!Array.isArray(left) || !Array.isArray(right)) throw new Error(`sortKeys.${mapping.lit} requires arrays on both sides`);
      left = left.slice().sort(sorter);
      right = right.slice().sort(sorter);
    }
    deepEqual(left, right, `$.${mapping.lit}`, diffs);
  }
  return { comparisons: (config.equivalence || []).length, diffs, coverage: equivalenceCoverage(config) };
}

function validateRelativeConfigPath(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Extraction config ${field} must be a non-empty string`);
  if (/[\u0000-\u001f\u007f]/.test(value) || path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)) throw new Error(`Extraction config ${field} must be a safe path relative to libDir`);
  const normalized = value.replace(/\\/g, '/');
  if (normalized.split('/').includes('..')) throw new Error(`Extraction config ${field} must not escape libDir`);
}

function validateExtractionConfig(config) {
  if (!config || typeof config !== 'object') throw new Error('Extraction config must export an object');
  for (const field of ['libId', 'libDir', 'engineFile', 'globalName']) {
    if (typeof config[field] !== 'string' || !config[field].trim()) throw new Error(`Extraction config ${field} must be a non-empty string`);
  }
  validateRelativeConfigPath(config.engineFile, 'engineFile');
  if (config.assetDir !== undefined) validateRelativeConfigPath(config.assetDir, 'assetDir');
  if (!Array.isArray(config.literals) || !config.literals.length) throw new Error('Extraction config literals must be a non-empty array');
  const literalKeys = new Set();
  for (const [index, literal] of config.literals.entries()) {
    if (!literal || typeof literal !== 'object') throw new Error(`Extraction config literals[${index}] must be an object`);
    if (typeof literal.key !== 'string' || !literal.key.trim()) throw new Error(`Extraction config literals[${index}].key must be a non-empty string`);
    if (literalKeys.has(literal.key)) throw new Error(`Extraction config literal key is duplicated: ${literal.key}`);
    literalKeys.add(literal.key);
    if (!(literal.pattern instanceof RegExp)) throw new Error(`Extraction config literal ${literal.key} pattern must be a RegExp`);
    if (literal.file !== undefined) validateRelativeConfigPath(literal.file, `literal ${literal.key} file`);
  }
  if (typeof config.buildPack !== 'function') throw new Error('Extraction config buildPack must be a function');
  if (!Array.isArray(config.equivalence)) throw new Error('Extraction config equivalence must be an array');
  if (config.equivalenceIgnore !== undefined && !Array.isArray(config.equivalenceIgnore)) throw new Error('Extraction config equivalenceIgnore must be an array');
  const accounted = new Set();
  for (const [index, mapping] of config.equivalence.entries()) {
    if (!mapping || typeof mapping !== 'object') throw new Error(`Extraction config equivalence[${index}] must be an object`);
    for (const field of ['lit', 'from']) if (typeof mapping[field] !== 'string' || !mapping[field].trim()) throw new Error(`Extraction config equivalence[${index}].${field} must be a non-empty string`);
    if (!literalKeys.has(mapping.lit)) throw new Error(`Extraction config equivalence references unknown literal: ${mapping.lit}`);
    if (accounted.has(mapping.lit)) throw new Error(`Extraction config literal has duplicate equivalence coverage: ${mapping.lit}`);
    accounted.add(mapping.lit);
  }
  for (const [index, ignored] of (config.equivalenceIgnore || []).entries()) {
    if (!ignored || typeof ignored !== 'object') throw new Error(`Extraction config equivalenceIgnore[${index}] must be an object`);
    if (typeof ignored.lit !== 'string' || !ignored.lit.trim()) throw new Error(`Extraction config equivalenceIgnore[${index}].lit must be a non-empty string`);
    if (typeof ignored.reason !== 'string' || !ignored.reason.trim()) throw new Error(`Extraction config equivalenceIgnore[${index}].reason must be a non-empty string`);
    if (!literalKeys.has(ignored.lit)) throw new Error(`Extraction config equivalenceIgnore references unknown literal: ${ignored.lit}`);
    if (accounted.has(ignored.lit)) throw new Error(`Extraction config literal has duplicate equivalence coverage: ${ignored.lit}`);
    accounted.add(ignored.lit);
  }
  const missing = [...literalKeys].filter((key) => !accounted.has(key));
  if (missing.length) throw new Error(`Extraction config literals lack equivalence coverage: ${missing.join(', ')}; map them or use equivalenceIgnore with a reason`);
  return config;
}

function runExtractionUnsafe(configPath, options = {}) {
  const modulesBefore = new Set(Object.keys(require.cache));
  const absoluteConfig = path.resolve(configPath);
  const consumedFiles = {};
  consumedFiles[absoluteConfig] = sha256File(absoluteConfig);
  delete require.cache[require.resolve(absoluteConfig)];
  let config;
  try {
    config = validateExtractionConfig(require(absoluteConfig));
  } catch (error) {
    throw new ExtractionError(error.message, 'input');
  }
  if (options.expectedLibDir) {
    const configuredLibDir = fs.realpathSync(path.resolve(config.libDir));
    const expectedLibDir = fs.realpathSync(path.resolve(options.expectedLibDir));
    if (configuredLibDir !== expectedLibDir) {
      throw new ExtractionError(`Extraction config libDir does not match report library: ${config.libDir}`, 'input');
    }
  }
  if (options.expectedLibId && config.libId !== options.expectedLibId) {
    throw new ExtractionError(`Extraction config libId does not match Data Pack meta.id: ${config.libId}`, 'input');
  }
  const enginePath = path.resolve(config.libDir, config.engineFile);
  const engineBytes = fs.readFileSync(enginePath);
  consumedFiles[enginePath] = sha256Bytes(engineBytes);
  const engineSource = engineBytes.toString('utf8');
  const defaults = sliceLiterals(engineSource, config.literals, config.libDir, consumedFiles);
  const pack = config.buildPack(defaults);
  if (!pack || typeof pack !== 'object' || Array.isArray(pack)) throw new Error('Extraction config buildPack must return an object');
  pack.schemaVersion = config.schemaVersion || '1.3';
  pack.meta = Object.assign({ id: config.libId, generatedBy: 'sg-data-pack: ' + path.basename(absoluteConfig) }, config.meta || {}, pack.meta || {});
  const declaredAssets = pack.assets && typeof pack.assets === 'object' && !Array.isArray(pack.assets) ? pack.assets : {};
  const scannedAssets = collectAssets(pack, config.libDir, consumedFiles, config.assetDir || 'lib/assets');
  pack.assets = Object.fromEntries([...new Set([...Object.keys(declaredAssets), ...Object.keys(scannedAssets)])].map((assetPath) => [
    assetPath,
    /^(https?:|data:)/i.test(assetPath)
      ? declaredAssets[assetPath]
      : Object.assign({}, declaredAssets[assetPath] || {}, scannedAssets[assetPath] || { exists: false }),
  ]));
  const validation = globalThis.SGDataLoader.validate(pack);
  const domain = typeof config.domainChecks === 'function' ? (config.domainChecks(pack) || {}) : {};
  const domainErrors = Array.isArray(domain) ? domain : domain.errors || [];
  const domainWarnings = Array.isArray(domain) ? [] : domain.warnings || [];
  validation.errors.push(...domainErrors.map((item) => '[domain] ' + item));
  validation.warnings.push(...domainWarnings.map((item) => '[domain] ' + item));
  let equivalence = { comparisons: 0, diffs: [], coverage: equivalenceCoverage(config) };
  if (!validation.errors.length) equivalence = runEquivalence(config, defaults, pack);
  for (const moduleFile of Object.keys(require.cache)) {
    if (modulesBefore.has(moduleFile) || !fs.existsSync(moduleFile) || !fs.statSync(moduleFile).isFile()) continue;
    consumedFiles[path.resolve(moduleFile)] = sha256File(moduleFile);
  }
  return {
    configPath: absoluteConfig,
    config,
    defaults,
    pack,
    validation,
    equivalence,
    consumedFiles,
    inventory: {
      literals: Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, Array.isArray(value) ? value.length : Object.keys(value || {}).length])),
      assets: Object.keys(pack.assets || {}).length,
    },
  };
}

function runExtraction(configPath, options = {}) {
  try {
    return runExtractionUnsafe(configPath, options);
  } catch (error) {
    if (error instanceof ExtractionError) throw error;
    const inputLike = error && ['ENOENT', 'EACCES', 'EISDIR', 'MODULE_NOT_FOUND', 'SyntaxError'].includes(error.code || error.name);
    throw new ExtractionError(error.message, inputLike ? 'input' : 'gate');
  }
}

module.exports = {
  ExtractionError,
  sliceLiteral,
  sliceLiterals,
  deepEqual,
  resolveAssetRoot,
  localAssetPath,
  collectAssets,
  equivalenceCoverage,
  runEquivalence,
  validateExtractionConfig,
  runExtraction,
};
