# Final agent evaluation results

These are the complete final audit bundles produced after the hardened runner, grader, evidence, denominator, and integrity reviews. They are committed as evidence, not as generated examples.

## Deterministic harness control

- Directory: [`scripted/`](scripted/)
- Experiment: `experiment:c914c326de4a45b64ab26744732c39e2d77885280e35269d009e233bc560cf3b`
- Self-contained result: `experiment-result:118e0cb1259834a153aa0bf69c0818810a5dbdc240806b167224e1c399cda2f2`
- Raw execution result: `experiment-result:ef44e721234db91d12ca3154dab1daa9156e463195ada83d30e757cedff296e8`
- Spec digest: `sha256:d7bf7564fa4283c928ffe7930b4cbaeac2d91f6ca14f994f5ebd1533967d62c2`
- Trials: 15 total, 15 valid, 0 infrastructure errors
- Passed: 15/15
- Runtime subset: 5/5
- Visual subset: 5/5
- Wilson 95% interval: 79.6%–100.0%
- Claim level: `harness-only`
- Recomputed audit: 15 TaskRuns and 125 listed artifact digests

This control proves only that the harness accepts deterministic correct patches and produces complete evidence. It is not AI capability evidence.

## Real AI experiment

- Directory: [`claude/`](claude/)
- Experiment: `experiment:20c81f58da37a1b7f17b7239e57dd9d7036ebce72529827e387f7ba48d536de3`
- Self-contained result: `experiment-result:43c9a914a08639bd2adbe306d81cddef9dfe863ae8eaa5205c7e3cf22c8e1581`
- Raw execution result: `experiment-result:56bbca6f13b5ea63f767f6ef4edcb2588959dfa59cb409e66c26981af559de91`
- Spec digest: `sha256:5dc9c394f2375420f7bf15f2cf4bd9a5e60e6db78887a3f01e3f2a7782486629`
- Declared provider: `claude-code-2.1.185`, `sonnet` alias
- Provider-reported actual model: `MiniMax-M3[1M]`
- Trials: 15 total, 14 valid, 1 infrastructure error
- Passed: 7/14 valid trials (50.0%)
- Wilson 95% interval: 26.8%–73.2%
- Failure taxonomy: 7 passed, 7 patch-invalid, 1 provider timeout infrastructure error
- Runtime subset: 1/4 valid required trials
- Visual subset: 1/4 valid required trials
- Provider usage: 22,223 input tokens; 94,361 output tokens; 1,792 cache-read input tokens
- Provider-reported cost: $2.471036
- Claim level: `ai-static-contract-only`
- Recomputed audit: 15 TaskRuns and 63 listed artifact digests

The four valid Pattern C trials stay in the runtime/visual denominator even when a patch fails before evidence collection. One passed the complete Data Pack, hidden candidate, browser producer, runtime, and visual gates. Three produced patches that failed exact zero-fuzz application. A fifth Pattern C trial hit the frozen provider timeout and is reported separately as infrastructure rather than retried.

The measured AI therefore showed initial, limited success on the static task contract, but the complete runtime/visual component-modification subset was **not** reliably demonstrated. This result does not support a claim of arbitrary production-library autonomy.

## Integrity and limitations

Every saved TaskRun records source immutability, patch policy, grader results, capabilities, and relative artifact digests. The audit recomputed every listed artifact SHA-256 after copying these bundles into the repository.

The portable runner does not provide an OS filesystem sandbox, network isolation, process isolation, or malicious-agent grader secrecy. Hidden grader bytes are absent from the prompt and candidate workspace, then copied into per-trial digest-verified staging after agent execution; original and staged bindings are rechecked. These controls detect drift but do not make arbitrary host paths unreadable to a malicious local process.

## Revalidation

```bash
node --test tests/*.test.js
node scripts/sg-data-pack task validate research/agent-eval/tasks/field-update/task.json
node scripts/sg-data-pack task validate research/agent-eval/tasks/alias-relation/task.json
node scripts/sg-data-pack task validate research/agent-eval/tasks/pattern-c-runtime/task.json
node scripts/sg-data-pack evidence runtime \
  research/agent-eval/results/claude/trials/pattern-c-runtime-r04/runtime-evidence.json
node scripts/sg-data-pack evidence visual \
  research/agent-eval/results/claude/trials/pattern-c-runtime-r04/visual-evidence.json
```

See each directory's `experiment.json`, `EXPERIMENT.md`, and `trials/*/task-run.json` for the complete machine-readable evidence.
