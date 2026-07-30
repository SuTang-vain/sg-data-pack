# Qinshihuang integration fixture

This is the first real engine-level integration fixture for `sg-data-pack`.

## Source and scope

The fixture is a curated copy of an authorized Qinshihuang example library. The original source
is intentionally not required at test time and is not referenced by any runtime path.

It contains only the engine, the example HTML JSON data source, the library rules, and the 21
assets referenced by the normalized pack. The source directory is not modified by tests.

The fixture intentionally does **not** copy the source library's generated `data.json`, old loader,
old schema, generated types, CSS, original page, screenshots, or unreferenced assets. Tests generate
`lib/data/data.json`, `data.js`, and `data.schema.json` in a temporary copy using the canonical
`sg-data-pack` loader and schema.

## What it proves

- external `<script type="application/json">` extraction;
- Chinese-name to stable-ID normalization;
- shared entities with stage overlays;
- pairwise relation registry plus hero-radial relation registry;
- `sameAs` identity declaration;
- asset discovery checked against a committed bytes/SHA-1 baseline, plus a tamper-failure test;
- `__fromPack(pack)` deep equivalence against the seven source events;
- library-specific hard rules;
- Data Pack diff impact from a real `entities.*.name` read into `__fromPack`.

## Known boundaries

The source engine's `__fromPack` currently indexes relations by `a::b`. This fixture therefore
certifies the current real data shape, not a general scoped multi-edge engine adapter. It also
exercises data integration only; the engine's full DOM mount and visual regression are separate
follow-up work.
