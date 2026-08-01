# Task-specific GraderSpec and GradeReport v1.0

A grader is a trusted, task-bound contract outside the agent workspace. `AgentTaskManifest.graders[]` binds both the grader spec bytes and the complete grader directory tree by SHA-256, including hidden assertions and visual references. Replacing expected results after task creation invalidates the task. After the agent exits, the runner rehashes the original bundle, copies it into a per-trial private staging directory, and rehashes both original and staged trees before and after grading.

“Hidden” is an evaluation-disclosure property: grader bytes are absent from the prompt and candidate workspace. Without an OS filesystem sandbox it is not a secrecy guarantee against a malicious process that probes arbitrary host paths; this limitation is recorded in TaskRun.

Supported checks are:

- `data-pack-contract`: `SGDataLoader` errors and optional strict warnings;
- `library-rules`: trusted library rules, optionally selected by rule id;
- `extract-equivalence`: configured literal/fromPack equivalence and complete coverage;
- `command`: shell-free argv with bounded cwd, timeout and output;
- `runtime-evidence` and `visual-evidence`: strict evidence consumers.

Every check declares `id`, `type`, positive `weight`, and whether it is `required`. Results distinguish `passed`, `failed`, `not-assessed`, `invalid`, and `infra-error`. A required non-passed check fails the verdict; `not-assessed` never earns score. Candidate command timeouts, malformed evidence, candidate browser failures, and candidate extraction worker exits are failures that remain in the AI denominator. `infra-error` is reserved for preflight/dependency failures such as a missing browser or explicitly declared provider/grader infrastructure exit code. If a trial observes both candidate failure and infra error, candidate failure takes precedence for aggregation. Command evidence includes argv, exit/signal/timeout, duration, bounded stdout/stderr and their SHA-256.

The grader receives `{workspace}`, `{grader}`, `{artifacts}`, `{toolRoot}`, `{treeSha256}`, and `{taskId}` token substitutions. `{grader}` and `{toolRoot}` refer to per-trial verified staging copies. It cannot change the accepted patch: candidate tree digest is fixed before grading and post-grader tree comparison rejects any candidate mutation. `extract-equivalence` uses a trusted supervisor process plus a worker-thread subject: the result travels over a private transferred `MessagePort` with a random token, candidate stdout/stderr are not result channels, and the trusted wrapper must return exactly one authenticated result with exit 0. Timeout, `process.exit`, forged stdout markers, or malformed worker output cannot terminate the parent TaskRun or earn a pass.
