# ENG-V2-01-RC1 independent re-review

**Verdict: READY_FOR_PR.** Reviewed on **2026-11-21**. F1 and F2 are resolved in the actual RC1 candidate. No remaining mandatory application defect was found. The remaining original browser failure was an obsolete expectation: a two-card deck cannot be complete after learning only its first card.

The complete corrected browser suite passes **17/17 scenario groups in Chromium and 17/17 in Firefox**. The v2 suite passes **118 tests**, v1 passes **68**, and both static checks and the combined production build pass. Production code, v1, and all previous review evidence were preserved.

## 1. Exact candidate and changes

| Item | Independently observed value |
|---|---|
| Repository | `<repo>` |
| Branch | `feature/eng-v2-01-modular-foundation` |
| HEAD and locally recorded `origin/main` | `45564ca608249b3a8a6ea48073589b17e6430ea1` |
| Default branch reference | `refs/remotes/origin/main` |
| Index | Empty; nothing staged |
| Implementation inventory | All 127 files from the original review accounted for; 13 changed, 114 unchanged |
| Tracked implementation status | Same 51 paths: 11 modified, 40 deleted |
| Intended untracked implementation files | Same 111 deliverables, including both lockfiles |
| Protected pre-existing files | 184, including the implementation and original Astra/Fable evidence |
| v1 | All 55 files byte-for-byte unchanged from the original review candidate |

The [candidate inventory](eng-v2-01-rc1-astra/candidate.json) records every protected path and SHA-256, original/current hashes for the 13 changed files, Git status, and the exact tested snapshot. The [candidate diff](eng-v2-01-rc1-astra/candidate-delta.diff) was generated against original snapshot files whose hashes first matched the original inventory.

| Changed file | Reviewed purpose |
|---|---|
| `src/features/flashcards/flashcards.ts` | Build and classify cards by explicit identity |
| `src/features/flashcards/types.ts` | One phrase identity plus linked word representation IDs |
| `src/features/flashcards/FlashcardsPage.svelte` | Learn, relearn, and reset actual card IDs only |
| `src/storage/database.ts` | Observe request promises and transaction completion; release failed transactions |
| `src/features/flashcards/flashcards.test.ts` | Identity, corpus, topic, and hidden-state assertions |
| `src/features/flashcards/FlashcardsPage.test.ts` | Correct independent-card interaction and reload expectations |
| `src/app/App.test.ts` | Cross-screen identity and asynchronous read-abort regressions |
| `src/content/catalog.test.ts` | Shared phrase/word ID uniqueness and valid links |
| `src/state/progress.test.ts` | Abort, preservation, and retry assertions |
| `src/test/database.ts` | Asynchronous abort injection and unhandled-rejection collection |
| `README.md` | Explain independent entry progress |
| `CHANGELOG.md` | Record F1/F2 corrections and 566 cards |
| `docs/handoffs/ENG-V2-01.md` | RC1 handoff |

**Nonblocking documentation correction:** handoff section 10.3 says 12 changed/115 unchanged and treats the handoff as outside the inventory. The handoff was one of the original 127 files. The correct comparison is **13 changed/114 unchanged**. This report records the correction without editing the implementation handoff.

Dependencies, both manifests/lockfiles, built-in content, workflow, build configuration, and v1 are unchanged. The original repository/framework-scope assessment still applies; this was the explicitly requested Svelte eng-trainer review, with no sibling-repository modifications.

## 2. F1 — identity correction verified

**Resolved.** `buildFlashcards` creates a card for each phrase ID. A word joins that card only when its `sourcePhraseId` identifies an existing phrase; an unlinked or dangling-link word gets its own word ID. Normalized text is used only to decide whether a pronunciation hint is useful. It no longer determines identity. The duplicate-ID guard is consistent with the shipped catalog's verified unique ID space.

`summarizeDeck` reads only `card.id` from learned progress. The page's answer, Learn again, and reset operations also use that ID. Hiding a phrase or any explicitly linked word still hides that one card.

**Case A, shipped consequently:** the unchanged independent scenario passes in both engines. Learning `phrase-084` leaves `advanced-linking-004-consequently` unlearned in Focus and absent from its topic's learned review. The separately rerun supplemental scenario checks Phrases/Focus after reload, Conjunctions at 1 learned, Advanced Linking Words at 0, All Vocabulary at 1/566, exact stored IDs, and then learning the second entry independently. Both engines pass.

