# ENG-V2-01 independent review

Reviewed on **2026-11-21**. Production application code was preserved. No staging, commit, stash, push, merge, workflow dispatch, Pages setting change, or deployment was performed.

The clean installs, existing static checks, existing unit suites, combined production build, and local Actions lint pass. Native browser testing found **one medium-severity identity/state-consistency defect and one low-severity unhandled read-abort defect**. Both reproduce in Chromium and Firefox. The identity defect requires correction before a PR is considered ready.

## 1. Exact candidate reviewed

| Item | Observed value |
|---|---|
| Repository | `<repo>` — `shcherbak-pro/eng-trainer` |
| Branch | `feature/eng-v2-01-modular-foundation` |
| HEAD / implementation baseline / locally recorded `origin/main` | `45564ca608249b3a8a6ea48073589b17e6430ea1` |
| Default branch reference | `refs/remotes/origin/main` |
| Index | Empty diff; implementation unstaged |
| Working-tree candidate | 51 tracked path changes and 111 intended untracked files; **127 existing deliverable files**, including unchanged files |
| Handoff | `docs/handoffs/ENG-V2-01.md` |

[candidate.json](eng-v2-01-astra/candidate.json) records the complete original status, every candidate file and its SHA-256, branch/commit/tree identifiers, and v1 baseline comparison. This includes the new `src/app`, `content`, `state`, `storage`, `features`, and `shared` modules, `src/test`, both lockfiles, `v1/`, build scripts, and workflow changes. Deleted tracked paths are recorded separately in the status. [tracked.diff](eng-v2-01-astra/tracked.diff) preserves the tracked patch; it was **not** the sole review input.

The parent `AGENTS.md` explicitly describes web-school/Angular work. This task explicitly targets eng-trainer, which is a Svelte application. No repository-local `AGENTS.md` or documented Agent Framework binding was found. The sibling `agent-framework-codex-workspace/docs/projects/eng-trainer.md` was read as a reference: it is an older descriptive project note, not a binding or loader instruction. No loader command or onboarding procedure was invented. Only eng-trainer received review files; sibling repositories were not modified.

A complete candidate copy was created before testing, excluding generated output and dependencies. Both `npm ci` operations used that copy and disposable npm caches. The installed copy was then relocated into `.astra-review-JWjXDp/candidate` inside eng-trainer because unrelated malformed `package.json`/`tsconfig.json` files in the host's temp directory interfered with esbuild's ancestor lookup. Sandbox directory-access failures were resolved by approved execution outside the sandbox. These were environment failures, not candidate defects. The active checkout's dependencies and editor processes were untouched.

[source-audit.json](eng-v2-01-astra/source-audit.json) confirms all 127 files in the tested snapshot and active implementation still match the initial hashes. The in-repository disposable workspace was removed after verification; [final-preservation.json](eng-v2-01-astra/final-preservation.json) records the final unchanged implementation status.

### v1 baseline and dependency reproducibility

All **53 copied baseline files** were compared with `45564ca`, normalizing line endings. Only `package.json` and `vite.config.ts` differ: package rename and `/eng-trainer/v1/` base respectively. The additional `v1/README.md` and lockfile are accounted for. The old feature commit `90d7941` and the baseline have identical tree IDs.

Restoring the original package name in `v1/package-lock.json` and its original CRLF line endings reproduces the handoff's starting-lockfile SHA-1, `0f24a6c9a936365b6c28cb0ddc0b80763d068dd8`. No root application imports were found in v1 source/tests. Its content, dependencies, source, and configuration are independent.

| File | SHA-256 |
|---|---|
| `package.json` | `b3afb27249bf149576e185bf6896f13edcd8eecd9d808f2b2f064992859a8518` |
| `package-lock.json` | `052752ba17ced8e1ce86e6830f0d00578e40cf90ce20dcb9a84ac333208e4bf1` |
| `v1/package.json` | `a1020863bebc7e2b1a22fd9e7a7f2de1c48f13d7d4c652cb9dd553620519fb07` |
| `v1/package-lock.json` | `65937877d5140403636a1123df04d6c4ab81f409f9ed4148f1328cb6a5fd6cc9` |

Both lockfiles are version 3, match their manifests, are present in the candidate, and are **not ignored**. They still need to be included when the developer eventually commits the implementation.

## 2. Independently verified checks

