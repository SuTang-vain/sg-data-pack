# Data Surface Manifest import

`ui-dismantler` owns the Data Surface Manifest contract. `sg-data-pack` consumes it read-only as a component-data handoff; it does not copy the contract schema or reinterpret a Manifest as a Data Pack.

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

It rejects raw static values and top-level Data Pack fields such as `entities`, `aliases`, `relations`, `stages`, `contents`, or `adapters`.

Import output is a `data-surface-import-report` with an explicit `dataPackGenerationAllowed` gate. Business entity modeling starts only after the report is `ready`; a review-required report remains evidence, not a generation input.
