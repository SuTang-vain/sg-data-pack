# Data Pack v1.2 Contract (Field Level)

> Formal schema: `scripts/lib/data-pack.schema.json`; runtime validator: `scripts/lib/sg-data-loader.js`.
> Top-level fields: schemaVersion / meta / entities / aliases / relationTypes / relations / stages /
> attributeTypes / attributeSources / contents / domain / assets / sameAs / provenance / kindNameFields.

## Top-Level Structure

```jsonc
{
  "schemaVersion": "1.2",
  "meta": {
    "id": "library-id", "title": "Title",
    "hero": "core entity id (optional)",
    "source": "data source", "fetchedAt": "YYYY-MM-DD",
    "assetBase": "../assets/",          // resolution prefix for bare-filename assets (optional)
    "confidenceThreshold": 0.7,          // W5 threshold (optional, default 0.7)
    "generatedBy": "@generated marker"
  },
  "entities": { /* required, see below */ },
  "aliases": { /* crawled name -> id */ },
  "relationTypes": { /* relationship-enum registry */ },
  "relations": [ /* master edge list */ ],
  "stages": [ /* stage/event views */ ],
  "attributeTypes": { /* attribute-label registry */ },
  "attributeSources": ["entities.*.relations", "domain.facts"],
  "contents": { /* long-form content */ },
  "domain": { /* library-specific data, free-form */ },
  "assets": { /* asset manifest */ },
  "sameAs": [["idA", "idB"]],
  "provenance": { /* record-level provenance */ },
  "kindNameFields": { "work": "title" }
}
```

## entities (required, non-empty)

Global entity table; keys are stable slug ids (`^[a-z][a-z0-9_-]*$`). Each entity requires `kind`
and a name field (`name` by default; overridable per kind via `kindNameFields`, e.g. work→title).
All other business fields are preserved as-is. **Never** reference by name or array index;
crawled names are normalized through aliases.

## aliases

`{"嬴政": "yingzheng"}`. Targets must exist (E4); values may use the `{id, context}` form
for disambiguation (same name, different people).

## relationTypes / relations

```jsonc
"relationTypes": { "enemy": { "label": "对立", "color": "#d94b4b" } },
"relations": [
  { "a": "rulaifo", "b": "wukong", "type": "enemy", "label": "五行山压", "scope": ["tianting"] }
]
```
- `type` must be registered in relationTypes (E6)
- `scope` (v1.1+): this edge is only active in the listed stages. When multiple edges share the
  same (a,b) pair, a stage's `{a,b}` reference must resolve to exactly one edge via scope
  (or type) (E12)

## stages

```jsonc
{ "key": "tianting", "name": "大闹天宫", "desc": "…",
  "entities": ["wukong"],              // id subset (preserve order when it drives rendering)
  "layout": { "wukong": [0.5, 0.4] },  // normalized coordinates in [0,1] (E8)
  "relations": [{ "a": "rulaifo", "b": "wukong" }],  // references into master edges; never duplicate
  "overlay": { "wukong": { "rel": ["主角"], "desc": "…" } } }  // stage-specific persona/description
```
Event-level metadata (year/summary/image, etc.) is preserved as extra stage fields.
**Never embed entity business fields inside a stage** (use overlay); never duplicate master edges.

## attributeTypes / attributeSources (v1.1+)

Label registry for attribute pairs (`[[label, value, ...]]` or `{label, ...}`) (E10).
`attributeSources` declares the paths to check: `entities.*.<field>` or `domain.<path>`.

## contents (v1.1+)

Prose/timeline content lifted out of the template HTML:

```jsonc
"timeline-2016": {
  "kind": "timeline-item", "title": "…", "time": "2016.08",
  "body": "<p>…</p>", "bodyFormat": "html-subset",
  "highlights": [{ "text": "白月光", "ref": "baiyueguang" }]  // ref must resolve to an entity/alias/domain.notes key (E13)
}
```

## assets

Keys are asset paths as they appear in the data (`'../assets/x.webp'`; bare filenames are
resolved via `meta.assetBase` before registration):

```jsonc
"../assets/x.webp": { "exists": true, "bytes": 12345, "hash": "sha1:…", "sourceUrl": "…" }
```
E11: every local asset referenced by entities/contents must be registered (http(s)/data: URIs
are exempt). W2 missing file, W4 missing hash.

## sameAs / provenance (v1.2)

```jsonc
"sameAs": [["yingzheng", "qinshihuang"]],   // two entities referring to the same real-world subject (E14)
"provenance": {
  "entities":  { "yingzheng": { "origin": "example-json-contract", "sourceUrl": null,
                                "fetchedAt": "2026-07-27", "confidence": 1.0, "note": "…" } },
  "relations": { "yingzheng::lisi": { /* key format: a::b */ } },
  "contents":  { "timeline-2016": { "origin": "template-html-contents" } }
}
```
Parallel-section design: never embedded into the entities themselves, so engines need no changes.
confidence below threshold → W5 review list.
Origin conventions: `engine-embedded-defaults` / `example-json-contract` / `template-html-contents` / `crawl:<source>`.

## Full Rule Set

- **Errors** (thrown on mount): E1 version / E2 meta / E3 required entity fields / E4 aliases /
  E5 dangling edge refs / E6 unregistered relationship enum / E7 stage refs / E8 coordinate out of
  range / E10 unregistered attribute / E11 unregistered asset / E12 scope not resolvable /
  E13 content refs / E14 sameAs / E15 provenance keys
- **Warnings** (recorded, non-blocking): W1 unreferenced entity / W2 missing asset / W3 edge
  missing label / W4 asset missing hash / W5 low confidence / W6 suspected duplicate entity

## derivations (v1.3, optional)

Declarative contract for **non-trivial derivations** between pack data and rendering.
Not executable code — it answers three questions for every derived presentation:
WHAT kind of derivation, from WHICH source, consumed by WHOM. Motivation: without it,
the mapping only exists in engine source (insertion-order timelines, repeated tracks,
lookup-rebuilt events), so data producers cannot know the blast radius of a change.

```jsonc
"derivations": {
  "carouselTrack": {
    "kind": "repeat",                          // repeat | insertion-order | lookup-rebuild | scope-resolution | projection | reference-only
    "source": "domain.carouselTrack.entityIds", // pack path, '*' wildcard allowed (E16-checked)
    "consumers": ["components/carousel-3d-item.js"], // engine function or component file
    "affects": ["div.slot1-carousel-track"],    // optional: affected selectors/regions
    "note": "6 milestones rendered as 12 track items for the infinite loop; editing one milestone changes both copies"
  }
}
```

Rules:
- Only model **non-trivial** derivations (repeat / ordering / rebuild / resolution / projection);
  plain field interpolation does not belong here.
- E16: valid kind enum, source path must resolve within the pack (invalid root = error,
  unresolvable = warning), consumers non-empty, note non-empty.
- `consumers`/`affects` existence on disk is NOT checked by the universal validator
  (loader is path-agnostic) — assert those in library-level rules instead.
- When a derivation's source changes, `sg-data-pack diff` output should be read together
  with the derivation's note (impact surface).
