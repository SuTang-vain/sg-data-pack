# Runtime and visual evidence contract v1.0

Runtime and visual checks are evidence producers, not booleans copied from an external exit code.
`sg-data-pack` validates the evidence shape, binds every local artifact by SHA-256, and recomputes
threshold results. Missing measurements or missing artifacts produce `not-assessed`, never `passed`.

## RuntimeEvidence

A `runtime-evidence` object binds `subjectTreeSha256`, producer name/version, environment and one
scenario. `assertions` contain stable ids and `passed|failed`; console errors, page errors and network
failures are independent failure sources. At least one assertion is required for an assessed result.
Artifacts use paths relative to the evidence file and include `sha256:<64 lowercase hex>`. Paths are mandatory; duplicate ids/paths, symlink or hardlink components, missing files, and digest mismatches make the evidence non-passing. Runtime evidence requires at least one verified artifact and one assertion for an assessed result.

`evidenceId` is `runtime:<sha256>` over canonical evidence with `evidenceId` omitted.

## VisualEvidence

A `visual-evidence` object binds reference/candidate tree digests, visual configuration digest,
producer and thresholds. Each scenario contains a viewport, measured pixel-diff ratio, computed-style
score, coverage, stability failures and three artifact references: reference, candidate and diff.

The consumer recomputes:

- `pixelDiffRatio <= maxPixelDiffRatio`;
- `computedStyleScore >= minComputedStyleScore`;
- `coverage >= minCoverage`;
- `stabilityFailures === 0`;
- all three distinct screenshot/diff references resolve to verified image artifacts;
- all artifact paths exist, contain no symlink/hardlink escape, and match their SHA-256.

The benchmark browser producer preflights browser, Pillow, reference render, and reference self-comparison before subject execution; those dependency failures are infrastructure errors. Candidate render/hang/comparison failures exit as candidate failures. Coverage comes from rendered card count, stability comes from a second candidate screenshot, and console/page/network failures come from page instrumentation rather than hardcoded empty arrays.

`evidenceId` is `visual:<sha256>` over canonical evidence with `evidenceId` omitted. A producer's own
`passed` field, if present, is not authoritative.

The canonical ui-dismantler quality profile remains documented in `visual-regression.md`. This
contract is its auditable handoff format; it does not make sg-data-pack a browser implementation.
