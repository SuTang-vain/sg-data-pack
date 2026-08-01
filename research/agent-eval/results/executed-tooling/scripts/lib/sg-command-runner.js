'use strict';

/* Synchronous, shell-free command execution with bounded inputs and outputs. */
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { assertWithinRoot, canonicalPath } = require('./sg-path-policy.js');

const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_MAX_BUFFER = 1024 * 1024;
const DEFAULT_ENV_ALLOWLIST = [
  'PATH',
  'HOME',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'SYSTEMROOT',
  'SystemRoot',
  'COMSPEC',
  'ComSpec',
  'PATHEXT',
];
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function assertArgv(argv) {
  if (!Array.isArray(argv) || argv.length === 0) {
    throw new TypeError('argv must be a non-empty array');
  }
  for (const argument of argv) {
    if (typeof argument !== 'string') throw new TypeError('every argv item must be a string');
    if (argument.includes('\0')) throw new TypeError('argv items must not contain null bytes');
  }
  if (argv[0].length === 0) throw new TypeError('argv[0] must name a command');
}

function normalizeAllowlist(value) {
  if (value === undefined) return DEFAULT_ENV_ALLOWLIST;
  if (value instanceof Set) value = [...value];
  if (!Array.isArray(value) || value.some((name) => typeof name !== 'string' || !ENV_NAME.test(name))) {
    throw new TypeError('envAllowlist must be an array or Set of environment variable names');
  }
  return value;
}

function allowedEnvironment(options = {}) {
  const allowlist = normalizeAllowlist(options.envAllowlist === undefined ? options.allowedEnv : options.envAllowlist);
  const supplied = options.env === undefined ? {} : options.env;
  if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) throw new TypeError('env must be an object');
  const source = { ...process.env, ...supplied };
  const output = Object.create(null);
  for (const name of allowlist) {
    if (!Object.prototype.hasOwnProperty.call(source, name) || source[name] === undefined) continue;
    const value = source[name];
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      throw new TypeError(`environment variable ${name} must be a string, number, or boolean`);
    }
    const text = String(value);
    if (text.includes('\0')) throw new TypeError(`environment variable ${name} must not contain null bytes`);
    output[name] = text;
  }
  return output;
}

function positiveInteger(value, fallback, name) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive safe integer`);
  return value;
}

function outputBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value === null || value === undefined) return Buffer.alloc(0);
  return Buffer.from(String(value));
}

function boundedText(value, maxBuffer) {
  const bytes = outputBuffer(value);
  const truncated = bytes.length > maxBuffer;
  return {
    text: bytes.subarray(0, maxBuffer).toString('utf8'),
    truncated,
  };
}

function structuredError(error) {
  if (!error) return undefined;
  return {
    name: error.name,
    code: error.code || null,
    message: error.message,
    errno: error.errno === undefined ? null : error.errno,
    syscall: error.syscall || null,
    path: error.path || null,
  };
}

function runCommand(input, legacyOptions = {}) {
  const objectForm = !Array.isArray(input) && input !== null && typeof input === 'object';
  const argv = objectForm ? input.argv : input;
  const options = objectForm ? input : legacyOptions;
  assertArgv(argv);
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('options must be an object');
  const allowedRoot = canonicalPath(options.allowedRoot || options.root || process.cwd(), { mustExist: true });
  const cwd = assertWithinRoot(allowedRoot, options.cwd || allowedRoot, { mustExist: true });
  if (!fs.statSync(cwd).isDirectory()) throw new TypeError(`cwd must be a directory: ${cwd}`);
  const timeout = positiveInteger(options.timeoutMs === undefined ? options.timeout : options.timeoutMs, DEFAULT_TIMEOUT, 'timeoutMs');
  const maxBuffer = positiveInteger(options.maxOutputBytes === undefined ? options.maxBuffer : options.maxOutputBytes, DEFAULT_MAX_BUFFER, 'maxOutputBytes');
  const env = allowedEnvironment(options);
  const started = process.hrtime.bigint();
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd,
    env,
    input: options.input,
    encoding: null,
    timeout,
    maxBuffer,
    killSignal: options.killSignal || 'SIGTERM',
    windowsHide: true,
    shell: false,
  });
  const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
  const stdout = boundedText(result.stdout, maxBuffer);
  const stderr = boundedText(result.stderr, maxBuffer);
  const errorCode = result.error && result.error.code;
  const timedOut = errorCode === 'ETIMEDOUT';
  const outputLimitReached = errorCode === 'ENOBUFS';
  const stdoutTruncated = stdout.truncated;
  const stderrTruncated = stderr.truncated;

  return {
    argv: [...argv],
    cwd,
    status: result.status,
    exitCode: result.status,
    exit: result.status,
    signal: result.signal,
    timedOut,
    durationMs,
    duration: durationMs,
    stdout: stdout.text,
    stderr: stderr.text,
    stdoutTruncated,
    stderrTruncated,
    truncated: outputLimitReached || stdoutTruncated || stderrTruncated,
    error: structuredError(result.error),
  };
}

module.exports = {
  DEFAULT_TIMEOUT,
  DEFAULT_MAX_BUFFER,
  DEFAULT_ENV_ALLOWLIST,
  allowedEnvironment,
  buildAllowedEnv: allowedEnvironment,
  runCommand,
  run: runCommand,
};
