#!/usr/bin/env node
/*
 * sg-pack-extract.js — SG Data Pack extraction / validation / equivalence testing in one tool
 *
 * Usage:
 *   node sg-pack-extract.js <path/to/xxx.config.js>           Extract and write data.json / data.js / data.schema.json, then validate + equivalence-test
 *   node sg-pack-extract.js <path/to/xxx.config.js> --check   Validate + equivalence-test only (no writes)
 *
 * Config (CommonJS module) must export:
 *   {
 *     libId: 'sandadui-graph-ts',
 *     libDir: '/abs/path/to/sandadui-graph-ts',
 *     engineFile: 'lib/src/sandadui.js',        // relative to libDir
 *     globalName: 'SanDuiLibrary',               // engine global name (for equivalence test)
 *     literals: [                                 // default-data literals to slice from the engine
 *       { key: 'chars', pattern: /var chars = \(options && options\.chars\) \|\|/, ctx: { IMG: '../assets/' } }
 *     ],
 *     meta: { title, hero, source },              // pack.meta additions
 *     buildPack(defaults) -> pack,                // literals -> spec-compliant pack
 *     equivalence: [                              // equivalence mapping: fromPack(pack)[fromKey] vs defaults[litKey] (deep compare)
 *       { lit: 'chars', from: 'chars' }, ...
 *     ],
 *     sortKeys: { allEdges: edgeSortKey },        // optional: sort before comparing
 *     domainChecks(pack) -> {errors, warnings},   // optional: library-level domain validation hook
 *     domainSchema: {...}                         // optional: library-level domain extension schema (written to data.schema.json)
 *   }
 */
'use strict';
const fs = require('fs');
const path = require('path');
const acorn = require('./vendor/acorn.js');

require('./lib/sg-data-loader.js'); // mounts globalThis.SGDataLoader

/* ---------- Literal slicing ---------- */
function sliceLiteral(src, spec) {
  const m = spec.pattern.exec(src);
  if (!m) throw new Error('Failed to locate literal "' + spec.key + '": pattern did not match');
  const start = m.index + m[0].length;
  if (spec.json) {
    // JSON mode: read from match position to the next </script>, parse as JSON
    const end = src.indexOf('</script>', start);
    if (end === -1) throw new Error('Literal "' + spec.key + '": closing </script> tag not found');
    return JSON.parse(src.slice(start, end).trim());
  }
  const node = acorn.parseExpressionAt(src, start, { ecmaVersion: 'latest' });
  const literalSrc = src.slice(node.start, node.end);
  const ctx = spec.ctx || {};
  const fn = new Function(...Object.keys(ctx), 'return (' + literalSrc + ');');
  return fn(...Object.values(ctx));
}

function sliceLiterals(engineSrc, specs, libDir) {
  const out = {};
  const fileCache = { __engine__: engineSrc };
  for (const spec of specs) {
    let src = engineSrc;
    if (spec.file) {
      if (!fileCache[spec.file]) {
        fileCache[spec.file] = fs.readFileSync(path.join(libDir, spec.file), 'utf8');
      }
      src = fileCache[spec.file];
    }
    out[spec.key] = sliceLiteral(src, spec);
  }
  return out;
}

/* ---------- Deep equality (object keys unordered, arrays ordered) ---------- */
function deepEqual(a, b, pathStr, diffs) {
  pathStr = pathStr || '$';
  diffs = diffs || [];
  if (a === b) return diffs;
  if (typeof a !== typeof b) { diffs.push(pathStr + ': type mismatch ' + typeof a + ' vs ' + typeof b); return diffs; }
  if (a === null || b === null || typeof a !== 'object') {
    if (a !== b) diffs.push(pathStr + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b));
    return diffs;
  }
  if (Array.isArray(a) !== Array.isArray(b)) { diffs.push(pathStr + ': array/object mismatch'); return diffs; }
  if (Array.isArray(a)) {
    if (a.length !== b.length) { diffs.push(pathStr + ': array length ' + a.length + ' vs ' + b.length); return diffs; }
    for (let i = 0; i < a.length; i++) deepEqual(a[i], b[i], pathStr + '[' + i + ']', diffs);
    return diffs;
  }
  const ka = Object.keys(a), kb = Object.keys(b);
  for (const k of ka) if (!(k in b)) diffs.push(pathStr + '.' + k + ': missing on right');
  for (const k of kb) if (!(k in a)) diffs.push(pathStr + '.' + k + ': missing on left');
  for (const k of ka) if (k in b) deepEqual(a[k], b[k], pathStr + '.' + k, diffs);
  return diffs;
}

/* ---------- Asset scanning (with sha1 hash) ---------- */
function sha1File(abs) {
  return 'sha1:' + require('crypto').createHash('sha1').update(fs.readFileSync(abs)).digest('hex');
}

