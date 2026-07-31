# Reviewed Recrawl → Candidate Pack Contract

This contract defines the opt-in review loop added in v1.3 tooling. A Candidate Pack is still an ordinary Data Pack v1.3; review metadata and decisions remain sidecar JSON files.

```text
baseline data.json + records.json
  → recrawl-skeleton --candidate-ready
  → review-report.json
  → review-decisions.json (human-authored)
  → candidate <baseline> <report> <decisions> --records <records>
  → candidate.json + candidate-audit.json
```

## Candidate-ready reports

The existing `hits`, `misses`, `summary`, `autoMergeable`, and `needsHumanReview` fields are retained for legacy consumers. They are a presentation projection only. `autoMergeable` never means that a row may be applied without review.

With `--candidate-ready`, the report also contains `candidateReview`:

```jsonc
{
  "version": "1.0",
  "baselineSha256": "sha256:<digest of baseline bytes>",
  "recordsSha256": "sha256:<digest of records bytes>",
  "origin": "crawl:example.test",
  "sourceUrl": "https://example.test/cast",
  "fetchedAt": "2026-07-31",
  "observations": [
    {
      "recordId": "r000000-<hash>",
      "inputIndex": 0,
      "crawledName": "Alice",
      "rawFields": { "occupation": "演员" },
      "resolution": { "status": "hit", "entityId": "alice", "via": "alias" },
      "checks": [
        {
          "itemId": "r000000-<hash>:field:occupation",
          "crawledField": "occupation",
          "baselineField": "occupation",
          "baselineExists": false,
          "baseline": null,
          "crawled": "演员",
          "classification": "gap"
        }
      ]
    }
  ],
  "reviewItems": [
    {
      "itemId": "r000000-<hash>:field:occupation",
      "kind": "field",
      "classification": "gap"
    }
  ],
  "reportId": "sha256:<digest of candidateReview without reportId>"
}
```

`--candidate-ready` requires all of the following explicitly:

- `--origin crawl:<source>`;
- an HTTP(S) `--source` URL;
- a real, fixed `--fetchedAt YYYY-MM-DD` date.

The report and candidate command bind to exact baseline and records bytes. The candidate command re-runs the review calculation and rejects a tampered or stale report. `recordId` includes the input index and record content hash; repeated names are therefore not ambiguous.

A hit produces typed `agree`, `gap`, `conflict`, or `unsupported` checks. A miss produces an identity review item and keeps all of its raw fields in the observation. Metadata fields (`sourceUrl`, `origin`, `fetchedAt`, and `confidence`) are not treated as entity business fields.

## Review decisions

Decisions are explicit and use stable `itemId` values:

```jsonc
{
  "decisionsVersion": "1.0",
  "reportId": "sha256:<candidateReview.reportId>",
  "reviewedBy": "reviewer-id",
  "reviewedAt": "2026-07-31T12:00:00Z",
  "decisions": [
    { "itemId": "...:field:occupation", "action": "apply", "confidence": 0.95, "note": "verified" },
    { "itemId": "...:field:actor", "action": "keep", "note": "baseline retained" },
    { "itemId": "...:identity", "action": "map-alias", "entityId": "alice", "context": "reviewed-name" },
    { "itemId": "...:identity", "action": "reject", "note": "not the same person" }
  ]
}
```

Every `reviewItems[]` item must have exactly one decision. Unknown, duplicate, missing, or unsupported actions fail closed. Fuzzy candidates are suggestions only; decisions always name a canonical entity id.

## Candidate scope

The first implementation intentionally supports only:

- applying or keeping a non-empty string gap/conflict on an existing entity direct field;
- appending a new alias to an existing entity (`map-alias`), optionally with contextual alias metadata;
- recording field-level provenance under `provenance.entities.<id>.fieldOrigins.<field>` for applied values.

The following are rejected: new/deleted/renamed entities, `kind` or display-name changes, empty/null/deletion operations, nested paths, non-string values, alias rewrites/deletes, relations and relation registries, stages, contents, domain, assets, `sameAs`, derivations, and arbitrary provenance patches. A miss with business fields only approves the identity; those fields require a later recrawl/cross-check.

`keep` is a completed review decision and leaves the Pack unchanged. `reject` is valid only for identity items. `apply` requires a confidence from 0 through 1. Multiple observations proposing different values for one entity field fail rather than using last-write-wins.

## Candidate and audit outputs

```bash
node "$SK" candidate baseline.json review-report.json review-decisions.json \
  --records records.json --out candidate.json --audit candidate-audit.json \
  [--strict] [--force]
```

The Candidate is validated with `SGDataLoader`. `--strict` also rejects warnings. The audit sidecar records input digests, reviewer metadata, each operation's before/after/result, validation, allow-listed diff, and derivation impact. It does not add fields to the Data Pack top level. `sg-data-pack diff` also reports stage array reordering as `stages.orderChanged` because stage order can drive rendering.

Exit codes:

- `0`: all decisions applied/kept/rejected, Candidate validation passed, outputs written;
- `1`: review incomplete, stale entity precondition, Data Pack validation failure, or strict warning failure;
- `2`: usage, JSON, digest, report contract, action, output-path, or other input error.

Outputs are written only after all in-memory checks pass. Existing outputs require `--force`; output paths may not alias any input path.

## Field-level provenance

`provenance.entities.<id>.fieldOrigins` is optional. Each key must name a direct field that exists on the entity and each value follows the normal provenance entry shape. It may carry review identifiers such as `reportId`, `recordId`, `itemId`, `reviewedBy`, and `reviewedAt`. Crawl origins without `sourceUrl` still produce W8; missing origin produces W7; confidence below `meta.confidenceThreshold` produces W5.