Environment: Windows 11 (`10.0.26200`), Node **24.18.0**, npm **11.17.0**, Playwright **1.62.1**. Browser versions were obtained from the actual running browsers: **Chromium 151.0.7922.34** and **Firefox 153.0**, headless, with disposable isolated contexts. No owner browser profile was used.

| Check | Independent result / evidence |
|---|---|
| Root clean install | PASS — 118 packages; [log](eng-v2-01-astra/install-v2.log) |
| v1 clean install | PASS — 116 packages; [log](eng-v2-01-astra/install-v1.log) |
| `npm run check` | PASS — 0 errors, 0 warnings; [log](eng-v2-01-astra/check-v2.log) |
| `npm test` | PASS — 5 files, 96 tests; [log](eng-v2-01-astra/tests-v2.log) |
| `npm run check:v1` | PASS — 0 errors, 0 warnings; [log](eng-v2-01-astra/check-v1.log) |
| `npm run test:v1` | PASS — 3 files, 68 tests; [log](eng-v2-01-astra/tests-v1.log) |
| `npm run build:site` | PASS — invokes `npm run build`, separate v1 build, assembly, structural check; [log](eng-v2-01-astra/build-site.log) |
| Nested-source exclusion | PASS — a deliberately invalid v1 TypeScript/test fixture did not affect root check/tests; v1 check detected it; fixture removed; [evidence](eng-v2-01-astra/scope-probe.json) |
| Actions lint | PASS — actionlint **1.7.12**, exit 0; [log](eng-v2-01-astra/actionlint.log) |
| GitHub Actions execution | **NOT RUN** |

Existing-test review found the 30 flashcard logic tests and 26 page tests retained, including interaction, deck, hidden-state, and reload assertions. Page tests now seed IndexedDB and await persistence. The old storage suite's localStorage and legacy-compatibility assertions were appropriately replaced; retained progress operations remain covered. The new mocked storage tests do not exercise a native initial-read transaction abort, which explains finding F2. Unique dataset-ID tests do not detect the flashcard identity merging in F1.

### Architecture

The extracted boundaries are used. The shell loads the catalog; screens receive the catalog or arrays obtained from it. `src/content/builtIn.ts` owns the application content fetch. `src/storage/database.ts` is the only production module accessing IndexedDB. Progress/settings services own persistent state and hand changes to the save queue; `viewState` owns transient state. Shared generic UI has no feature-persistence dependency; reusable entry controls use the central progress service. Application navigation maintains the current screen in memory and persists its last-screen setting without competing storage writers.

No production v2 localStorage/sessionStorage access, legacy read, migration, fallback storage, or dual write was found. No service-worker or Cache Storage code exists in either application. The notable boundary defect is semantic identity inside flashcard composition, described below.

### Production artifact and browser coverage

The tests served the **newly assembled `site-dist/`**, mounted at `/eng-trainer/` and `/eng-trainer/v1/` by a small static HTTP server. It does not return an app shell for missing files: missing script and route requests returned genuine 404s. The ten published files contain only each application's HTML, compiled JS/CSS, JSON, and favicon; no source, dependencies, or repository metadata. See [artifact hashes](eng-v2-01-astra/artifact.json).

Both engines completed **17 scenario groups each: 14 passed and three failed**. Two failing identity groups describe the same root defect, F1; the read-abort group describes F2. Full assertions, observations, native transaction outcomes, and errors are in [Chromium results](eng-v2-01-astra/browser-chromium.json) and [Firefox results](eng-v2-01-astra/browser-firefox.json).

