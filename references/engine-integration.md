# Engine-Patch Standard Template

Goal: make the engine prefer an injected Data Pack while **changing zero rendering logic — behavior
must be byte-identical when `options.data` is absent**.
Technique: convert the pack into the legacy options shape, reusing the existing
`(options && options.x) || defaults` paths.

## Standard Patch (3 spots)

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
  var allEdges = (pack.relations || []).map(function (r) {
    return { a: r.a, b: r.b, type: r.type, label: r.label };
  });
  var byPair = {};
  allEdges.forEach(function (e) { byPair[e.a + '::' + e.b] = e; });
  var storyModules = (pack.stages || []).map(function (s) {
    return {
      key: s.key, name: s.name, desc: s.desc,
      chars: (s.entities || []).slice(),
      layout: s.layout,
      edges: (s.relations || []).map(function (ref) {
        // when multiple edges share (a,b), resolve via scope (isomorphic to loader E12)
        var hit = byPair[ref.a + '::' + ref.b];
        return hit;
      }),
      roles: s.overlay
    };
  });
  var d = pack.domain || {};
  return { chars: chars, allEdges: allEdges, storyModules: storyModules, works: d.works };
}
function __resolveDataOptions(options) {
  if (!options || !options.data) return options;
  if (typeof SGDataLoader !== 'undefined') {
    SGDataLoader.assertValid(options.data);        // fail loudly, never silently
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
3. **Equivalence is a hard gate** — `__fromPack(pack)` deep-equals the embedded defaults; never skip it
4. **No silent data anomalies** — dangling refs/duplicates in source data are reported, never filtered away
5. The loader must be copied to `lib/src/sg-data-loader.js` (`node scripts/sg-data-pack loader` prints its path)

## Example-Page Integration

```html
<script src="../src/sg-data-loader.js"></script>
<script src="../src/<engine>.js"></script>
<script src="../data/data.js"></script>
<script>MyLib.mount(document.getElementById('mount'), { data: SG_DATA_PACK });</script>
```