**Case C, explicit relationships:** the shipped phrase/linked-word scenario passes, including unlearning on Phrases and hiding through Words. A new independent fixture goes further: two phrases with similar text; two words explicitly linked to one phrase, including different wording and wording matching the other phrase; one equal-text unlinked word; and one equal-text word pointing to an absent phrase. It produces exactly four identities. All six topic views, review lists, Phrases, Focus, word hiding/unhiding, individual answers, and reloads agree. Stored learned IDs contain the two phrase IDs and two standalone word IDs, never the linked representation IDs or missing target. See [independent runner](eng-v2-01-rc1-astra/independent-browser.mjs) and [Chromium](eng-v2-01-rc1-astra/independent-final/independent-chromium.json)/[Firefox](eng-v2-01-rc1-astra/independent-final/independent-firefox.json) evidence.

## 3. The six corpus pairs and ordering

The [independent corpus audit](eng-v2-01-rc1-astra/corpus-audit.json) executes both original and RC1 card builders against the unchanged content, and checks the new output against raw phrase IDs and explicit relationships. All 566 phrases have exactly one linked word; every word is accounted for exactly once. The six old merged pairs are:

| First identity / topic | Second identity / topic |
|---|---|
| `phrase-005` / Start answer | `hedging-005-from-my-perspective` / Hedging Phrases |
| `phrase-013` / Contrast | `advanced-linking-008-that-being-said` / Advanced Linking Words |
| `phrase-084` / Conjunctions | `advanced-linking-004-consequently` / Advanced Linking Words |
| `presentation-phrase-085` / Presentation Phrases | `advanced-linking-009-as-a-result` / Advanced Linking Words |
| `presentation-phrase-087` / Presentation Phrases | `advanced-linking-012-more-importantly` / Advanced Linking Words |
| `presentation-phrase-088` / Presentation Phrases | `hedging-008-to-some-extent` / Hedging Phrases |

Thus 560 becomes **566** under the approved identity rules. Both directions of independent learning and linked-word hiding are checked for every pair. All **31 topic names and totals remain unchanged**; membership is now tied to each entry's own category/link. Every topic's complete ID sequence is compared with the raw-content membership oracle.

New decks follow source phrase order exactly. Entries formerly pulled forward into another topic by text merging now occupy their proper source positions. Existing saved order remains stable: both native browsers restored a saved 560-card sequence at index 80, appended the six newly represented IDs, advanced to index 81, saved all 566 unique IDs, and resumed at the same card after reload. No progress or ordering migration is required.

## 4. Why the original C++/C# test failed, and the precise correction

First, the original runner was copied byte-for-byte and executed unchanged. Both browsers produced **16 passes and one failure**, timing out while waiting for “Deck complete” after the first answer. At that point the evidence shows total=2, only `review-cpp` written to learned progress, and C# still available with one remaining/one learned. The [Chromium screenshot](eng-v2-01-rc1-astra/unchanged/chromium-distinct-entry-identities-with-similar-display-text.png) directly shows this state. There was no unhandled application error. The old wait prevented the test from reaching its identity assertion.

Only that scenario body was changed in the [RC1 runner](eng-v2-01-rc1-astra/browser-review.mjs). The [precise patch](eng-v2-01-rc1-astra/browser-review.patch) retains and strengthens the identity requirement:

1. Require C++ first and two cards with zero learned.
2. After the first answer, require C# available, no completed heading, 1/2 learned, stored IDs exactly `['review-cpp']`, and the remaining session exactly `['review-csharp']`.
3. Reload; require only C++ learned on Phrases, C# still learnable, C# current in Flashcards, and only C++ in learned review.
4. Answer C#; only then require completion, 2/2 learned, and exactly both IDs stored.
5. Reload again; require completion, both learned phrase cards, and both learned review entries.

The [original script copy](eng-v2-01-rc1-astra/browser-review.original.mjs), original review directory, and unchanged RC1 outcomes remain intact. [Source verification](eng-v2-01-rc1-astra/source-audit.json) proves the other 16 scenario bodies and the support module are unchanged. Final results are 17/17 in each engine.

For auditability, preliminary review-harness results are retained separately in `corrected/` and `independent/`. The first expanded C++ test needed `.first()` because the completed screen legitimately has two “Review learned vocabulary” buttons. The new relationship fixture initially omitted navigation blocks; the synchronous-failure probe initially assumed settings was the second store, whereas it is fourth, with seven requests already issued. These were review-harness errors. Their corrected complete runs are in `corrected-final/` and `independent-final/`; production files were never changed.

