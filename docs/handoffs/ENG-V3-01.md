# ENG-V3-01 — Implementation handoff

| | |
|---|---|
| Date | 23 November 2026 |
| Developer | Fable (Claude Code) |
| Status | **Implemented and verified locally; ready for independent review.** Nothing was staged, committed, pushed, merged, deployed or published. |
| Scope | The dual-product foundation: one source tree that builds the released v2 unchanged and an experimental v3 that is not published |
| Evidence | [`docs/evidence/eng-v3-01/`](../evidence/eng-v3-01/README.md) |
| Reference | [Products and routes](../architecture/PRODUCTS-AND-ROUTES.md) describes the result for developers |

## 1. Decisions and reviewed design

The owner's six decisions for this milestone, as given in the task:

1. Compile-time product constants, with a guarded lazy import and provable exclusion from the stable build.
2. An immutable lock of the 33 released files (28 of v2, 5 of v1), anchored to the Linux Pages artifact of commit `498705a`.
3. One Pages publisher. A committed publish flag per route; v3 stays unpublished; no workflow input or manual run can bypass it.
4. An independent `eng-trainer-v3` database at schema version 1: the six existing stores plus `meta`.
5. Separate generated content trees, and an empty v3 overlay that yields the released catalog. The entry ledger is deferred.
6. The line-ending policy stays as it is.

The design is the ENG-V3-00 architecture, corrected in RC1 and re-reviewed by Astra with the verdict `READY_FOR_V3_01`. Those documents are uncommitted and live in the ENG-V3-00 worktree (`.worktrees/eng-v3-00`). They were read from there, in full, and are not copied into this branch:

| Document | SHA-256 of the file as read |
|---|---|
| `docs/plans/ENG-V3-00-ARCHITECTURE.md` | `6ef2b936fc876a5e5e72546a9d08fddb1e2c0daa3034fde8d56396d3c84966a3` |
| `docs/plans/ENG-V3-00-CONTENT-AND-MIGRATION.md` | `f37d810546f011081a29bcff6dd0268c4f602a4795c790da61c6de31e2a2c861` |
| `docs/plans/ENG-V3-00-FEASIBILITY.md` | `32514b09b5f6b7ad9950b2946c5ba0b6c964fe47b8baabef42e3c37f4d2a213e` |
| `docs/plans/ENG-V3-00-RC1-CORRECTIONS.md` | `c62e1cff8dd3a34f76a65092d742df78b273607e45037a96b70fc935e1e6e6ab` |
| `docs/reviews/ENG-V3-00-ASTRA.md` | `963445fbc8442e230f540baa8e32df88d5f8aa611102c10e50dcdfdc7c8f25e7` |
| `docs/reviews/ENG-V3-00-RC1-ASTRA.md` | `4329e03c7e04e8c5a8075412b396fe05b7b4a4ca0b77c8209dc93a22ad55f246` |

The first five hashes equal the ones in the RC1 review, so the implementation follows the reviewed text.

## 2. Baseline, branch and preserved work

