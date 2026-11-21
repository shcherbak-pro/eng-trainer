# ENG-V2-02B-RC1 — Independent re-review (Fable)

| | |
|---|---|
| Date | 2026-11-21 |
| Reviewer | Fable (Claude Code), independent of the implementation |
| Developer | Astra / Codex |
| Scope | Corrections for F1 and F2 from [the ENG-V2-02B review](ENG-V2-02B-FABLE.md), plus regression of the complete ENG-V2-02B candidate |
| Repository | `shcherbak-pro/eng-trainer`, branch `feature/eng-v2-02b-vocabulary-import` |
| Baseline | `020babfaf24a14a0a1fdc15c13c90dde00ea9633` (= `origin/main`, verified with `git ls-remote`) |
| Verdict | **READY_FOR_PR** |

## Summary

Both corrections fix the root causes I reported, and I verified each independently. Neither changes anything beyond its finding.

- **F1 (shared deck order):** while a collection is absent, answering, shuffling or resetting a shared deck (`all`, `topic:…`) no longer discards that collection's card slots. Reimport brings the cards back in their original relative positions.
  - A model test drove the real session functions through 6,000 random 60-step histories and found **0 oracle violations**. It catches the original defect and three plausible wrong fixes.
  - In Chromium and Firefox, 108 real UI answers, 6 shuffles and 4 single-deck resets were each checked against an independent oracle for the exact persisted ID sequence and the cursor.
- **F2 (hidden state):** "Unhide all" stays global for its entry type but touches only entries currently in the catalog. Hidden flags of a removed collection stay stored and return on reimport. The control is no longer shown for removed entries alone, and other entry types are not affected.
- **Regression:** all documented commands pass, and all original ENG-V2-02B browser scenarios pass again in both engines. One Firefox layout measurement was flaky in the harness: it passed on 3 of 3 reruns, and a clean probe confirms the layout.

**No newly confirmed defects.** Three informational observations and some test-quality notes are listed in section 8. F3–F6 and the ENG-V2-02A findings N1–N7 remain deferred, as agreed.

---

## 1. Exact candidate and RC1 delta inventory

Recorded before any test: `HEAD` = baseline, 0 staged files, no stash, and 143 status entries. All 436 non-ignored working-tree files are fingerprinted in [candidate.sha256](eng-v2-02b-rc1-fable/candidate.sha256), excluding this re-review's own directory; the status list is in [candidate-status.txt](eng-v2-02b-rc1-fable/candidate-status.txt).

**Delta against my original fingerprint** (356 files, [ENG-V2-02B review](eng-v2-02b-fable/candidate.sha256)): 9 changed, 0 removed, 80 added.

| Change | Files |
|---|---|
| Modified source | `src/features/flashcards/flashcards.ts` (new `preserveUnavailableCards`), `src/features/flashcards/FlashcardsPage.svelte`, `src/state/progress.ts` (`unhideAll` scope, `resetFlashcardDeck` session argument), `src/features/vocabulary/PhrasesPage.svelte`, `WordIndexPage.svelte`, `IrregularVerbsPage.svelte` |
| Modified tests | `src/features/flashcards/flashcards.test.ts` (+6 cases) |
| New tests | `src/features/collections/retainedLearning.test.ts` (5 cases) |
| Modified documents | `docs/handoffs/ENG-V2-02B.md` (RC1 section appended), `docs/architecture/USER-COLLECTIONS.md` (deletion-policy paragraphs, deferred follow-ups) |
| New evidence | 31 files under `docs/evidence/eng-v2-02b-rc1/` |
| Added but not part of RC1 | My original review report and its 47 evidence files (48 files) |

This matches Astra's description exactly: seven existing source/test files, two documents, the mounted regression suite and the evidence. There are no unexplained differences.

**Unchanged** (byte-identical to the reviewed candidate):
- `src/storage/database.ts` (database name, version 2 and stores);
- `src/collections/format.ts` and `service.ts` (import/export contracts, atomic writes);
- `src/content/userCatalog.ts` and `src/app.css`;
- all of `v1/`, `content/` (11 packs), `.github/`, `scripts/`, `package.json` and `package-lock.json`;
- the 12 `docs/releases/` files.

**Astra's inventory.** All 52 hashes in [candidate-delta.json](../evidence/eng-v2-02b-rc1/candidate-delta.json) match the files: 9 before/after, 31 added and 12 release files.

**My original review is untouched.** All 48 files are inside the fingerprint above, and none has a modification time later than my final edit of that report.

