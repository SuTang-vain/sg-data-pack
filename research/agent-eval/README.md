# Agent task evaluation benchmark

This directory contains the reproducible synthetic benchmark used to test whether an agent can make a correct, auditable component-library change under the sg-data-pack contracts.

## Corpus

The frozen corpus contains three tasks, each repeated five times by the experiment specs:

1. `field-update`: change one existing entity field and preserve every unrelated value;
2. `alias-relation`: add one alias and one registered relation without changing entities;
3. `pattern-c-runtime`: extend a Pattern C DOM JSON gallery, compile the browser data entry, and pass real runtime and visual checks.

Each task binds source/input bytes, full source tree including modes, allow/deny file policy, patch limits, complete grader directory, required evidence scenarios, and execution limits through `taskId`. Complete expected candidates and browser references are in the grader bundle, not in the agent prompt or candidate workspace.

“Hidden” does not mean secret from a malicious local process on an unsandboxed host. The portable runner records `osSandbox`, `filesystemIsolation`, `networkIsolation`, `processIsolation`, and `maliciousAgentGraderSecrecy` as false. It instead rehashes immutable inputs and runs graders/tools from verified per-trial staging copies after agent execution.

## Rebuild frozen identities

After intentionally changing a task, source fixture, grader, reference, provider adapter, or experiment definition:

```bash
node research/agent-eval/build-fixtures.js
node scripts/sg-data-pack task validate research/agent-eval/tasks/field-update/task.json
node scripts/sg-data-pack task validate research/agent-eval/tasks/alias-relation/task.json
node scripts/sg-data-pack task validate research/agent-eval/tasks/pattern-c-runtime/task.json
```

Never regenerate IDs merely to hide unexplained drift. Review the changed bytes first.

## Run the harness control

```bash
rm -rf /tmp/sg-agent-scripted
node scripts/sg-data-pack experiment \
  research/agent-eval/experiment-scripted.json \
  --out /tmp/sg-agent-scripted
```

The scripted provider is a deterministic positive control. Its only valid claim level is `harness-only`; 100% scripted success is not AI evidence.

## Run a real provider

```bash
rm -rf /tmp/sg-agent-claude
node scripts/sg-data-pack experiment \
  research/agent-eval/experiment-claude.json \
  --out /tmp/sg-agent-claude
```

The provider adapter bytes are content-bound by the ExperimentSpec and the actual provider/model/token/cost metadata is retained when reported by the CLI. Authentication, provider unavailability, and trusted dependency preflight failures are reported as infrastructure errors. Candidate patch, policy, grader, timeout, runtime, visual, or post-agent integrity failures remain in the valid AI denominator.

## Interpret results

Always report:

- total, valid, invalid, and infrastructure trial counts;
- valid pass rate and Wilson 95% interval;
- agent completion, patch apply, policy, grader, runtime, and visual stage counts;
- actual provider-reported model names and usage/cost;
- failure taxonomy and every TaskRun artifact path;
- the explicit `claimLevel` and missing sandbox capabilities.

`ai-task-contract-with-runtime-visual-subset` is evidence only for this small synthetic task corpus. It is not evidence of arbitrary production-library autonomy. `ai-static-contract-only` means at least one AI trial passed but the declared browser subset did not pass completely. `ai-task-contract-not-demonstrated` means no valid AI trial passed.

## Audit artifacts

An experiment output is self-contained below its output directory:

- `experiment.json` and `EXPERIMENT.md`;
- `trials/<trial-id>/task-run.json`;
- agent prompt and patch;
- PatchAudit and GradeReport;
- runtime/visual evidence, DOM, browser logs, screenshots, and diffs where required.

Recompute every listed artifact SHA-256 before publishing a result. Do not replace missing real-provider evidence with scripted or mocked output.
