'use strict';

/* Execute untrusted extraction config/engine code away from report stdout. */
const fs = require('node:fs');
const { runExtraction } = require('./sg-pack-extract-core.js');

const [, , configPath, expectedLibDir, expectedLibId] = process.argv;
let payload;
try {
  const result = runExtraction(configPath, { expectedLibDir, expectedLibId });
  payload = {
    ok: true,
    result: {
      inventory: result.inventory,
      validation: result.validation,
      equivalence: result.equivalence,
      consumedFiles: result.consumedFiles,
    },
  };
} catch (error) {
  payload = {
    ok: false,
    error: {
      name: error.name,
      message: error.message,
      kind: error.kind || 'gate',
    },
  };
}
fs.writeFileSync(3, JSON.stringify(payload));
