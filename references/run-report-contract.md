# RunReport v1.0 — Library Evolution Report Contract

`sg-data-pack report` is the product-facing aggregation layer for the existing extraction, validation, rules, diff, recrawl review, and Candidate audit capabilities. It does not modify the source library or any supplied input artifact.

```bash
node "$SK" report <libDir> \
  [--config extract.config.js] [--baseline old-data.json] \
  [--review review-report.json] [--audit candidate-audit.json] \
  [--strict] [--verify-hash] [--out report-dir] [--json]
```

## Output contract

The command creates one `RunReport` object with `reportVersion: "1.0"`. The machine contract is [`scripts/lib/run-report.schema.json`](../scripts/lib/run-report.schema.json). JSON, terminal output, and Markdown are all projections of this same object.

Top-level sections are:

- `run`: deterministic `sha256:` id, `command`, `libId`, mode, semantic outcome, maturity, and process `exitCode`;
- `inputs`: paths, flags, and SHA-256 digests for consumed files;
- `summary`: findings, errors, warnings, open/resolved items, changes, and unassessed coverage counts;
- `inventory`: Data Pack collection counts;
- `findings`: structured diagnostics with phase, category, severity, status, evidence, and repair hint;
- `changes`: baseline or Candidate before/after explanations;
- `assurances` / `coverage`: explicit verification status;
- `risks` / `nextSteps`: residual risks and actionable development hand-off;
- `operations` / `impacts` / `artifacts`: Candidate operations, derivation blast radius, and traceable inputs/outputs;
- `raw`: lossless collector details for machine investigation.

## Five user-facing sections

The default terminal and `REPORT.md` output answer these questions in order:

1. **发现的问题** — what failed, conflicted, is unsupported, or still needs a human decision;
2. **已修改 / 已完善** — exactly which Data Pack sections, fields, stage order, or Candidate operations changed;
3. **验证范围** — what evidence actually ran, including counts and hash/equivalence evidence;
4. **剩余风险** — warnings, unassessed capabilities, derivation impacts, no-check rules, and known library boundaries;
5. **下一步** — prioritized owner, command, and done-when condition.

`NOT_ASSESSED` is never treated as a pass. Runtime DOM mount, visual regression, and live production crawl remain `not-assessed` unless a future evidence collector is connected.

## Outcomes and exit codes

Semantic outcome is independent from process status:

| Outcome | Meaning | Exit |
|---|---|---:|
| `ready` | supplied evidence has no blocking finding | 0 |
| `issues-found` | non-blocking warnings remain | 0 |
| `review-required` | unresolved review items remain | 1 |
| `blocked` | a validation, rule, equivalence, or integrity gate failed | 1 |
| `input-error` | an argument, file, JSON, digest, or collector input is invalid | 2 |

`--strict` turns loader/rules/extraction/Candidate warnings into blocking failures, matching the existing validation and rules commands.

## Input binding and safety

All consumed file bytes are SHA-256 bound into the deterministic Run ID. Candidate-ready review reports are checked for their own `reportId`, baseline digest, and review item shape. Candidate audits are checked for version, validation arrays, operations, unresolved items, and derivation impacts. Invalid supplied artifacts fail closed as `input-error` and do not produce `--out` files.

`--verify-hash` is opt-in. When enabled, local manifest assets are resolved inside the library's `lib/assets` root and checked against their SHA-1 manifest values. Remote/data URI assets are skipped; unsafe paths cannot escape the asset root.

## Source immutability

The report collector is read-only. It never writes `lib/data/data.json`, a baseline, review report, audit sidecar, or Candidate. With `--out`, only the requested report directory receives `report.json` and `REPORT.md`.
