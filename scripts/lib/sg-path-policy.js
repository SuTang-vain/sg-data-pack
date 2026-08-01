'use strict';

/*
 * Small, dependency-free filesystem policy primitives used by repository tools.
 * All paths are treated as untrusted input until they have passed the relevant
 * checks below. The module deliberately does not create, remove, or mutate
 * files.
 */
const fs = require('node:fs');
const path = require('node:path');

const CONTROL_PATH = /[\u0000-\u001f\u007f]/;
const WINDOWS_ABSOLUTE = /^[A-Za-z]:/;

function pathError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function assertPathString(value, name = 'path') {
  if (typeof value !== 'string' || value.length === 0) {
    throw pathError('INVALID_PATH', `${name} must be a non-empty string`);
  }
  if (CONTROL_PATH.test(value)) {
    throw pathError('INVALID_PATH', `${name} contains a control character`);
  }
}

function canonicalPath(value, options = {}) {
  assertPathString(value);
  const absolute = path.resolve(value);
  const mustExist = options.mustExist === true;
  try {
    return fs.realpathSync.native(absolute);
  } catch (error) {
    if (mustExist || (error && error.code !== 'ENOENT' && error.code !== 'ENOTDIR')) throw error;

    // realpathSync cannot resolve a path which does not exist yet. Resolve the
    // nearest existing ancestor, then append the non-existent suffix. This
    // still canonicalizes symlinked parents and makes containment checks safe
    // for output paths.
    const suffix = [];
    let current = absolute;
    while (true) {
      try {
        const physical = fs.realpathSync.native(current);
        return path.join(physical, ...suffix.reverse());
      } catch (ancestorError) {
        if (ancestorError && (ancestorError.code === 'ENOENT' || ancestorError.code === 'ENOTDIR')) {
          const parent = path.dirname(current);
          if (parent === current) throw ancestorError;
          suffix.push(path.basename(current));
          current = parent;
          continue;
        }
        throw ancestorError;
      }
    }
  }
}

function sameFile(left, right, options = {}) {
  const leftPath = canonicalPath(left, options);
  const rightPath = canonicalPath(right, options);
  try {
    // canonical paths cover symlink aliases; device/inode also covers hard
    // links, which are the other common meaning of “same file”. A missing
    // path is not a file, even when both arguments spell the same path.
    const leftStat = fs.statSync(leftPath);
    const rightStat = fs.statSync(rightPath);
    return leftPath === rightPath || (leftStat.dev === rightStat.dev && leftStat.ino === rightStat.ino);
  } catch (error) {
    if (options.mustExist) throw error;
    return false;
  }
}

function safeRelativePath(value, options = {}) {
  if (value === '' && options.allowEmpty) return '';
  assertPathString(value, 'relative path');
  if (path.isAbsolute(value) || WINDOWS_ABSOLUTE.test(value) || value.startsWith('\\')) {
    throw pathError('UNSAFE_RELATIVE_PATH', `path must be relative: ${value}`);
  }
  // Treat both separators as separators. This prevents a Windows-style
  // traversal from becoming a harmless filename when checked on POSIX.
  const pieces = value.replace(/\\/g, '/').split('/');
  if (pieces.some((piece) => piece === '..')) {
    throw pathError('UNSAFE_RELATIVE_PATH', `path contains a parent traversal: ${value}`);
  }
  if (pieces.length === 1 && pieces[0] === '.' && options.allowEmpty) return '';
  if (pieces.some((piece) => piece === '' || piece === '.')) {
    throw pathError('UNSAFE_RELATIVE_PATH', `path contains an empty or dot segment: ${value}`);
  }
  return pieces.join('/');
}

function isSafeRelativePath(value, options) {
  try {
    safeRelativePath(value, options);
    return true;
  } catch (_) {
    return false;
  }
}

