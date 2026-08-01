# Data Surface consumer profile

This file is a **local consumer profile**, not the upstream Data Surface Manifest schema. The `ui-dismantler` producer contract remains authoritative. The profile records the minimum boundary checks performed by `sg-data-pack`; it must not be copied upstream or used to generate a Data Pack.

## Import boundary

The importer accepts a Manifest with `schemaVersion: "1.0"`, `kind: "data-surface-manifest"`, producer identity hashes, library metadata, surfaces, unresolved/review state, and metrics. A surface describes an interface evidence boundary: owner, source, shape, fields, consumers, injection, references, unresolved notices, and optional evidence.

`surface.reviewRequired`, when supplied, is strictly a JSON boolean. The top-level `reviewRequired` is required and is also strictly boolean. Raw static business values are rejected.

## Data Pack separation

No Data Pack v1.3 root section may appear in a handoff. This includes `meta`, `kindNameFields`, `sameAs`, `provenance`, `entities`, `aliases`, `relationTypes`, `heroRelTypes`, `relations`, `stages`, `attributeTypes`, `attributeSources`, `contents`, `domain`, `assets`, and `derivations`; the legacy `adapters` field is rejected as well. This is a consumer-side boundary guard, not a replacement for the producer schema.

## Evidence and digest

The importer preserves each surface's evidence in the audit report. `source.digest` is SHA-256 over the complete Manifest after recursively sorting object keys while retaining array order. Therefore any evidence, review, unresolved, metric, identity, owner, or field change changes the digest; object key ordering alone does not.
