#!/usr/bin/env node
/*
 * sg-pack-diff.js — structural diff between two Data Packs (data.json).
 *
 * Usage:
 *   sg-data-pack diff <old.json> <new.json>            Human-readable report
 *   sg-data-pack diff <old.json> <new.json> --json     Machine-readable report
 *
 * Reports added/removed/changed entities, relations, aliases, contents,
 * stages, and sameAs links. Field-level changes list dotted paths.
 * Exit code: 0 = identical structure, 1 = differences found, 2 = usage error.
 *
 * Typical uses:
 *   - review data evolution alongside git (diff HEAD~1:data.json vs worktree)
 *   - regression check after a re-crawl: did ids/relations survive?
 */
'use strict';
const fs = require('fs');

const [, , oldPath, newPath, ...flags] = process.argv;
if (!oldPath || !newPath) {
  console.error('Usage: sg-data-pack diff <old.json> <new.json> [--json]');
  process.exit(2);
}
const asJson = flags.includes('--json');

function load(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.error(`Cannot read ${p}: ${e.message}`);
    process.exit(2);
  }
}

/* ---------- generic helpers ---------- */
function isObj(x) { return x && typeof x === 'object' && !Array.isArray(x); }

function diffRecordMap(oldMap, newMap, pickFields) {
  // returns { added, removed, changed: [{id, fields: [dotted paths]}] }
  const oldKeys = Object.keys(oldMap || {});
  const newKeys = Object.keys(newMap || {});
  const added = newKeys.filter((k) => !(k in (oldMap || {})));
  const removed = oldKeys.filter((k) => !(k in (newMap || {})));
  const changed = [];
  for (const k of newKeys) {
    if (!(k in (oldMap || {}))) continue;
    const fields = changedPaths(oldMap[k], newMap[k]);
    if (fields.length) changed.push({ id: k, fields });
  }
  return { added, removed, changed };
}

function changedPaths(a, b, prefix) {
  prefix = prefix || '';
  const out = [];
  if (JSON.stringify(a) === JSON.stringify(b)) return out;
  if (!isObj(a) || !isObj(b)) { out.push(prefix || '(value)'); return out; }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const p = prefix ? prefix + '.' + k : k;
    if (!(k in a)) out.push(p + ' (added)');
    else if (!(k in b)) out.push(p + ' (removed)');
    else if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) {
      if (isObj(a[k]) && isObj(b[k])) out.push(...changedPaths(a[k], b[k], p));
      else out.push(p);
    }
  }
  return out;
}

function relationKey(r) {
  if (r && typeof r.id === 'string' && r.id) return `id:${r.id}`;
  const scope = Array.isArray(r && r.scope) ? [...new Set(r.scope)].sort().join('|') : '*';
  return `${r && r.a}::${r && r.b}::${r && r.type}::scope=${scope}`;
}
function recordMapWithOccurrences(records, keyOf) {
  const out = new Map();
  const seen = new Map();
  for (const record of records || []) {
    const base = keyOf(record);
    const occurrence = (seen.get(base) || 0) + 1;
    seen.set(base, occurrence);
    out.set(occurrence === 1 ? base : `${base}#${occurrence}`, record);
  }
  return out;
}
function diffRelations(oldR, newR) {
  // Scope is part of relation identity: two edges can share (a,b,type) while
  // representing different stage-scoped facts. Occurrence suffixes preserve
  // malformed duplicates rather than silently collapsing them in Map.
  const oldMap = recordMapWithOccurrences(oldR, relationKey);
  const newMap = recordMapWithOccurrences(newR, relationKey);
  const added = [...newMap.keys()].filter((k) => !oldMap.has(k));
  const removed = [...oldMap.keys()].filter((k) => !newMap.has(k));
  const changed = [];
  for (const k of newMap.keys()) {
    if (!oldMap.has(k)) continue;
    const fields = changedPaths(oldMap.get(k), newMap.get(k));
    if (fields.length) changed.push({ id: k, fields });
  }
  return { added, removed, changed };
}