function isWithinRoot(root, target, options = {}) {
  const physicalRoot = canonicalPath(root, options);
  const physicalTarget = canonicalPath(target, options);
  const relative = path.relative(physicalRoot, physicalTarget);
  if (relative === '') return options.allowRoot !== false;
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function assertWithinRoot(root, target, options = {}) {
  if (!isWithinRoot(root, target, options)) {
    throw pathError('PATH_OUTSIDE_ROOT', `path is outside allowed root: ${target}`, {
      root: canonicalPath(root, options),
      target: canonicalPath(target, options),
    });
  }
  return canonicalPath(target, options);
}

function existingPathComponents(value) {
  assertPathString(value);
  const absolute = path.resolve(value);
  const components = [];
  let current = absolute;
  while (true) {
    components.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return components.reverse();
}

function symlinkComponent(value, options = {}) {
  const components = existingPathComponents(value);
  let startIndex = 0;
  if (options.root) {
    const root = path.resolve(options.root);
    const rootIndex = components.indexOf(root);
    if (rootIndex !== -1) startIndex = rootIndex;
  }
  if (options.root && options.includeRoot === false) startIndex += 1;
  for (let index = startIndex; index < components.length; index += 1) {
    const component = components[index];
    try {
      if (fs.lstatSync(component).isSymbolicLink()) return component;
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
    }
  }
  return null;
}

function hasSymlinkComponent(value, options) {
  return symlinkComponent(value, options) !== null;
}

function assertNoSymlinkComponents(value, options) {
  const component = symlinkComponent(value, options);
  if (component) {
    throw pathError('SYMLINK_COMPONENT', `path contains a symlink component: ${value}`, { component });
  }
  return true;
}

function globPatternRegex(pattern) {
  assertPathString(pattern, 'glob pattern');
  const normalized = pattern.replace(/\\/g, '/');
  let source = '^';
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === '*' && normalized[index + 1] === '*') {
      if (normalized[index + 2] === '/') {
        source += '(?:.*/)?';
        index += 2;
      } else if (index + 2 === normalized.length || normalized[index + 2] !== '/') {
        // A trailing globstar also matches the directory itself, as common
        // ignore-file glob syntax does (foo/** matches foo and foo/child).
        if (index > 0 && normalized[index - 1] === '/') {
          source = source.slice(0, -1) + '(?:/.*)?';
        } else {
          source += '.*';
        }
        index += 1;
      } else {
        source += '.*';
        index += 1;
      }
    } else if (character === '*') {
      source += '[^/]*';
    } else if (character === '?') {
      // '?' is intentionally literal: the policy contract only has * and **.
      source += '\\?';
    } else {
      source += character.replace(/[.+^${}()|[\\]\\\\]/g, '\\\\$&');
    }
  }
  return new RegExp(`${source}$`);
}

function matchesGlob(value, pattern) {
  const relative = safeRelativePath(value, { allowEmpty: true });
  return globPatternRegex(pattern).test(relative);
}

function asPatterns(value) {
  if (value === undefined || value === null) return [];
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw pathError('INVALID_GLOB_POLICY', 'allow/deny patterns must be strings or arrays of strings');
  }
  return value;
}

function evaluateGlobPolicy(value, policy = {}) {
  const relative = safeRelativePath(value, { allowEmpty: true });
  const deny = asPatterns(policy.deny || policy.denied);
  const allow = asPatterns(policy.allow || policy.allowed);
  const deniedBy = deny.find((pattern) => matchesGlob(relative || '.', pattern));
  if (deniedBy !== undefined) return { allowed: false, path: relative, deniedBy, allowedBy: null };
  if (allow.length === 0) return { allowed: true, path: relative, deniedBy: null, allowedBy: null };
  const allowedBy = allow.find((pattern) => matchesGlob(relative || '.', pattern));
  return { allowed: allowedBy !== undefined, path: relative, deniedBy: null, allowedBy: allowedBy || null };
}

function isPathAllowed(value, policy) {
  return evaluateGlobPolicy(value, policy).allowed;
}

function operationPolicy(config = {}) {
  const root = config.root || config.allowedRoot || null;
  const operations = config.operations || config.operation || {};

  function check(operation, target, options = {}) {
    const selected = operations[operation] || config[operation] || config;
    const selectedRoot = options.root || root;
    let relative = target;
    let canonicalTarget = null;
    if (selectedRoot) {
      canonicalTarget = assertWithinRoot(selectedRoot, target, {
        allowRoot: options.allowRoot,
        mustExist: options.mustExist,
      });
      relative = path.relative(canonicalPath(selectedRoot), canonicalTarget).split(path.sep).join('/');
    }
    const globResult = evaluateGlobPolicy(relative, selected || {});
    return {
      ...globResult,
      operation,
      target,
      canonicalTarget,
      root: selectedRoot,
    };
  }

  function assert(operation, target, options = {}) {
    const result = check(operation, target, options);
    if (!result.allowed) {
      const reason = result.deniedBy ? `denied by ${result.deniedBy}` : 'not included by allow policy';
      throw pathError('OPERATION_NOT_ALLOWED', `${operation} is not allowed for ${target}: ${reason}`, result);
    }
    return result;
  }

  return {
    check,
    evaluate: check,
    isAllowed: (operation, target, options) => check(operation, target, options).allowed,
    assert,
    assertAllowed: assert,
  };
}

function checkOperation(operation, target, config) {
  return operationPolicy(config).check(operation, target);
}

function assertOperationAllowed(operation, target, config) {
  return operationPolicy(config).assert(operation, target);
}

module.exports = {
  canonicalPath,
  sameFile,
  safeRelativePath,
  assertSafeRelativePath: safeRelativePath,
  isSafeRelativePath,
  isWithinRoot,
  isPathWithinRoot: isWithinRoot,
  assertWithinRoot,
  symlinkComponent,
  hasSymlinkComponent,
  hasSymlinkComponents: hasSymlinkComponent,
  assertNoSymlinkComponent: assertNoSymlinkComponents,
  assertNoSymlinkComponents,
  matchesGlob,
  globMatch: matchesGlob,
  evaluateGlobPolicy,
  isPathAllowed,
  pathAllowed: isPathAllowed,
  operationPolicy,
  createOperationPolicy: operationPolicy,
  checkOperation,
  assertOperationAllowed,
};
