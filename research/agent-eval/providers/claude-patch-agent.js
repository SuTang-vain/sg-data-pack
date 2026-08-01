#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const [, , workspace, patchFile, promptFile] = process.argv;
if (!workspace || !patchFile || !promptFile) {
  console.error('Usage: claude-patch-agent <workspace> <patch-file> <prompt-file>');
  process.exit(2);
}

function collectTextFiles(root) {
  const files = [];
  let bytes = 0;
  function visit(directory) {
    for (const name of fs.readdirSync(directory).sort()) {
      if (name === '.git') continue;
      const absolute = path.join(directory, name);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink() || !stat.isFile() && !stat.isDirectory()) throw new Error(`unsupported source entry: ${absolute}`);
      if (stat.isDirectory()) visit(absolute);
      else {
        const content = fs.readFileSync(absolute);
        if (content.includes(0)) throw new Error(`binary source is not supported by this provider: ${absolute}`);
        bytes += content.length;
        if (bytes > 1024 * 1024) throw new Error('source context exceeds 1 MiB');
        files.push({ path: path.relative(root, absolute).split(path.sep).join('/'), content: content.toString('utf8') });
      }
    }
  }
  visit(root);
  return files;
}

try {
  const task = fs.readFileSync(promptFile, 'utf8');
  const files = collectTextFiles(workspace);
  const source = files.map((file) => `--- SOURCE FILE: ${file.path} ---\n${file.content}\n--- END SOURCE FILE ---`).join('\n\n');
  const prompt = `${task}\n\nYou are participating in an audited patch-only evaluation. The complete source snapshot is included below. You have no tools and must not request any. Produce one exact unified diff against these source bytes. Use diff --git, --- a/path, +++ b/path headers and zero-fuzz context. Preserve all unrelated bytes and values. Do not use Markdown fences, commentary, prose, commands, binary patches, renames, symlinks, or mode changes. Your response must begin with diff --git and contain only the patch.\n\n${source}`;
  const result = spawnSync('claude', [
    '-p', '--safe-mode', '--tools', '', '--no-session-persistence',
    '--model', 'sonnet', '--output-format', 'json', prompt,
  ], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 300000 });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (result.stderr) process.stderr.write(result.stderr);
    process.exit(3);
  }
  const response = JSON.parse(result.stdout);
  if (response.is_error || response.subtype !== 'success' || typeof response.result !== 'string') {
    console.error(response.api_error_status || response.subtype || 'Claude provider failed');
    process.exit(3);
  }
  let patch = response.result.trim();
  const start = patch.indexOf('diff --git ');
  if (start > 0) patch = patch.slice(start);
  if (patch.startsWith('```')) patch = patch.replace(/^```(?:diff)?\s*/, '').replace(/\s*```$/, '');
  fs.writeFileSync(patchFile, patch.trimEnd() + '\n');
  const metadata = {
    provider: 'claude-code',
    declaredModel: 'sonnet',
    modelUsage: response.modelUsage || {},
    usage: response.usage || {},
    totalCostUsd: response.total_cost_usd === undefined ? null : response.total_cost_usd,
    durationApiMs: response.duration_api_ms || null,
    stopReason: response.stop_reason || null,
    permissionDenials: response.permission_denials || [],
  };
  process.stdout.write(JSON.stringify(metadata) + '\n');
} catch (error) {
  console.error(error.stack || error.message);
  process.exit(3);
}