- **Base.** `498705a075e6f71b04e22e4437c50ec587de38dd`, the squash commit of PR #6 and the released ENG-V2-03. `git ls-remote` showed remote `main` at the same commit when work started.
- **Branch and isolation.** `feature/eng-v3-01-foundation`, created from that commit in a new linked worktree, `.worktrees/eng-v3-01`. HEAD is still the base. The work is uncommitted and nothing is staged.
- **Line endings of the worktree.** Git on this machine converts text files to CRLF on checkout. A build from such files differs from the released Linux artifact in eight files, by carriage returns only (measured, see the [evidence](../evidence/eng-v3-01/README.md#line-endings)). The worktree's tracked files were therefore written with the repository's own LF line endings, by passing the option to the one checkout command. No Git setting was changed, no tracked content was normalized, and the repository's line-ending policy is as before.
- **Protected workspaces.** The main checkout (92 untracked files), the ENG-V2-03 worktree (63) and the ENG-V3-00 worktree (61, including its 55 evidence files) were fingerprinted before the new worktree was created and after the last run. All three are byte-identical, with unchanged HEADs and nothing staged ([`preservation.json`](../evidence/eng-v3-01/preservation.json)). Nothing was built, installed, cleaned or checked out in them.
- **Unchanged in the candidate.**
  - `v1/`, `content/catalog.json`, `content/packs/`, the frozen content fixtures, every earlier review and evidence folder.
  - Dependencies and both lockfiles. `npm ci` ran in the new worktree only (root, then `v1/`).
  - The Pages triggers, the deployment job and its permissions.
- **Tools and network.**
  - Playwright 1.65.1 with Chromium 159.0.8154.6 and Firefox 159.0 from the earlier release folder under `.git/`, read-only. Nothing was installed.
  - Network use: `git ls-remote`; one read of each of the 33 public production files for the lock cross-check, and three of them once more for a comparison.
  - One unintended request: in the first trial of the browser script, the frozen v1 page asked Google Fonts for its icon font, which is v1's released behaviour. The script now blocks and records requests to other origins, and the recorded runs contacted only the local server.
  - No model weights were downloaded. No real browser profile was used.
- **Instructions.** The parent `AGENTS.md` describes Angular web-school work. This Svelte repository follows the explicit task. Its general rules were kept: this repository only, no commits, and `npm run build` before reporting.

## 3. Summary

| Area | Result |
|---|---|
| Stable v2 and v1 | The assembled site is **byte-identical** to the release: all 33 files, same paths, sizes and SHA-256. The released 15 script tests and 345 application tests all still pass. |
| Products and routes | `site.config.json` with a validated reader that fails closed. The product is a build-time choice; the stable product is the default. |
| Publication | A committed `publish` flag per route. v3 is `false`. No argument, environment variable or workflow input reaches it. |
| Experimental v3 | Builds into `dist-v3/` with its own base path, its own database and one lazy placeholder screen. It is not in the Pages artifact. |
| Storage | `eng-trainer-v3`, version 1, seven stores. It never opens `eng-trainer-v2` and never touches `localStorage`. No migration, copy or backup. |
| Content | Generated per product into separate folders. The empty overlay yields the released manifest and all 14 packs. |
| Gates | Seven gates before the Pages upload, and 13 deliberate faults that prove they fail. |
| Rehearsal | A route swap and its rollback, built locally. Rollback reproduces the 33 released files exactly. |
| Browser | 84 of 84 checks in Chromium and in Firefox, in disposable contexts with synthetic data. |

## 4. What was implemented

### 4.1 Products, routes and the publish flag

- [`site.config.json`](../../site.config.json): site base, three products, three routes, one `publish` flag per route.
- [`scripts/site-config.mjs`](../../scripts/site-config.mjs): the only reader. It validates the file and returns it frozen. The build, both assemblies, the gates, the rehearsal and the tests all use it.
- It rejects: unknown products and keys; missing, duplicate and malformed routes; routes named like a build folder; path traversal, absolute paths and backslashes; folders that overlap each other, the sources, the tools, v1 or an assembly; a changed stable identity; a moved v1; a `publish` value that is not a boolean; a site without a published root.
- The stable product's database, folders and absent pronunciation capability are fixed in the reader. A configuration edit cannot turn the stable product into something else.
- `loadSiteConfig()` takes no argument. The reader, the assembly and the gate scripts read no environment variable and no command-line argument, and a test checks that. The workflow has no inputs.
- A test pins `"publish": false` for v3. Publishing needs a reviewed change of the file **and** of that test.

### 4.2 Compile-time constants and the lazy seam

- `vite.config.ts` reads `ENG_PRODUCT` (default `stable-v2`) and passes five constants to the code through Vite `define`: `__ENG_PRODUCT__`, `__ENG_DATABASE__`, `__ENG_PRONUNCIATION__`, `__SITE_BASE__`, `__ENG_VERSION_LINKS__`. Types and rules are in [`src/product.d.ts`](../../src/product.d.ts).
- Five shared source files changed for it, and the stable build is still byte-identical:

| File | Change |
|---|---|
| `src/storage/database.ts` | Database name and version from the constants; the experimental schema |
| `src/app/navigation.ts` | The experimental screen's label and route, behind `__ENG_PRONUNCIATION__` |
| `src/app/App.svelte` | One guarded branch, last in the screen list, with the dynamic import |
| `src/app/AppShell.svelte`, `src/features/settings/SettingsPage.svelte` | The link to v1 starts at `__SITE_BASE__` |

- **A finding during implementation.** The first version put the product condition inside the `try` block of the database upgrade handler. The stable script then changed: same size, other identifier names. The cause: the bundler does not remove unused code inside `try` blocks, so the experimental schema function stayed in the stable chunk and shifted the minifier's name order. The lock caught it at once. The condition now sits before the `try` block. The rule is written in `src/product.d.ts` and in the architecture document, and a test checks it in the sources.
- The experimental-only folder is `src/features/pronunciation/`, with one file, `PronunciationPlaceholder.svelte`. Shared code reaches it through exactly one guarded dynamic import; a test checks that as well.
- **The placeholder screen.** It says that pronunciation practice is not part of this build, names the product and the database, and links to the other versions. It has no control, and uses no microphone, audio, recognition, model, Worker, cache or network. It exists so that compile-time exclusion can be proven on a real lazy chunk. It is not a feature.
- **Entry page.** A Vite plugin, loaded for the experimental product only, adds `noindex`, a product marker and "(experimental v3)" to the title. `index.html` itself is unchanged.

### 4.3 Storage

- `stable-v2`: `eng-trainer-v2`, version 2, the six stores and the released migrations. Unchanged behaviour, checked by the released tests and by a literal contract test.
- `experimental-v3`: `eng-trainer-v3`, version 1, created in one step: the six shared stores and `meta`. `meta` gets `schema` (1) and `createdAt` in the same transaction, so the database exists completely or not at all. Two tests inject a failure and find no database afterwards and no unhandled rejection.
- `readAll()` returns the six learning stores only. The state services never see `meta`.
- Tests and both browsers show: v3 opens only `eng-trainer-v3`; a seeded v2 database is deeply equal after v3 start-up and use; v1's `localStorage` records are unchanged; on a fresh origin `eng-trainer-v2` is never created.

Two names on one origin are a logical separation only. This milestone makes no durability, backup or security claim (section 10).

### 4.4 Addresses

- Content, assets and the brand link use the product's own base path, as before.
- The two links to v1 now use the site base. From `/eng-trainer/v3/` they would otherwise have pointed to `/eng-trainer/v3/v1/`.
- `scripts/check-site.mjs` takes each product's base from the route list instead of the literal `/eng-trainer/assets/`, for fonts too.

### 4.5 Content

- `node scripts/generate-content.mjs` without an argument is the stable product and writes `public/data/` exactly as before.
- With `experimental-v3` it rebuilds `.variant/experimental-v3/public/` from nothing: the static files of `public/` and the product's own `data/`.
- [`content/v3/overlay.json`](../../content/v3/overlay.json) must be empty: no blocks, no changes, no other file beside it. It names the released manifest; if the released sources ever build another manifest, the experimental build stops.
- [`src/test/fixtures/released-catalog-v2.lock.json`](../../src/test/fixtures/released-catalog-v2.lock.json) pins the released manifest and its 14 packs. Both products must generate exactly that.
- No entry ledger, target revision, deprecation or vocabulary change was implemented.

### 4.6 Assemblies

| Command | Routes | Target | Purpose |
|---|---|---|---|
| `npm run assemble` | published only | `site-dist/` | The Pages artifact: v2 and v1, without `v3/` |
| `npm run assemble:test` | all | `.site-test/` | Local browser checks. Ignored by Git, never uploaded. |

The assembly empties its target first. Before it deletes anything it refuses a missing build, a build that contains a folder or file named like any configured route (published or not), a route outside the configuration, and two products at one path.

### 4.7 Gates and the released-site lock

`npm run check:products` ([`scripts/product-gates.mjs`](../../scripts/product-gates.mjs)) examines `site-dist/`, the folder that is uploaded, and `dist-v3/`:

1. **Released-site lock:** exactly the 33 released files. Extra, missing and changed files fail; hidden files count.
2. **Unpublished routes:** no file at the path of an unpublished route.
3. **Stable chunks:** one script, one stylesheet, and the entry page names exactly those.
4. **Stable tokens:** none of 17 speech, model, Worker and remote-runtime tokens, and none of 7 traces of the experimental product.
5. **Stable content:** the released manifest and 14 packs.
6. **Experimental content:** the same.
7. **Experimental build:** its own database and base path, a lazy placeholder chunk, `noindex`, and none of the 17 feature tokens.

The lock, [`scripts/locks/released-site.files.json`](../../scripts/locks/released-site.files.json):

- It was written from the inventory of the released Linux artifact (workflow run 45049070378), recorded in the ENG-V2-03 production evidence. No hash comes from a local build.
- Cross-checks: the live site serves the same 33 files; the unchanged baseline built from LF files gives the same 33 files; so does the candidate. Details are in [`lock-provenance.json`](../evidence/eng-v3-01/lock-provenance.json).
- A test pins a digest of its file list (`fad43c4f…`). Editing the lock is therefore always a visible, deliberate change of two files.
- Governance, as decided: v3 work must pass the lock unchanged. The lock is not rebased to make a change pass. Only a separately approved stable release replaces it.

`npm run check:negative` proves that the gates fail: 13 cases, among them one changed byte, an extra and a hidden file, the unpublished product in the site, colliding routes, and two real stable builds in which the experimental screen is reachable.

### 4.8 Workflow

[`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml) keeps its triggers, its single build job, the deployment job and its permissions. Five steps were added to the build job, in sequence:

- `npm run test:v3` after the v2 tests, and `npm run build:v3` after the v2 build;
- `npm run check:negative` and `npm run rehearse:promotion` after the site check;
- `npm run check:products` as the **last step before the upload**. A test checks that nothing runs between the gate and the upload.

The workflow still uploads `./site-dist` only, once.

### 4.9 Promotion rehearsal

`npm run rehearse:promotion` builds two arrangements into `.rehearsal/` from the same sources. The promoted route list exists in memory only.

- **Promoted** (v3 at the root, v2 under `v2/`): each product keeps its product name and database. Links to v1 stay at the site base. The experimental product's link to the stable version follows the route list to `/eng-trainer/v2/`. The archived v2 has a new entry page, script and stylesheet, because addresses are compiled in; its other 25 files and all 5 files of v1 are byte-identical to the release.
- **Rollback** (the committed list again): the rebuilt site is the 33 released files exactly, and the experimental build equals its normal build.
- The browser checks switch one running origin to the promoted site and back. Each product shows the state it saved before, and both databases keep their names and versions.

### 4.10 Tests

- The suite runs once per product, never in parallel: `npm test`, then `npm run test:v3`.
- Shared tests take addresses and the database name from the product under test ([`src/test/product.ts`](../../src/test/product.ts)). The literal values of both products are pinned in [`src/product.contract.test.ts`](../../src/product.contract.test.ts).
- **No released assertion was removed or weakened.**
  - Ten assertions in four test files named a literal address or database name (`/eng-trainer/data/…`, `/eng-trainer/v1/`, `/eng-trainer/#index`, `eng-trainer-v2`). They now take the value from the product under test, and the contract test asserts each of those literals for the stable product.
  - Five route-inventory assertions add the list of experimental screens, which is empty for the stable product. A new stable-only test pins the exact released screens, labels and destinations.
- Nine tests of the stable upgrade path run for the stable product only: the experimental database starts at version 1 and has no older version.

| File | Tests | Why stable only |
|---|---|---|
| `src/storage/openStorage.test.ts` | 4 | A tab that holds database version 1 blocks the upgrade to 2 |
| `src/app/App.test.ts`, "blocked database upgrade at start-up" | 2 | The same, at application level |
| `src/collections/service.test.ts` | 3 | Blocked upgrade, failed upgrade and real upgrade from version 1 |

- One addition to two existing test files: their `afterEach` now waits for dynamic imports to settle. Without it, a lazy screen that is still loading when a test ends breaks the next test of the experimental run. It is a no-op for the stable product.
- **Time limits.** One complete run failed: two whole-application tests of the experimental suite timed out at 5 seconds while the machine was slower overall. No assertion failed. One of the two is a released test. In response the experimental suite has a limit of 10 seconds per test, and the new whole-application tests have an explicit limit of 15 seconds. The stable suite keeps the released limit of 5 seconds. The record is in the [evidence](../evidence/eng-v3-01/README.md#a-timing-failure).

## 5. Verification

The table shows the last ordered run on the complete candidate; every command exited with 0. Of three complete runs, the first and the third passed, and the second failed on a time limit (section 4.10). Commands, counts and logs are in the [evidence](../evidence/eng-v3-01/README.md#commands-and-results).

| Command | Result |
|---|---|
| `npm run check` | 272 files, 0 errors, 0 warnings |
| `npm test` | 49 script tests (15 released, 34 new); 352 application tests pass, 20 skipped (experimental only) |
| `npm run test:v3` | 357 application tests pass, 15 skipped (9 stable upgrade path, 6 stable only) |
| `npm run check:v1`, `npm run test:v1` | 0 errors; 68 tests pass |
| `npm run build` | `index-CggR75Uk.js` and `index-DFaGuSQ9.css`, the released files |
| `npm run build:v3` | 29 files; lazy chunk 1.74 kB |
| `npm run build:site`, `npm run verify:content` | Pass |
| `npm run check:negative` | 13 of 13 faults refused |
| `npm run rehearse:promotion` | 20 of 20 checks |
| `npm run check:products` | 7 of 7 gates |
| `npm run assemble:test` | 62 files, structural check passes |
| `git diff --check`, whitespace of new files | Clean |
| Browser, Chromium and Firefox | 84 of 84 each |

Application tests: all 345 released tests pass for the stable product. 27 are new: 1 for both products, 6 for the stable one and 20 for the experimental one.

## 6. Candidate fingerprints

| Artifact | Files | Result |
|---|---|---|
| `site-dist/` | 33 | Digest `fad43c4f965be026af034ccc2393cf88a95ea4dcb52192b6b36d60dc1f068b58`, **equal to the lock** |
| `dist-v3/` | 29 | Digest `51219e087edb51811c94709bd4c5c859f7288f00dd1b7bed60f9551ac0c880ab` |

Experimental files that differ from the stable build:

| File | Bytes | SHA-256 |
|---|---|---|
| `index.html` | 1,431 | `39323b9a86a350800b742664374810f492f45608f6a1be415e7eed9ec1582b18` |
| `assets/index-BZffMJE-.js` | 269,018 | `4d8bdc51ce5c3bd0efad12dbbf8114244f87cd7f46ca4ba4f47380082e11d0eb` |
| `assets/index-pTid4Cqy.css` | 48,265 | `88ad10030406a73910e362a5c93124bc327b637c075aedd1e892e508d7cd2182` |
| `assets/PronunciationPlaceholder-DQxki5-Y.js` | 1,740 | `5127f0ffa47d99a4c944b1433388caa1bb980ddbb4db475d85235da5766d2bef` |

The source files of the candidate, with sizes and hashes, are in [`candidate-files.json`](../evidence/eng-v3-01/candidate-files.json).

## 7. Changed files

**Modified (26).**

| Group | Files |
|---|---|
| Application | `src/app/App.svelte`, `src/app/AppShell.svelte`, `src/app/navigation.ts`, `src/features/settings/SettingsPage.svelte`, `src/storage/database.ts` |
| Build and tools | `vite.config.ts`, `vitest.config.ts`, `tsconfig.json`, `package.json` (scripts only), `.gitignore`, `scripts/generate-content.mjs`, `scripts/assemble-site.mjs`, `scripts/check-site.mjs`, `.github/workflows/deploy.yml` |
| Tests | `src/test/content.ts`, `src/test/database.ts`, `src/app/App.test.ts`, `src/app/App.home.test.ts`, `src/app/navigation.test.ts`, `src/content/builtIn.test.ts`, `src/state/progress.test.ts`, `src/storage/openStorage.test.ts`, `src/collections/service.test.ts` |
| Documents | `README.md`, `CHANGELOG.md`, `docs/architecture/BUILT-IN-CONTENT.md` |

**New.**

| Group | Files |
|---|---|
| Configuration and content | `site.config.json`, `content/v3/overlay.json` |
| Locks | `scripts/locks/released-site.files.json`, `src/test/fixtures/released-catalog-v2.lock.json` |
| Application | `src/product.d.ts`, `src/features/pronunciation/PronunciationPlaceholder.svelte` |
| Scripts | `scripts/site-config.mjs`, `product-content.mjs`, `product-run.mjs`, `site-assembly.mjs`, `site-checks.mjs`, `product-gates.mjs`, `check-products.mjs`, `check-negative.mjs`, `assemble-test-site.mjs`, `rehearse-promotion.mjs` |
| Tests | `scripts/site-config.test.mjs`, `product-content.test.mjs`, `product-gates.test.mjs`; `src/test/product.ts`, `src/product.contract.test.ts`, `src/storage/experimentalDatabase.test.ts`, `src/app/App.product.test.ts` |
| Documents | `docs/architecture/PRODUCTS-AND-ROUTES.md`, this handoff, `docs/evidence/eng-v3-01/` |

Ignored and not part of the candidate: `dist-v3/`, `.variant/`, `.site-test/`, `.rehearsal/`, `.local/`.

## 8. Differences from the ENG-V3-00 file plan

The architecture listed expected files for this milestone. The implementation differs in these points:

| Plan | Implemented | Reason |
|---|---|---|
| `scripts/build-product.mjs` | `scripts/product-run.mjs` | One wrapper for build, test and dev server of a product |
| `scripts/check-products.mjs` | The same, plus the library `scripts/product-gates.mjs` | The negative cases and the rehearsal run the very same gate code on other folders |
| `index.html` edited for v3, with a page Content-Security-Policy | `index.html` unchanged; a Vite plugin adds `noindex` and a product marker; **no policy** | See section 9 |
| Sibling links "from the site base and the route list" | The v1 links use the site base. Links from the route list exist only on the experimental placeholder screen. | Nothing more is needed until another product is published |
| — | `scripts/check-negative.mjs`, `scripts/rehearse-promotion.mjs`, `scripts/assemble-test-site.mjs` | Required by the task: negative tests, rehearsal, test-only assembly |

## 9. Deviations, limitations and untested areas

- **Linux CI has not run.** Nothing was pushed. Local runs used Windows and Node 24 with LF files; CI uses Linux and Node 22. The lock was confirmed against the live site and by local builds, not by a CI run of this candidate.
- **The released artifact was not downloaded again.** The lock relies on the inventory recorded at release time. This environment has no authenticated GitHub client, and Pages artifacts expire.
- **No page Content-Security-Policy for v3.** The task permits one and forbids presenting it as a Worker boundary. The policy belongs to V3-02 stage A, where it is designed together with the Worker bootstrap and tested on a server without policy headers. Adding an untested policy now would only create a claim. `index.html` and its inline theme script are untouched.
- **A CRLF checkout fails the lock** for eight files, by carriage returns only. The gate says so. This is the measured consequence of the unchanged line-ending policy.
- **On Windows, a working directory with a lower-case drive letter** changes Svelte's scoped class names, as before this milestone. The new wrapper scripts normalize the directory; plain `npm run build` does not. The gate's failure message names this cause.
- **Static text in the "blocked upgrade" screen says "version 2".** It is shared code, and that screen cannot appear in v3 while its database has one version. It needs a product value when v3 gets a second schema version.
- **The experimental entry page carries `noindex` on every route**, also at the root in the rehearsal. Whether a promoted product keeps it is a decision for the promotion.
- **After promotion `/eng-trainer/v3/` answers 404.** A redirect or link policy is a later decision.
- **`tsconfig.json` has a new `paths` entry** for the test helper that reads the product's generated content. It does not affect the build: the lock passes.
- **Timing of the test suites.** Several released whole-application tests need 2.5 to 4 seconds against a limit of 5. They can time out on a loaded machine, as before this milestone, and the workflow now runs a second suite after the first. The experimental suite has a wider limit; the stable suite was left as released. A failing test step stops the job before the upload, so a timeout can delay a deployment but cannot publish anything wrong.
- **v1 requests its icon font from Google Fonts.** Released behaviour of the frozen v1, unchanged. It is noted here because the browser checks had to block it.
- **Not tested:** Safari, phones, a real Pages deployment, storage pressure, and anything with real learning data.

## 10. Future gates that are not part of this milestone

ENG-V3-01 contains no recording, speech dependency, model, cache, Worker, history, migration, ledger engine or backup. It therefore claims none of the following. The three independently reviewed controls remain outstanding:

- **R1 — origin-wide durability.** Browser storage of one origin shares one quota and one eviction exposure; a separate database name protects nothing. Before any large model cache is used on a real profile: a validated full backup, a **recovery path that the user can actually use for each exposed section (v1, v2 and v3)**, and safe handling of capacity, eviction and downloads.
- **R2 — network boundary.** A tested Worker bootstrap and dependency loader on Pages-like hosting without policy headers, strict-local browser recognition, and no cloud fallback.
- **R3 — spoken-target revisions.** The effective spoken-target revision contract, before any transcript feedback, attempt history or content patch that affects an exercise target.

Also outstanding: before V3-02 stage B, the first real-device memory and latency checks must **pass on disposable profiles**. An agreed device list alone is not enough.

Publishing `/v3/` remains a separate owner decision and a separate, reviewed change.

## 11. Reproduction

```bash
npm ci && npm run install:v1

npm run check
npm test                      # stable-v2
npm run test:v3               # experimental-v3, after the stable suite, never at the same time
npm run check:v1 && npm run test:v1

npm run build                 # stable-v2 -> dist/
npm run build:v3              # experimental-v3 -> dist-v3/
npm run build:site            # v2, v1, assembly of site-dist/, structural check
npm run verify:content

npm run check:negative        # 13 deliberate faults
npm run rehearse:promotion    # route swap and rollback, into .rehearsal/
npm run check:products        # the gates on site-dist/ and dist-v3/
npm run assemble:test         # three products into .site-test/
```

`node docs/evidence/eng-v3-01/run-checks.mjs` runs the same sequence and rewrites the logs. The browser commands are in the [evidence README](../evidence/eng-v3-01/README.md#running-again).

**ENG-V3-01 — IMPLEMENTED / READY FOR INDEPENDENT REVIEW**

---

## 12. ENG-V3-01-RC1 — Safe generation destinations

| | |
|---|---|
| Date | 23 November 2026 |
| Developer | Fable (Claude Code) |
| Status | **Corrected and verified locally; ready for independent re-review.** Nothing was staged, committed, pushed, merged, deployed or published. |
| Scope | The one mandatory finding of the independent review, **F1 (P1)**: the configuration reader accepted folders that a script then deleted. Nothing else was redesigned. |
| Review | [`docs/reviews/ENG-V3-01-ASTRA.md`](../reviews/ENG-V3-01-ASTRA.md), verdict `CHANGES_REQUIRED`. It and its evidence are unchanged. |
| Evidence | [`docs/evidence/eng-v3-01-rc1/`](../evidence/eng-v3-01-rc1/README.md) |

Sections 1 to 11 above are the reviewed record and were not edited. [Section 12.9](#129-what-this-section-replaces-in-sections-1-to-11) lists the statements in them that this section replaces.

### 12.1 The candidate before the correction

Before the first edit, the working files were compared with the inventory in the review ([`candidate-authentication.json`](../evidence/eng-v3-01-rc1/candidate-authentication.json)).

| Check | Result |
|---|---|
| HEAD and branch | `498705a075e6f71b04e22e4437c50ec587de38dd`, `feature/eng-v3-01-foundation`; nothing staged |
| All 2,192 reviewed files, digest in the review's format | `6449e48d5b6401febb3a930c80264be547a1954edb2916acb1a020990b0faf0d`, equal to the review's value |
| The 78 changed or new files | each one has the size and SHA-256 that the review recorded |
| Added since the reviewed state | the review only: its report and 63 evidence files |
| The report `ENG-V3-01-ASTRA.md` | SHA-256 `225714cd59d8f659707a39f7dce31a1e96432d2feee03a6bdf79892e1d25548b` |

### 12.2 Root cause

Three things were true together.

1. **The reader judged a folder by its text.** It compared the configured value, case-sensitively, with a list of protected folder names. The list held no file names, and text is not what the disk resolves: `SRC` is `src` on a disk that ignores case.
2. **The experimental folders were free values.** Only the stable product's folders were fixed. `experimental-v3` could name any folder that passed the text rules.
3. **The staging step trusted that judgement and deleted.** `stageProductPublic()` removed `join(repoRoot, publicDir)` recursively, with `force`, and checked nothing itself.

Looking at every removal in the build, staging and assembly path showed the same pattern in two more places, which the review did not exercise:

- **The build folder.** `products.experimental-v3.outDir` was accepted by the same text rules, and Vite empties its output folder before it writes. A real build in a disposable copy, with `outDir` set to `SRC`, deleted all 133 source files and then reported success ([section 12.7](#127-before-and-after)).
- **The assembly target.** `assembleRoutes()` removed whatever `target` it was given. Its callers pass constants, so this was not reachable from the configuration, but nothing in the function prevented it.

### 12.3 The safe-destination contract

**No configuration value decides which folder is emptied or deleted.** The folders that scripts generate are a list in code, [`scripts/generated-dirs.mjs`](../../scripts/generated-dirs.mjs):

| Folder | Use | Emptied or deleted by |
|---|---|---|
| `dist` | `build` | Vite, for `stable-v2` |
| `dist-v3` | `build` | Vite, for `experimental-v3` |
| `.variant/experimental-v3/public` | `staged-public` | content generation |
| `site-dist` | `site` | the production assembly |
| `.site-test` | `site` | the test assembly |
| `.rehearsal` and folders below it | `work` | the promotion rehearsal |
| `.local/negative` and folders below it | `work` | the negative checks |

Nothing else is ever removed by a script. `src/`, `content/`, `scripts/`, `docs/`, the stable `public/`, `v1/`, every file at the top of the repository and every other folder in `.local/` are outside the list.

A folder may be emptied or deleted only when both of these hold:

1. **The name is exact.** The folder is on the list, as plain text. Nothing is trimmed, lower-cased or normalized before the comparison. A folder below a work area is lower-case words joined by hyphens. The caller also names the uses it accepts, so staging cannot empty a build folder and an assembly cannot empty a staged one.
2. **The folder is real.** On disk, each part of the path that exists is a real folder, listed by its parent under exactly this name, inside the repository. Parts that do not exist yet are accepted.

`site.config.json` keeps its `outDir` and `publicDir` fields, and its content is unchanged. Each one must now equal the fixed folder of its product: `dist` and `public` for `stable-v2`, `dist-v3` and `.variant/experimental-v3/public` for `experimental-v3`, `v1/dist` for `legacy-v1`. Route promotion changes paths in the site and gives no product another folder.

The rule is applied at two boundaries, as the task asked:

| Boundary | Where | What it does |
|---|---|---|
| A. Configuration | `validateSiteConfig()` | Compares every product folder with its fixed value, as exact text. Reads no file. |
| A. Configuration | `loadSiteConfig()` | After that, checks `dist`, `dist-v3` and the staged folder on disk. Every script and every build loads the configuration this way. |
| B. Removal | `stageProductPublic()` | Refuses unless the given `publicDir` equals the constant, then calls the guard. The folder that is deleted is the constant, never the configured value. It does this for any object it is given, validated or not. |
| B. Removal | `assembleRoutes()` | Calls the guard for its target. Accepts `site` and `work` only. |
| B. Removal | `check-negative.mjs`, `rehearse-promotion.mjs` | Call the guard for their work area. |
| B. Removal | `vite.config.ts` | A build-only plugin checks the output folder that Vite resolved, before Vite empties it. Accepts `build` and `work` only. It also covers `--outDir` and the inline folders of the rehearsal and the negative checks. |

The guard is `removeGeneratedDir(root, dir, uses)`. It is now the only recursive removal in the scripts, and a test fails if another script gains one.

### 12.4 Changed files

Compared with the reviewed candidate ([`changed-files.json`](../evidence/eng-v3-01-rc1/changed-files.json) has sizes and hashes):

| File | Change |
|---|---|
| `scripts/generated-dirs.mjs` | **New.** The list of generated folders and the guard. |
| `scripts/site-config.mjs` | Every product folder is fixed. The text rules and the protected-folder list are gone, replaced by exact comparison. `loadSiteConfig()` also checks the folders on disk. |
| `scripts/product-content.mjs` | `stageProductPublic()` checks its folder itself and removes through the guard. |
| `scripts/site-assembly.mjs` | Removes its target through the guard. The two folder names now come from the list. |
| `scripts/check-negative.mjs` | Removes its work area through the guard. Two new cases, 15 in all. |
| `scripts/rehearse-promotion.mjs` | Removes its work area through the guard. |
| `vite.config.ts` | The build-only plugin that checks the output folder. |
| `scripts/safe-destinations.test.mjs` | **New.** 11 regression tests for F1, in disposable copies of the repository. |
| `scripts/generated-dirs.test.mjs` | **New.** 13 tests of the list and the guard. |
| `scripts/site-config.test.mjs` | The folder test now pins the fixed folders and refuses 60 other values per folder. One comment about the workflow order is more exact. |
| `scripts/product-content.test.mjs` | Its staging test moved to `safe-destinations.test.mjs`, because the staged folder can no longer be redirected to a test folder. |
| `package.json` | The two new test files are part of `npm test`. No dependency changed. |
| `docs/architecture/PRODUCTS-AND-ROUTES.md` | A section on generated folders; the reader's rules; the wording about the workflow order. |
| `CHANGELOG.md` | An entry for this correction. |
| `docs/handoffs/ENG-V3-01.md` | This section, appended. |

Not changed: `site.config.json`, the application (`src/`, `index.html`, `public/`), `v1/`, the content sources, both locks, both lockfiles, the workflow, `.gitignore`, the evidence of ENG-V3-01 and the review.

### 12.5 How invalid values are refused

| Value or state | Refused by | Message |
|---|---|---|
| Another spelling of a protected folder: `SRC`, `Public`, `V1/public`, `Dist` | boundary A, as text | `products.experimental-v3.publicDir must be ".variant/experimental-v3/public" (found "SRC"). Product folders are fixed in code and cannot be configured, because scripts empty and delete them.` |
| A source or configuration file: `index.html`, `vite.config.ts`, `site.config.json`, `package.json` | boundary A, as text | the same |
| Any other folder, also a harmless-looking one: `out`, `dist-v4` | boundary A, as text | the same |
| A path that leads to an accepted folder: `./dist-v3`, `dist-v3/../dist-v3` | boundary A, as text | the same. The text is not normalized, so no normalization can turn an unsafe value into an accepted one. |
| The accepted name is a file on disk | boundary A on load, and boundary B | `The generated folder "dist-v3" cannot be used: "dist-v3" is a file, not a folder. Nothing was removed or created.` |
| The accepted name, or a folder above it, is a symbolic link or a junction | boundary A on load, and boundary B | `... ".variant/experimental-v3" is a symbolic link or a junction, not a real folder. ...` |
| The disk holds the accepted name under another spelling (`DIST-V3`), where the disk ignores case | boundary A on load, and boundary B | `... "dist-v3" exists on disk under another spelling. ...` |
| A folder for another use: staging into `dist`, assembling into `dist-v3` | boundary B | `"dist" is a generated folder for "build". Here only "site" or "work" is accepted.` |
| A build into a folder that is not generated, also by `--outDir` | boundary B, the build plugin | `"SRC" is not a generated folder of this repository, so no script may empty or delete it.` |

An existing link is detected with `lstat`, which reports Windows junctions as links. The listing of the parent folder detects another spelling. As a second, independent question to the operating system, the resolved real path of the folder must equal the path that was built from the repository folder and the exact names.

### 12.6 The check happens before the deletion

- `removeGeneratedDir()` runs the checks and the removal in one function, with no other step between them. The removal has no `force` option. A folder that does not exist is not removed and not created.
- In `stageProductPublic()` the refusal for a wrong folder comes first, before the content is built. The disk check comes immediately before the removal.
- A refusal throws. Nothing catches it to clean up or to try another way.
- The tests do not only look for an error. Each refused case records every file, folder and link of its disposable repository before and after, with SHA-256 for files, and requires the two records to be equal. That includes a folder beside the repository, for values such as `../outside`.

### 12.7 Before and after

**The same test file on both versions.** [`before-after.mjs`](../evidence/eng-v3-01-rc1/before-after.mjs) runs `scripts/safe-destinations.test.mjs`, unchanged, against the scripts as the review saw them and against the corrected scripts. The reviewed scripts are the copies in `before/`; the runner first proves that each one has the hash the review recorded.

| Test | Reviewed scripts | Corrected scripts |
|---|---|---|
| The configuration cannot name a source folder, a source file or another spelling | **fail** | pass |
| No product folder can be redirected | **fail** | pass |
| The content command refuses an invalid staged folder and leaves every file as it was | **fail** | pass |
| The content command refuses an invalid build folder | **fail** | pass |
| The staging function refuses every folder but its own, also for an unvalidated configuration | **fail** | pass |
| The content command refuses a staged folder that is a link or a file, or is reached through a link | **fail** | pass |
| The staging function itself refuses the same | **fail** | pass |
| The assembly empties only an assembly folder, and never a link or a file | **fail** | pass |
| On a disk that ignores case, the tested spellings are the protected folders themselves (Windows only) | pass | pass |
| The legitimate staged folder is regenerated, complete and without stale files | pass | pass |
| The staged folder is created when missing, and the assembly fills its own folders | pass | pass |

The eight failures are the finding: in the "before" run the operations were accepted and the disposable repositories lost files. The three tests that pass in both runs show that the tested spellings are real aliases on Windows, and that legitimate generation worked before and still works.

**Sentinel hashes.** The review's two reproductions and one link case, run again through the content command in disposable copies ([`sentinels.json`](../evidence/eng-v3-01-rc1/sentinels.json) has every hash before and after):

| Case | Reviewed scripts | Corrected scripts |
|---|---|---|
| `publicDir: "SRC"` | accepted; `src/main.ts` and `src/app/App.svelte` are **gone** | refused; all 8 sentinels unchanged |
| `publicDir: "index.html"` | accepted; `index.html` is **now a folder** | refused; all 8 sentinels unchanged |
| A link at `.variant/experimental-v3` that leads to the repository, so the valid staged path is `public/` | accepted; `public/favicon.svg` and `public/fonts/licence.txt` are **gone** | refused; all 8 sentinels unchanged |
| Control: the committed configuration | accepted; unchanged | accepted; unchanged |

The sentinels and their SHA-256, the same before and after every corrected run:

| Sentinel | SHA-256 |
|---|---|
| `index.html` | `1d42b58d179c338d56394cb38ceaff3893be1e493ffc4688a7769478f62f7419` |
| `package.json` | `0ce00e635c7b098ef6a307e609de09d4d8a839c66ec4c06777eb830482f72320` |
| `vite.config.ts` | `ea89aa581ffbe5af74915a49499e06b6c02cfa7aebfd5eba70c79cbaeb1085bc` |
| `src/main.ts` | `f232d7f0b499022e6fa594f9721e156ccbe3bc3b2eaf4952f240d1b40f5e6dc7` |
| `src/app/App.svelte` | `8bbced2d8e09aabc45ab946b631e7f767788da63369b040914b5d7cb91b9a5e4` |
| `public/favicon.svg` | `fb91f9a03c202c5f160eef644da6f2f704b19ac5c5f8b4c124e1b0b485ad57a0` |
| `public/fonts/licence.txt` | `acd1fc61f56da3a2a38f74b3e565d9ae5a5bad6e5c34946ebb85e7f33ee5e604` |
| `v1/public/data/materials.json` | `a5c6fde47be239fff32ca7baf9467d1f3e434ae0f266cc5b528f944dfedfcc27` |

**The build folder, with a real Vite build.** [`build-folder-probe.mjs`](../evidence/eng-v3-01-rc1/build-folder-probe.mjs) builds `experimental-v3` in complete disposable copies of the application under `.local/` ([`build-folder-probe.json`](../evidence/eng-v3-01-rc1/build-folder-probe.json)):

| Case | Reviewed scripts | Corrected scripts |
|---|---|---|
| `outDir: "SRC"` in the configuration | build ran; **133 of 133 source files lost** | refused when the configuration was read; sources unchanged |
| `dist-v3` is a link to `src/` | build ran; **133 of 133 lost** | refused when the configuration was read (disk check); sources unchanged |
| `vite build --outDir SRC` | build ran; **133 of 133 lost** | refused by the build plugin; sources unchanged |
| Control: a plain build | build ran; sources unchanged | build ran; sources unchanged |

### 12.8 Verification

One complete run, in this order, one command after another ([`commands.json`](../evidence/eng-v3-01-rc1/commands.json), [`logs/`](../evidence/eng-v3-01-rc1/logs/)). Windows 11, Node.js 24.18.0.

| Command | Result |
|---|---|
| `npm run check` | 272 files, 0 errors, 0 warnings |
| `npm test` | 72 script tests pass; 352 application tests pass, 20 skipped (experimental only) |
| `npm run test:v3` | 357 pass, 15 skipped (9 stable upgrade path, 6 stable only) |
| `npm run check:v1` | 189 files, 0 errors, 0 warnings |
| `npm run test:v1` | 68 pass |
| `npm run build` | `index-CggR75Uk.js`, `index-DFaGuSQ9.css`: the released files |
| `npm run build:v3` | `index-BZffMJE-.js`, `index-pTid4Cqy.css`, `PronunciationPlaceholder-DQxki5-Y.js`: the accepted files |
| `npm run build:site` | 33 files assembled; structural check passed |
| `npm run verify:content` | exact legacy projection and order; 566 source links; v1 unchanged |
| `npm run check:negative` | 15 of 15 deliberate faults refused |
| `npm run rehearse:promotion` | 18 promotion and 2 rollback checks passed |
| `npm run check:products` | 7 of 7 gates passed |
| `npm run assemble:test` | 62 files; structural check passed |
| `git diff --check`, and the same checks on new files | clean |

The script tests are now 72: the 15 released ones, the 33 others of ENG-V3-01 (one of the 34 moved into a new file), and 24 new. No released test was removed or weakened.

**Artifacts** ([`artifacts.json`](../evidence/eng-v3-01-rc1/artifacts.json)). The application was not touched, so every fingerprint must equal the one of ENG-V3-01, and it does:

| Artifact | Files | Digest of the file list | Equal to ENG-V3-01 |
|---|---|---|---|
| `site-dist/` | 33 | `fad43c4f965be026af034ccc2393cf88a95ea4dcb52192b6b36d60dc1f068b58` | yes, and equal to the released-site lock |
| `dist-v3/` | 29 | `51219e087edb51811c94709bd4c5c859f7288f00dd1b7bed60f9551ac0c880ab` | yes |
| `dist/`, `v1/dist/`, `.site-test/`, promoted site, rollback site | 28, 5, 62, 62, 33 | see the file | yes, all five |

The released-site lock file itself is unchanged. No browser campaign was repeated: the compiled products are byte-identical to the ones the review tested, and the correction is in build scripts only.

### 12.9 What this section replaces in sections 1 to 11

| Earlier statement | Now |
|---|---|
| 4.1: the reader fails closed on "unsafe or overlapping folders" by rules on the text | Every product folder is fixed; see 12.3. |
| 3 and 11: "13 deliberate faults" | 15. The two new ones: a product folder that is not the product's own, and a build into a folder that the repository does not generate. |
| 4.10 and 5: 49 script tests (15 released, 34 new) | 72 script tests (15 released, 57 new). |
| 4.6: the assembly's list of refusals | It also refuses a target that is not an assembly folder or a work-area folder. |
| 4.5: staging can be pointed at another folder by the configuration (used by one test) | It cannot. That test now runs in a disposable copy of the repository. |

Two observations of the review were marked non-blocking. Neither is part of F1, and the task asked for a focused correction:

- **The order of the last workflow steps.** The developer document and one test comment now say exactly what the review found: the gate is the last command of the repository before the upload, and the `Configure GitHub Pages` action stands between them. The workflow file and its comment are unchanged. Moving that action above the gate, or rewording the workflow comment, is a one-line change that waits for the owner's decision.
- **`experimental-v3` is not a required product in the reader.** Unchanged. The committed-configuration test and `check:products` still refuse a configuration without it.

### 12.10 Limits and platform notes

- **Not run on Linux.** Nothing was pushed, so the workflow has not run on this candidate, and this machine has no Linux environment. The tests were written for both platforms: they create links with the `junction` type, which Node.js treats as a symbolic link outside Windows, and the alias cases are refused as text everywhere. That they pass on Linux with Node.js 22 is expected, not observed.
- **Links on Windows are junctions here.** Creating a symbolic link to a folder needs a privilege that this account does not have (`EPERM`). Junctions need none, and `lstat` reports both as links, so the same refusal applies. Symbolic links to folders on Windows were not exercised.
- **Aliases that were tested on Windows:** other letter case, for which the tests also prove that the spelling resolves to the protected folder. Short 8.3 names (`NODE_M~1`) resolve to the long folder on this disk too; they are refused as text. Names with a trailing dot or space do not resolve to the folder under Node.js; they are refused as text all the same.
- **Check, then act.** The check and the removal are two steps. A process that replaces a folder by a link between them is not detected. This is a guard against mistakes in configuration and on disk, not against a concurrent attacker.
- **Vite does its own emptying.** For `dist` and `dist-v3` the guard cannot perform the removal. It runs when Vite has resolved its configuration, before the build starts.
- **A link inside a generated folder** is removed as a link, and its target is left alone. A test pins this behaviour of Node.js 24; the build-folder probe relies on it for cleanup.
- **A stricter environment.** A developer who made `dist` a link, for example to a faster disk, now gets a refusal. That is intended.
- **Not covered:** the frozen v1 project empties its own `v1/dist` in its own build; `scripts/generate-content.mjs` for the stable product deletes single stale pack files in `public/data/packs/` by an exact name pattern, as released. Neither path is configurable.

### 12.11 Preservation

Fingerprints were taken before the first edit and after the last run ([`preservation.json`](../evidence/eng-v3-01-rc1/preservation.json)).

| Workspace or group | Files | Before and after |
|---|---|---|
| Main checkout | 1,240 tracked, 92 untracked | identical |
| ENG-V2-03 worktree | 2,140 tracked, 63 untracked | identical |
| ENG-V3-00 worktree | 2,140 tracked, 61 untracked | identical |
| The review: report and 63 evidence files | 64 | identical |
| The evidence of ENG-V3-01 | 27 | identical |
| Application, `v1/`, content sources, locks, lockfiles, workflow, `site.config.json` | see the file | identical |

- The 55 evidence files of ENG-V3-00 still have the digest `6f54c4ffc1a31987c55ea92e415daed05456e25425822f08150841f6c059ab38`.
- The reviewed text of this handoff is still the unchanged beginning of the file; the record holds its hash.
- HEAD is `498705a`, nothing is staged, and nothing was committed or pushed.
- The review's ignored copies in `.local/` were not touched. The correction's own disposable copies were in the system's temporary folder and, for the build probe, in a new folder under `.local/`; all were removed after their runs. `.local/negative/` is the work area of `npm run check:negative` and is left as that command leaves it.
- No dependency was installed. Network use: two `git ls-remote` reads after the last run, which showed remote `main` still at `498705a` and no pushed branch for this work.

### 12.12 Reproduction

```text
node --test scripts/generated-dirs.test.mjs scripts/safe-destinations.test.mjs   # the 24 new tests
node docs/evidence/eng-v3-01-rc1/before-after.mjs          # the same regressions on the reviewed and the corrected scripts
npm run build:v3
node docs/evidence/eng-v3-01-rc1/build-folder-probe.mjs    # real Vite builds in disposable copies
node docs/evidence/eng-v3-01-rc1/run-checks.mjs            # the complete sequence of section 12.8
```

**ENG-V3-01-RC1 — IMPLEMENTED / READY FOR INDEPENDENT RE-REVIEW**

---

## 13. ENG-V3-01-RC2 — Build output destinations

| | |
|---|---|
| Date | 24 November 2026 |
| Developer | Fable (Claude Code) |
| Status | **Corrected and verified locally; ready for independent re-review.** Nothing was staged, committed, pushed, merged, deployed or published. |
| Scope | The one mandatory finding of the RC1 re-review, **F1-RC1 (P1)**: a Rollup output option made Vite empty a folder that the build check never saw. Nothing else was redesigned. |
| Review | [`docs/reviews/ENG-V3-01-RC1-ASTRA.md`](../reviews/ENG-V3-01-RC1-ASTRA.md), verdict `CHANGES_REQUIRED`. It and its evidence are unchanged. |
| Evidence | [`docs/evidence/eng-v3-01-rc2/`](../evidence/eng-v3-01-rc2/README.md) |

Sections 1 to 12 above are the reviewed record and were not edited. [Section 13.10](#1310-what-this-section-replaces-in-sections-1-to-12) lists the statements in them that this section replaces.

### 13.1 The candidate before the correction

Before the first edit, the working files were compared with the inventory that the RC1 review recorded when it started ([`candidate-authentication.json`](../evidence/eng-v3-01-rc2/candidate-authentication.json)).

| Check | Result |
|---|---|
| HEAD and branch | `498705a075e6f71b04e22e4437c50ec587de38dd`, `feature/eng-v3-01-foundation`; nothing staged |
| All 2,298 files (2,140 tracked, 158 untracked), digest in the review's format | `7811c56c92ae996116e43283963f0b7d99812cdf36eeefd2697949fd31a2eb76`, equal to the review's value |
| Every one of the 2,298 files | has the size and SHA-256 that the review recorded |
| The review's own grouping of RC1 | 12 changed files, 3 new implementation files, 39 RC1 evidence files, 64 files of the first review: all as recorded |
| Added since the reviewed state | the RC1 review only: its report and 172 evidence files |
| The report `ENG-V3-01-RC1-ASTRA.md` | SHA-256 `ac7377c4143ec461ef6bc382c1c42cdb45efc509ccae13bfcdcbb66a0c980c59`, the value in the review's `final-check.json` |
| The review's evidence index | all 171 rows match the files |

The worktree was not reset.

### 13.2 Root cause

The build check of RC1 read one value, and Vite decides from more than one.

1. **Vite has two sources for the folders it empties.** `getResolvedOutDirs(root, outDir, outputOptions)` returns `outDir` only when `build.rollupOptions.output` is absent. When it is set, every output with a `dir` replaces `outDir`, for an object and for each entry of a list. `prepareOutDir` then empties each of these folders and copies the public folder into it.
2. **The RC1 check read `build.outDir` and nothing else.** So `outDir: "dist-v3"` passed, and `output: { dir: "src" }` beside it emptied `src/`.
3. **The RC1 check read one set of options.** Vite builds from the options of an environment, `environments.<name>.build`. `build` is a second set. For `vite build` and `build()` Vite makes `build` a copy of the environment's options before plugins see the configuration, so the two agree. With the builder API and a shared configuration they do not: the check saw the top-level `outDir`, and Vite built into the folder of the client environment.

Point 3 was not in the review. It was found while the final boundary was inspected ([section 13.6](#136-the-final-boundary)), and a real build on the RC1 code confirmed it ([section 13.7](#137-before-and-after)).

The passages of the installed Vite 6.4.3 and Rollup 4.63.1, with line numbers and file hashes, are in [`vite-source.txt`](../evidence/eng-v3-01-rc2/vite-source.txt).

### 13.3 The corrected contract

**A build has one destination: the folder `build.outDir`, emptied before anything is written to it.**

The check is `assertBuildDestinations(config)` in [`scripts/generated-dirs.mjs`](../../scripts/generated-dirs.mjs). The build-only plugin in `vite.config.ts` calls it from `configResolved`. It checks every set of build options that Vite holds: `build`, and `environments.<name>.build` for each environment. For each set:

| Rule | Detail |
|---|---|
| 1. `outDir` is a generated build folder | Unchanged from RC1: `dist`, `dist-v3`, or a folder in a work area, as exact text, and a real folder on disk. The list in code stays the only authority. |
| 2. `rollupOptions.output` is absent | Any value is refused, whatever it holds. No Rollup output option is accepted. |
| 3. `emptyOutDir` is not `false` | The folder is always emptied before a file is written to it. |

How this meets the contract that the task recommended:

| Contract of the task | Here |
|---|---|
| 1. `build.outDir` is validated against the allow-list | Rule 1, now for every set of options |
| 2. `output.dir` overrides are forbidden | Rule 2 |
| 3. `output.file` overrides are forbidden | Rule 2. Vite 6.4.3 would refuse `file` itself, but later. |
| 4. Object and list forms are examined | Rule 2 does not look inside the value. Its presence is refused, so no form can be missed. |
| 5. The inline API gets the same validation | The check runs on the resolved configuration. At that moment `vite.config.ts`, the inline options of the JavaScript API and the command line are already merged. |
| 6. One valid entry of a list does not excuse another | A list is refused as a whole. |
| 7. Unrelated Rollup options may remain | Every `rollupOptions` key other than `output` is left alone. |

Two decisions go beyond the minimum, and both are deliberate:

- **No output option at all, not only `dir` and `file`.** The task allows this where the builds need no output option, and none does: the two products, the rehearsal and the negative checks set none. A rule that names two keys has to be right about every other key, in every form, in every later version. A rule that accepts nothing does not. If an output option is needed later, for example `manualChunks`, the check has to be extended on purpose with a list of accepted keys.
- **`emptyOutDir: false` is refused.** It is not part of the finding. With it, a link that lies inside the output folder is not removed, and the build writes through it: a real build on the RC1 code put 25 files into folders outside its output folder that way ([section 13.7](#137-before-and-after)). With the default, Vite removes such a link as a link before it writes.

There is no switch for any of this. The check reads no environment variable and no command-line argument.

### 13.4 Where the check runs

`configResolved` is called at the end of Vite's `resolveConfig`. Every build goes through it before `buildEnvironment` starts: `vite build`, `build()`, and each configuration that `createBuilder()` resolves.

A real build was observed in a disposable copy ([`lifecycle.json`](../evidence/eng-v3-01-rc2/lifecycle.json)). The order for a valid build:

1. Vite loads `vite.config.ts`. For that it creates `node_modules/.vite-temp/`, writes a temporary module there and removes it.
2. **The check is entered and accepts.**
3. Rollup starts (`buildStart`) and finishes loading and transforming the modules (`buildEnd`).
4. Vite empties the output folder. The first call there removed a stale file that the copy held.
5. Vite copies the public folder, and Rollup writes the files (`generateBundle`, then `writeBundle`).

For the review's inline case, `build({ build: { rollupOptions: { output: { dir: "src" } } } })` with the configuration file unchanged, the record shows the same three calls of step 1, the check entered and rejected, and **no further call**. The copy is unchanged.

What this does not claim: the check does not run before every write. Step 1 comes first, and the check cannot prevent it. The observation covers the functions of Node.js that create, write, copy, rename or remove; it is not a trace by the operating system.

### 13.5 Changed files

Compared with the candidate that the RC1 review recorded ([`changed-files.json`](../evidence/eng-v3-01-rc2/changed-files.json) has sizes and hashes):

| File | Change |
|---|---|
| `scripts/generated-dirs.mjs` | **New function** `assertBuildDestinations`. Nothing else in the file changed. |
| `vite.config.ts` | The plugin calls the new function. Its comment says what it covers. |
| `scripts/build-destinations.test.mjs` | **New.** 10 tests with real Vite builds in disposable copies of the application. |
| `scripts/generated-dirs.test.mjs` | One new test of the function. The test that reads `vite.config.ts` pins the new call. |
| `scripts/check-negative.mjs` | One new case, 16 in all: a build with a Rollup output option and a valid output folder. |
| `package.json` | The new test file is part of `npm test`. No dependency changed. |
| `docs/architecture/PRODUCTS-AND-ROUTES.md` | A subsection on what a Vite build may write, with the supported versions and the limits. |
| `CHANGELOG.md` | An entry for this correction. |
| `docs/handoffs/ENG-V3-01.md` | This section, appended. |

Not changed: `site.config.json`, the application (`src/`, `index.html`, `public/`), `v1/`, the content sources, both locks, both lockfiles, the workflow, `.gitignore`, every other script, the evidence of ENG-V3-01 and of RC1, and both reviews.

### 13.6 The final boundary

Every way in which the installed Vite decides where a build goes was read in its source. Each one was then tried as a real build, except the last two rows.

| Way to name a destination | Result on the corrected code |
|---|---|
| `build.outDir`: configuration, inline option, `--outDir` | Checked: the list, then the disk (RC1, unchanged). |
| `build.rollupOptions.output` with `dir`, as an object or a list | Refused. |
| `output.file` | Refused by the check. Vite 6.4.3 would also refuse it, before it empties anything. |
| The older nested form `output: { output: { dir } }` | Refused by the check. Rollup 4.63.1 ignores it with a warning. |
| Name patterns in `output` (`entryFileNames` and others) | Refused with every other output option. |
| `environments.<name>.build`: `outDir`, `rollupOptions.output`, `emptyOutDir` | Every set is checked, also for an environment that the build does not use. |
| The builder API: `createBuilder()`, `builder: {}` (what `--app` sets), `builder.sharedConfigBuild` | Each configuration that Vite resolves passes the check. With a shared configuration there is one, and all its sets are checked. |
| `build.emptyOutDir: false`, `--no-emptyOutDir` | Refused. |
| File names inside the build: `build.assetsDir`, `build.manifest`, `--manifest` with a path that leads out | Not judged by the check. Rollup 4.63.1 refuses such a name before it writes; a test pins this. By then Vite has emptied the product's own folder, and nothing else. |
| The copy of the public folder | Goes into the checked output folder only. |
| `vite preview` | The plugin is not applied. Preview reads a folder and writes none. |

Not exercised as builds: watch mode, library mode and server-side builds. The products do not use them. In the source they take their folders from the same two values, and the check runs before any of them starts.

Outside the boundary, as the task states: a plugin that writes or deletes by itself, a plugin or program that changes the resolved options after the check, a build that does not use this `vite.config.ts`, and a process that replaces a folder between the check and Vite's emptying.

### 13.7 Before and after

**The three bypasses of the review.** [`before-after.mjs`](../evidence/eng-v3-01-rc2/before-after.mjs) judges both sides with the same two assertions: the build is refused, and no file, folder or link of the copy differs.

- **Before:** not run again. The review recorded every file, folder and link of its copies before and after each build. The script first proves those records intact against the review's own evidence index, and proves that each copy held the RC1 implementation: 184 of 184 files that the RC1 inventory also has are byte-identical, the guard is the RC1 file, and the configuration file is the RC1 file, with exactly the review's one edit in the two edited cases.
- **After:** real builds of the corrected implementation, each in a new, complete copy of the application.

| Case | RC1 (the review's records) | Corrected (new builds) |
|---|---|---|
| `output: { dir: "src" }` written into `vite.config.ts`; `vite build` | build ran, exit 0; **133 of 133 source files lost** | refused, exit 1; copy unchanged |
| `output: [{ dir: "dist-v3" }, { dir: "src" }]` written into `vite.config.ts`; `vite build` | build ran, exit 0; **133 of 133 lost** | refused, exit 1; copy unchanged |
| `build({ build: { rollupOptions: { output: { dir: "src" } } } })`, configuration file unchanged | build ran; the guard saw `outDir: "dist-v3"` and accepted; **133 of 133 lost** | refused, exit 1; copy unchanged |

The message in all three corrected runs: `"build.rollupOptions.output" is set. A build of this repository accepts no Rollup output option: Vite empties every folder that such an option names, and "build.outDir" is the only destination. The build stopped before any folder was emptied.`

**Three neighbours that no record covered.** They were found while the boundary was inspected, so each was run once on the RC1 implementation and once on the corrected one, in disposable copies ([`boundary-probe.json`](../evidence/eng-v3-01-rc2/boundary-probe.json)):

| Case | RC1 | Corrected |
|---|---|---|
| The same output folder, set for the client environment | build ran; **133 of 133 source files lost** | refused; copy unchanged |
| Builder API with a shared configuration, and `outDir: "src"` for the client environment | build ran; **133 of 133 lost**. RC1 checked the top-level `outDir`, which was `dist-v3`. | refused; copy unchanged |
| Links inside `dist-v3/`, and `emptyOutDir: false` | build ran; **25 files added** outside the output folder, through the links | refused; copy unchanged |
| The same links, and a plain build | build ran; nothing outside the output folder changed | the same |
| Control: a plain build | build ran; nothing outside the output folder changed | the same |

**Destructive runs in this correction.** The three cases of the review were not repeated on the RC1 code. The three neighbours above were, because no record of them existed: once in each run of the probe script, and it ran three times, the last two as part of the complete verification. Before that, a scratch exploration ran the same kind of builds on the RC1 code; two of them damaged their own copies in the same way, and its output is not part of the evidence. Every such build ran in a new copy under `.local/` that was removed afterwards. No build with an unsafe option was started in the worktree itself.

### 13.8 Source-preservation hashes

The 133 files below `src/`, as sorted rows of path, size and SHA-256, have the digest `57893d333b1cb55e89367e709598bff0f5392dc475de9882169ad6578e6b834f`.

| Copy | Before the build | After the build |
|---|---|---|
| The review's three RC1 copies | that digest | 0 of 133 files left |
| The three corrected copies | that digest | that digest; 133 of 133 identical |

The digest is the same on both sides, so the review's copies and the new copies held the same sources. For the corrected runs the whole copy is compared, not only `src/`: 332 entries, with the frozen v1 project, the content sources, the scripts, the configuration and a folder beside the copy. The inventory digests before and after each run are in [`before-after.json`](../evidence/eng-v3-01-rc2/before-after.json).

### 13.9 Verification

One complete run, in this order, one command after another ([`commands.json`](../evidence/eng-v3-01-rc2/commands.json), [`logs/`](../evidence/eng-v3-01-rc2/logs/)). Windows 11, Node.js 24.18.0, Vite 6.4.3, Rollup 4.63.1.

| Command | Result |
|---|---|
| `npm run check` | 272 files, 0 errors, 0 warnings |
| `npm test` | 83 script tests pass; 352 application tests pass, 20 skipped (experimental only) |
| `npm run test:v3` | 357 pass, 15 skipped (9 stable upgrade path, 6 stable only) |
| `npm run check:v1` | 189 files, 0 errors, 0 warnings |
| `npm run test:v1` | 68 pass |
| `npm run build` | `index-CggR75Uk.js`, `index-DFaGuSQ9.css`: the released files |
| `npm run build:v3` | `index-BZffMJE-.js`, `index-pTid4Cqy.css`, `PronunciationPlaceholder-DQxki5-Y.js`: the accepted files |
| `npm run build:site` | 33 files assembled; structural check passed |
| `npm run verify:content` | exact legacy projection and order; 566 source links; v1 unchanged |
| `npm run check:negative` | 16 of 16 deliberate faults refused |
| `npm run rehearse:promotion` | 18 promotion and 2 rollback checks passed |
| `npm run check:products` | 7 of 7 gates passed |
| `npm run assemble:test` | 62 files; structural check passed |
| `git diff --check`, and the same checks on new files | clean |
| The three evidence scripts of this section, run again on the final files | all pass |

The script tests are now 83: the 72 of RC1, one new test of the function, and the 10 tests with real builds. No earlier test was removed or weakened. The one test that reads `vite.config.ts` pins the new call in place of the old one.

**Artifacts** ([`artifacts.json`](../evidence/eng-v3-01-rc2/artifacts.json)). The application was not touched, so every fingerprint must equal the one of ENG-V3-01, and it does:

| Artifact | Files | Digest of the file list | Result |
|---|---|---|---|
| `site-dist/` | 33 | `fad43c4f965be026af034ccc2393cf88a95ea4dcb52192b6b36d60dc1f068b58` | the value in the task; equal to ENG-V3-01 and to the released-site lock |
| `dist-v3/` | 29 | `51219e087edb51811c94709bd4c5c859f7288f00dd1b7bed60f9551ac0c880ab` | the value in the task; equal to ENG-V3-01 |
| `dist/`, `v1/dist/`, `.site-test/`, promoted site, rollback site | 28, 5, 62, 62, 33 | see the file | equal to ENG-V3-01, all five |

The released-site lock file and the content lock are unchanged, and no assertion on them was changed. `publish` is still `false`, and no file of v3 is in the assembled site. The database names and versions, the 14 packs with their manifest and the placeholder screen are untouched: the correction is in two build files, and `src/` is byte-identical.

No browser campaign was repeated. The compiled products are byte-identical to the ones both reviews tested.

### 13.10 What this section replaces in sections 1 to 12

| Earlier statement | Now |
|---|---|
| 12.3, last row: the build plugin "checks the output folder that Vite resolved" | It checks every set of build options that Vite resolved, and refuses a Rollup output option and `emptyOutDir: false`; see 13.3. |
| 12.5, last row: a build is refused for an output folder that is not generated | Also for any Rollup output option, whatever folder it names. |
| 12.10: "Vite does its own emptying. … It runs when Vite has resolved its configuration" | Still so. Section 13.4 has the observed order. |
| 12.4 and 12.8: 15 negative cases | 16. |
| 12.8: 72 script tests | 83. |

The two non-blocking observations of the first review are unchanged and still wait for the owner: `experimental-v3` is `required: false` in the reader, and the `Configure GitHub Pages` action stands between the last gate and the upload.

### 13.11 Limits and platform notes

- **Two versions are pinned.** The check was read and tested against Vite 6.4.3 and Rollup 4.63.1, the versions in `package-lock.json`. A test fails when either number changes. That is on purpose: an update has to repeat the reading of `getResolvedOutDirs` and `prepareOutDir`, and of Rollup's check of file names, before the numbers are changed. `package.json` still allows `^6.0.0`.
- **No Rollup output option is available** to a later milestone until the check is extended. See 13.3.
- **`emptyOutDir: false` is not available.** No script of the repository used it.
- **File names are Rollup's business.** The check does not judge them. See 13.6.
- **An entry named `.git` inside an output folder** is never removed by Vite's emptying. The builds write nothing there.
- **Folder names are judged from Vite's `root`,** as Vite resolves them. The products and the checks build with the repository as `root`.
- **Not run on Linux, and not with Node.js 22.** As in 12.10: nothing was pushed, and this machine has no Linux environment. The new tests create links with the `junction` type, which Node.js treats as a symbolic link outside Windows. Linux CI is a later gate of the pull request.
- **Links on Windows are junctions here.** As in 12.10. Symbolic links to folders on Windows were not exercised.
- **Check, then act.** As in 12.10. A process that replaces a folder between the check and Vite's emptying is not detected.
- **`npm test` takes about 50 seconds longer on this machine:** 37 seconds before, 87 seconds now. The new file starts 44 real builds: the check refuses 33, Rollup refuses 2, and 9 build. Its copies are under `.local/` of the repository, because a build needs the installed packages; each test removes its own folder.

### 13.12 Preservation

Fingerprints were taken before the first edit and after the last run ([`preservation.json`](../evidence/eng-v3-01-rc2/preservation.json)).

| Workspace or group | Files | Before and after |
|---|---|---|
| Main checkout | 1,240 tracked, 92 untracked | identical |
| ENG-V2-03 worktree | 2,140 tracked, 63 untracked | identical |
| ENG-V3-00 worktree | 2,140 tracked, 61 untracked | identical |
| The RC1 review: report and 172 evidence files | 173 | identical |
| The first review: report and 63 evidence files | 64 | identical |
| The evidence of ENG-V3-01 and of RC1 | 27 and 39 | identical |
| Application, `v1/`, content sources, locks, lockfiles, workflow, `site.config.json`, every script that RC2 did not name in 13.5 | see the file | identical |
| The two older ignored review snapshots in `.local/` | 3,990 and 2,555 entries | identical to the digests that the RC1 review recorded at its end |
| The RC1 review's own ignored copy in `.local/` | see the file | no entry created or modified since this correction's first inventory |
| `.git/info/exclude`, `.gitignore`, `v1/.gitignore` | 3 | identical to the hashes that the RC1 review recorded |

- The 55 evidence files of ENG-V3-00 still have the digest `6f54c4ffc1a31987c55ea92e415daed05456e25425822f08150841f6c059ab38`.
- The reviewed text of this handoff, sections 1 to 12, is still the unchanged beginning of the file; the record holds its hash.
- `package.json` differs from the reviewed file in the `test` script only.
- HEAD is `498705a`, nothing is staged, and nothing was committed or pushed.
- The correction's disposable copies were new folders under `.local/`, named `build-destinations-*` and `rc2-*`. All were removed after their runs. `.local/negative/` is the work area of `npm run check:negative` and is left as that command leaves it.
- No dependency was installed and no lockfile changed. Network use: two `git ls-remote` reads after the last run, which showed remote `main` still at `498705a` and no pushed branch for this work.

### 13.13 Reproduction

```text
node --test scripts/build-destinations.test.mjs scripts/generated-dirs.test.mjs   # the real builds, and the unit tests of the guard
node docs/evidence/eng-v3-01-rc2/before-after.mjs      # the review's three cases: its records for RC1, new builds for the correction
node docs/evidence/eng-v3-01-rc2/boundary-probe.mjs    # three neighbouring cases on RC1 and on the correction
node docs/evidence/eng-v3-01-rc2/lifecycle.mjs         # where the check runs in a build
node docs/evidence/eng-v3-01-rc2/vite-source.mjs       # the passages of the installed Vite and Rollup
node docs/evidence/eng-v3-01-rc2/run-checks.mjs        # the complete sequence of section 13.9
```

The first four build in disposable copies under `.local/`, and the second and third also read the RC1 review's records. None of them starts an unsafe build in the worktree.

**ENG-V3-01-RC2 — IMPLEMENTED / READY FOR INDEPENDENT RE-REVIEW**