## 5. F2 — transaction lifecycle verified

**Resolved.** `readAll` records `tx.done` before issuing requests and tracks each keys/values promise immediately. `Promise.all` observes completion and requests together, so successful requests cannot masquerade as a committed transaction. On failure, cleanup attempts abort, attaches rejection handlers to outstanding requests/completion, and rethrows the original cause as `StorageError`. Cleanup does not replace failure with successful/default data. The same helper preserves write-failure behavior, which the complete suite retests.

Native browser verification covers three distinct failure timings in both engines:

| Injection | Verified result |
|---|---|
| Original successful first `getAll` followed by native transaction abort | Startup error, no unhandled `AbortError`, unchanged populated database, zero default writes, successful retry with progress/theme restored |
| New abort after **all eight** native read requests succeed | Transaction completion alone still fails startup; no detached rejection; all four stores unchanged; retry restores saved state without writes |
| New synchronous throw issuing the final `getAll`, with **seven** earlier requests pending | Native transaction aborted and pending rejections handled; same visible failure, preservation, zero writes, and retry guarantees |

The additional cases seed progress, settings, a Learn Pass, and a flashcard session, then compare complete stored records before and after Retry. They collect browser `pageerror` and `unhandledrejection` events; both remain empty. The unchanged save-abort, held-write, later-edit/retry, failed-write/reset, and unsaved-mode scenarios also pass. This is controlled native failure injection, not a claim to reproduce physical quota exhaustion or process termination.

## 6. Regression-test review and verification results

The 96-to-118 increase is accounted for as follows:

| v2 test file | Original | RC1 |
|---|---:|---:|
| Flashcard logic | 30 | 44 |
| Flashcard page | 26 | 27 |
| App integration | 9 | 13 |
| Catalog | 6 | 8 |
| Progress/persistence | 25 | 26 |
| **Total** | **96** | **118** |

The new tests assert distinct IDs for identical/case/punctuation-similar text, explicit links with differing text, missing links, shipped duplicate pairs, and independent topic learning. Cross-screen tests inspect stored records and reload state. Read-abort tests cause an asynchronous transaction abort after request success and check unhandled rejections, preservation, and Retry. These unit tests use `fake-indexeddb`; native browser results are independently identified above.

Rewritten tests remove the old requirement to merge unrelated IDs. Button, keyboard, swipe, flip, shuffle, topic reset, review/Learn again, hidden-state, and saved-deck/reload assertions remain. The page fixture now has four cards instead of three; expected order/counts follow independent entries. The tests express the approved identity requirements, not merely the new implementation's shape.

A fresh complete snapshot was installed and built under `.astra-review-rc1-ER04Gb/candidate`, using disposable caches. This avoids the previously observed unrelated temp-directory configuration files and leaves active dependencies/editor processes untouched. Approved execution outside the sandbox was used where esbuild/browser startup required it. Environment: Windows 11 `10.0.26200`, Node **24.18.0**, npm **11.17.0**, Playwright **1.62.1**, Chromium **151.0.7922.34**, Firefox **153.0**.

| Check | Independent result |
|---|---|
| Fresh root / v1 `npm ci` | PASS; 118 / 116 packages — [root log](eng-v2-01-rc1-astra/install-v2.log), [v1 log](eng-v2-01-rc1-astra/install-v1.log) |
| `npm run check` | 0 errors, 0 warnings — [log](eng-v2-01-rc1-astra/check-v2.log) |
| `npm test` | 5 files, 118 passed — [log](eng-v2-01-rc1-astra/test-v2.log) |
| `npm run check:v1` | 0 errors, 0 warnings — [log](eng-v2-01-rc1-astra/check-v1.log) |
| `npm run test:v1` | 3 files, 68 passed — [log](eng-v2-01-rc1-astra/test-v1.log) |
| `npm run build:site` | PASS, including required `npm run build`, v1 build, assembly, and artifact check — [log](eng-v2-01-rc1-astra/build-site.log) |
| actionlint 1.7.12 | Exit 0 for unchanged deployment workflow — [log](eng-v2-01-rc1-astra/actionlint.log) |
| Whitespace check | Default `git diff --check` flags CRLF in `CHANGELOG.md`; `git -c core.whitespace=cr-at-eol diff --check` exits 0 — [raw](eng-v2-01-rc1-astra/diff-check.log), [CRLF-aware](eng-v2-01-rc1-astra/diff-check-crlf.log) |
| Independent corpus and saved-order audit | PASS — [script](eng-v2-01-rc1-astra/corpus-audit.mjs), [results](eng-v2-01-rc1-astra/corpus-audit.json) |
| Live GitHub Actions | NOT RUN; not a local-readiness blocker |