| Scenario | Result in both engines |
|---|---|
| Correct v1/v2 entry pages; all ten screens; hash navigation and refresh | PASS |
| JS/CSS/favicon body bytes match built files; JSON parses and matches intended corpus | PASS |
| Each application's same-origin resources stay in its own base path | PASS |
| v2 link on every implemented screen; real click from 390×844 viewport | PASS; link unobscured above bottom navigation — [Firefox screenshot](eng-v2-01-astra/firefox-mobile-link.png) |
| Fresh v2 state with synthetic legacy data on the same origin | PASS; legacy state not read into v2 |
| v1 reads expected legacy learned state/theme; resets leave the other application's storage intact | PASS; unrelated localStorage sentinel also preserved |
| Populated database restored before effects; all declared settings, progress, Focus entries, passes and deck position | PASS; zero startup writes when saved state already matches the screen |
| Missing optional records | PASS; defaults used without writing default records over saved data |
| Rapid toggles, independent preferences, progress/settings together, navigation during pending writes | PASS; native transaction explicitly observed pending, then released; latest state retained after completed writes and reload |
| Reset during a held write; reset after a failed write followed by Retry | PASS; old progress not revived |
| Request succeeds, transaction then aborts; newer edits before Retry | PASS; visible unsaved notice, rollback, latest changes persisted on retry, no unrelated update loss |
| Failed open, Retry, and optional unsaved mode | PASS; visible error/notice and no persistence in unsaved mode |
| Failed initial read | Data preservation and Retry PASS; unhandled rejection FAIL — F2 |
| Failed content request and Retry | PASS; controlled HTTP 503 handled |
| Searches before visiting later corpus sections | PASS; beginning/middle/end phrases and words, Ukrainian translation, all three verb sets, Learn Pass material tag search |
| Search/pagination/prompt reset with retained category, page size, and screen | PASS; coherent first page and empty prompt after reload |
| Learn Pass create/edit/delete/reload; Focus; hide/unhide; sorted word and verb identities | PASS for ordinary entries; duplicate identity FAIL — F1 |
| Flashcard buttons, keyboard, mouse swipe, flip, review/Learn again, topic, shuffle and deck reset | PASS; state/deck order survives reload; leaving during answer completion preserves the answer |
| Reverse answer/check/reveal/next, practice prompts, patterns and answers | PASS |
| Single-item speech and section Start/Stop at 10/20/50 repeats | UI/native API calls PASS; audible output/quality **not verified** |
| v1 representative search, learned state, flashcards/reload, prompt, speech API | PASS |

No unexpected console errors or uncaught application exceptions occurred in successful normal-flow scenarios. The controlled content test logs its expected 503 in Chromium. F2 is the unexpected uncaught exception. Native speech calls were delegated to the real API: Firefox emitted start/end events; Chromium recorded interrupted events when Stop/cancel was exercised. Neither establishes audible quality or completion of an entire repeat sequence.

The built-in corpus remained 566 phrases, 566 word entries, 339 verbs, 39 blocks, 7 patterns, 6 answers, and 15 drills. Search samples include `phrase-001`, `agent-vocab-022`, and `ai-certification-phrase-121`, plus word equivalents and verbs from each set. Tests used actual content except the explicitly identified two-entry collision fixture.

### Failure injection and persistence interpretation

[browser-support.mjs](eng-v2-01-astra/browser-support.mjs) wraps native browser IndexedDB APIs. Open failure throws a controlled `SecurityError`. Read failure calls the real transaction's `abort()` from a successful `getAll` request callback. Save failure calls `abort()` after a successful native `put` request; recorded transactions prove request success preceded abort. Pending-write tests keep a real transaction active with harmless reads, observe it pending during navigation/reset, then release it. No fake-indexeddb is used in these browser scenarios.

These are **controlled failures, not reproduced quota exhaustion**. Reload assertions follow completed transactions. No claim is made that an unfinished write survives abrupt process termination. The existing jsdom suites remain separately identified as mocked IndexedDB testing.

## 3. Confirmed defects, ordered by importance

### F1 — P2 / medium: flashcard text deduplication merges identities and disagrees with dictionary/Focus state

**Impact:** A learner can have an entry shown as unlearned in Focus while flashcards exclude it from learning and count it as learned. Distinct entries whose display text normalizes alike can also be silently marked learned together, with the erroneous state surviving reload.

**Violated requirements:** stable entry identity; progress remains associated with the correct entry; consistent state across vocabulary, Focus and flashcards; distinct entries must not share progress merely because display text is similar.

**Reproduce with the shipped corpus, in a fresh v2 context:**

1. Open Phrases and search `consequently`.
2. Mark lowercase `consequently` (`phrase-084`, Conjunctions) learned.
3. Add `Consequently, …` (`advanced-linking-004-consequently`, Advanced Linking Words) to Focus. Reload.
4. Open Focus. That entry still offers **Mark as learned**.
5. Open Flashcards → By Topic → Advanced Linking Words → Review learned vocabulary.

**Expected:** The same learning identity has consistent learned state in every view; separate IDs must not silently inherit one another's progress through text comparison.

**Observed:** Focus shows the Advanced Linking Words entry unlearned, while that topic reports **1 learned** and lists the merged `consequently` card. IndexedDB contains only `phrase-084` in `learnedPhrases`.

