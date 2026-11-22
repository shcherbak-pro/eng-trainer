# ENG-V2-03 independent review evidence

See [the review report](../ENG-V2-03-ASTRA.md) for the finding, coverage and verdict. All commands run from the candidate worktree. No application or developer-evidence files were changed.

| Evidence | Purpose |
|---|---|
| `preservation-before.json`, `preservation-after.json` | Full candidate/main inventories, candidate fingerprint, final equality |
| `content-oracle.mjs`, `content-oracle.json`, `editorial-mapping.json` | Owner Markdown as the independent editorial source; Git-based legacy reconstruction and mutation probes |
| `released-materials.json` | Independently reconstructed released catalog, including ID-less answers |
| `independent.test.ts`, `vitest.config.ts`, `independent-final.json` | Set/identity, legacy search, malformed generation/runtime and actual collection-service checks |
| `browser-independent.mjs`, `browser-independent.json` | Independent native same-name topic, transactions, persistence operations, routes, shared components and ordinary dialogs |
| `browser-additional.json` | Learn again/Undo/Reset/reload plus complete chip-focus geometry at 390/320 px and enlarged text |
| `*-chip-focused-selected-clipped.png` | Required finding F1 in both engines |
| `race-probe.test.ts`, `race.config.ts`, `reset-race.json` | Original forced Reset schedule against baseline/candidate; expected rejection captured explicitly |
| `commands-native/` | Successful documented checks; `commands/` preserves the initial sandbox filesystem failures |
| `implementation-browser-rerun/` | Fresh outputs from the developer's unmodified 12-scenario runner |
| `budget-comparison.json` | Fresh response-body measurements and baseline shared-component markup comparison |
| `artifact-audit.json` | Candidate artifact reproduction, archived baseline/v1 comparison and scoped-hash probe |
| `*-attempt1.*`, `*-attempt2.*`, `independent-tests.*` | Initial reviewer harness runs; their corrections are explained in the report |
| `hygiene.json` | Sanitization and final evidence inventory |

The review-local `.gitignore` excludes exact candidate backup copies, the patch and disposable baseline/malformed fixtures. These remain on disk for this review. They are not intended as duplicate repository source in a future PR.

Reproduce editorial and independent data checks:

```powershell
node docs/reviews/eng-v2-03-astra/content-oracle.mjs '<path-to-owner-ENG-V2-03-IMPLEMENTATION-TASK.md>'
npx vitest run --config docs/reviews/eng-v2-03-astra/vitest.config.ts
```

For a fresh baseline extraction, `prepare-baseline.mjs` exports `03f1267` under this directory and builds it with the existing dependencies. It refuses to replace an existing extraction. The native runner resolves Playwright and browser binaries from the actual common Git directory and serves only local builds:

```powershell
node docs/reviews/eng-v2-03-astra/prepare-baseline.mjs
node docs/reviews/eng-v2-03-astra/browser-independent.mjs
node docs/reviews/eng-v2-03-astra/browser-independent.mjs learn-again-reset-reload chip-focus-reflow
npx vitest run --config docs/reviews/eng-v2-03-astra/race.config.ts
node docs/reviews/eng-v2-03-astra/artifact-audit.mjs
node docs/reviews/eng-v2-03-astra/preserve.mjs after
```

The Reset diagnostic intentionally permits expected unhandled rejections in its isolated Vitest configuration, records their stacks and asserts that both baseline and candidate reproduce them. It must not be interpreted as an error-free application run.

The documented command runner and budget runner were reused without edits, with outputs directed here. Their exact command arguments are described by their source under `docs/evidence/eng-v2-03/`; resolve the isolated Playwright directory through `git rev-parse --git-common-dir`. The budget comparison uses the new local `runtime/baseline/dist` and candidate `site-dist` under identical Windows build conditions.

All browser profiles contain synthetic data only. Clipboard calls are disabled. Speech synthesis is mocked. Screenshots contain no owner learning data. Public review logs are sanitized; exact local backups are deliberately left byte-identical.