Each browser suite served the newly assembled production artifact at `/eng-trainer/` and `/eng-trainer/v1/`, using real static responses without SPA fallback and fresh isolated contexts. [Artifact hashes](eng-v2-01-rc1-astra/corrected-final/artifact.json) cover the ten published files; unchanged and corrected runs used identical bytes.

Counts below are **scenario groups per engine**, kept separate to avoid presenting supplemental coverage as a replacement for the original suite:

| Evidence set | Chromium | Firefox |
|---|---:|---:|
| Original Astra pre-RC1 review, preserved | 14 pass / 3 fail | 14 pass / 3 fail |
| Fable's provided RC1 unchanged-suite evidence | 16 pass / 1 obsolete-test fail | 16 pass / 1 obsolete-test fail |
| Astra independent RC1 unchanged runner | 16 pass / 1 obsolete-test fail | 16 pass / 1 obsolete-test fail |
| **Astra corrected complete original suite** | **17 pass / 0 fail** | **17 pass / 0 fail** |
| Fable's provided three-case supplement | 3 pass / 0 fail | 3 pass / 0 fail |
| Astra execution of that unchanged supplement | 3 pass / 0 fail | 3 pass / 0 fail |
| New independent Astra cases | 4 pass / 0 fail | 4 pass / 0 fail |

See the [aggregate evidence](eng-v2-01-rc1-astra/verification-summary.json), complete corrected [Chromium](eng-v2-01-rc1-astra/corrected-final/browser-chromium.json)/[Firefox](eng-v2-01-rc1-astra/corrected-final/browser-firefox.json) results, unchanged [Chromium](eng-v2-01-rc1-astra/unchanged/browser-chromium.json)/[Firefox](eng-v2-01-rc1-astra/unchanged/browser-firefox.json) results, and rerun supplemental [Chromium](eng-v2-01-rc1-astra/fable-supplement/identity-supplement-chromium.json)/[Firefox](eng-v2-01-rc1-astra/fable-supplement/identity-supplement-firefox.json) results.

The complete 17 groups retain navigation/assets/mobile-link, v1/v2 storage isolation, restoration before effects, whole-corpus search, rapid/pending writes, reset/retry, startup/content failures, learning and speech API flows, both identity cases, missing records, flashcard interactions, sorted word/verb identities, and representative v1 coverage.

## 7. Remaining observations and limits

No remaining mandatory defect was confirmed. The handoff's 12/115 inventory statement is the only documentation discrepancy identified in RC1.

The changelog already used CRLF in the original candidate and still does (61 original lines, 67 now). Git's default whitespace check treats those carriage returns as trailing whitespace; the CRLF-aware check passes. No line-ending normalization was performed during review.

Existing learned-ID lists are preserved; RC1 does not infer which IDs written by an old merged answer were unintended. No data-repair migration is claimed. Synthetic missing links are handled as independent word identities; content-pack/schema work remains outside scope.

There were no uncaught application exceptions in the final runs. Console/network review found only the deliberately injected content HTTP 503 and Firefox interruptions of the external Google icon-font download during navigation/reload. Those messages remain in the evidence; they are not hidden application errors. Audible speech quality, WebKit, abrupt process termination, and a hosted Pages deployment were not verified. Local Windows/Node 24 execution does not substitute for the future Ubuntu/Node 22 Actions run.

## 8. Readiness and preservation

**READY_FOR_PR:** F1 and F2 are independently closed, the original failing test is corrected without weakening identity assertions, and the complete requested verification passes.

[Source audit](eng-v2-01-rc1-astra/source-audit.json) confirms all 184 pre-existing files match both the tested snapshot and the original RC1 capture. [Final preservation](eng-v2-01-rc1-astra/final-preservation.json) confirms unchanged implementation status/HEAD/index and removal of the disposable in-repository workspace. Review additions are limited to this report and `docs/reviews/eng-v2-01-rc1-astra/`.

No implementation edits, staging, commit, stash, push, merge, workflow dispatch, deployment, or Pages-setting change was performed. The working tree remains ready for owner review.
