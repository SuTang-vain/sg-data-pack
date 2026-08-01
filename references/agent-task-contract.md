# AgentTaskManifest v1 contract

`AgentTaskManifest` is a declarative, content-addressed description of one agent task. The machine-readable contract is [`scripts/lib/agent-task.schema.json`](../scripts/lib/agent-task.schema.json); the read-only implementation is [`scripts/lib/agent-task-manifest.js`](../scripts/lib/agent-task-manifest.js).

The current version is exactly `taskVersion: "1.0"`. The validator fails closed: unknown fields, malformed paths, missing digests, duplicate identifiers/patterns, and resource-policy violations are errors, not warnings.

## Shape

A manifest has exactly these top-level fields:

- `taskVersion`: `"1.0"`;
- `taskId`: `sha256:<64 lowercase hex>`;
- `instructions`: `{ text, sha256 }`, where `sha256` hashes the UTF-8 bytes of `text`;
- `source`: `{ root, revision, treeSha256 }`;
- `inputs`: entries `{ id, path, role, sha256 }`;
- `filePolicy`: `allowed` rules, `forbidden` patterns, `denyPrecedence: true`, `allowSymlinks: false`, `allowHardlinks: false`, `maxChangedFiles`, and `maxPatchBytes`;
- `patchPolicy`: `{ format: "unified-diff", fuzz: 0, allowBinary: false }`;
- `graders`: entries `{ id, spec, sha256, treeSha256, weight }`; the spec bytes and complete hidden grader/reference directory are content-bound;
- `evidence`: `{ runtime: [], visual: [] }` arrays (their contents are evidence descriptors owned by the caller);
- `execution`: `{ timeoutMs, network: "off", maxOutputBytes }`.

`id` values are unique within their respective arrays (`inputs` and `graders`). `filePolicy.allowed[].pattern` and `filePolicy.forbidden[]` do not repeat. `allowed[].operations` contains one or more distinct operations from `add`, `modify`, and `delete`. A forbidden match wins over an allowed match because `denyPrecedence` is mandatory `true`.

All digest fields use the repository-wide prefixed form `sha256:<hex>`. `sha256` means SHA-256 over bytes, not a hexadecimal string that has first been re-encoded.

## Canonical JSON and task ID

Canonical JSON is compact `JSON.stringify` output after recursively sorting keys of every JSON object. Array order is preserved. There is no trailing newline, whitespace normalization, number conversion, or array sorting. The canonical material for the task ID is the complete manifest with the `taskId` property removed. Therefore:

```text
taskId = sha256(UTF-8(canonicalJson(manifest without taskId)))
```

`computeTaskId(manifest)` implements this rule. It is useful when authoring a manifest, but `validateTaskManifest` still checks that the supplied ID is present and matches; computing a new ID does not make an otherwise invalid manifest valid.

The implementation also exposes `canonicalJson`, `canonicalize`, `sha256`, and `computeTreeSha256` for producers and tests. These functions do not write files.

## Path rules and resolution

Manifest paths are POSIX-style, relative, non-empty paths. Concrete `source.root` and `inputs[].path` values are not globs; only the `filePolicy` pattern fields may contain glob metacharacters. They must not contain:

- a leading `/` or a Windows drive prefix such as `C:`;
- a backslash (`\\`), NUL, or empty path components (`//`);
- `.` or `..` path components (the source root may be `"."` to mean its task-file directory, but other dot components are rejected).

`source.root` is relative to the **task file's directory** when `taskFile` is supplied. `inputs[].path`, `filePolicy.allowed[].pattern`, and `filePolicy.forbidden[]` are relative to the resolved source root. Thus for `tasks/foo/task.json` and `source.root: "../../project"`, an input `src/a.js` means `../../project/src/a.js` from the task file directory. The path is resolved and must remain within that source root when files or the tree are verified.

For direct programmatic validation, `sourceRoot` may be supplied. It must be the already resolved source-root directory and must equal the resolution of `source.root` if `taskFile` is also supplied. `taskFile` takes precedence for resolving `source.root`; `sourceRoot` is then a consistency check. `readTaskManifest(file)` always passes the manifest file as `taskFile`.

A path is never resolved relative to the process working directory merely because the manifest omits `taskFile`. This avoids making a manifest's meaning depend on the caller's current directory.

## Source and file verification

`source.revision` is the producer's immutable source revision identifier (for example, a commit or checkout label). The v1 helper treats it as an opaque non-empty string; it does not invoke Git.

`source.treeSha256` binds a deterministic filesystem-tree description. `computeTreeSha256(root)` walks the complete tree read-only, sorts names by their UTF-8 bytes, and hashes canonical JSON entries. Entries bind path, kind, mode, and regular-file bytes; security snapshots include `.git/**` rather than applying reporting excludes. Symlinks and hardlinks are rejected by default, matching the manifest policy. The tree helper can explicitly opt into them for independent tooling, but a v1 manifest cannot: `allowSymlinks` and `allowHardlinks` must remain false.

- `validateTaskManifest(manifest, { verifyFiles: true, taskFile, sourceRoot })` reads each input and compares its byte digest. It rejects missing files, non-regular files, symlinks, hardlinks, and files outside the source root.
- `validateTaskManifest(manifest, { verifyTree: true, taskFile, sourceRoot })` computes and compares `source.treeSha256` and applies the same link policy to every tree entry.
- These checks are opt-in because the pure shape/identity validation does not need filesystem access. All checks are read-only.

## Resource and patch gates

The implementation applies finite bounds in addition to non-negative/integer checks:

- `execution.timeoutMs`: `1..86400000` (24 hours);
- `execution.maxOutputBytes`: `1..1073741824` (1 GiB);
- `filePolicy.maxChangedFiles`: `0..1000000`;
- `filePolicy.maxPatchBytes`: `0..1073741824` (1 GiB).

The task requests offline candidate/grader execution. Only unified diffs with zero fuzz and no binary patch content are accepted. The portable v1 runner enforces patch and filesystem postconditions, rechecks immutable task/grader/tool bindings after untrusted stages, and runs candidate extraction code in a killable child worker. It does **not** claim OS-level filesystem, network, or process isolation; TaskRun records those capabilities as false. In particular, “hidden grader” means omitted from the agent prompt and disposable candidate workspace, not cryptographically unreadable to a malicious local process on an unsandboxed host. A remote AI provider is an external control-plane dependency and is reported separately from candidate execution.

## API

```js
const {
  validateTaskManifest,
  computeTaskId,
  readTaskManifest,
} = require('../scripts/lib/agent-task-manifest.js');

const result = validateTaskManifest(manifest, {
  taskFile: '/absolute/path/to/task.json',
  sourceRoot: '/absolute/path/to/source',
  verifyFiles: true,
  verifyTree: true,
});
// { valid, issues: [{ path, message }], expectedTaskId, sourceRoot, ... }

const taskId = computeTaskId(manifest);
const loaded = readTaskManifest('/absolute/path/to/task.json'); // throws on invalid JSON/manifest
```

`readTaskManifest` parses one JSON file and returns the parsed manifest. It never rewrites, normalizes, or updates it. Invalid input throws an error with code `INVALID_AGENT_TASK_MANIFEST` and structured `issues`; unreadable or malformed JSON throws `AGENT_TASK_MANIFEST_READ_ERROR`.
