# ENG-V2-03 — evidence

| | |
|---|---|
| Date | 22 November 2026 |
| Scope | Learning topics, shared header and Home statistics ([handoff](../../handoffs/ENG-V2-03.md)) |
| Base | `main` at `03f1267f1ef4287580227ce5db67615988c98177`; branch `feature/eng-v2-03-learning-topics` in a linked worktree |
| Integration | None: nothing staged, committed, pushed, merged or deployed |

This folder is new. Historical evidence, reviews, release reports and v1 are unchanged ([`preservation.json`](preservation.json), [`v1-preservation.json`](v1-preservation.json)).

## Results

Final run: Windows, Node 24.18.0, Playwright 1.65.1 with Chromium 159.0.8154.6 and Firefox 159.0. The commands ran from the worktree root.

| Check | Result |
|---|---|
| `npm run check` / `npm run check:v1` | 0 errors, 0 warnings (264 / 189 files) |
| `npm test` / `npm run test:v1` | 15/15 content and build tests and 335/335 Vitest tests (28 files) / 68/68 |
| `npm run build`, `npm run build:site` | Pass; the site check verifies all 14 pack hashes, identities, counts, links and the fonts |
| `npm run verify:content` | Pass: the legacy projection of source and published content equals the release |
| `git -c core.whitespace=cr-at-eol diff --check` and the same checks on new files | Clean |
| Browser checks ([`browser/results.json`](browser/results.json)) | 12/12 scenarios in Chromium and 12/12 in Firefox |
| Response-body budgets ([`budget-and-markup.json`](budget-and-markup.json)) | Pass in both engines; worst total 530,582 B on `#wordIndex` (budget 563,200 B) |
| Released Patterns and Answers markup | Identical to the release in both engines |
| Preservation | 92 pre-existing untracked files of the main checkout byte-identical; its branch, HEAD and index unchanged; the eleven released pack URLs unchanged; v1 built output equal to the released artifact |

## Measurements

**First study content at 390 × 844** (`routes-phone` in `browser/results.json`; identical in both engines). Phrases and Words 203 px, Flashcards 247, Verbs 255, Patterns 188, Answers 164, Reverse practice 163, Speaking prompts 99, Focus list and Collections 107. Topic screens: first subsection at 319 (Conditionals), 430 (Interview English) and 441 px (Small Talk). On Home, the first topic card starts at 639 px; the tab bar starts at 779 px. The header is 47 px on phones.

**Budgets.** Cold load in a fresh context at 390 × 844. The local server sends gzip -9 bodies (WOFF2 as stored); response-body bytes only. In Chromium:

| | Code | Fonts | Content | Total |
|---|---:|---:|---:|---:|
| Released, `#wordIndex` | 88,775 | 193,052 | 230,303 | 512,130 |
| Now, `#wordIndex` | 96,631 | 193,052 | 240,899 | 530,582 |
| Delta | +7,856 | 0 | +10,596 | +18,452 |

The released build is a build of `03f1267`. Its asset names equal those in the production release evidence.

## Reproduction

From the worktree root, with root and v1 dependencies installed and a working directory written as `C:\…`. With a lower-case drive letter, Svelte hashes absolute file names into scoped class names, so local builds would differ from CI.

```powershell
node docs/evidence/eng-v2-03/run-commands.mjs <output-dir>
$env:PLAYWRIGHT_BROWSERS_PATH = '<isolated-browser-binaries>'
node docs/evidence/eng-v2-03/browser-check.mjs '<playwright-node_modules>' site-dist '<browser-output-dir>'
node docs/evidence/eng-v2-03/compare-builds.mjs '<playwright-node_modules>' '<released-dist>' site-dist '<compare.json>'
node docs/evidence/eng-v2-03/collect-evidence.mjs docs/evidence/eng-v2-03 '<browser-output-dir>' '<compare.json>' '<main-checkout>' '<untracked-before.sha256>' '<released-artifact>'
```

`<released-dist>` is `git archive 03f1267` with linked `node_modules`, `node scripts/generate-content.mjs` and `npx vite build`. `<untracked-before.sha256>` is the `sha256sum` list of the main checkout's untracked files, recorded before any change.

## Inventory

| Path | Contents |
|---|---|
| `logs/`, `commands.json` | Every command's output with its exit code, plus the whitespace check of new files |
| `browser/results.json`, `browser/screenshots.json` | All browser scenarios with their measurements; hashes of every screenshot |
| `screenshots/` | Selected screenshots: Home, the three topics, final subsections, Library screens, error screen, 200 % text, narrow and desktop, both engines |
| `budget-and-markup.json` | Response-body budgets per route and engine, released against now, and the markup comparison of released patterns and answers |
| `content-totals.json` | Released and current counts from the generated manifest, and the delta |
| `id-mapping.json` | All 72 editorial IDs with their catalog IDs, subsections, keys, answers and blocks |
| `artifact.json` | Every file of the tested `site-dist` with its hash |
| `preservation.json`, `v1-preservation.json` | Main checkout, pre-existing files, released packs, worktree state; v1 source and built output |
| `git-status.txt` | The worktree's complete status |
| `browser-check.mjs`, `compare-builds.mjs`, `run-commands.mjs`, `collect-evidence.mjs`, `sanitize.mjs` | The scripts that produced this folder |
| `sanitization.json` | Hash of every published file |

## Hygiene

- **Data.** Only synthetic or built-in material was used. Every browser scenario used a fresh, non-persistent context. Requests to other hosts were refused. Speech synthesis and the clipboard were replaced inside the page. No owner profile, learning data or system clipboard was used.
- **Sanitizing.** Machine paths are replaced with `<repo>` and `<user-home>`, the account name with `<user>`, and color codes are removed from logs.
- **Expected log entries.** The browser logs list only the deliberate failures (the 503 manifest of the start-up scenario) and v1's refused Google Fonts request.
