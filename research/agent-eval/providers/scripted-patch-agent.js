#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const [, , workspace, patchFile, promptFile] = process.argv;
const prompt = fs.readFileSync(promptFile, 'utf8');
const changes = [];
function updateJson(relative, mutate) {
  const file = path.join(workspace, relative);
  const before = fs.readFileSync(file, 'utf8');
  const value = JSON.parse(before);
  mutate(value);
  changes.push({ relative, before, after: JSON.stringify(value, null, 2) + '\n' });
}
if (prompt.includes('summary-new')) {
  updateJson('lib/data/data.json', (pack) => { pack.entities.alice.summary = 'summary-new'; });
} else if (prompt.includes('Alicia') && prompt.includes('friend')) {
  updateJson('lib/data/data.json', (pack) => {
    pack.aliases.Alicia = 'alice';
    pack.relations.push({ id: 'alice-bob-friend', a: 'alice', b: 'bob', type: 'friend', label: 'Friend' });
  });
} else if (prompt.includes('Gamma Card')) {
  updateJson('lib/data/data.json', (pack) => {
    pack.entities.gamma = { kind: 'card', title: 'Gamma Card', color: '#8b5cf6' };
    pack.aliases['Gamma Card'] = 'gamma';
    pack.stages.find((stage) => stage.key === 'gallery').entities.push('gamma');
    pack.domain.cardOrder.push('gamma');
  });
  const data = JSON.parse(changes[0].after);
  const relative = 'lib/data/data.js';
  changes.push({ relative, before: fs.readFileSync(path.join(workspace, relative), 'utf8'), after: 'globalThis.SG_DATA_PACK = ' + JSON.stringify(data) + ';\n' });
} else {
  console.error('scripted agent does not recognize this task');
  process.exit(1);
}
function fullFileDiff(change) {
  const before = change.before.trimEnd().split('\n');
  const after = change.after.trimEnd().split('\n');
  return [
    `diff --git a/${change.relative} b/${change.relative}`,
    `--- a/${change.relative}`,
    `+++ b/${change.relative}`,
    `@@ -1,${before.length} +1,${after.length} @@`,
    ...before.map((line) => '-' + line),
    ...after.map((line) => '+' + line),
  ].join('\n');
}
fs.writeFileSync(patchFile, changes.map(fullFileDiff).join('\n') + '\n');