**Additional independent collision reproduction:** the browser test serves a valid synthetic catalog with two phrases, IDs `review-cpp`/`review-csharp`, display text **C++**/**C#**, and distinct translations/examples. Phrases renders both. Flashcards creates only one card, and pressing **I know it** persists both IDs as learned. Reloading confirms both learned. This fixture is deliberately synthetic; C++/C# are not claimed to be present in the shipped corpus.

**Cause/source:** `src/features/flashcards/flashcards.ts:21` removes punctuation; `:122` and `:136` merge by normalized text; `:146` aggregates learning IDs; `:184` treats any one ID as sufficient. `src/features/flashcards/FlashcardsPage.svelte:132` saves all merged IDs, while `src/shared/entries/PhraseCard.svelte:17` checks only its own ID. This merging logic is inherited from the baseline; retaining it does not satisfy the approved v2 identity/consistency requirements.

**Evidence:** `built-in-duplicate-entry-consistency` and `distinct-entry-identities-with-similar-display-text` fail in both browser result files. They record the database, Focus state, topic count, and learned IDs.

**Focused correction:** Use dataset identity and explicit `sourcePhraseId` relationships for shared entries. Do not infer identity from punctuation-stripped display text. If equivalent phrases are intentionally one learning entry, define explicit canonical identity and use it consistently in vocabulary, Focus, flashcards and progress operations. Add regression cases for both the shipped duplicate inconsistency and genuinely distinct similar-looking terms. No legacy migration is required.

### F2 — P3 / low: aborted initial reads leave an unhandled transaction rejection

**Impact:** The intended storage-error screen appears and data stays safe, but startup also emits an uncaught `AbortError` in both browsers. Retry works. No data loss or inability to recover was observed; this finding alone is not the reason to withhold readiness.

**Violated requirement:** storage failures are handled without unexpected application errors.

**Reproduction:** Seed native `eng-trainer-v2` with `learnedPhrases: ['phrase-001']` and settings `{theme:'dark', activePage:'phrases'}`. Before application startup, wrap `IDBObjectStore.getAll` to abort its real transaction from the request's success callback. Open v2. Observe the storage-error screen and the uncaught browser `AbortError`. Remove the injection, verify the original database is unchanged, and click **Try again**; saved state loads successfully.

**Expected:** A handled storage error with no detached/unhandled promise rejection and no writes over unread data.

**Observed:** Data preservation and visible recovery pass, but the browser `pageerror` list contains `AbortError`.

**Cause/source:** `src/storage/database.ts:59` awaits the request aggregation before attaching the `tx.done` await at `:67`. When a request/transaction abort rejects the earlier aggregation, execution enters the catch at `:69` without consuming the transaction-completion rejection. The write path already handles pending promises more carefully.

**Focused correction:** Attach completion/rejection handling when the read transaction is created and await request results and transaction completion together; consume/abort outstanding work on failure. Retain the current no-default-writes behavior. Add an asynchronous transaction-abort regression, not just a synchronously throwing `getAll` mock.

**Evidence:** `failed-initial-read-preserves-populated-database` in both browser result files. The test completes database preservation and successful Retry assertions before failing on the uncaught-error assertion.

## 4. Intentional changes and non-blocking limitations

- Search text and list page numbers reset on reload. Persisted category/page size and last screen remain coherent; the phrase-list browser test restores AI Certification Vocabulary on page one with an empty search. This is not a parity defect.
- The persisted old “practice prompt” was a randomly selected string from `drills`, displayed for speaking practice. It is not an authored answer or unfinished document. Resetting it returns to the invitation to generate a prompt. Reverse Practice's answer textarea was already transient in v1.
- The system theme is applied before IndexedDB hydration; a saved preference can therefore produce the acknowledged theme flash. The saved theme itself restores correctly. No localStorage theme exception is proposed; flash duration/perceptibility was not measured.
- An unavailable-storage screen is allowed. The extra Continue without saving mode correctly keeps a visible notice and performs no persistence. A read-only fallback is not required.
- Reset also resets preferences except theme and has no confirmation, as documented. Pending/failed writes did not undo reset in testing.
- Tabs do not synchronize live; the documented last-writer behavior was not expanded into a new synchronization requirement.

## 5. GitHub Actions review and unverified Fable claims

There is one workflow and one Pages deployment job in the candidate: `.github/workflows/deploy.yml`. Actionlint passes. Source inspection confirms:

| Event | Validation/build/assembly | Publication path |
|---|---|---|
| PR targeting `main` | Both apps | Configure/upload/deploy all excluded |
| Push to `main` | Both apps | One combined artifact and one deploy job |
| Manual run on `main` | Both apps | Same publication path |
| Manual run on another branch | Both apps | Configure/upload/deploy excluded |

No path filters exclude `v1/` changes. `setup-node` hashes both lockfiles; both installations use `npm ci` in the proper directories. Deployment requires the successful build job, including assembly and structural validation. Upload targets `./site-dist`. Build permissions are `contents: read`; deployment grants `pages: write`/`id-token: write`, uses the `github-pages` environment, and serializes deployment with the `pages` concurrency group. PR runs may cancel older PR runs; running production deployments are not cancelled.

The inspected Configure Pages v6 and Deploy Pages v5 versions exist upstream. Configure Pages defaults to no automatic enablement and reads site metadata; the documented public-resource permission exception means the build job's limited permissions are not a demonstrated defect for this public site. References: [configure-pages v6 action definition](https://github.com/actions/configure-pages/blob/v6/action.yml), [metadata lookup implementation](https://github.com/actions/configure-pages/blob/v6/src/api-client.js), [GitHub Pages REST permissions](https://docs.github.com/en/rest/pages/pages#get-a-github-pages-site), [deploy-pages v5 definition](https://github.com/actions/deploy-pages/blob/v5/action.yml). This is source review, not an authenticated runtime permission test.

**GitHub Actions execution: NOT RUN.** Actual PR checks, production deployment, Pages source/environment settings, branch protection, and live served assets remain unverified. The historical claim that an owner's actual predeployment progress will appear in deployed v1 was tested only with synthetic legacy data on the same local origin. Neither real owner data nor live deployment was accessed. These omissions do not independently block this local review.

## 6. Environments and scenarios not tested

Safari/WebKit; actual mobile devices or touch hardware; audible speech quality; uninterrupted completion of all 10/20/50 speech repetitions; natural quota exhaustion or disk failure; abrupt process termination mid-write; multiple-tab conflict/convergence behavior; Node 22 on Ubuntu (the CI environment); actual GitHub Actions execution and live Pages deployment. Mobile layout used a 390×844 desktop-browser viewport; swipe coverage used native mouse pointer input.

## 7. Review-only additions and reproduction

All retained additions are this report and files under `docs/reviews/eng-v2-01-astra/`:

- `snapshot.mjs`: full candidate inventory/copy and v1 baseline comparison.
- `source-audit.mjs`: candidate hash preservation, manifests/lockfiles, import boundaries and retained-test audit.
- `browser-support.mjs`: strict static server, native IndexedDB instrumentation, synthetic seeding and inspection.
- `browser-review.mjs`: 17 independent browser scenario groups, result recording, nonzero status when selected scenarios fail.
- `isolation-probe.mjs`: temporary failing v1 fixture used only in the disposable snapshot and removed afterward.
- JSON evidence, command logs (including environment-failure diagnostics), source diffs, and browser screenshots. Superseded selector-debug screenshots were removed; assertions and final result files identify actual application failures.

No existing application or test file was edited. No dependency/tooling package was added to either manifest or lockfile. Playwright/browser binaries and actionlint were installed only in disposable review tooling storage.

To repeat browser checks, build the complete candidate with its own lockfiles, install Playwright 1.62.1 and its Chromium/Firefox binaries in separate tooling storage, set `PLAYWRIGHT_BROWSERS_PATH`, then run:

```text
node docs/reviews/eng-v2-01-astra/browser-review.mjs <candidate-root> <tools-directory-containing-node_modules> <evidence-directory>
```

Optional `REVIEW_ENGINE=chromium|firefox` and `REVIEW_CASE=<regular expression>` select scenarios. With this candidate, the two identity scenarios and initial-read-abort scenario are expected to fail. The runner creates isolated contexts, uses a loopback server, and closes them when done.

## 8. Corrections for Fable

1. Correct flashcard identity merging and make learned-state semantics consistent across Phrases, Focus and flashcards. Preserve explicit phrase/word links without conflating unrelated display text.
2. Handle the read transaction's completion rejection on every error path; preserve the working no-overwrite/retry behavior.
3. Retain regressions for the shipped duplicate case, distinct similar-text IDs, and a native asynchronous read abort. Re-run the existing checks/build and these browser scenarios after correction.

Live deployment readiness is outside this verdict. No deployment was attempted or is requested by this review.

**CHANGES_REQUIRED**