## 2. Independent F1 assessment

**Root cause, confirmed in code.** `resolveSession()` filters the saved order down to the visible learning cards, which is correct for display. Before RC1, `answer()`, `shuffle()` and the deck reset saved that *filtered* session directly, so absent `user:` IDs were dropped from `all`/`topic:…` on the first save.

**The correction.** `preserveUnavailableCards(saved, next, availableIds)` walks the previously saved order:

| Saved ID | Treatment |
|---|---|
| Absent `user:` ID | Keeps its slot |
| ID still in the new visible sequence | Its slot is refilled, in order, from that sequence |
| Anything else (learned, hidden, or a stale built-in ID) | Dropped, as before |

- The remaining new IDs are appended at the end.
- The cursor becomes the merged position of the card the visible session points at.
- For "Keep learning" and "I know it" the refill is the identity mapping: the result is the old order with only the cards that left the pool removed, and new cards appended.
- For shuffle and reset, only the available slots are reordered; absent slots keep their exact indices.
- With no absent IDs, the output equals the input exactly, so behaviour for existing users is unchanged.
- The stored `{ order, index }` format and database version are unchanged.
- `FlashcardsPage` applies it to answers, shuffle and reset. A reset stores the merged session only when it still contains absent IDs; otherwise it deletes the session, as before.

**Model test.** [integration/session-model.test.ts](eng-v2-02b-rc1-fable/integration/session-model.test.ts) ran in the disposable copy: **11/11** ([results](eng-v2-02b-rc1-fable/results/session-model.json)). It composes the real `resolveSession`, `answerCard`, `shuffleSession` and `preserveUnavailableCards` exactly as `FlashcardsPage` does.

- **Inputs:** each run is a random history of 60 steps drawn from:
  - "Keep learning", "I know it", shuffle and single-deck reset;
  - Learn again and hide/unhide;
  - removing and reimporting three collections (one introduced later as genuinely new), and reload.
