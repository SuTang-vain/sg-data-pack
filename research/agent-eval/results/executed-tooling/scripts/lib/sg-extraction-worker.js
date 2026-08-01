#!/usr/bin/env node
'use strict';
const crypto = require('node:crypto');
const path = require('node:path');
const { MessageChannel, Worker } = require('node:worker_threads');

const [, , configPath, workspaceRoot] = process.argv;
if (!configPath || !workspaceRoot) {
  process.stderr.write('extraction supervisor requires config path and workspace root\n');
  process.exit(1);
}

const token = crypto.randomBytes(32).toString('hex');
const channel = new MessageChannel();
const worker = new Worker(path.join(__dirname, 'sg-extraction-subject.js'), { stdout: true, stderr: true });
let message = null;
let protocolError = null;
let subjectStdoutBytes = 0;
let subjectStderrBytes = 0;
worker.stdout.on('data', (chunk) => { subjectStdoutBytes += chunk.length; });
worker.stderr.on('data', (chunk) => { subjectStderrBytes += chunk.length; });
channel.port1.on('message', (value) => {
  if (message !== null) {
    protocolError = 'subject sent more than one result';
    return;
  }
  if (!value || value.token !== token || !value.result || typeof value.result !== 'object') {
    protocolError = 'subject returned an invalid authenticated result';
    return;
  }
  message = value.result;
});
worker.once('error', (error) => { protocolError = 'subject worker error: ' + error.message; });
worker.once('exit', (exitCode) => {
  channel.port1.close();
  const protocolOk = exitCode === 0 && protocolError === null && message !== null;
  process.stdout.write(JSON.stringify({
    supervisorVersion: '1.0',
    protocolOk,
    workerExitCode: exitCode,
    protocolError: protocolOk ? null : protocolError || 'subject exited without an authenticated trusted-wrapper result',
    subjectStdoutBytes,
    subjectStderrBytes,
    result: protocolOk ? message : null,
  }) + '\n');
  process.exit(protocolOk ? 0 : 1);
});
worker.postMessage({ token, configPath, workspaceRoot, port: channel.port2 }, [channel.port2]);
