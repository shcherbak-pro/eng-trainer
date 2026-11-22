# ENG-V2-03-RC1 independent review evidence

See [the review](../ENG-V2-03-RC1-ASTRA.md): **CHANGES_REQUIRED** for height-only resizing while a chip retains keyboard focus. Original fixed-size horizontal clipping is corrected.

| Evidence | Purpose |
|---|---|
| `preserve.mjs`, `preservation-before.json`, `preservation-after.json`, `scope.json` | Exact candidate/main provenance, RC1 delta, and final equality |
| `artifacts.mjs`, `artifacts.json` | Authenticate 92 original source/evidence files and 33 before-build files; verify 29 preserved rebuilt artifacts |
| `focused.mjs`, `browser-support.mjs`, `focused.json` | Independent real-keyboard before/after oracle and lifecycle checks |
| `viewport-resize.mjs`, `viewport-resize.json`, `viewport-resize.log` | Reproduced acceptance failure; runner exits 1 |
| `viewport-resize-attempt1.json` | First observation of the same resize failure, preserved before the confirming run |
| `shared-controls.mjs`, `shared-controls.json` | Four other chip-style consumers, before/after comparisons in both engines |
| `shots/` | Representative original, corrected, wrapped, and remaining-failure screenshots |
| `commands/` | Fresh documented project gates and actual counts |
| `independent.test.ts`, `vitest.config.ts`, `independent.json` | Existing 24-test suite with output-path-only adaptations |
| `prepare-runners.mjs`, `runner-adaptations.json` | Exact historical-runner substitutions and hashes |
| `implementation-browser/` | Fresh output of the unchanged 12-scenario implementation runner |
| `budget.mjs`, `budget.json` | Established cold-load method, refreshed against original and RC1 |
| `tools.json`, `final-checks.json` | Actual tool versions and public evidence hygiene |

Commands were run from the candidate worktree with its existing root/v1 dependencies. The isolated native browsers are resolved through `git rev-parse --git-common-dir`. No dependencies or browser profiles were installed or changed.

Exact sequence used:

```powershell
node docs/reviews/eng-v2-03-rc1-astra/preserve.mjs before
node docs/reviews/eng-v2-03-rc1-astra/run.mjs gates
node docs/reviews/eng-v2-03-rc1-astra/artifacts.mjs
node docs/reviews/eng-v2-03-rc1-astra/prepare-runners.mjs
node docs/reviews/eng-v2-03-rc1-astra/run.mjs independent
node docs/reviews/eng-v2-03-rc1-astra/run.mjs browser
node docs/reviews/eng-v2-03-rc1-astra/run.mjs budget
node docs/reviews/eng-v2-03-rc1-astra/run.mjs focused
node docs/reviews/eng-v2-03-rc1-astra/shared-controls.mjs
node docs/reviews/eng-v2-03-rc1-astra/viewport-resize.mjs
node docs/reviews/eng-v2-03-rc1-astra/preserve.mjs after
node docs/reviews/eng-v2-03-rc1-astra/final-audit.mjs
```

The viewport probe was run twice in fresh contexts to confirm the finding. The confirming version records its hash and exits 1 if the resized chip is clipped. Its expected failing command is separate from the passing project gates and primary focused scenarios.

These are evidence-producing commands, not an instruction to overwrite this review. For later review, use a new output location. Initial preservation and original-build authentication refuse to replace existing captures. Do not invoke historical review/evidence writers against their old output directories.

`focused.json` reports nine passing RC1 scenarios and 126 geometry observations per engine. Its two original-build calibration scenarios produce 56 visibility failures per engine and zero other failures. These repeated observations are not 126 distinct browser scenarios. The separate viewport probe contributes a failing tenth RC1 scenario in each engine, with before/resize/refocus measurements. Deliberately delivered canceled animation callbacks belong to the labelled lifecycle scenario; the resize failure uses ordinary native viewport/keyboard behavior.

The 0.75 CSS px tolerance allows fractional text metrics versus integral clipping dimensions. Full 2px outlines plus 2px offsets, readable non-space characters, clipping ancestors, viewport edges, and the fixed navigation all participate in the oracle. Screenshots are original browser captures, with no display transform used as a text-enlargement substitute.

`local/` is ignored and contains exact candidate copies, the authenticated original build, and disposable malformed fixtures. Public evidence uses repository-relative names and synthetic state. Historical evidence, application code, implementation tests and the main checkout were preserved.
