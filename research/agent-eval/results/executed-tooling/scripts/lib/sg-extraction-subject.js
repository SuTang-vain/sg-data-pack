#!/usr/bin/env node
'use strict';
const { parentPort } = require('node:worker_threads');
const { runExtraction } = require('./sg-pack-extract-core.js');

parentPort.once('message', (message) => {
  const port = message && message.port;
  const token = message && message.token;
  if (!port || typeof token !== 'string' || !message.configPath || !message.workspaceRoot) process.exit(1);
  const send = port.postMessage.bind(port);
  const close = port.close.bind(port);
  parentPort.close();
  try {
    const extraction = runExtraction(message.configPath, { expectedLibDir: message.workspaceRoot });
    send({
      token,
      result: {
        ok: true,
        validation: extraction.validation,
        equivalence: extraction.equivalence,
        consumedFiles: extraction.consumedFiles,
        inventory: extraction.inventory,
      },
    });
    close();
  } catch (error) {
    send({ token, result: { ok: false, kind: error.kind || 'gate', message: error.message } });
    close();
  }
});
