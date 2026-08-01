# Engine-Patch Standard Template

Goal: make the engine prefer an injected Data Pack while **changing zero rendering logic — behavior
must be byte-identical when `options.data` is absent**.
Technique: convert the pack into the legacy options shape, reusing the existing
`(options && options.x) || defaults` paths.

## Integration Shell (3 spots)

The injection shell is universal; the body of `__fromPack` is an adapter for the library's legacy
shape. The first example below is the **entity-graph adapter**, not a mandatory Data Pack shape.
Plain collections and DOM JSON-script pages should use the dedicated adapters later in this guide.

### ① Insert at the top of the engine IIFE (before mount)

```js
/* ============ SG Data Pack support ============ */
function __fromPack(pack) {
  // Convert per library collection; strip `kind` from entities; resolve stage {a,b} refs back to full edge objects
  var chars = {};
  Object.keys(pack.entities || {}).forEach(function (id) {
    var e = pack.entities[id];
    if (e.kind !== 'person') return;               // filter by the library's actual kinds
    var c = {};
    Object.keys(e).forEach(function (k) { if (k !== 'kind') c[k] = e[k]; });
    chars[id] = c;
  });
  var masterEdges = pack.relations || [];
  function canonical(x) {
    return typeof SGDataLoader !== 'undefined' ? (SGDataLoader.resolveId(pack, x) || x) : x;
  }
  function legacyEdge(r) {
    return { a: canonical(r.a), b: canonical(r.b), type: r.type, label: r.label };
  }
  var allEdges = masterEdges.map(legacyEdge);
  function matchEdge(ref, stageKey) {
    var cands = masterEdges.filter(function (r) {
      return canonical(r.a) === canonical(ref.a) && canonical(r.b) === canonical(ref.b);
    });
    if (ref.id !== undefined) cands = cands.filter(function (r) { return r.id === ref.id; });
    if (ref.type !== undefined) cands = cands.filter(function (r) { return r.type === ref.type; });
    cands = cands.filter(function (r) {
      return !Array.isArray(r.scope) || r.scope.indexOf(stageKey) !== -1;
    });
    if (cands.length > 1) {
      var scoped = cands.filter(function (r) { return Array.isArray(r.scope); });
      if (scoped.length === 1) cands = scoped;
    }
    if (cands.length !== 1) throw new Error('stage relation cannot resolve uniquely: ' + ref.a + '::' + ref.b);
    return legacyEdge(cands[0]);
  }
  var storyModules = (pack.stages || []).map(function (s) {
    return {
      key: s.key, name: s.name, desc: s.desc,
      chars: (s.entities || []).map(canonical),
      layout: s.layout,
      edges: (s.relations || []).map(function (ref) { return matchEdge(ref, s.key); }),
      roles: s.overlay
    };
  });
  var d = pack.domain || {};
  return { chars: chars, allEdges: allEdges, storyModules: storyModules, works: d.works };
}
function __resolveDataOptions(options) {
  if (!options || !options.data) return options;
  if (typeof SGDataLoader !== 'undefined') {
    var __r = SGDataLoader.assertValid(options.data);        // fail loudly, never silently
    // Warnings are reported honestly: the validator may surface W1/W2/W4/W5/W6/W7/W8
    // (unreferenced entities, missing asset hashes, low confidence, missing origin, etc.).
    // These are non-blocking but must not be swallowed on mount.
    if (typeof console !== 'undefined' && console.warn && __r && __r.warnings && __r.warnings.length) {
      __r.warnings.forEach(function (w) { console.warn('[SGDataLoader] ' + w); });
    }
  } else if (typeof console !== 'undefined' && console.error) {
    console.error('[engine] options.data not validated: include lib/src/sg-data-loader.js first');
  }
  var d = __fromPack(options.data);
  var merged = {};
  Object.keys(options).forEach(function (k) { merged[k] = options[k]; });
  Object.keys(d).forEach(function (k) { if (d[k] !== undefined) merged[k] = d[k]; }); // pack wins
  return merged;
}
/* ========== SG Data Pack support (end) ========== */
```

### ② First line of mount

```js
function mount(root, options) {
  options = __resolveDataOptions(options);   // first line
  // ……all original logic untouched
}
```