- **Decks:** built-in, A, B and C cards, for both `all` and a topic subset. Saved orders also start with stale built-in IDs.
- **Oracle** (written from the documented rules, not from Astra's values):

| Check | Rule |
|---|---|
| Answers | The exact persisted sequence is `filter(old, absent or still learning) ++ new learning cards` |
| Absent IDs | Never lost, relative order unchanged |
| Duplicates and ghosts | No duplicate slots; no ghost card is ever visible |
| Cursor after an answer | The next card (or wraparound) |
| Cursor after shuffle | The first shuffled card |
| Shuffle and reset | The visible sequence equals the shuffled order or the deck's card order |
| Cursor after reimport | Does not move when the persisted cursor card was the one on screen |

| Implementation | Runs × steps | Oracle violations |
|---|---|---|
| RC1, `all` deck | 3,000 × 60 | **0** |
| RC1, topic deck | 3,000 × 60 | **0** |
| Mutant: pre-RC1 (save the visible session directly) | 300 × 60 per deck | 5,010 / 1,954 lost absent IDs, plus order violations |
| Mutant: absent IDs moved to the end | ″ | 1,188 / 988 order violations |
| Mutant: cursor index not remapped | ″ | 1,334 / 1,084 cursor violations |
| Mutant: learned or hidden known cards retained | ″ | 4,025 / 3,955 order violations |

The oracle therefore detects the original defect and plausible incorrect fixes. Correct preserved array length alone would not pass it.

**Native browser test.** [rc1-browser-review.mjs](eng-v2-02b-rc1-fable/rc1-browser-review.mjs) runs on the assembled `site-dist`, in fresh contexts, in Chromium 151.0.7922.34 and Firefox 153.0.

*Fixtures:*
- Collection A has an unlinked word "Same text", an unlinked phrase "Same text", a phrase with a linked word, another word, and an off-topic phrase.
- Collection B has its own "Same text" word, a phrase and a word.
- Collection C is imported later as a genuinely new collection.

*How the decks were built:*
- **All Vocabulary:** seeded once in the existing schema with A, B and built-in cards interleaved, with the cursor on A's phrase at deletion time.
- **Topic "Structure":** 5 built-in cards plus A and B, interleaved through the real **Shuffle** button with a seeded `Math.random`.

*After every UI answer, the harness checks:*
- the **exact persisted ID sequence**;
- the **persisted cursor ID**;
- the **displayed card**.

All three are compared with an oracle computed from the published packs plus IndexedDB.

| Required scenario | Result (both engines) |
|---|---|
| Import two collections; build and save shared decks; record orders and cursors | 574 IDs for All Vocabulary (5 from A); 12 for the topic deck (4 from A) |
| Delete A | No session write; hero counts drop by A's 3 phrases and 3 words. With the cursor on A's card, the view moves to the next visible card |
| A disappears from visible decks | A full cycle of the topic deck shows no A card and exactly one "Same text" (B's) |
| Answer remaining cards | 18 (All Vocabulary) and 36 (topic) oracle-checked answers per engine, absent A IDs retained throughout |
| Independent same-text identities | "I know it" on B's "Same text" adds only B's ID to `learnedPhrases` |
| Learn again | The relearned card is appended on the next save (existing rule) |
| Shuffle and single-deck reset with A absent | Absent slots keep their exact indices. The visible multiset after shuffle equals the learning cards; reset refills the available slots in deck order. Cursor on the first card |
| Reload | Persisted order and displayed card unchanged |
| New IDs (C imported while A is absent) | Appended at the end on the next answer |
| Reimport A (original native JSON) | **No session write, no cursor jump**; A's IDs in their **original relative order** (equal to the order recorded before the first deletion); A's cards shown in their retained slots in the next cycle |
| Repeated deletion and reimport | A second cycle with answers in between preserves the same A order |
| Unrelated collection-specific session (B) | Deep-equal throughout |
| Ghost cards | None while A is absent; hero counts exclude A |

**One documented cursor case, verified separately.** The cursor is saved on the next visible card only when a session is written.

If the persisted cursor is on a card of the removed collection and nothing is answered before reimport, the deck resumes at that restored card:
- the browser scenario `F1-cursor-on-removed-card-without-answers` shows this in both engines;
- the model test hit this case 1,217 and 2,074 times.

This matches the architecture text and is not a defect (see O1).

**Limitation acknowledged in the handoff.** Slots discarded by the earlier build cannot be reconstructed. I did not require it; the verification covers prevention of future loss.

## 3. Independent F2 assessment

**Root cause, confirmed.** Before RC1, the three "Unhide all" controls rendered whenever the raw hidden list was non-empty, and `unhideAll()` replaced that list with `[]`.

**The correction:**
- `unhideAll(kind, availableIds)` removes only the given IDs (`removeValues`).
- Each view passes the catalog-known hidden IDs of its type, computed from the full catalog rather than the filtered view, and shows the control only when that list is non-empty.
- All three callers pass a scope; `svelte-check` reports 0 errors, so the required argument is used everywhere.

An empty scope returns the same list reference, so no change is persisted.

**Native browser test** (`F2-hidden-state-mixed-types-filters-delete-reimport`, both engines). Hidden at the start:

| Type | Hidden entries |
|---|---|
| Phrases | 1 built-in, 1 from A, 1 from B |
| Words | 1 built-in, 1 from A, 1 from B |
| Verbs | 1 real verb, plus a stale verb ID not in the catalog |

| Required check | Result |
|---|---|
| Delete A; its hidden IDs remain in IndexedDB | All three lists unchanged; hero hidden count 7 → 5 (stale verb ID never counted) |
| Unnecessary control not shown | After the available entries are unhidden, the Words and Phrases controls disappear although A's IDs are still stored. The Verbs control was never shown for the stale ID alone |
| Unhide all for available entries; global scope kept | "Unhide all words" pressed while the view was filtered to collection B and searched for "bravo": the **built-in** hidden word (not in view) was unhidden too. "Unhide all phrases" was pressed under a search plus Category filter |
| Unavailable IDs unchanged | `hiddenWords` = [A's word], `hiddenPhrases` = [A's phrase] |
| Other types untouched | Unhiding words left phrases and verbs unchanged, and so on. Unhiding verbs kept the stale ID |
| Reload | Controls stay hidden; the database is unchanged |
| Reimport A | A's word and phrase are hidden again (absent from lists), the hero shows 2 hidden, the controls return; unhiding words then clears only words |

The same entry-scoped behaviour was confirmed by the original orphaned-progress scenario. Rerun unchanged on RC1, it now records "Unhide all" **not shown** and the word **still hidden after reimport**; the original candidate recorded the opposite.

## 4. Regression-test quality assessment

The 11 new tests are worth keeping.

**`flashcards.test.ts`** (6 cases) asserts *exact* ID sequences and cursor indices, not lengths:
- absent slots kept after "Keep learning";
- learned and hidden cards removed, a new ID appended, a stale built-in ID dropped;
- wraparound to the first available card;
- an exhausted deck keeping absent IDs, which return on restore;
- shuffle keeping absent slots and the cursor;
- no duplicate slots, and identity when nothing is absent.

These could not pass while losing absent IDs, changing restored order or misplacing the cursor in the cases they cover.

**`retainedLearning.test.ts`** (5 cases: mounted Svelte views plus fake IndexedDB):
- **Shared-deck tests:** both shared decks go through import → deletion → two real answers → reload while absent → reimport. They compare the complete persisted session, progress, entry records, the other collection, the other shared deck and both collection-specific sessions.
- **Shuffle and reset:** absent slots and the exact reset order are checked.
- **F2 tests:** mixed available and absent hidden IDs, an empty scope, reload and the returning control.

**Weaknesses** (non-blocking; all covered by my independent checks):

| Weakness | Location | Effect |
|---|---|---|
| Tautological assertions | `retainedLearning.test.ts` lines 109–110 | They assert indexes in the test's own `expected` constant, so they can never fail |
| Ambiguous final check | The last F1 assertion (`'Same term'`) | It cannot tell the word `id(1)` from the phrase `id(2)`, which share that text; it would pass with the cursor on the wrong one |
| Missing F2 checks | F2 mounted test | Does not check that the *other* hidden lists stay unchanged, and does not mount the Verbs page |
| Missing cursor check | Mounted shuffle test | Does not check the cursor after shuffle |
| Limited model coverage | Unit tests overall | Only fixed histories, no repeated cycles or randomized histories |

## 5. Browser verification in Chromium and Firefox

All runs use the assembled production artifact (`site-dist`) built from the RC1 tree in a disposable copy. Every scenario uses a fresh context, synthetic data and no owner profile or storage. External requests are blocked apart from a stubbed font stylesheet.

| Suite | Chromium 151.0.7922.34 | Firefox 153.0 |
|---|---|---|
| RC1 F1/F2 scenarios ([rc1-browser-review.mjs](eng-v2-02b-rc1-fable/rc1-browser-review.mjs)) | 4/4 PASS | 4/4 PASS |
| Original ENG-V2-02B suite, rerun **unchanged** ([browser-review.mjs](eng-v2-02b-fable/browser-review.mjs)) | 15/15 PASS | 14/15 in the full run; the failing scenario passed **3/3 reruns** |
| Footer and bottom-navigation clearance probe ([mobile-bottom-probe.mjs](eng-v2-02b-fable/mobile-bottom-probe.mjs)) | 4/4 clear | 4/4 clear |

The original suite covers:
- migration, including an open released-build tab, blocked and failed upgrades;
- CSV/JSON import, preview, duplicates and cancel;
- deletion and reimport, and two-tab stale writes;
- native transaction failures and retry;
- security and inert text, and export round trips;
- UI, keyboard and layout, performance, and v1 isolation.

**The single Firefox failure was a harness flake.** The UI scenario's "page end clears the bottom navigation" check at 390 px measured before Firefox finished scrolling after a viewport resize: scrollY 2,089 of a maximum of 2,295, the same artifact the original review documented.
- `src/app.css` is byte-identical to the reviewed candidate.
- The same scenario passed on 3 of 3 immediate reruns.
- The clean probe shows Firefox reaching the true page end with the footer above the navigation in all four candidate cases (footer bottom 688 < navigation top 727).

The original script was intentionally not modified.

There were **0 page errors, 0 console errors, 0 unhandled rejections and 0 external requests** in all runs.

## 6. Static, unit and build results

Run in a disposable full copy with fresh `npm ci` (root and `v1`). The logs are in [logs/](eng-v2-02b-rc1-fable/logs/).

| Command | Result |
|---|---|
| `npm run check` | 0 errors, 0 warnings (220 files) |
| `npm test` | `node:test` **10/10**; Vitest **9 files, 193/193** (182 retained + 11 new) |
| `npm run check:v1` | 0 errors, 0 warnings (189 files) |
| `npm run test:v1` | **68/68** |
| `npm run build:site` | PASS, including the required `npm run build`, the v1 build, assembly and `check:site` (11 pack hashes, identities, counts and links) |
| `npm run verify:content` | PASS: 1,538 records, exact content and order, 566 links, published content and v1 unchanged |
| `git -c core.whitespace=cr-at-eol diff --check` | Clean |
| `npm run build` in the developer workspace | PASS. Regenerated `public/data` (git-ignored) is byte-identical to the copy's |
| Review model test (`session-model.test.ts`) | 11/11 |

## 7. Newly confirmed defects

**None.**

## 8. Remaining non-blocking findings

**New observations** (informational; no change required):

| ID | Observation |
|---|---|
| O1 | **Cursor after reimport without answers.** If the persisted cursor was on a card of the removed collection and no answer was saved during the absence, reimport resumes at that restored card. This follows the documented rule, but the handoff phrase "without jumping away from the current card" holds only once a session has been written while the collection was absent. One sentence in `USER-COLLECTIONS.md` would make this explicit |
| O2 | **Retained IDs accumulate.** Absent `user:` IDs now stay in shared deck orders until the collection is reimported or the global Reset progress is used, as learned, hidden and Focus IDs already do. Growth is bounded by what the learner imported (at most 1,000 IDs per collection per deck). There is no way to purge one removed collection's progress |
| O3 | **Stale verb IDs.** "Unhide all verbs" no longer appears for, or clears, verb IDs that are not in the catalog, for example from older content. Such IDs were already invisible and uncounted; this is harmless and consistent with F2 |

**Test-quality notes:** see section 4.

**Deferred and accepted** (not implemented, as instructed): F3 keyboard focus after file selection; F4 guidance while retrying a still-blocked upgrade; F5 conflict-specific wording for stale writes; F6 Cyrillic export file names. The ENG-V2-02A findings N1–N7 remain separate.

## 9. Verification limitations

- **Not tested:** Safari/WebKit, real mobile or touch devices, assistive technology, real disk-quota exhaustion, process termination, more than two tabs, GitHub Actions and production.
- **Released baseline:** a local build of `020babf`, reused from the original review folder.
- **Model scope:** the model test composes the real session functions as `FlashcardsPage` does, but the page wiring itself is verified natively in the browser, not inside the model.
- **History:** progress pruned by the earlier build cannot be reconstructed, as the handoff states; I verified prevention only.
- **Firefox flake:** the UI-layout measurement in the unchanged original harness can be early in Firefox; this is documented, with reruns and a clean probe.

**Harness corrections** made while building the RC1 harness. These were all bugs in my own scripts, none required application changes:
- **Hero counts:** A has 3 word entries, because a linked word still counts as a word.
- **First topic shuffle:** it ran before any topic session existed.
- **Element matching:** I tried to match a list item by `innerText` newlines.
- **Fixture order:** my first crafted order put B's "Same text" behind the cursor.
- **Duplicate button:** "Back to flashcards" exists twice.
- **Wrong page:** the final F2 click was issued on the wrong page.
- **Model test:**
  - the first reimport-cursor oracle was too strict (see O1);
  - one edge used an inexact wrap rule;
  - the long runs needed an explicit Vitest timeout.

## 10. Git state and preservation evidence

| Check | State |
|---|---|
| Branch / HEAD | `feature/eng-v2-02b-vocabulary-import` / `020babfaf24a14a0a1fdc15c13c90dde00ea9633`; `origin/main` is the same commit |
| Staged / stash / commits | 0 / none / none created. Nothing pushed, merged, dispatched or deployed |
| Candidate after the re-review | All **436** fingerprinted files byte-identical: Astra's implementation and evidence, the **12 `docs/releases/` files**, and my original review and its evidence. The 143 status entries outside this re-review's directory are unchanged |
| Disposable copy | Matched the same fingerprint before and after testing |
| Additions | This report and `docs/reviews/eng-v2-02b-rc1-fable/` only |
| Workspace side effects | `npm run build` regenerated the git-ignored `public/data` (identical) and `dist/` |

**Evidence**, under [eng-v2-02b-rc1-fable/](eng-v2-02b-rc1-fable/). Local paths are replaced as in [SANITIZATION.md](SANITIZATION.md), and ANSI codes are stripped:

| Path | Content |
|---|---|
| `candidate.sha256`, `candidate-status.txt` | Pre-review fingerprint (436 files) and status (143 entries) |
| `integration/session-model.test.ts`, `results/session-model.json` | F1 model test, oracle and mutants |
| `rc1-browser-review.mjs`, `browser/rc1/` | Native F1/F2 scenarios and their results |
| `browser/regression/`, `browser/regression-firefox-ui-rerun-{1,2,3}/` | Unchanged original suite on RC1, and the Firefox reruns |
| `browser/mobile-bottom/` | Footer and navigation clearance probe |
| `collect-evidence.mjs`, `logs/` | Collector; command, install, model, browser, probe and workspace-build logs |

---

**Verdict: READY_FOR_PR.** I independently verified both corrections, found no regressions, and no mandatory findings remain.
