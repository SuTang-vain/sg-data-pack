#!/usr/bin/env node
/*
 * sg-pack-types.js — generate TypeScript declarations from a Data Pack.
 *
 * Two layers:
 *   1. contract layer: DataPack base interfaces (from the universal contract)
 *   2. library layer:  per-kind entity interfaces inferred from the actual
 *      data.json (field unions, optional markers, literal enums, id unions)
 *
 * Usage:
 *   sg-data-pack types <data.json> [--out lib/src/data-types.d.ts] [--name <PackName>]
 *
 * Default <PackName> is derived from meta.id (diegovz-home-0722-ts -> DiegovzHome0722Ts
 * is ugly, so prefer passing --name, e.g. --name Diegovz).
 *
 * Engines can then opt into checking WITHOUT a build step:
 *   // @ts-check
 *   /** @type {import('./data-types').DiegovzPack} *\/ (pack)
 *
 * Inference rules:
 *   - entities grouped by kind; fields = union across the group
 *   - field optional (?) when absent in any member of the group
 *   - string fields with <=8 distinct short values and full coverage -> literal union
 *   - arrays: homogeneous element literal union where possible, else unknown[]
 *   - nested objects: inline interface when consistent shape, else Record<string, unknown>
 */
'use strict';
const fs = require('fs');
const path = require('path');

const [, , packPath, ...rest] = process.argv;
if (!packPath) {
  console.error('Usage: sg-data-pack types <data.json> [--out <file.d.ts>] [--name <PackName>]');
  process.exit(2);
}
const flag = (n) => {
  const i = rest.indexOf(n);
  if (i < 0) return null;
  const value = rest[i + 1];
  if (!value || value.startsWith('--')) {
    console.error(`${n} requires a value`);
    process.exit(2);
  }
  return value;
};
const pack = JSON.parse(fs.readFileSync(packPath, 'utf8'));
const explicitName = flag('--name');
if (explicitName && !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(explicitName)) {
  console.error(`--name must be a valid TypeScript identifier, got ${JSON.stringify(explicitName)}`);
  process.exit(2);
}
const libName = explicitName || (() => {
  const id = (pack.meta && pack.meta.id) || 'Library';
  const derived = id.replace(/(^|[-_])(\w)/g, (m, p, c) => c.toUpperCase()).replace(/[^A-Za-z0-9_$]/g, '');
  if (!derived) return 'Library';
  return /^[A-Za-z_$]/.test(derived) ? derived : `Pack${derived}`;
})();
const outPath = flag('--out');

const ENUM_MAX = 8;

/* ---------- type inference ---------- */
function pascal(s) {
  // split on - _ and any non-alphanumeric, capitalize each part, join
  return String(s).split(/[^A-Za-z0-9]+/).filter(Boolean).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
}
function tsLit(s) { return JSON.stringify(s); }

function inferValueType(values, depth) {
  const types = new Set(values.map((v) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v)));
  if (types.size > 1) return 'unknown';
  const t = [...types][0];
  if (t === 'string') {
    const uniq = [...new Set(values)];
    if (uniq.length <= ENUM_MAX && uniq.every((s) => s.length <= 40)) {
      return uniq.map(tsLit).join(' | ');
    }
    return 'string';
  }
  if (t === 'number') return 'number';
  if (t === 'boolean') return 'boolean';
  if (t === 'array') {
    const elems = values.flat();
    if (!elems.length) return 'unknown[]';
    const et = inferValueType(elems, depth + 1);
    return et.includes('\n') ? 'unknown[]' : `(${et})[]`.replace(/^\((string|number|boolean)\)\[\]$/, '$1[]');
  }
  if (t === 'object' && depth === 0) {
    // inline interface if all members share a consistent key set
    const keySets = values.map((v) => Object.keys(v).sort().join(''));
    if (new Set(keySets).size === 1) {
      const keys = Object.keys(values[0]);
      const fields = keys.map((k) => `    ${JSON.stringify(k)}: ${inferValueType(values.map((v) => v[k]), depth + 1)};`).join('\n');
      return `{\n${fields}\n  }`;
    }
    return 'Record<string, unknown>';
  }
  return 'unknown';
}

