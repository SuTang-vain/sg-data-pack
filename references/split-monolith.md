# Splitting a Monolithic Page Library into Component Fragments (Byte-Exact)

Reference technique for stage-2 decomposition: a library whose engine is one giant
inline HTML template (whole-page static transpile) gets split into per-component
fragments **without changing a single output byte**.

Pilot: `diegovz-home-0722-ts/tools/split-components.js` (living implementation, 28 fragments).

## Method: offset-slicing (never re-serialize)

1. **Extract the cooked template string** from the engine with acorn
   (`TemplateLiteral.quasis[].value.cooked`). Do not slice the raw source:
   escape sequences like `\/` cook differently.
2. **Locate component elements** with parse5 `parseFragment(html, {sourceCodeLocationInfo: true})`
   — you get `startOffset/endOffset` into the *original string* for every element.
   (parse5 is an npm dependency here; this step is not zero-dependency.)
3. **Slice the original string** at those offsets. Re-serializing the DOM is forbidden
   (attribute order/entities/whitespace would drift).
4. **Replace child-component ranges with placeholder tokens** inside each parent fragment:
   `@@SG_COMP:<id>@@` for nested components, `@@SG_ITEM:<type>:<index>@@` for collection items.
   Only replace *direct* children (maximal ranges) — filter out anything nested in another child.
5. **Skeleton** = the original string with all top-level component ranges tokenized.
6. **Verify**: token-resolution reassembly must equal the cooked template byte-for-byte.
   Print the first-diff offset on mismatch.

## Pitfalls (all hit in the pilot)

- **Cooked ≠ raw**: template literals containing `\/` (77 occurrences in the pilot).
- **Nested ranges**: replacing all descendants (not just direct children) corrupts offsets.
- **Class/id prefix adaptation**: transpiled libraries often prefix selectors (`sg-`); adapt
  plan selectors before matching.
- **"Repeated item" groups may be lies**: verify instance homogeneity *before* parameterizing
  (token-LCS `templatize` will show 1 giant slot / structural divergence). The pilot had a
  3-"item" footer group that was actually 3 unrelated blocks, and a section badge misfiled
  as a list item. Split them out as one-off components instead — evidence over plan.
- **Registry init order**: if fragment modules create the global registry, renderer modules
  must defensively ensure sub-registries exist (`D.renderItem = D.renderItem || {}`).

## After the split: parameterize collections

Run `sg-data-pack templatize` on each homogeneous item group (see SKILL.md step 3b),
name slots semantically, and extract them into Data Pack entities. Keep per-instance
engine ids (Elementor eids, repeater ids) **as data** — CSS hooks and scenario replay
selectors depend on them.

## Equivalence gates to keep green

1. reassembly === cooked template (split time)
2. worktree render === HEAD render (evolution mode) / === monolith (acceptance mode)
3. `__fromPack(defaults)` deep-equals `__fromPack(data.json)`
4. full visual regression on the split library (see visual-regression.md)
