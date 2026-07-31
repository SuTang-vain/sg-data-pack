#!/usr/bin/env node
/*
 * sg-pack-diff.js — structural diff between two Data Packs (data.json).
 *
 * Usage:
 *   sg-data-pack diff <old.json> <new.json>            Human-readable report
 *   sg-data-pack diff <old.json> <new.json> --json     Machine-readable report
 *
 * Reports added/removed/changed entities, relations, aliases, contents, stages,
 * sameAs links, and all v1.3 sections. Exit code: 0 = identical, 1 = differences,
 * 2 = usage or input error.
 */
'use strict';
const fs = require('node:fs');
const { buildDiff, count } = require('./lib/sg-pack-diff.js');

const [, , oldPath, newPath, ...flags] = process.argv;
if (!oldPath || !newPath) {
  console.error('Usage: sg-data-pack diff <old.json> <new.json> [--json]');
  process.exit(2);
}
const asJson = flags.includes('--json');

function load(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    console.error(`Cannot read ${file}: ${error.message}`);
    process.exit(2);
  }
}

const report = buildDiff(load(oldPath), load(newPath), { old: oldPath, new: newPath });

if (asJson) {
  const { total, ...jsonReport } = report;
  console.log(JSON.stringify(jsonReport, null, 2));
} else {
  const formatList = (label, section, showFields) => {
    if (!count(section)) return;
    console.log(`\n[${label}] +${section.added.length} -${section.removed.length} ~${section.changed.length}`);
    if (section.added.length) console.log('  added:   ' + section.added.join(', '));
    if (section.removed.length) console.log('  removed: ' + section.removed.join(', '));
    for (const change of section.changed.slice(0, showFields ? 50 : 10)) {
      console.log(`  changed: ${change.id}`);
      if (showFields) for (const field of change.fields.slice(0, 8)) console.log(`           .${field}`);
    }
  };
  console.log(`sg-data-pack diff\n  old: ${oldPath}\n  new: ${newPath}`);
  formatList('entities', report.entities, true);
  formatList('relations', report.relations, true);
  formatList('aliases', report.aliases, false);
  formatList('contents', report.contents, true);
  formatList('stages', report.stages, true);
  if (report.stages.orderChanged) console.log('  order:   changed');
  if (report.sameAs.added.length || report.sameAs.removed.length) {
    console.log(`\n[sameAs] +${report.sameAs.added.length} -${report.sameAs.removed.length}`);
    report.sameAs.added.forEach((value) => console.log('  added:   ' + value));
    report.sameAs.removed.forEach((value) => console.log('  removed: ' + value));
  }
  formatList('derivations', report.derivations, true);
  formatList('assets', report.assets, true);
  formatList('provenance', report.provenance, false);
  formatList('attributeTypes', report.attributeTypes, true);
  formatList('relationTypes', report.relationTypes, true);
  formatList('heroRelTypes', report.heroRelTypes, true);
  formatList('kindNameFields', report.kindNameFields, true);
  formatList('domain', report.domain, true);
  formatList('meta', report.meta, true);
  console.log(report.total ? `\n${report.total} difference(s) found.` : '\nNo structural differences.');
  if (report.derivationsImpacted.length) {
    console.log('\n⚠ derivations impact (blast radius):');
    for (const derivation of report.derivationsImpacted) {
      console.log(`  • ${derivation.name} (${derivation.kind})  <- ${derivation.triggers.join(', ')}`);
      if (derivation.note) console.log(`      ${derivation.note}`);
    }
  }
}
process.exit(report.total ? 1 : 0);
