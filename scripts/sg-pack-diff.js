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

function relationKey(r) { return `${r.a}::${r.b}::${r.type}`; }
function diffRelations(oldR, newR) {
  const oldMap = new Map((oldR || []).map((r) => [relationKey(r), r]));
  const newMap = new Map((newR || []).map((r) => [relationKey(r), r]));
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
  stages: diffRecordMap(
    Object.fromEntries((oldPack.stages || []).map((s) => [s.id, s])),
    Object.fromEntries((newPack.stages || []).map((s) => [s.id, s]))
  ),
  sameAs: diffPairs(oldPack.sameAs, newPack.sameAs),
};

/* ---------- derivations impact analysis ---------- *
 * For each changed record, find derivations whose `source` touches the same
 * pack section and surface them as blast-radius warnings. Sources use dotted
 * paths with optional '*' wildcards (e.g. entities.*.points, domain.works.*.cover).
 */
function sourceMatches(sourcePath, section, id, field) {
  const segs = String(sourcePath || '').split('.');
  if (segs[0] !== section) return false;
  // patterns we match:
  //   <section>            -> any change in section
  //   <section>.*          -> any record in section
  //   <section>.*.<field>  -> specific field across all records
  //   <section>.<id>       -> specific record
  if (segs.length === 1) return true;
  if (segs[1] === '*') {
    if (segs.length === 2) return true;
    if (segs.length === 3) return segs[2] === field;
    return false;
  }
  return segs[1] === id;
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
  // domain changes: scan derivations whose source root is 'domain'
  const oldDomain = JSON.stringify(oldPack.domain || {});
  const newDomain = JSON.stringify(newPack.domain || {});
  if (oldDomain !== newDomain) for (const d of impactedDerivations(newPack, 'domain')) add(d, 'domain changed');
  return [...impacts.values()].map((i) => ({ ...i, triggers: [...i.triggers] }));
}
const derivImpacts = collectImpacts(newPack, report);
report.derivationsImpacted = derivImpacts;

function count(sec) {
  return (sec.added ? sec.added.length : 0) + (sec.removed ? sec.removed.length : 0) + (sec.changed ? sec.changed.length : 0);
}
const total =
  count(report.entities) + count(report.relations) + count(report.aliases) +
  count(report.contents) + count(report.stages) + report.sameAs.added.length + report.sameAs.removed.length;

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
