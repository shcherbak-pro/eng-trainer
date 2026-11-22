# ENG-V2-UX-01B-RC1 — correction evidence

| | |
|---|---|
| Date | 22 November 2026 |
| Scope | Astra's findings F1–F5 ([review](../../reviews/ENG-V2-UX-01B-ASTRA.md)); [handoff section](../../handoffs/ENG-V2-UX-01B.md#corrective-iteration--eng-v2-ux-01b-rc1-22-november-2026) |
| Baseline | HEAD `f14dd4e33de2dfcbd8b80e1b72dbfec4326823d3`, branch `feature/eng-v2-ux-01b-spoken-line` |
| Reviewed candidate | Tree fingerprint `1df5517c9fedb1ef909d74e4788e5f943c40a34ca7f6e8d65f47c9c39b5e0231` (696 paths), matched exactly before any edit |
| Integration | None: nothing committed, staged, pushed or deployed |

This folder is new. Astra's review and evidence, the UX-01B evidence and every other historical file are unchanged ([`preservation.json`](preservation.json)).

## Results

Final run: 22 November 2026, 01:37 UTC. Windows, Node 24.18.0, npm 11.17.0, Playwright 1.65.1 (Chromium 159.0.8154.6, Firefox 159.0). Fonts were prepared with Python 3.14.7, fontTools 4.68.0 and brotli 1.2.1.

| Check | Result |
|---|---|
| `npm run check` / `npm run check:v1` | 0 errors, 0 warnings (250 / 189 files) |
| `npm test` / `npm run test:v1` | 10/10 content and build tests and 288/288 Vitest tests (24 files) / 68/68 |
| `npm run build`, `npm run build:site` | Pass. The site check confirms the six fonts, both licences, the FONTLOG, no Google Fonts and no replaced subsets |
| `npm run verify:content` | Pass: exact built-in content, 566 links, v1 unchanged |
| `git -c core.whitespace=cr-at-eol diff --check` | Clean |
| Astra's `independent.test.ts`, unchanged | 7/7 (reviewed candidate: 3/7) |
| Font check (`scripts/fonts/derive_eng_trainer_sans.py --check`) | Pass: only name IDs 1, 3, 4, 6 differ in each subset |
| UX-01B browser runner, unchanged | 16/16 in each engine |
| Astra's browser harness, unchanged | 21/22 in each engine. The one failure measures the removed family name “Source Sans 3” |
| The same glyph case with the family name adjusted | 1/1 in each engine |
| RC1 browser checks | 5/5 in each engine |
| Protected and historical files | All unchanged (`preservation.json`) |

**Before and after.** The candidate Astra reviewed was rebuilt from HEAD, Astra's captured diff and the pre-RC1 texts in `before-after/reviewed-originals/`. It reproduces Astra's fingerprint `1df5517c…` exactly (`before-after/reviewed-reconstruction.json`). The same tests were then run against it and against the corrected candidate:

| | Reviewed candidate | Corrected |
|---|---|---|
| RC1 regression files (69 tests) | 35 pass, 31 fail, 1 file cannot run (the language table did not exist) | 69 pass |
| Astra's independent tests | 3 pass, 4 fail | 7 pass |

The tests that fail before and pass after cover F1, F2, F3 and F5. The 35 that pass on both are guards and earlier behaviour; the list is in `before-after/summary.json`.

**Notes.**
- The unchanged UX-01B runner still records `fonts.sourceSans: true`. That value comes from `document.fonts.check('16px "Source Sans 3"')`, which browsers also return for a family that is not declared. The RC1 check `f4-font-family-loaded` inspects the declared faces instead: four “Eng Trainer Sans” faces, all `loaded`, and no “Source Sans 3” face.
- In the RC1 runner, Firefox writes the computed `font-family` without quotes. The check normalizes quotes; this concerns RC1's own runner, not Astra's harness.

## Reproduction

From the repository root, with root and v1 dependencies installed:

```powershell
npm run check; npm test; npm run check:v1; npm run test:v1; npm run build; npm run build:site; npm run verify:content
git -c core.whitespace=cr-at-eol diff --check
node node_modules/vitest/vitest.mjs run --config docs/reviews/eng-v2-ux-01b-astra/vitest.config.ts
```

Browsers (an isolated Playwright with its own Chromium and Firefox; never a personal profile):

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = '<isolated-browser-binaries>'
node docs/evidence/eng-v2-ux-01b/browser-check.mjs '<playwright-node_modules>' site-dist '<output-dir>'
$env:REVIEW_OUT = '<output-dir>'; node docs/reviews/eng-v2-ux-01b-astra/browser-independent.mjs
node docs/evidence/eng-v2-ux-01b-rc1/scripts/rc1-browser-check.mjs '<playwright-node_modules>' site-dist '<output-dir>'
```

Astra's harness loads Playwright from `.git/eng-v2-02b-release/tools/node_modules` and writes only to `REVIEW_OUT`. The glyph case with the adjusted family name is the same file with the one-line change in `browser/astra-font-adjustment.diff`.

Fonts, in a fresh Python virtual environment with `scripts/fonts/requirements.txt` installed:

```powershell
python scripts/fonts/derive_eng_trainer_sans.py --download --input-dir <originals> --output-dir <out>
python scripts/fonts/derive_eng_trainer_sans.py --check --input-dir <originals> --output-dir src/assets/fonts
```

With the recorded tool versions, the derivation reproduces the four files byte for byte.

Before and after:
1. `scripts/reconstruct-reviewed.mjs <repo> <work-dir> <target>` rebuilds the reviewed candidate from Astra's `candidate-before.json` and `candidate-tracked.diff`. `<work-dir>` holds `reviewed-originals/` (copied from `before-after/`) and `fonts/originals/`, the four originals, which `--download` fetches. `prepare-lf.cjs` and `split-endings.cjs` show how the two files with mixed line endings were recovered.
2. Run the same Vitest files in that target. The target must not be under `.git`, which Vite does not serve, or under the system temp folder.
3. `scripts/compare-before-after.cjs` compares the two reports.

## Inventory

| Path | Contents |
|---|---|
| `logs/` | The final run of every command, the font check, Astra's independent tests and the four browser runs, with exit codes and the environment |
| `before-after/` | The same tests run against the reconstructed reviewed candidate and against the corrected one (`summary.json`), the compact Vitest reports, the reconstruction record and the pre-RC1 texts it needs |
| `browser/` | Results of the unchanged UX-01B runner, Astra's unchanged harness, the one-line font adjustment of its glyph case (`astra-font-adjustment.diff`) and the RC1 checks, with screenshots |
| `fonts/font-check.json` | Table-by-table comparison of the four original subsets and their renamed derivatives |
| `rc1-delta.json` | Every file RC1 changed, added or removed, with hashes before and after |
| `preservation.json`, `v1-preservation.json` | Protected, review, evidence and historical files; v1 source and build |
| `artifact.json`, `git-status.txt` | The tested site; the complete working-tree status |
| `scripts/` | The RC1 browser checks, the reconstruction and comparison scripts, the collector and the run script |
| `sanitization.json` | Raw and published hashes of every sanitized text file |

## Hygiene

- **Data.** All data is synthetic or built-in material. No owner profile, real learning data or system clipboard was used: each page's clipboard is replaced inside the page.
- **Sanitizing.** Machine-specific paths in logs, results and scripts are replaced with `<repo>`, `<user-home>`, `<user>` and `<run>`.
- **Expected log entries.** The browser logs list only the deliberate failures (fonts refused, the 503 manifest) and the unchanged v1 page's refused Google Fonts request.
