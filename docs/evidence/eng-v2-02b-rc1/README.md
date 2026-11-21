# ENG-V2-02B-RC1 — correction evidence

Date: 2026-11-21. Scope: Fable findings F1/F2 only. Baseline/HEAD: `020babfaf24a14a0a1fdc15c13c90dde00ea9633`; branch: `feature/eng-v2-02b-vocabulary-import`. No integration or deployment was performed.

Read the [corrective handoff](../../handoffs/ENG-V2-02B.md#corrective-iteration--eng-v2-02b-rc1-2026-11-21) and [original independent review](../../reviews/ENG-V2-02B-FABLE.md). The original review and its evidence, the previous implementation evidence, and all 12 release files are unchanged.

## Results

- Static checks: v2 and v1, 0 errors/warnings.
- Tests: 10 content/build, 193 v2 (11 new), 68 v1; all pass.
- Combined build and exact built-in preservation: pass (1,538 records, 566 explicit links, 11 packs).
- Native Chromium 151.0.7922.34 and Firefox 153.0: 3 RC1 scenarios plus 5 original regression groups per engine, all pass.
- No page/console errors, failed requests or RC1 unhandled promise rejections.
- Owner browser storage was never opened; all fixtures and downloads are synthetic.

## Reproduction

Run from the repository root with installed root and v1 dependencies (Node 24.18.0 / npm 11.17.0 were used):

```powershell
npm run check
npm test
npm run check:v1
npm run test:v1
npm run build:site
npm run verify:content
git -c core.whitespace=cr-at-eol diff --check
```

Use a separate Playwright installation and its Chromium/Firefox binaries. Neither the runner nor the application should use a personal browser profile. The optional output path below preserves the checked-in evidence when reproducing:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = '<isolated-browser-binaries>'
node docs/evidence/eng-v2-02b-rc1/browser-check.mjs '<playwright-tools>' node_modules/.cache/eng-v2-02b-rc1/reproduced
node docs/evidence/eng-v2-02b/browser-check.mjs '<playwright-tools>' node_modules/.cache/eng-v2-02b-rc1/reproduced-baseline
```

`<playwright-tools>/node_modules/playwright/index.mjs` must exist. The runner serves `site-dist` at a local `/eng-trainer/` path without an SPA fallback, using the existing native-browser support helper. External fonts load normally. Imported files are local and synthetic.

The two F1 scenarios seed complete, interleaved shared orders through native IndexedDB in the existing schema, then use real UI answers before and after collection deletion. Records include the full before/after session orders and progress, same-text independent IDs, restoration cursor and appended new ID. F2 uses actual Hide/Unhide controls for removed, unrelated imported and built-in entries. No fault injection is used in the new RC1 scenarios. The original regression rerun includes its documented controlled storage-failure injections.

## Inventory and hygiene

| Path | Evidence |
|---|---|
| `logs/` | Static/test/build/content commands and final browser runs |
| `browser/` | RC1 native results, synthetic JSON exports, restored-deck screenshots |
| `baseline-browser/` | Separate rerun of the original five groups per engine |
| `artifact.json` | SHA-256 inventory of the tested combined site |
| `candidate-delta.json` | RC1 before/after file hashes, new files, protected-file verification and Git scope |
| `git-status.txt` | Complete uncommitted candidate, including original review and release files |
| `sanitization.json` | Raw/published log hashes and normalization policy |
| `collect-evidence.mjs` | Evidence collection and scope verification, using ignored local run output |

The initial 404-file snapshot matched all 356 files in Fable's original fingerprint before any correction. `candidate-delta.json` identifies only this iteration's changes; combine it with the unchanged original candidate inventories for the full review scope. It excludes its own hash. The ignored `before.json` snapshot is required only to regenerate the delta, not to run the tests.

New public logs replace machine-specific repository/user/temp paths with placeholders and strip terminal ANSI codes. The raw-to-published hashes apply only to newly produced RC1 logs. No original independent evidence hash changed. Public JSON and screenshots contain synthetic data; dependencies, generated content, build files and browser profiles remain ignored. Intermediate harness failures stay in the ignored cache; the handoff documents their causes.

F3–F6 and prior N1–N7 are deferred. These results cover local desktop Chromium/Firefox, not production, Safari, real mobile hardware or physical quota exhaustion. Existing progress already pruned by an older build cannot be reconstructed.
