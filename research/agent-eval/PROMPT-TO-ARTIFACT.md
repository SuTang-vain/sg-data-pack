# Prompt-to-artifact completion audit

This checklist maps the requested next-stage capability to concrete implementation and executed evidence.

| Requirement | Implementation | Executed evidence | Status |
|---|---|---|---|
| Agent task manifest | `scripts/lib/agent-task.schema.json`, `scripts/lib/agent-task-manifest.js`, `scripts/sg-pack-task.js` | Three valid content-addressed manifests under `tasks/*/task.json`; full source/input/grader/tree verification in `audit-results.js` | Complete |
| AI patch execution | `scripts/lib/sg-task-runner.js`, `scripts/lib/sg-patch-executor.js` | 15 real-AI TaskRuns under `results/claude/trials/`; each keeps prompt, patch where produced, PatchAudit, source before/final digests and termination | Complete |
| Task-specific grader | `scripts/lib/sg-grader.js`, `scripts/lib/sg-grader.schema.json` | Complete hidden expected candidates for all three tasks; Pattern C GradeReport has 5 checks and score 8/8 in `results/claude/trials/pattern-c-runtime-r04/grade-task-grader.json` | Complete |
| Allowed/forbidden enforcement | Manifest file policy, parser preflight, exact apply, postflight tree diff, mode gate | `results/policy-negative/patch-audit.json` rejects `.git/config`; tests reject direct `.git` mutation, traversal, binary, rename, hardlink/symlink, executable add and actual mode drift | Complete |
| Runtime evidence | `scripts/lib/sg-runtime-evidence.js`; staged headless-Chrome producer | `results/claude/trials/pattern-c-runtime-r04/runtime-evidence.json`, verified DOM/log artifacts, 4 passed assertions, zero console/page/network failures | Complete for one real-AI trial; corpus rate 1/4 valid required trials |
| Visual evidence | `scripts/lib/sg-visual-evidence.js`; Chrome + Pillow producer | `results/claude/trials/pattern-c-runtime-r04/visual-evidence.json`, reference/candidate/diff screenshots, second-run stability, pixel/style/coverage gates | Complete for one real-AI trial; corpus rate 1/4 valid required trials |
| Success-rate experiment | `scripts/lib/sg-experiment.js`, `scripts/sg-pack-experiment.js`, `experiment.schema.json` | Scripted 15/15 control and Claude 15-trial report under `results/`; Wilson CI, stage denominators, provider model/tokens/cost and failure taxonomy | Complete |
| Auditable | SHA-256 content IDs; verified grader/tool staging; immutable-input checks; worker supervisor; raw/relocated reports | `audit-results.js` verifies 30 TaskRuns, 188 artifacts, all content IDs, relocation audits, evidence, negative control and executed tooling tree | Complete |
| Regressible | Contract, security, adversarial and integration tests | Final `node --test tests/*.test.js`: 188/188 pass; `git diff --check`: pass | Complete |
| No overstated claim | Capability flags and contracts explicitly deny unavailable isolation; strict claim levels | Scripted: `harness-only`; real AI: `ai-static-contract-only`; runtime/visual subset 1/4, not represented as fully demonstrated | Complete |

## Real AI conclusion

The final real-provider experiment measured 15 trials: 14 valid, 1 infrastructure timeout, 7 passes and 7 valid patch failures. Valid pass rate was 50.0% with Wilson 95% interval 26.8%–73.2%. The actual provider-reported model was `MiniMax-M3[1M]` despite the declared `sonnet` alias.

This is initial, limited evidence that an AI can use the contracts for the benchmark's static component-library data tasks. It is **not** evidence that the runtime/visual Pattern C task is reliably solved: only 1 of 4 valid required trials passed runtime and visual gates. It is also not evidence of arbitrary production-library autonomy.

## Explicit limitations

- No OS sandbox, filesystem syscall isolation, network isolation, process isolation, or malicious-agent grader secrecy is claimed.
- “Hidden grader” means absent from prompt and candidate workspace. Per-trial verified staging and rehashing detect drift but do not make host paths unreadable to an unsandboxed malicious process.
- The benchmark is three small synthetic tasks, not a production-library sample.
- Provider timeout is reported as infrastructure and was not retried.
- Exact patch application rejects malformed hunk context; seven valid AI trials failed at this stage.

## Reproduction

```bash
node --test tests/*.test.js
node research/agent-eval/audit-results.js
node research/agent-eval/run-policy-negative.js /tmp/sg-policy-negative
```

The exact tooling used for the saved experiments is preserved under `results/executed-tooling/` and bound by `execution-bundle.json`. Raw execution reports and deterministic relocation audits are retained next to the self-contained ExperimentReports.
