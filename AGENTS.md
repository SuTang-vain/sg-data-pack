# Repository guidance

## Start here

Read `HANDOFF.md` for environment setup, directory ownership, handoff baseline, optional dependencies and known limits. Read `README.md` and the relevant `references/` contract before changing behavior. `SKILL.md` describes how this tool is applied to an external component library; this repository is the tool itself.

## Runtime and verification

- Core CLI: `node scripts/sg-data-pack --help`; Node >= 18 and Git. No package install is needed.
- Full offline acceptance: `node scripts/verify-handoff.js`.
- Focused suite: `node --test tests/*.test.js`; do not invoke `node --test tests`.
- Saved evidence: `node research/agent-eval/audit-results.js`.
- Do not call real providers, install tools, launch new browser experiments or rebuild document outputs merely to validate a core change. These are optional workflows with separate dependencies and authorization.

## Preserve contracts and evidence

- Keep schema, loader, CLI/types, tests and reference documentation consistent when changing a contract.
- Never treat `NOT_ASSESSED` as a pass, scripted trials as AI evidence, or the portable runner as an OS sandbox.
- `research/agent-eval/results/` is immutable historical evidence, including the archived `executed-tooling/` tree. Do not edit it to match current code, normalize old absolute paths, prune browser logs or overwrite failures.
- Task, grader, provider and experiment bytes are content-bound. Only rebuild fixture IDs for intentional reviewed changes, not to silence unexplained drift. Write new experiment results separately.
- Digest-bound artifact files must be Git-tracked, not just present locally. The handoff regression test checks this against the Git index.
- Keep LF / frozen bytes and executable bits intact. Do not perform bulk formatting on fixtures or historical evidence.

## Paths and generated output

- Resolve paths relative to the checkout or the input file, never an old user's home directory.
- Optional document builds use `.doc-build/output/` or `SG_DOC_OUTPUT_DIR` and explicitly configured licensed fonts; archived renders stay unchanged.
- Do not commit credentials, `.env`, virtual environments, caches or unrelated artifacts. Do not copy agent login state from another machine.
- Use topic branches for new work. Preserve history; do not force-push or delete branches as part of routine handoff.
