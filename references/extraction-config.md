# Extraction Config Guide

A config is a CommonJS module that tells the CLI where the defaults live in the engine, how to
convert them into a spec-compliant pack, and how to verify the configured equivalence surface.
Template: `assets/extract.config.template.js`.

`extract` is a source-to-pack bootstrap operation. Its baseline is the configured engine/HTML literals,
not an existing `lib/data/data.json`. Use `--compare-existing` to compare the fresh in-memory pack with
the current output. A divergent existing pack is never overwritten unless `--force` is explicit.

## Full Field Reference

```js
module.exports = {
  libId: 'my-lib-ts',                    // library id (= pack.meta.id)
  libDir: '/abs/path/to/my-lib-ts',      // library root (absolute path)
  engineFile: 'lib/src/my-lib.js',       // engine file (relative to libDir)
  globalName: 'MyLibrary',               // engine global name (read after requiring the engine)
  schemaVersion: '1.3',                  // optional, default 1.3
  assetDir: 'lib/assets',                // optional physical asset root, relative to libDir

  literals: [                            // default-data literal slicing (equivalence baseline)
    // JS literal: pattern matches up to and including `||` or `=`; acorn parses the expression from there
    { key: 'chars', pattern: /var chars = \(options && options\.chars\) \|\|/, ctx: { IMG: '../assets/' } },
    // JSON embedded in HTML: `file` targets another file; with json:true, reads to the next </script>
    { key: 'events', file: 'lib/examples/my.html', pattern: /<script id="sg-event-data" type="application\/json">/, json: true }
  ],

  meta: { title: '…', hero: 'heroId', source: '…', fetchedAt: 'YYYY-MM-DD' },

  buildPack(defaults) { /* defaults.<literal key> -> pack */ },

  equivalence: [                         // fromPack(pack)[from] vs defaults[lit] (deep-equal)
    { lit: 'chars', from: 'chars' }
  ],
  // Every literal must be mapped or explicitly ignored with evidence:
  // equivalenceIgnore: [{ lit: 'rendererDefaults', reason: 'Renderer-only; covered by visual regression VR-1' }],
  sortKeys: { chars: (x, y) => 0 },      // optional: sort arrays before comparing (order-insensitive)
  domainChecks(pack) { return { errors: [], warnings: [] }; },  // optional: library-level domain validation
  domainSchema: { type: 'object' }       // optional: domain extension written into data.schema.json
};
```

## Literal Slicing Notes

- The end of the `pattern` match is where expression parsing begins — **the pattern must include the trailing `||` (or `=`)**
- Variables referenced inside the literal (e.g. `IMG + "x.webp"`) are injected via `ctx`
- Data inside a template string: slice the whole TEMPLATE first (`pattern: /var TEMPLATE = /`, eval
  into a cooked string), then extract with regex inside buildPack. In minified files, comma-chained
  declarations make acorn overrun — split the declarations into separate statements first
- The equivalence test `require`s the engine file: the engine must be an IIFE/UMD that only defines
  functions on load and never touches the DOM. This is a trusted-code requirement, not a sandbox.
- `assetDir` controls the physical filesystem root. `meta.assetBase` remains the logical prefix used
  to resolve bare asset references into manifest keys; the two settings are intentionally separate.
- Equivalence only proves the declared mappings. Renderer constants and actual DOM mount/visual behavior
  require runtime or visual evidence and must not be described as passed by this check.

## buildPack Conversion Patterns

### Pattern A: id-based library (smoothest)

Source data already uses semantic keys (e.g. `chars.wukong`). Directly: entities = chars + `kind`
field; aliases = `name→id`; relations = deduplicated explicit edges; in stages, chars→entities,
edges→`{a,b}` references, roles→overlay. **Master edges = union of explicit edges (dedup by
`a::b::type::label`); multiple edges on the same (a,b) pair need `scope`.**

### Pattern B: Chinese-name-reference library (needs idMap)

Source data references people by name and duplicates entity copies per stage (e.g. each event
carries full person records):
1. **Hand-write an idMap** in the config (Chinese name → pinyin slug; cross-check every person in the data)
2. entities hold canonical fields only (name/kind/avatar from first occurrence; differences go to overlay)
3. Stage-copy contextual fields (role/deed/impact) all go into stage.overlay
4. fromPack rebuilds the legacy structure by looking up original names via entity.name — the
   equivalence test verifies the round trip is lossless

### Pattern C: external JSON-script library

Data lives in a `<script type="application/json">` tag in the example HTML: use the `file + json:true`
literal mode; everything else follows pattern A/B. The engine's data path
(`options.x || JSON.parse(#id)`) stays untouched — the pack flows through it via fromPack.

### Making implicit edges explicit

Source data where "every node implicitly connects to the center" (no explicit edge array):
generate relations as `{a: centerId, b: nodeId, type: node.rel, label: node.rel}` and set
meta.hero = centerId.

## Provenance Stamping (mandatory since v1.2)

At the end of buildPack, generate with a generic stamp function (never hand-write entries):

```js
pack.provenance = {
  entities: Object.fromEntries(Object.keys(pack.entities).map(id => [id, {
    origin: 'engine-embedded-defaults', sourceUrl: null, fetchedAt: '2026-XX-XX',
    confidence: 1.0, note: 'Baseline data (embedded in original case page); original sourceUrl lost'
  }])),
  relations: Object.fromEntries(pack.relations.map(r => [r.a + '::' + r.b, { /* same */ }])),
  // with contents: contents: Object.fromEntries(Object.keys(pack.contents).map(k => [k, { origin: 'template-html-contents', ... }]))
};
```

## Equivalence-Test Troubleshooting

| Diff shape | Common cause |
|---|---|
| `$.x: missing on right` | fromPack dropped a field (check for allow-listed keys) |
| `$.x[i]: array length differs` | over-aggressive dedup / stage.entities order lost |
| `$.x.y: "A" !== "B"` | restored the id instead of the original Chinese name after conversion |
| edges mismatch | master-edge dedup key missing label/type, or stage refs mismatched |

## Common Pitfalls

1. **Alias collides with an entity id** (E4): alias keys must not equal any existing id
2. **fromPack returning undefined fields**: `__resolveDataOptions` skips undefined during merge,
   but explicit undefined keys can still break equivalence — only include keys with values
3. **HTML escaping**: JSON inside a template string may contain `<\/script>`/`\"` escapes —
   eval the template literal first, then extract
4. **Never silently drop data**: dangling refs/duplicates in the source must either be fixed via
   aliases or reported — filtering them out is forbidden
