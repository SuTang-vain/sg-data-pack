# Agent TaskRun v1.0

`TaskRun` is the auditable result of one AgentTaskManifest execution. It is separate from Library
Evolution `RunReport v1.0`: the latter explains a Data Pack state; TaskRun records an agent,
patch-policy decision, graders and runtime/visual evidence.

A TaskRun binds:

- task manifest bytes, taskId, revision and source contract tree digest;
- independent runner snapshots before/final and `sourceUnchanged`;
- complete source/candidate snapshots including `.git/**`, before/after untrusted stages and at finalization;
- digest-verified private staging copies of grader and tool trees plus original/staged integrity checks;
- any post-agent task/grader/tool/candidate/source integrity drift as a non-passing policy violation;
- provider/model metadata, argv, duration, exit/signal/timeout, stdout/stderr digests;
- agent patch bytes and PatchAudit;
- candidate tree digest and every GradeReport;
- every prompt, patch, audit, DOM, screenshot, diff and evidence artifact by SHA-256;
- `secondaryErrors` for post-grade integrity/artifact problems that must not erase an already observed candidate failure;
- explicit capabilities and missing isolation guarantees.

Verdicts are `passed`, `agent-failed`, `patch-invalid`, `policy-violation`, `grader-failed`, `input-error`, or `infra-error`. Provider authentication/unavailability and trusted dependency preflight failures are infrastructure failures. Candidate/subject timeout, malformed evidence, browser failure after subject execution, and post-agent integrity drift are completed non-passes and remain in the AI denominator. `termination.processExitCode` uses 0 for pass, 1 for completed non-pass, 2 for invalid input, and 3 for infrastructure failure.

TaskRun reports can prove what happened in one disposable workspace. They do not authorize promotion
of the patch into the source library; promotion is a separate reviewed operation.