### ③ Make hardcoded collections overridable + export

```js
// before: var heroRel = { ... };        after:
var heroRel = (options && options.heroRel) || { ... };

// before: global.MyLib = { mount: mount, create: create };   after:
global.MyLib = { mount: mount, create: create, __fromPack: __fromPack };
```

## Pattern C: DOM JSON-script adapter

When the legacy data is the whole options payload in a DOM JSON script, preserve that parse path as
the no-pack fallback and make the injected path additive:

```js
function __fromPack(pack) {
  // Rebuild the exact legacy JSON object. Keep this adapter library-specific.
  return {
    items: Object.keys(pack.entities || {}).map(function (id) {
      var entity = pack.entities[id];
      return { id: id, label: entity.label, image: entity.image };
    }),
    categories: (pack.domain && pack.domain.categories) || []
  };
}

function __resolveDataOptions(options) {
  if (!options || !options.data) return options;
  if (typeof SGDataLoader !== 'undefined') SGDataLoader.assertValid(options.data);
  var legacyOptions = __fromPack(options.data);
  var merged = {};
  Object.keys(options).forEach(function (key) { if (key !== 'data') merged[key] = options[key]; });
  Object.keys(legacyOptions).forEach(function (key) { merged[key] = legacyOptions[key]; });
  return merged;
}

function readDomDefaults() {
  var element = document.getElementById('sg-data');
  if (!element || !element.textContent) throw new Error('Missing #sg-data JSON defaults');
  return JSON.parse(element.textContent);
}

function mount(root, options) {
  options = __resolveDataOptions(options);
  var data = options && options.items ? options : readDomDefaults();
  // Original rendering logic continues unchanged and consumes `data`.
}
```

The extraction equivalence mapping compares the sliced JSON object with `__fromPack(pack)`. It does
**not** execute `mount`, parse the live DOM, collect browser errors, or compare pixels. Those are
separate runtime/visual assurances and remain `NOT_ASSESSED` until evidence is supplied.

## Plain collection adapter

A collection library does not need graph-shaped variables:

```js
function __fromPack(pack) {
  return {
    cards: Object.keys(pack.entities || {}).map(function (id) {
      var entity = pack.entities[id];
      return { key: id, title: entity.title, summary: entity.summary };
    })
  };
}
```

Return the exact legacy collection names consumed by the engine. Do not manufacture `chars`,
`allEdges`, or `storyModules` unless those are real engine inputs.

## Variants

| Scenario | Approach |
|---|---|
| Chinese-name-reference library | fromPack rebuilds legacy structures using `entities[id].name` to restore original names |
| Edge-less library (pure entity table) | fromPack converts entities/domain only; skip relations/stages logic |
| Implicit-edge library (all nodes link to center) | pack.relations are explicit for the contract only; fromPack outputs no edges (the engine never needed them) |
| Library with scoped multi-edges | pass s.key per stage when building storyModules; matchEdge filters by a::b, then resolves multiple hits via scope containing stage.key |
| Data in a DOM JSON script | keep the original parse path as fallback: `(options && options.x) || JSON.parse(#id)` |
| contents prose injection | after `root.innerHTML = TEMPLATE` and **before event binding**, run `querySelector(sel).innerHTML = body` per the CONTENT_TARGETS table |

## Iron Rules

1. **Zero rendering-logic changes** — all edits live at the data entry point
2. **Byte-identical behavior without options.data** — `__resolveDataOptions` is a pass-through
3. **Configured equivalence is a hard gate** — every extracted literal is mapped or explicitly ignored with evidence; mapped `__fromPack(pack)` fields deep-equal the embedded defaults
4. **No silent data anomalies** — dangling refs/duplicates in source data are reported, never filtered away
5. The loader must be copied to `lib/src/sg-data-loader.js` (`node scripts/sg-data-pack loader` prints its path)

## Example-Page Integration

```html
<script src="../src/sg-data-loader.js"></script>
<script src="../src/<engine>.js"></script>
<script src="../data/data.js"></script>
<script>MyLib.mount(document.getElementById('mount'), { data: SG_DATA_PACK });</script>
```