function stageMap(stages) {
  const out = {};
  const seen = {};
  (stages || []).forEach((stage, i) => {
    const base = stage && (stage.key || stage.id) || `#${i}`;
    seen[base] = (seen[base] || 0) + 1;
    const key = seen[base] === 1 ? base : `${base}#${seen[base]}`;
    out[key] = stage;
  });
  return out;
}

function diffPairs(oldS, newS) {
  const norm = (s) => new Set((s || []).map((p) => JSON.stringify([...p].sort())));
  const o = norm(oldS), n = norm(newS);
  return {
    added: [...n].filter((x) => !o.has(x)),
    removed: [...o].filter((x) => !n.has(x)),
  };
}

/* ---------- run ---------- */
const oldPack = load(oldPath);
const newPack = load(newPath);

const report = {
  old: oldPath,
  new: newPath,
  entities: diffRecordMap(oldPack.entities, newPack.entities),
  relations: diffRelations(oldPack.relations, newPack.relations),
  aliases: diffRecordMap(oldPack.aliases, newPack.aliases),
  contents: diffRecordMap(oldPack.contents, newPack.contents),
  stages: diffRecordMap(stageMap(oldPack.stages), stageMap(newPack.stages)),
  sameAs: diffPairs(oldPack.sameAs, newPack.sameAs),
  // P0-7: previously absent sections — changes here were invisible to the diff.
  derivations: diffRecordMap(oldPack.derivations, newPack.derivations),
  assets: diffRecordMap(oldPack.assets, newPack.assets),
  provenance: diffRecordMap(oldPack.provenance, newPack.provenance),
  attributeTypes: diffRecordMap(oldPack.attributeTypes, newPack.attributeTypes),
  relationTypes: diffRecordMap(oldPack.relationTypes, newPack.relationTypes),
  heroRelTypes: diffRecordMap(oldPack.heroRelTypes, newPack.heroRelTypes),
  kindNameFields: diffRecordMap(oldPack.kindNameFields, newPack.kindNameFields),
  domain: diffRecordMap(oldPack.domain, newPack.domain),
  meta: diffRecordMap(
    isObj(oldPack.meta) ? oldPack.meta : {},
    isObj(newPack.meta) ? newPack.meta : {}
  ),
};

/* ---------- derivations impact analysis ---------- *
 * For each changed record, find derivations whose `source` touches the same
 * pack section and surface them as blast-radius warnings. Sources use dotted
 * paths with optional '*' wildcards (e.g. entities.*.points, domain.works.*.cover).
 */
/* Match a dotted source path (with optional '*' wildcards) against a changed
 * record located at (section, id, field). `field` is the dotted tail from the
 * changed record root, e.g. for domain.works[0].cover the change is reported as
 *   section='domain', field='works.0.cover'
 * Source paths like `domain.works.*.cover` must match it.
 *
 * Semantics:
 *   - seg[0] must equal section
 *   - remaining segs are matched against the field's dotted segments, where
 *     '*' matches any single segment and literal segments must match exactly.
 *   - if the source has fewer segments than the field, it matches a prefix
 *     (i.e. the source describes a parent collection).
 */
function sourceMatches(sourcePath, section, id, field) {
  const segs = String(sourcePath || '').split('.');
  if (segs[0] !== section) return false;
  // patterns with no further segments => any change in the section
  if (segs.length === 1) return true;
  // build the path-relative segments to compare against
  // field looks like "works.0.cover" (for a domain.works[0].cover change)
  // or "works" (whole collection changed) or undefined (record add/remove).
  const fieldSegs = field ? String(field).split('.') : [];
  // If the source uses a concrete id in position 1 (e.g. domain.specificKey),
  // require the field to start with that key.
  if (segs[1] !== '*') {
    if (!fieldSegs.length || fieldSegs[0] !== segs[1]) {
      // when there is no field info but the source is concrete, treat as a miss
      // unless the change is section-wide (field undefined means add/remove of
      // a whole record we cannot locate — only wildcard sources match those).
      return false;
    }
    return matchSegs(segs.slice(2), fieldSegs.slice(1));
  }
  // segs[1] === '*' : the wildcard stands for one segment of the field path
  return matchSegs(segs.slice(2), fieldSegs.slice(1));
}
/* recursive segment match: '*' matches one segment; literals must match.
 * The changed field may be a *prefix* of the source (the whole collection
 * changed and we cannot pinpoint the element) OR the source may be a *prefix*
 * of the field (the source describes a parent collection). Both are hits. */
