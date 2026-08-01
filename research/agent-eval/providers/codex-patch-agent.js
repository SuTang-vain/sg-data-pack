#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const [, , workspace, patchFile, promptFile] = process.argv;
if (!workspace || !patchFile || !promptFile) {
  console.error('Usage: codex-patch-agent <workspace> <patch-file> <prompt-file>');
  process.exit(2);
}
const task = fs.readFileSync(promptFile, 'utf8');
const prompt = `${task}\n\nYou are participating in an audited patch-only evaluation. Inspect the workspace, but do not modify it. Produce one exact unified diff against the current files. Use diff --git, --- a/path, +++ b/path headers and zero-fuzz context. Do not use Markdown fences, commentary, prose, commands, binary patches, renames, symlinks, or mode changes. The final response must begin with diff --git and contain only the patch.`;
const result = spawnSync('codex', [
  'exec', '--ephemeral', '--ignore-user-config', '--ignore-rules',
  '--sandbox', 'read-only', '--skip-git-repo-check', '-C', workspace,
  '--color', 'never', '-o', patchFile, '-'
], { input: prompt, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 300000 });
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) {
  console.error(result.error.message);
  process.exit(3);
}
if (result.status !== 0) process.exit(3);
let patch = fs.readFileSync(patchFile, 'utf8').trim();
const start = patch.indexOf('diff --git ');
if (start > 0) patch = patch.slice(start);
if (patch.startsWith('```')) patch = patch.replace(/^```(?:diff)?\s*/, '').replace(/\s*```$/, '');
fs.writeFileSync(patchFile, patch.trimEnd() + '\n');
