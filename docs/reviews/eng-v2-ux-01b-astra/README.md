# ENG-V2-UX-01B Astra evidence

Independent review of the uncommitted Spoken Line candidate, 22 November 2026. [Report](../ENG-V2-UX-01B-ASTRA.md).

| Evidence | Purpose |
|---|---|
| [candidate-before.json](candidate-before.json), [status-before.txt](status-before.txt), [candidate-tracked.diff](candidate-tracked.diff) | Full nonignored candidate fingerprint and Git state before verification |
| [preservation-after.json](preservation-after.json) | Candidate paths, index and HEAD unchanged |
| [logs/](logs/) | Initial environment failures, successful required checks and the separate failing review tests |
| [summary.json](summary.json), [native-combined.json](native-combined.json) | Results with corrected harness cases selected; 17 pass / 5 fail per native engine |
| [regression/results.json](regression/results.json), [regression/shots/](regression/shots/) | Unchanged implementation runner, 16/16 per engine; 158 screenshots |
| [native/results.json](native/results.json) | First independent run, including two subsequently corrected harness assumptions |
| [native-corrected/results.json](native-corrected/results.json) | Reset dialog/background inertness and downloaded-template ordering, both corrected and passing |
| [native-additional/results.json](native-additional/results.json) | Independent blocked startup, Learn again save failures, actual export filenames |
| [native-failures-final/results.json](native-failures-final/results.json) | Final focused reproduction of application failures, including page/console errors and unhandled rejections |
| [independent.test.ts](independent.test.ts), [vitest.config.ts](vitest.config.ts) | Seven separate mounted/state cases: four expose stale Undo, three pass |
| [browser-independent.mjs](browser-independent.mjs) | Independent synthetic-data native UI/race/storage/measurement harness |
| [asset-audit.json](asset-audit.json), [google-fonts-reference.css](google-fonts-reference.css) | Exact font versions/hashes/provenance, published font identity, 29-file artifact inventory, v1 text differences and 101-file protection check |
| [sanitization.json](sanitization.json) | Original/published hashes for newly sanitized evidence |

Reproduce from the repository root with the already installed root/v1 dependencies and existing read-only Playwright runner:

```powershell
node docs/reviews/eng-v2-ux-01b-astra/verify-commands.mjs 'npm.cmd run check' 'npm.cmd test' 'npm.cmd run check:v1' 'npm.cmd run test:v1' 'npm.cmd run build:site' 'npm.cmd run verify:content'
node node_modules/vitest/vitest.mjs run --config docs/reviews/eng-v2-ux-01b-astra/vitest.config.ts
$env:PLAYWRIGHT_BROWSERS_PATH = (Resolve-Path '.git/eng-v2-02b-release/browsers').Path
node docs/evidence/eng-v2-ux-01b/browser-check.mjs (Resolve-Path '.git/eng-v2-02b-release/tools/node_modules').Path (Resolve-Path 'site-dist').Path 'docs/reviews/eng-v2-ux-01b-astra/regression-rerun'
$env:REVIEW_OUT = 'docs/reviews/eng-v2-ux-01b-astra/native-rerun'
node docs/reviews/eng-v2-ux-01b-astra/browser-independent.mjs
node docs/reviews/eng-v2-ux-01b-astra/asset-audit.mjs --references
node docs/reviews/eng-v2-ux-01b-astra/capture.mjs --verify
```

Use `ONLY` for a comma-separated set of scenario names. The browser harness records per-case status; inspect JSON rather than treating the process exit code as the verdict. The separate Vitest command intentionally fails against this candidate. Do not rerun `capture.mjs` without `--verify` over the original fingerprint.

Browser data/profiles are disposable, requests are local except the separately identified public-font provenance fetch, and clipboard calls are replaced with an in-page stub. No owner clipboard contents are accessed. The review never stages/commits or modifies production files. The report distinguishes native UI observations from direct retained-callback tests, accepted deviations, harness corrections and unperformed checks.
