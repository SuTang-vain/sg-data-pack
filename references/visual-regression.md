# Visual Regression Guide (ui-dismantler quality gate)

Browser visual regression for sg-* component libraries uses the `quality` command of the
ui-dismantler toolchain (three-track comparison: pixelmatch ≤2%, 45 computed CSS props ≥0.98,
selector/nav/font integrity). It opens the library's own `lib/examples/*.html` in system Chrome
and screenshots the `#mount` root across 4 viewports (desktop/tablet/mobile/tiny).

## Canonical command

```bash
cd /path/to/ui-dismantler
node dist-ts/cli.js quality <lib>/original.html \
  --lib <lib>/lib \
  --manifest <lib>/manifest.json \
  --scenarios <lib>/scenarios.json \          # omit if absent
  --visual-artifacts <lib>/artifacts-regression \
  --browser-mode shared-browser --browser-concurrency 1 \
  --browser-stability fixed --browser-resource-cache run-local \
  --out <lib>/quality-regression-report.json
```

Exit code = gate result. Key gates: pixel-diff / computed-style / viewport-matrix /
scenario-viewport-matrix / scenarios / coverage.

## Hard-won operational rules

1. **Always use `--browser-stability fixed` for pages with continuous animation.**
   Libraries with breathing avatars, autoplay carousels, or rAF physics loops never reach a
   stable DOM signature; `adaptive` mode times out — and the timeout is reported on the
   **reference** side ("dom/layout/assertion stability timeout"), which looks like a regression
   but is not. Diagnosis pattern: stabilityFailures > 0 + pixelDiff = 0 + computedStyle ≥ 0.98
   = flakiness, not regression. Use `--browser-concurrency 1` as well.
2. **After any toolchain analyzer upgrade, re-sync scenarios.json `covers` fingerprints.**
   The coverage gate matches eligible interaction fingerprints (from the CURRENT analyzer)
   against scenario `covers` arrays (written under the OLD analyzer). Drift shows as
   verifiedCoverage dropping with interactions that are visibly exercised by passing scenarios.
   Fix by semantically exact covers mappings, equivalenceGroups (for interactions driving the
   same state transition), or adding real scenarios for uncovered transitions.
3. **equivalenceGroups require `representativeFingerprint`** (must be one of
   `memberFingerprints`) — undocumented; the CLI exits with an error naming it.
4. reference.png is re-screenshotted from original.html on every run (no stored-baseline mode);
   regression = rerun and compare the new generated output / gate exit code.
5. Engine changes that keep `options.data` as an additive path are transparent to the tool:
   it opens the example page as-is; pack resolution happens inside the page.

## Data-driven pages checklist (post Data-Pack migration)

- Example page must be self-contained: `sg-data-loader.js` → engine → `../data/data.js`
  → `mount(root, { data: SG_DATA_PACK })` — the tool does not inject anything.
- External http images in the page may trip the external-availability gate; localize assets
  into `lib/assets/` when possible.
- After changing data (not engine), rerun the full gate: `extract` (regenerates pack) →
  `validate --verify-hash` → `rules` → `quality`.
