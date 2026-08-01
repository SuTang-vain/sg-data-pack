# Data Rules Guide — Library-Level Feature Rules

After a library's Data Pack passes extraction (all green), the **analyze** step derives library-specific
rules from the pack + engine + assets. Two artifacts, both living in `lib/data/`:

- `data-rules.json` — structured rules (machine-executable / machine-searchable)
- `DATA-GUIDE.md` — human contributor guide generated from the rules

Validate any rules file with: `node scripts/sg-data-pack rules <libDir> [--strict] [--rule <id>]`
(hard-rule failures exit 1; soft failures are warnings unless --strict). `--rule <id>` selects one
known rule after the complete rules document has been structurally validated; unknown or repeated
options/ids are usage errors (exit 2).

## data-rules.json Format (rulesVersion 1.0)

```jsonc
{
  "rulesVersion": "1.0",
  "libId": "sandadui-graph-ts",
  "generatedAt": "YYYY-MM-DD",
  "profile": {
    "archetype": "page archetype, e.g. character-graph / encyclopedia-card / event-timeline",
    "summary": "one-sentence description of the data shape",
    "entityKinds": ["person"],
    "stageModel": "event-driven | story-phase | single-graph | none",
    "heroCentric": true,
    "growthAxes": ["entities", "stages", "relations"],   // which dimensions can grow
    "dataShapeNotes": ["3-6 key shape observations — derived from ENGINE RENDERING LOGIC, not guesswork"]
  },
  "rules": [
    {
      "id": "<lib-prefix>-<kebab-case>",     // e.g. sdd-hero-big-exclusive
      "level": "hard | soft",
      "subject": "human locator string, e.g. entities.*.avatar / stages.*.entities / assets.*",
      "rule": "the rule text (concrete, actionable; no vague words like 'try to' / 'appropriate')",
      "rationale": "why — cite rendering logic or data evidence",
      "evidence": "measured evidence, e.g. '15/15 avatars are .png; 5 sampled at 160px width'",
      "source": "observed | extracted | human",   // induced from data / extracted from page or engine / human-specified
      "check": "JS expression string or null — see below",
      "repairHint": "optional but recommended for hard rules: one-line actionable fix instruction, printed on failure (DesignRepair-style detect→repair). Anchor it to the subject: WHAT to change, WHERE, and HOW (incl. copy-pastable commands when useful).",
      "coveredBy": "E-rule number if already covered by the universal contract (e.g. 'E3/E6'), else null"
    }
  ]
}
```

## subject, scope, and check conventions (hard requirement)

- `subject` is an **unparsed human locator string**. It tells a contributor where to look (for
  example `entities.*.avatar` or `stages.*.entities`); the evaluator does not resolve it,
  interpret wildcards, or use it to select records.
- `check` is a **JavaScript expression string**, evaluated with pack sections in scope:
  `entities / relations / stages / contents / domain / assets / aliases / relationTypes /
   heroRelTypes / attributeTypes / attributeSources / kindNameFields / meta / sameAs /
   provenance / derivations / pack`.
  This scope must stay synchronized with the executor whenever a pack root becomes available
  to rules. In particular, `heroRelTypes`, `attributeSources`, and `derivations` are supported.
- The expression must evaluate to a truthy/falsy value. If you cannot write an executable expression, use `null`.
- **Pseudo-DSL is forbidden** (`all(entities.*, e -> ...)` does not run). Write real JS:
  `Object.values(entities).every(e => ...)`
- After writing, **evaluate every check against the real data.json with node — all must pass**.
  A failing check means either the rule is wrong (fix it) or it describes an aspiration
  (demote to soft and say so), never ship a failing hard rule.
- Set-notation conveniences: use `Object.keys(x).includes(y)`, `new Set(...)`, array spreads —
  plain ES2020 only, no external libraries.

## Rule-Writing Discipline (learned from pilots)

1. **Evidence or silence.** Every rule needs `evidence` from real measurement (node statistics
   over data.json, sips on assets, grep on engine). If you cannot produce evidence, do not write
   the rule — list it in your report as a rejected candidate with the reason.
2. **hard vs soft.** hard = structurally required + preferably machine-checkable
   (field presence, enum membership, reference integrity, format regex). soft = statistical
   distributions (length ranges, count ranges, observed conventions). Never put a distribution
   rule in hard.
3. **Derive from the engine, not intuition.** Check how the engine actually consumes a field
   before ruling on it. Pilot discoveries that changed rules: a `layout` field that is NOT used
   at runtime (engine recomputes), a `color` token with no CSS definition (ghost enum),
   a `desc` truncation that does not exist. Write such findings into `profile.dataShapeNotes`.
4. **Don't re-legislate the universal contract.** If E1-E16 already covers it, set `coveredBy`
   and only write the library-specific delta (e.g. "rel must be one of THESE 4 values because
   the engine's legend is hardcoded").
5. **Statistics must be real.** Length/count rules: compute min/max/median over the actual pack
   with node (full-width chars count as 1). Image rules: sample real files with sips.
6. **Rule count 8-15**, spanning: entity field requirements / asset specs / stage-or-content
   constraints / relationship constraints / extension checklists (add-entity, add-stage-or-content,
   add-relation — one checklist rule each).

## DATA-GUIDE.md Structure (Chinese, for human contributors)

1. Library overview + one-paragraph data.json map
2. "Add a person/entity" checklist (asset specs, fields, description length ranges, rule-id refs)
3. "Add a stage/content block" checklist
4. "Add a relation" checklist (type decision tree when relationTypes has several)
5. "What else can grow" — proactive expansion suggestions from growthAxes
6. Notes: known special cases (sameAs pairs, expected W1 warnings, alias-table usage)

## Typical Findings Worth Writing (from 7 libraries)

- Runtime-synthesized edges (hero-radial from `big+rel`, heroRel auto-complete) — new relations
  must know whether to go into `relations` or `overlay.rel`/`heroRel`
- Stage size ranges the layout algorithm is designed for (e.g. ring ordering tuned for n≤8)
- Label length clamps in the engine (e.g. edge labels clipped at 92/72px pill width)
- Multi-format asset reality (jpg/jpeg/png/webp mixed) vs assumptions
- Two semantically different enums living in overlay vs master edges (write into dataShapeNotes)
- Ghost tokens (fields consumed by string concat but never defined in CSS)
