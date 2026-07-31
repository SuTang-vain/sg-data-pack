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

function localAssetPath(libDir, assetPath) {
  if (typeof assetPath !== 'string' || !assetPath || /[\u0000-\u001f\u007f]/.test(assetPath)) throw new Error(`Unsafe asset path: ${assetPath}`);
  const root = path.resolve(libDir, 'lib', 'assets');
  const relative = assetPath.replace(/^(\.\.\/)?assets\//, '');
  if (path.isAbsolute(relative) || /^[A-Za-z]:[\\/]/.test(relative)) throw new Error(`Asset path must be relative: ${assetPath}`);
  const absolute = path.resolve(root, relative);
  const fromRoot = path.relative(root, absolute);
  if (fromRoot === '..' || fromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(fromRoot)) throw new Error(`Asset path escapes lib/assets: ${assetPath}`);
  if (!fs.existsSync(root)) return absolute;
  if (fs.lstatSync(root).isSymbolicLink()) throw new Error('Asset root must not be a symlink');
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error(`Asset path contains a symlink: ${assetPath}`);
  }
  return absolute;
}

function collectAssets(pack, libDir, consumedFiles) {
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
  const assets = {};
  for (const assetPath of Object.keys(found)) {
    const absolute = localAssetPath(libDir, assetPath);
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

function runEquivalence(config, defaults, pack) {
  global.window = globalThis;
  const enginePath = path.resolve(config.libDir, config.engineFile);
  delete require.cache[require.resolve(enginePath)];
  require(enginePath);
  const library = globalThis[config.globalName];
  if (!library || typeof library.__fromPack !== 'function') throw new Error(`Engine does not export __fromPack (${config.globalName}); complete the engine patch first`);
  const restored = library.__fromPack(pack);
  const diffs = [];
  for (const mapping of config.equivalence || []) {
    let left = defaults[mapping.lit];
    let right = restored[mapping.from];
    const sorter = config.sortKeys && config.sortKeys[mapping.lit];
    if (sorter) {
      left = left.slice().sort(sorter);
      right = right.slice().sort(sorter);
    }
    deepEqual(left, right, `$.${mapping.lit}`, diffs);
  }
  return { comparisons: (config.equivalence || []).length, diffs };
}

function validateExtractionConfig(config) {
  if (!config || typeof config !== 'object') throw new Error('Extraction config must export an object');
  for (const field of ['libId', 'libDir', 'engineFile', 'globalName']) {
    if (typeof config[field] !== 'string' || !config[field].trim()) throw new Error(`Extraction config ${field} must be a non-empty string`);
  }
  if (!Array.isArray(config.literals) || !config.literals.length) throw new Error('Extraction config literals must be a non-empty array');
  if (typeof config.buildPack !== 'function') throw new Error('Extraction config buildPack must be a function');
  if (!Array.isArray(config.equivalence) || !config.equivalence.length) throw new Error('Extraction config equivalence must be a non-empty array');
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
  pack.schemaVersion = config.schemaVersion || '1.3';
  pack.meta = Object.assign({ id: config.libId, generatedBy: 'sg-data-pack: ' + path.basename(absoluteConfig) }, config.meta || {}, pack.meta || {});
  pack.assets = Object.assign(collectAssets(pack, config.libDir, consumedFiles), pack.assets || {});
  const validation = globalThis.SGDataLoader.validate(pack);
  const domain = typeof config.domainChecks === 'function' ? (config.domainChecks(pack) || {}) : {};
  const domainErrors = Array.isArray(domain) ? domain : domain.errors || [];
  const domainWarnings = Array.isArray(domain) ? [] : domain.warnings || [];
  validation.errors.push(...domainErrors.map((item) => '[domain] ' + item));
  validation.warnings.push(...domainWarnings.map((item) => '[domain] ' + item));
  let equivalence = { comparisons: 0, diffs: [] };
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

module.exports = { ExtractionError, sliceLiteral, sliceLiterals, deepEqual, collectAssets, runEquivalence, validateExtractionConfig, runExtraction };