function collectAssets(pack, libDir) {
  const found = {};
  const assetBase = (pack.meta && typeof pack.meta.assetBase === 'string') ? pack.meta.assetBase : '';
  (function walk(v) {
    if (typeof v === 'string') {
      const m = /(\.\.\/)?assets\/[^\s"'`)\]]+/.exec(v);
      if (m) { found[m[0]] = true; return; }
      // with assetBase declared, bare-filename assets are also scanned
      if (assetBase && /\.(png|jpe?g|webp|gif|svg)$/i.test(v) && !/^https?:\/\//i.test(v) && !/^data:/.test(v)) {
        found[assetBase + v] = true;
      }
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  })(pack);
  const assets = {};
  for (const p of Object.keys(found)) {
    const rel = p.replace(/^(\.\.\/)?assets\//, '');
    const abs = path.join(libDir, 'lib', 'assets', rel);
    let entry = { exists: false };
    try {
      const st = fs.statSync(abs);
      entry = { exists: true, bytes: st.size, hash: sha1File(abs) };
    } catch (_) { /* missing */ }
    assets[p] = entry;
  }
  return assets;
}

/* ---------- Equivalence test ---------- */
function runEquivalence(config, defaults, pack) {
  // Load the patched engine (IIFE only defines functions; never touches the DOM)
  global.window = globalThis;
  delete require.cache[require.resolve(path.join(config.libDir, config.engineFile))];
  require(path.join(config.libDir, config.engineFile));
  const lib = globalThis[config.globalName];
  if (!lib || typeof lib.__fromPack !== 'function') {
    throw new Error('Engine does not export __fromPack (' + config.globalName + '); complete the engine patch first');
  }
  const restored = lib.__fromPack(pack);
  const allDiffs = [];
  for (const map of config.equivalence) {
    let left = defaults[map.lit];
    let right = restored[map.from];
    const sorter = config.sortKeys && config.sortKeys[map.lit];
    if (sorter) {
      left = left.slice().sort(sorter);
      right = right.slice().sort(sorter);
    }
    const diffs = deepEqual(left, right, '$.' + map.lit);
    allDiffs.push(...diffs);
  }
  return allDiffs;
}

/* ---------- Main ---------- */
function main() {
  const name = process.argv[2];
  const checkOnly = process.argv.includes('--check');
  if (!name) { console.error('Usage: node sg-pack-extract.js <path/to/config.js> [--check]'); process.exit(2); }
  const configPath = path.resolve(process.cwd(), name.endsWith('.js') ? name : name + '.config.js');
  if (!fs.existsSync(configPath)) { console.error('Config file not found: ' + configPath); process.exit(2); }
  const config = require(configPath);

  const enginePath = path.join(config.libDir, config.engineFile);
  const src = fs.readFileSync(enginePath, 'utf8');

  console.log('== [' + config.libId + '] 1/4 Slicing engine default-data literals');
  const defaults = sliceLiterals(src, config.literals, config.libDir);
  for (const spec of config.literals) {
    const v = defaults[spec.key];
    const n = Array.isArray(v) ? v.length : Object.keys(v || {}).length;
    console.log('   - ' + spec.key + ': ' + n + ' entries');
  }

  console.log('== 2/4 Building spec-compliant Data Pack');
  const pack = config.buildPack(defaults);
  pack.schemaVersion = config.schemaVersion || '1.3';
  pack.meta = Object.assign({ id: config.libId, generatedBy: 'sg-data-pack: ' + path.basename(configPath) }, config.meta || {}, pack.meta || {});
  pack.assets = Object.assign(collectAssets(pack, config.libDir), pack.assets || {});
  const missing = Object.entries(pack.assets).filter(([, a]) => !a.exists);
  console.log('   - entities: ' + Object.keys(pack.entities).length +
    ', relations: ' + (pack.relations || []).length +
    ', stages: ' + (pack.stages || []).length +
    ', assets: ' + Object.keys(pack.assets).length + (missing.length ? ' (missing ' + missing.length + ')' : ''));

  console.log('== 3/4 SGDataLoader validation' + (config.domainChecks ? ' + domain library-level checks' : ''));
  const result = globalThis.SGDataLoader.validate(pack);
  if (typeof config.domainChecks === 'function') {
    const extra = config.domainChecks(pack) || {};
    const extraErrors = Array.isArray(extra) ? extra : (extra.errors || []);
    const extraWarnings = Array.isArray(extra) ? [] : (extra.warnings || []);
    result.errors.push(...extraErrors.map(e => '[domain] ' + e));
    result.warnings.push(...extraWarnings.map(w => '[domain] ' + w));
  }
  result.errors.forEach(e => console.error('   [ERROR] ' + e));
  result.warnings.forEach(w => console.warn('   [warn]  ' + w));
  if (result.errors.length) { console.error('Validation failed; aborting.'); process.exit(1); }

  console.log('== 4/4 Equivalence test (fromPack(pack) vs engine defaults)');
  const diffs = runEquivalence(config, defaults, pack);
  if (diffs.length) {
    diffs.slice(0, 20).forEach(d => console.error('   [DIFF] ' + d));
    console.error('Equivalence test failed: ' + diffs.length + ' differences; aborting.');
    process.exit(1);
  }
  console.log('   - all ' + config.equivalence.length + ' deep comparisons passed; data is lossless');

  if (!checkOnly) {
    const dataDir = path.join(config.libDir, 'lib', 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    const json = JSON.stringify(pack, null, 2) + '\n';
    fs.writeFileSync(path.join(dataDir, 'data.json'), json);
    fs.writeFileSync(path.join(dataDir, 'data.js'),
      '// @generated by sg-data-pack — do not edit by hand; modify data.json and regenerate\n' +
      'globalThis.SG_DATA_PACK = ' + JSON.stringify(pack) + ';\n');

    // library-level schema: canonical core + domain extension
    const core = JSON.parse(fs.readFileSync(path.join(__dirname, 'lib', 'data-pack.schema.json'), 'utf8'));
    core.$id = 'https://sg.local/' + config.libId + '/data.schema.json';
    core.title = 'SG Data Pack v1.3 — ' + config.libId + ' data contract';
    if (config.domainSchema) core.properties.domain = config.domainSchema;
    fs.writeFileSync(path.join(dataDir, 'data.schema.json'), JSON.stringify(core, null, 2) + '\n');

    console.log('Written:');
    console.log('   - ' + path.join(dataDir, 'data.json'));
    console.log('   - ' + path.join(dataDir, 'data.js'));
    console.log('   - ' + path.join(dataDir, 'data.schema.json'));
  }
  console.log('✔ [' + config.libId + '] done');
}

main();
