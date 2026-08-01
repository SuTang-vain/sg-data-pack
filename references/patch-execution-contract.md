# Patch execution and PatchAudit v1.0

`sg-data-pack task run` never asks an agent to modify the source library. It copies the exact
content-addressed source tree into a disposable workspace and gives the agent one output capability:
a unified diff artifact.

The runner then:

1. validates the task, input, source tree, grader spec and grader tree digests;
2. snapshots source and workspace trees;
3. runs the agent with a bounded shell-free argv command;
4. rejects direct source/workspace writes and undeclared artifact files;
5. parses the diff and rejects absolute/traversal paths, binary patches, renames, mode changes, symlinks, submodules, duplicate entries and unsupported operations; add/delete patches must declare modes, v1 adds are fixed to `100644`, delete mode must match the baseline, and postflight independently rejects actual mode drift;
6. enforces `allowed`/`forbidden` paths before apply, with deny precedence;
7. runs exact `git apply --check` and `git apply` with no fuzz;
8. snapshots the candidate and rechecks the actual tree diff against file policy;
9. after agent execution, rehashes the task, source, grader, external integrity inputs, and tool tree;
10. copies graders and tool scripts into per-trial digest-verified private staging directories, then rehashes original and staged trees before/after grading;
11. runs candidate extraction/equivalence code in a bounded child worker rather than the parent runner;
12. fails closed if the final source tree differs or any post-agent immutable binding drifts;
13. writes a SHA-256-bound `patch-audit.json` and TaskRun artifacts.

`PatchAudit` records task/patch/tree digests, declared and actual operations, policy decisions,
apply command evidence and capability limits. Any rejected patch leaves the disposable workspace at
its original tree or the whole workspace is discarded.

## Trust boundary

The v1 runner provides strong postcondition and content-integrity enforcement. It does **not** claim a portable OS sandbox: `osSandbox`, `networkIsolation`, and `processIsolation` are recorded as false unless a future platform runner can enforce them. A local process can address host paths outside its cwd; `allowedRoot` bounds command cwd, not filesystem syscalls. Therefore private staging and post-stage rehashing detect drift but do not make grader bytes secret from a malicious local agent. An external AI provider may need network access even when candidate code execution is intended to be offline. Capability absence must remain visible in TaskRun and must not be reworded as isolation.
