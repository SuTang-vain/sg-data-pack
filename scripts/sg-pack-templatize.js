#!/usr/bin/env node
/*
 * sg-pack-templatize.js — auto-derive an item template from N repeated HTML
 * instances via multi-way token alignment (LCS diff of instance[0] vs each other).
 *
 * Generalized from the diegovz stage-2 parameterizer. Use it for collection-type
 * pages (card lists, timelines, leaderboards): the output is a byte-exact
 * template + per-instance slot values, ready to be mapped to semantic fields.
 *
 * Usage:
 *   sg-data-pack templatize <instances.json> [--out <dir>] [--prefix <name>]
 *
 * Input JSON: an array of HTML strings (the repeated item instances, in order),
 * e.g. extracted from the page with any DOM tool you like.
 *
 * Output (with --out, otherwise report only):
 *   <prefix>-template.txt   HTML template with @@FIELD:f<n>@@ slots
 *   <prefix>-values.json    { slotCount, instances: [[slotValue, ...] x N] }
 *
 * Guarantees: fill(template, values[i]) === instances[i] for every i (byte-exact),
 * verified before exit. Exit 1 if verification fails.
 *
 * Next steps after running (manual, see references/data-rules-guide.md):
 *   1. name the slots semantically (title/period/url/eid...) from the value samples
 *   2. write the item renderer (template + slot builders) into the library
 *   3. extract slot values into Data Pack entities
 */
'use strict';
const fs = require('fs');
const path = require('path');

const [, , input, ...rest] = process.argv;
if (!input) {
  console.error('Usage: sg-data-pack templatize <instances.json> [--out <dir>] [--prefix <name>]');
  process.exit(2);
}
const flag = (n) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : null; };
const outDir = flag('--out');
const prefix = flag('--prefix') || 'item';

let instances;
try {
  instances = JSON.parse(fs.readFileSync(input, 'utf8'));
} catch (e) {
  console.error(`Cannot read ${input}: ${e.message}`);
  process.exit(2);
}
if (!Array.isArray(instances) || instances.length < 2 || instances.some((x) => typeof x !== 'string')) {
  console.error('Input must be a JSON array of >=2 HTML strings.');
  process.exit(2);
}

/* ---------- tokenize: tags | newline+indent | text runs (lossless join) ---------- */
function tokenize(s) {
  return s.match(/<[^>]*>|\n[^\S\n]*|[^<\n]+|\n/g) || [];
}

/* ---------- LCS alignment ---------- */
function align(base, inst) {
  const n = base.length, m = inst.length;
  const dp = new Uint32Array((n + 1) * (m + 1));
  const W = m + 1;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * W + j] = base[i] === inst[j]
        ? dp[(i + 1) * W + j + 1] + 1
        : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
    }
  }
  const matched = new Map();
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (base[i] === inst[j]) { matched.set(i, j); i++; j++; }
    else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) i++;
    else j++;
  }
  return { matched, instLen: m };
}

/* ---------- derive template across all instances ---------- */
function deriveTemplate(instances) {
  const base = tokenize(instances[0]);
  const others = instances.slice(1).map(tokenize);
  const aligns = others.map((t) => align(base, t));
  const n = base.length;

  // stable[i]: matched in every instance AND no insertion immediately before it
  const stable = new Array(n).fill(true);
  for (const { matched } of aligns) {
    for (let i = 0; i < n; i++) if (!matched.has(i)) stable[i] = false;
    let prevI = -1;
    for (const [b, ii] of [...matched.entries()].sort((a, b2) => a[0] - b2[0])) {
      if (prevI !== -1 && ii !== prevI + 1) stable[b] = false; // insertion before b
      prevI = ii;
    }
  }

  const segments = [];
  let cur = null;
  for (let i = 0; i < n; i++) {
    if (stable[i]) {
      if (!cur || cur.type !== 'static') { cur = { type: 'static', text: '' }; segments.push(cur); }
      cur.text += base[i];
    } else {
      if (!cur || cur.type !== 'slot') { cur = { type: 'slot', id: segments.filter((s) => s.type === 'slot').length, baseStart: i, baseEnd: i }; segments.push(cur); }
      cur.baseEnd = i + 1;
    }
  }

  // per-instance slot values — boundaries via STATIC tokens only
  const perInstance = [];
  const allTok = [base, ...others];
  const allAlign = [{ matched: new Map(base.map((_, i) => [i, i])), instLen: n }, ...aligns];
  for (let k = 0; k < instances.length; k++) {
    const { matched, instLen } = allAlign[k];
    const tok = allTok[k];
    const values = [];
    for (const seg of segments) {
      if (seg.type !== 'slot') continue;
      let start = 0;
      for (let b = seg.baseStart - 1; b >= 0; b--) if (stable[b] && matched.has(b)) { start = matched.get(b) + 1; break; }
      let end = instLen;
      for (let b = seg.baseEnd; b < n; b++) if (stable[b] && matched.has(b)) { end = matched.get(b); break; }
      values[seg.id] = tok.slice(start, end).join('');
    }
    perInstance.push(values);
  }

  const slotCount = segments.filter((s) => s.type === 'slot').length;
  const template = segments.map((s) => (s.type === 'static' ? s.text : `@@FIELD:f${s.id}@@`)).join('');
  return { template, slotCount, perInstance };
}

function fillTemplate(template, values) {
  return template.replace(/@@FIELD:f(\d+)@@/g, (m, i) => values[+i]);
}

/* ---------- run ---------- */
const { template, slotCount, perInstance } = deriveTemplate(instances);

let ok = true;
for (let i = 0; i < instances.length; i++) {
  if (fillTemplate(template, perInstance[i]) !== instances[i]) { ok = false; console.error(`verify FAIL at instance ${i}`); break; }
}

const staticBytes = template.replace(/@@FIELD:f\d+@@/g, '').length;
const slotBytes = perInstance.flat().join('').length;
console.log(`instances: ${instances.length}`);
console.log(`slots: ${slotCount}`);
console.log(`template: ${template.length}b (static ${staticBytes}b), values: ${slotBytes}b`);
console.log(`byte-exact verification: ${ok ? 'OK' : 'FAILED'}`);
if (!ok) process.exit(1);

// slot value samples to aid semantic naming
console.log('\nslot samples (up to 2 distinct values each):');
for (let s = 0; s < slotCount; s++) {
  const uniq = [...new Set(perInstance.map((v) => v[s]))];
  const samples = uniq.slice(0, 2).map((x) => (x.length > 70 ? x.slice(0, 70) + `…(${x.length}b)` : x));
  console.log(`  f${s} (${uniq.length} distinct): ${JSON.stringify(samples)}`);
}

if (outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${prefix}-template.txt`), template);
  fs.writeFileSync(path.join(outDir, `${prefix}-values.json`), JSON.stringify({ slotCount, instances: perInstance }, null, 2));
  console.log(`\nwrote ${prefix}-template.txt + ${prefix}-values.json to ${outDir}`);
}
