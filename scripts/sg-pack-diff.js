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
}
process.exit(total ? 1 : 0);
