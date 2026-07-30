---
name: sg-data-pack
description: >-
  Component-library data-layer normalization pipeline — extracts embedded/scattered business data from component libraries (especially sg-* libraries decomposed from HTML case pages) into a unified Data Pack (entities/aliases/relations/stages/contents/provenance/derivations), and patches engines to prefer injected data. MUST USE when the user mentions: component library data normalization, fixing data-crawl errors or broken data relationships, extracting embedded data into data.json, entity-relationship modeling (character graphs / event stages), Data Pack validation (E1-E16), data provenance/confidence, mount-options data injection, or applying this pipeline to a new component library.
---

# SG Data Pack — Component Library Data-Layer Normalization

## Core Concept

A Data Pack is the **single entry point** for a component library's business data (`lib/data/data.json`). Four rules:

1. **Single source of truth**: embedded defaults in the engine JS are fallback only; production data lives in data.json
2. **ID-only references**: entities live in `entities` (stable slug ids); `aliases` maps crawled names → ids; never reference by name or array index
3. **Reference, never duplicate**: `relations` holds each edge exactly once; `stages` carry id references and overlays only
4. **Fail loudly**: `SGDataLoader.assertValid` validates on mount (E1-E16/W1-W8) — errors are thrown, never silently swallowed; warnings are reported honestly

## CLI (scripts/sg-data-pack, zero-dependency, Node ≥ 18)

```bash
SK=~/.zcode/skills/sg-data-pack/scripts/sg-data-pack   # or the codex/claude install path

node "$SK" extract <path/to/xxx.config.js>          # extract + validate + equivalence test; writes lib/data/{data.json,data.js,data.schema.json}
node "$SK" extract <path/to/xxx.config.js> --check  # validate + equivalence only (no writes)
node "$SK" validate <data.json> [--strict] [--verify-hash]  # standalone validation (--verify-hash detects replaced assets)
node "$SK" rules <libDir> [--strict]                      # execute library-level data rules (data-rules.json)
node "$SK" diff <old.json> <new.json> [--json]            # structural diff between two packs (evolution / recrawl review)
node "$SK" templatize <instances.json> [--out dir]        # derive item template from repeated HTML instances (collection pages)
node "$SK" alias-candidates <data.json> <names.json|txt>     # rank unresolved crawled names
node "$SK" recrawl-skeleton <data.json> <records.json> [--out dir]  # generate cross-check/review report
node "$SK" types <data.json> [--out file.d.ts] [--name N]   # generate TypeScript declarations
node "$SK" loader    # print runtime-validator path (copy into the library's lib/src/)
node "$SK" schema    # print contract schema path
```

## Workflow (for a new component library)

Execute in order; detailed formats live in the referenced files:

### 1. Survey the data landscape

Read the engine `lib/src/*.js` and the example page. List every business-data collection:
which are `options`-overridable vs hardcoded, how entities are identified (key/name/index),
how relationships are encoded, whether multi-stage data shares entities or duplicates them,
and whether prose content is hardcoded in the TEMPLATE.
**Read `references/data-pack-contract.md` first to learn the target structure.**

### 2. Write the extraction config

Copy `assets/extract.config.template.js` and fill it in. Full field reference plus three
real-world patterns (id-based library / Chinese-name-reference library / external-JSON library)
in `references/extraction-config.md`.

### 3. Patch the engine (if not already patched)

Add `__fromPack` + `__resolveDataOptions`, hook into the first line of mount, and make
hardcoded collections overridable. **Copy the standard template in `references/engine-integration.md`**.
Constraint: no rendering-logic changes; behavior must be byte-identical when `options.data` is absent.

### 3b. (Collection / monolith libraries only) Split + templatize

If the engine is a whole-page static template with repeated item groups (card lists,
timelines, leaderboards), first split it into component fragments with **offset-slicing**
(never re-serialize the DOM; see `references/split-monolith.md` for the method and the
pitfalls), then auto-derive item templates:

```bash
node "$SK" templatize items.json --out build/   # items.json = array of per-instance HTML strings
```

Verify group homogeneity *before* parameterizing — a "repeated item" group that templatize
collapses into one giant slot is actually heterogeneous; split those into one-off
components (evidence over plan). Name slots semantically, keep engine ids (Elementor eids
etc.) as data, and extract entities as usual. Sections whose copy is not crawl-prone may
stay static — declare the boundary in DATA-GUIDE.

### 4. Extract + validate

```bash
cp "$(node "$SK" loader)" <lib>/lib/src/sg-data-loader.js
node "$SK" extract <config>          # must be fully green: 0 validation errors, equivalence passed
```

The equivalence test is the **losslessness guarantee**: `__fromPack(pack)` must deep-equal the
embedded defaults. Common failure causes: missing fields in fromPack / key-order changes /
undeduplicated duplicates — fix item by item using the reported diff paths.

### 5. Integrate + regress

Example page: `sg-data-loader.js` → engine → `../data/data.js` → `mount(root, { data: SG_DATA_PACK })`.
Re-run `node "$SK" extract <config> --check` to confirm stability.

### 6. Analyze: derive library-level feature rules

After the pack is green, analyze the page's data characteristics (pack + engine rendering logic +
assets) and produce `lib/data/data-rules.json` (hard/soft rules with evidence, machine-executable
`check` expressions) + `lib/data/DATA-GUIDE.md` (human contributor guide). This serves two goals:
(a) a contract for future page-extension development, (b) guidance for humans supplementing
content and assets. **Follow `references/data-rules-guide.md`** (format, check-expression
convention, evidence discipline). Verify with `node "$SK" rules <libDir>`.

## Rule Cheat Sheet (enforced by the validator)

| Rule | Meaning |
|---|---|
| E5/E7 | references in relations/stages (after alias resolution) must exist in entities — **crawled-name mismatches explode here** |
| E6/E10 | relation.type must be registered in relationTypes; attribute-pair labels must be registered in attributeTypes |
| E11 | local assets referenced by entities/contents/**domain** must be listed in assets (bare filenames resolve via meta.assetBase) |
| E12 | multiple edges on the same (a,b) pair (relationship evolves across stages) must be disambiguated by scope; stage refs canonicalize via resolveId |
| E13 | contents highlights[].ref must resolve to an entity/alias/annotation key — **wrong entity names in prose are caught** |
| E14/E15 | both sides of sameAs must exist; provenance keys must point at real records |
| E16 | derivations: valid kind enum + source path resolvable within the pack + alsoTouches/affects paths validated |
| W5/W6 | below-threshold confidence goes to a review list; same-named entities without sameAs get flagged |
| W7/W8 | provenance missing origin warns; crawl-origin provenance missing sourceUrl warns |

## Crawl-Pipeline Contract (for data producers)

Crawl output may only consist of: `data.json` + `assets/` + the alias table. Requirements:

- Normalize entity names to canonical ids via `aliases` before writing any reference
- Fill provenance with real `origin`/`sourceUrl`/`fetchedAt`/`confidence` (baseline data is 1.0; crawled data uses actual values)
- Before committing, must pass: `node "$SK" validate data.json --strict --verify-hash`

## Deep References

- `references/data-pack-contract.md` — full Data Pack v1.3 contract (field level)
- `references/extraction-config.md` — extraction-config guide with three typical patterns
- `references/engine-integration.md` — engine-patch standard template (copy-paste grade)
- `references/data-rules-guide.md` — library-level feature rules: format, check convention, evidence discipline
- `references/visual-regression.md` — browser visual regression: canonical command, fixed-stability rule, scenarios fingerprint maintenance
- `references/split-monolith.md` — byte-exact split of whole-page static libraries into fragments (offset-slicing), incl. pilot pitfalls
