# Data Surface Manifest import

`ui-dismantler` owns the Data Surface Manifest contract. `sg-data-pack` consumes it read-only as a component-data handoff; it does not copy the contract schema or reinterpret a Manifest as a Data Pack. The local [consumer profile](data-surface-consumer-profile.md) describes only the checks this importer needs and is **not** an authoritative upstream schema. When the profile and the producer contract differ, the `ui-dismantler` contract is authoritative and this consumer must be updated deliberately.

```bash
node scripts/sg-data-pack data-surface-import <manifest.json> \
  --out /tmp/data-surface-import.report.json
```

The default command exits with status `1` when the Manifest or any surface still requires review. `--allow-review-required` permits audit/report generation but never enables Data Pack generation.

The importer accepts only interface evidence:

- source/fixture/configuration identity hashes;
- component owners and consumers;
- source, shape and field descriptions;
- injection and reference boundaries;
- unresolved and review state.

It rejects raw static values and every Data Pack v1.3-only root section (`meta`, `kindNameFields`, `sameAs`, `provenance`, `entities`, `aliases`, relation registries/edges, stages, attribute registries/sources, `contents`, `domain`, `assets`, and `derivations`), plus the legacy `adapters` field. `surface.reviewRequired`, when present, must be an actual JSON boolean; strings and numeric stand-ins are invalid.

Import output is a `data-surface-import-report` with an explicit `dataPackGenerationAllowed` gate. Business entity modeling starts only after the report is `ready`; a review-required report remains evidence, not a generation input. Each surface's `evidence` is preserved, and `source.digest` is the SHA-256 of the complete canonical Manifest (recursively key-sorted JSON), not a projection of selected identity or metrics fields.

The CLI rejects unknown or repeated options. `--out` may not resolve to the input Manifest through an identical canonical path, symlink, or inode/hardlink, and report replacement uses a same-directory temporary file followed by an atomic rename.