/* ---------- entity inference ---------- */
const byKind = new Map();
for (const [id, e] of Object.entries(pack.entities || {})) {
  const k = e.kind || 'unknown';
  if (!byKind.has(k)) byKind.set(k, []);
  byKind.get(k).push([id, e]);
}

const kindInterfaces = [];
for (const [kind, members] of [...byKind.entries()].sort()) {
  const iname = `${libName}${pascal(kind)}Entity`;
  const fields = new Map(); // field -> {values, coverage}
  for (const [, e] of members) {
    for (const [f, v] of Object.entries(e)) {
      if (f === 'kind') continue;
      if (!fields.has(f)) fields.set(f, []);
      fields.get(f).push(v);
    }
  }
  const lines = [`export interface ${iname} {`, `  kind: ${tsLit(kind)};`];
  for (const [f, vals] of [...fields.entries()].sort()) {
    const optional = vals.length < members.length ? '?' : '';
    lines.push(`  ${JSON.stringify(f)}${optional}: ${inferValueType(vals, 0)};`);
  }
  lines.push('}');
  kindInterfaces.push({ kind, iname, code: lines.join('\n') });
}

const entityUnion = kindInterfaces.map((k) => k.iname).join(' | ') || 'never';
const idUnion = Object.keys(pack.entities || {}).map(tsLit).join(' | ') || 'never';

/* ---------- emit ---------- */
const out = `/* Auto-generated from data.json by sg-data-pack types (${libName}).
 * Do not edit — regenerate: sg-data-pack types lib/data/data.json --name ${libName} */

/* ---------- contract layer (universal Data Pack sections) ---------- */
export interface SgRelation { id?: string; a: string; b: string; type: string; label?: string; scope?: string[]; }
export interface SgProvenanceEntry { origin?: string; sourceUrl?: string | null; fetchedAt?: string; confidence?: number; note?: string; }
export interface SgAssetEntry { exists?: boolean; bytes?: number; hash?: string; sourceUrl?: string; }
export interface SgDerivation {
  kind: 'repeat' | 'insertion-order' | 'lookup-rebuild' | 'scope-resolution' | 'projection' | 'reference-only';
  source: string;
  consumers: string[];
  affects?: string[];
  alsoTouches?: string[];
  note: string;
}

/* ---------- library layer (inferred from data) ---------- */
${kindInterfaces.map((k) => k.code).join('\n\n')}

export type ${libName}Entity = ${entityUnion};
export type ${libName}EntityId = ${idUnion};

export interface ${libName}Pack {
  schemaVersion: '1.0' | '1.1' | '1.2' | '1.3';
  meta: { id: string; title: string; [k: string]: unknown };
  entities: Record<string, ${libName}Entity>;
  aliases?: Record<string, string | { id: string; context?: string; [k: string]: unknown }>;
  relationTypes?: Record<string, { label: string; color?: string; [k: string]: unknown }>;
  heroRelTypes?: Record<string, { label: string; color?: string; dimension?: 'hero-radial' | 'pairwise' | 'both'; [k: string]: unknown }>;
  relations?: SgRelation[];
  stages?: Array<Record<string, unknown>>;
  contents?: Record<string, Record<string, unknown>>;
  domain?: Record<string, unknown>;
  assets?: Record<string, SgAssetEntry>;
  attributeTypes?: Record<string, { label?: string; description?: string; [k: string]: unknown }>;
  attributeSources?: string[];
  kindNameFields?: Record<string, string>;
  sameAs?: Array<[string, string]>;
  derivations?: Record<string, SgDerivation>;
  provenance?: {
    entities?: Record<string, SgProvenanceEntry>;
    relations?: Record<string, SgProvenanceEntry>;
    contents?: Record<string, SgProvenanceEntry>;
  };
}
`;

if (outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, out);
  console.log(`wrote ${outPath}`);
  console.log(`kinds: ${kindInterfaces.length} (${kindInterfaces.map((k) => k.kind).join(', ')})`);
  console.log(`entities: ${Object.keys(pack.entities || {}).length}, ids as literal union: ${idUnion === 'never' ? 'no' : 'yes'}`);
} else {
  process.stdout.write(out);
}