function matchSegs(srcSegs, fieldSegs) {
  // field is a prefix of source: e.g. field="works" (whole array changed),
  // source="works.*.cover" — the change is a superset of what the source tracks.
  if (fieldSegs.length < srcSegs.length) {
    // every field segment must line up with the source up to where the field ends
    for (let i = 0; i < fieldSegs.length; i++) {
      if (srcSegs[i] !== '*' && srcSegs[i] !== fieldSegs[i]) return false;
    }
    return true;
  }
  // field has at least as many segments as source: source must be a prefix
  for (let i = 0; i < srcSegs.length; i++) {
    if (srcSegs[i] === '*') continue;
    if (srcSegs[i] !== fieldSegs[i]) return false;
  }
  return true;
}
function impactedDerivations(pack, section, id, field) {
  const derivs = (pack && pack.derivations) || {};
  const hits = [];
  for (const [name, d] of Object.entries(derivs)) {
    const sources = [d.source].concat(d.alsoTouches || []);
    if (sources.some((src) => sourceMatches(src, section, id, field))) hits.push({ name, ...d });
  }
  return hits;
}
function collectImpacts(pack, report) {
  const impacts = new Map(); // derivationName -> { name, kind, note, triggers: Set }
  const add = (d, trigger) => {
    if (!impacts.has(d.name)) impacts.set(d.name, { name: d.name, kind: d.kind, note: d.note, consumers: d.consumers, triggers: new Set() });
    impacts.get(d.name).triggers.add(trigger);
  };
  for (const id of report.entities.added) for (const d of impactedDerivations(pack, 'entities', id)) add(d, `+entity ${id}`);
  for (const id of report.entities.removed) for (const d of impactedDerivations(pack, 'entities', id)) add(d, `-entity ${id}`);
  for (const c of report.entities.changed) {
    const fields = c.fields.map((f) => f.replace(/ \(added\)| \(removed\)/g, '').split('.')[0]);
    for (const f of [...new Set(fields)]) for (const d of impactedDerivations(pack, 'entities', c.id, f)) add(d, `~entity ${c.id}.${f}`);
  }
  if (count(report.relations)) for (const d of impactedDerivations(pack, 'relations')) add(d, 'relations changed');
  for (const id of report.contents.added) for (const d of impactedDerivations(pack, 'contents', id)) add(d, `+content ${id}`);
  for (const id of report.contents.removed) for (const d of impactedDerivations(pack, 'contents', id)) add(d, `-content ${id}`);
  for (const c of report.contents.changed) for (const d of impactedDerivations(pack, 'contents', c.id)) add(d, `~content ${c.id}`);
  if (count(report.stages)) for (const d of impactedDerivations(pack, 'stages')) add(d, 'stages changed');
  // domain changes: P0-7 — diff at the nested-field level so that a derivation
  // whose source is `domain.works.*.cover` actually fires when a cover changes.
  // changedPaths returns dotted paths like "works.0.cover"; we feed the tail
  // (after the collection key) to sourceMatches as `field`.
  const oldDomain = oldPack.domain || {};
  const newDomain = newPack.domain || {};
  if (JSON.stringify(oldDomain) !== JSON.stringify(newDomain)) {
    const domainChanged = changedPaths(oldDomain, newDomain)
      .map((p) => p.replace(/ \(added\)| \(removed\)/g, ''));
    const fieldsHit = new Set();
    for (const fp of domainChanged) {
      // fp looks like "works.0.cover" or "works" or "works.0"
      for (const d of impactedDerivations(newPack, 'domain', undefined, fp)) add(d, `~domain.${fp}`);
      fieldsHit.add(fp);
    }
    // if no derivation matched at field granularity, still report domain-wide impact
    if (!fieldsHit.size) for (const d of impactedDerivations(newPack, 'domain')) add(d, 'domain changed');
  }
  // P0-7: previously-absent sections now feed impact propagation too
  for (const c of report.derivations.changed) add({ name: c.id, kind: 'meta', note: 'derivation definition changed', consumers: [], triggers: new Set() }, `~derivation ${c.id}`);
  if (count(report.assets)) for (const d of impactedDerivations(newPack, 'assets')) add(d, 'assets changed');
  if (count(report.provenance)) for (const d of impactedDerivations(newPack, 'provenance')) add(d, 'provenance changed');
  if (count(report.attributeTypes)) for (const d of impactedDerivations(newPack, 'attributeTypes')) add(d, 'attributeTypes changed');
  if (count(report.relationTypes)) for (const d of impactedDerivations(newPack, 'relationTypes')) add(d, 'relationTypes changed');
  if (count(report.heroRelTypes)) for (const d of impactedDerivations(newPack, 'heroRelTypes')) add(d, 'heroRelTypes changed');
  if (count(report.kindNameFields)) for (const d of impactedDerivations(newPack, 'kindNameFields')) add(d, 'kindNameFields changed');
  if (count(report.meta)) for (const d of impactedDerivations(newPack, 'meta')) add(d, 'meta changed');
  return [...impacts.values()].map((i) => ({ ...i, triggers: [...i.triggers] }));
}
const derivImpacts = collectImpacts(newPack, report);
report.derivationsImpacted = derivImpacts;

