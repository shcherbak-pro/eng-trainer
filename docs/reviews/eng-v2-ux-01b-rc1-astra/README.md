Independent re-review of the uncommitted ENG-V2-UX-01B-RC1 candidate, 22 November 2026. [Review and verdict](../ENG-V2-UX-01B-RC1-ASTRA.md).

| Evidence | Contents |
|---|---|
| [candidate-before.json](candidate-before.json), [status-before.txt](status-before.txt), [candidate-tracked.diff](candidate-tracked.diff) | Complete working-tree identity, including untracked files; fingerprint `74b28dc7…` |
| [delta-verification.json](delta-verification.json) | Exact reconciliation to original review inventory and RC1 delta |
| [preservation-after.json](preservation-after.json) | All 1,025 path states, HEAD/index, protected and earlier evidence preserved |
| [logs/](logs/) | Initial sandbox failures, successful checks/build/tests, browser commands and font reproduction |
| [browser-summary.json](browser-summary.json) | Original, adjusted, regression, RC1 and focused outcomes kept separate |
| [browser-original/results.json](browser-original/results.json) | Unchanged historical suite: 21/22 in each browser, obsolete family expectation only |
| [browser-adjusted/results.json](browser-adjusted/results.json), [harness-adjustment.json](harness-adjustment.json) | Full 22/22 per engine; exactly one changed line/two expected-family references |
| [browser-regression/results.json](browser-regression/results.json) | Unchanged 16-scenario runner, all pass; layout, slow/failed-font and v1 guards |
| [browser-rc1/results.json](browser-rc1/results.json) | Existing five RC1 scenarios, all pass per engine |
| [browser-focused/results.json](browser-focused/results.json), [browser-focused.mjs](browser-focused.mjs) | Ten independent scenarios per engine: cross-deck identity, focus ownership, collection removal, returned issue names/file context, post-render races, raster fonts, description language |
| [affected-keys.test.ts](affected-keys.test.ts), [vitest.config.ts](vitest.config.ts) | Nine reviewer tests: actual Undo callbacks, explicit links/equal text, unrelated fields, zero-write invalidation, hydration and Reset |
| [fonts/equivalence.json](fonts/equivalence.json), [fonts/originals/](fonts/originals/), [fonts/reproduced/](fonts/reproduced/) | Hash-pinned source downloads, separate deterministic derivation and table/name comparison |
| [source-font-invariants.json](source-font-invariants.json) | Font output byte identity, unchanged parser/model/queue/schema, precise line-ending counts |
| [asset-audit.json](asset-audit.json) | Independent font metadata, published matches, full 30-file artifact and exact v1 differences |
| [description-language-audit.json](description-language-audit.json) | All 39 descriptions and their reviewed classification |
| [before-after-evidence-audit.json](before-after-evidence-audit.json) | Behavioral failures distinguished from missing APIs/modules/new DOM hooks and passing guards |
| [sanitization.json](sanitization.json) | Hashes before/after removal of machine-specific paths from new logs only |

Reproduce from the repository root. Root/v1 dependencies and the existing isolated Playwright installation were already present. No owner browser/profile is used.

```powershell
node docs/reviews/eng-v2-ux-01b-rc1-astra/run-commands.mjs 'npm.cmd run check' 'npm.cmd test' 'npm.cmd run check:v1' 'npm.cmd run test:v1' 'npm.cmd run build:site' 'npm.cmd run verify:content'
node node_modules/vitest/vitest.mjs run --config docs/reviews/eng-v2-ux-01b-astra/vitest.config.ts
node node_modules/vitest/vitest.mjs run --config docs/reviews/eng-v2-ux-01b-rc1-astra/vitest.config.ts
```

`run-browser.ps1` accepts `original`, `adjusted`, `regression`, `rc1` or `focused`. It sets the isolated browser path and clears `ONLY`; use a copied wrapper/new output directory for future runs to preserve this evidence. Browser harness exit codes alone are insufficient: inspect each scenario's JSON status. The complete original and adjusted suites ran separately.

Fonts used Python 3.14.7 with `scripts/fonts/requirements.txt` in `node_modules/.cache/eng-v2-ux-01b-rc1-astra-fonts/`. The exact commands and output are in `logs/commands-1795312758143.json`. `--download` wrote originals and derived assets under this review directory; `--check` only read candidate assets. The license accompanies the evidence fonts in [fonts/OFL.txt](fonts/OFL.txt). The primary-source licensing review used the [upstream OFL](https://raw.githubusercontent.com/google/fonts/main/ofl/sourcesans3/OFL.txt) and [SIL RFN/webfont guidance](https://openfontlicense.org/webfonts-and-reserved-font-names/).

All browser fixtures are synthetic; clipboard calls are stubbed. Only representative glyph, issue-focus, learned-row and fallback screenshots were visually inspected; the full regression geometry survey is automated. No screen-reader, browser-translation or physical-device result is claimed. Initial sandbox failures and the original-family browser failures are retained and distinguished from successful verification.

`capture.mjs` refuses to overwrite its baseline. Use `--verify` only to check preservation. No original review, implementation evidence, RC1 evidence, production source or implementation test was edited.
