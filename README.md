# sg-data-pack

Component-library data-layer normalization pipeline — extract embedded data into validated, provenance-tracked Data Packs.

An agent skill (Codex / Claude Code / ZCode) plus a zero-dependency Node CLI. It normalizes
scattered/embedded business data in component libraries (especially sg-* libraries decomposed
from HTML case pages) into a unified **Data Pack**: entities, aliases, relations, stages,
contents, assets, sameAs, and record-level provenance — then patches the library engine to
prefer injected data, with a losslessness guarantee.

## Why

- **Crawl errors stop silently corrupting pages** — the validator fails loudly on mount
  (rules E1–E15: dangling references, unregistered enums, coordinate out of range, …)
- **Relationship chaos ends** — ID-only references, aliases for crawled-name normalization,
  master edges stored once, stages reference instead of duplicating
- **Provenance built in** — per-record origin/sourceUrl/fetchedAt/confidence, low-confidence
  review lists (W5), fuzzy duplicate detection (W6), asset sha1 verification

## Install (pick your agent)

```bash
git clone https://github.com/SuTang-vain/sg-data-pack.git

# then symlink (or copy) into your agent's skills directory:
ln -s "$PWD/sg-data-pack" ~/.zcode/skills/sg-data-pack    # ZCode
ln -s "$PWD/sg-data-pack" ~/.codex/skills/sg-data-pack    # Codex
ln -s "$PWD/sg-data-pack" ~/.claude/skills/sg-data-pack   # Claude Code
```

## CLI quick start

```bash
SKILL=~/.zcode/skills/sg-data-pack/scripts/sg-data-pack

node $SK extract <path/to/config.js>          # extract + validate + equivalence test
node $SK extract <path/to/config.js> --check  # validate only (regression)
node $SK validate <data.json> --strict --verify-hash
node $SK loader    # print runtime-validator path (copy into a library's lib/src/)
node $SK schema    # print contract-schema path
```

Zero dependencies (acorn is vendored). Requires Node ≥ 18.

## Documentation

- `SKILL.md` — workflow and rule cheat sheet (loaded by agents)
- `references/data-pack-contract.md` — Data Pack v1.2 field-level contract
- `references/extraction-config.md` — extraction-config guide + three real-world patterns
- `references/engine-integration.md` — engine-patch standard template
- `assets/extract.config.template.js` — annotated config template for a new library

## License

MIT
