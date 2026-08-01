# Agent success-rate ExperimentSpec and ExperimentReport v1.0

An experiment runs a fixed task set repeatedly from fresh immutable baselines:

```bash
node scripts/sg-data-pack experiment research/agent-eval/experiment-claude.json \
  --out /tmp/sg-agent-experiment
```

`ExperimentSpec` binds agent kind/provider/model label, argv, the actual adapter path and byte digest, ordered task manifest paths/taskIds/manifest digests, repetitions and seed through `experimentId`. Each task × repetition receives a new disposable workspace and its own TaskRun artifact directory. The experiment rechecks spec, adapter, task manifest/taskId, source, grader bundle, and tool integrity before/after every trial rather than trusting one initialization check.

The report preserves:

- total, valid, invalid and infrastructure-error trial counts;
- pass rate over valid trials and Wilson 95% interval;
- stage rates for agent completion, patch apply, file-policy compliance, graders, runtime and visual;
- verdict failure taxonomy;
- mean/median duration;
- provider-reported actual models, input/output/cache tokens and cost;
- a reference to every TaskRun.

Invalid input and pre-subject infrastructure failures are reported separately rather than silently removed or counted as AI task failures. Candidate timeout/crash/evidence failure and any post-agent integrity drift remain valid failures. A simultaneous candidate failure takes precedence over infra so a failing trial cannot disappear from the denominator. Runtime/visual denominators include every valid trial whose task declares those checks, including patch/policy/grader precondition failures that never reached evidence collection.

A scripted provider proves the harness only (`harness-only`). A real AI provider can support an initial task-contract claim, but a small synthetic benchmark is not evidence of general component library autonomy. `ai-task-contract-not-demonstrated` means no valid AI trial passed. `ai-static-contract-only` means at least one valid AI trial passed but required runtime/visual coverage was not fully successful. `ai-task-contract-with-runtime-visual-subset` means at least one valid trial passed and every valid trial in the declared browser-evidence subset passed its runtime/visual checks; it is deliberately narrower than a claim about arbitrary production libraries.