function count(sec) {
  return (sec.added ? sec.added.length : 0) + (sec.removed ? sec.removed.length : 0) + (sec.changed ? sec.changed.length : 0);
}
const total =
  count(report.entities) + count(report.relations) + count(report.aliases) +
  count(report.contents) + count(report.stages) + report.sameAs.added.length + report.sameAs.removed.length +
  count(report.derivations) + count(report.assets) + count(report.provenance) +
  count(report.attributeTypes) + count(report.relationTypes) + count(report.heroRelTypes) +
  count(report.kindNameFields) + count(report.domain) + count(report.meta);

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const fmtList = (label, sec, showFields) => {
    if (!count(sec)) return;
    console.log(`\n[${label}] +${sec.added.length} -${sec.removed.length} ~${sec.changed.length}`);
    if (sec.added.length) console.log('  added:   ' + sec.added.join(', '));
    if (sec.removed.length) console.log('  removed: ' + sec.removed.join(', '));
    for (const c of sec.changed.slice(0, showFields ? 50 : 10)) {
      console.log(`  changed: ${c.id}`);
      if (showFields) for (const f of c.fields.slice(0, 8)) console.log(`           .${f}`);
    }
  };
  console.log(`sg-data-pack diff\n  old: ${oldPath}\n  new: ${newPath}`);
  fmtList('entities', report.entities, true);
  fmtList('relations', report.relations, true);
  fmtList('aliases', report.aliases, false);
  fmtList('contents', report.contents, true);
  fmtList('stages', report.stages, true);
  if (report.sameAs.added.length || report.sameAs.removed.length) {
    console.log(`\n[sameAs] +${report.sameAs.added.length} -${report.sameAs.removed.length}`);
    report.sameAs.added.forEach((x) => console.log('  added:   ' + x));
    report.sameAs.removed.forEach((x) => console.log('  removed: ' + x));
  }
  fmtList('derivations', report.derivations, true);
  fmtList('assets', report.assets, true);
  fmtList('provenance', report.provenance, false);
  fmtList('attributeTypes', report.attributeTypes, true);
  fmtList('relationTypes', report.relationTypes, true);
  fmtList('heroRelTypes', report.heroRelTypes, true);
  fmtList('kindNameFields', report.kindNameFields, true);
  fmtList('domain', report.domain, true);
  fmtList('meta', report.meta, true);
  console.log(total ? `\n${total} difference(s) found.` : '\nNo structural differences.');
  if (derivImpacts.length) {
    console.log('\n⚠ derivations impact (blast radius):');
    for (const d of derivImpacts) {
      console.log(`  • ${d.name} (${d.kind})  <- ${d.triggers.join(', ')}`);
      if (d.note) console.log(`      ${d.note}`);
    }
  }
}
process.exit(total ? 1 : 0);
