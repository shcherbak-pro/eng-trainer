# ENG-V2-02B — Implementation handoff

Date: 2026-11-21. Developer: Astra / Codex. Status: **implemented and locally validated; ready for Fable's independent review**. No commit, push, merge, PR or deployment was performed.

## Baseline and preserved work

`git fetch origin main` verified `020babfaf24a14a0a1fdc15c13c90dde00ea9633`. The new branch is **`feature/eng-v2-02b-vocabulary-import`**, created directly from that `origin/main` with no upstream tracking. HEAD remains the baseline commit.

Before branching, the 12 uncommitted files under `docs/releases/` were inspected and fingerprinted. Every file remains byte-identical, including the ENG-V2-02A production report, browser evidence and reproduction script. They remain uncommitted and are separate from this milestone's changes.

Applicable parent instructions describe web-school/Angular; the explicit eng-trainer request governs this Svelte milestone. The no-commit and required-build rules were followed. There is no repository-local/nested `AGENTS.md`, bootstrap, or verified memory-loader binding; workspace `.agents`/`.codex` remain empty. The previous verified framework assessment is recorded in the 02A handoff. No unbound memory pack was loaded, and no sibling repository or framework configuration was modified. ENG-V2-01/RC1 and ENG-V2-02A handoffs, architecture and independent findings informed the implementation.

## Implementation

The complete contracts and limits are in [USER-COLLECTIONS.md](../architecture/USER-COLLECTIONS.md).

| Area | Implementation |
|---|---|
| Database migration | `src/storage/database.ts`: database version **2** adds `userCollections` and `userEntries`; the four existing stores and every record are preserved. Blocked upgrades fail visibly with close-other-tabs guidance. Failed upgrades roll back and have no detached promise rejection. |
| Native contracts | `src/collections/format.ts`: versioned JSON envelope; collection UUIDs under `user:`; entry UUIDs scoped to the collection; words/phrases, English, translation, topic, examples, optional explicit same-collection phrase links. |
| CSV | UTF-8/BOM, comma/semicolon, quoted delimiters/quotes/multiline fields. Required `english,translation`; optional `topic,example,kind`. Default kind: word. |
| Validation and preview | 2 MiB file/export limit, 1,000 entries per collection, bounded fields, schema/type checks, invalid record reporting, duplicate-text warnings and acknowledgment, ID/link collision checks. Any invalid record blocks the entire import. |
| Collection service | `src/collections/service.ts`: metadata and entries commit together, with a condition read inside the transaction to reject stale state. Catalog updates only after transaction completion. Failure retains the preview for retry. Rename/delete use the same guarantees. |
| Shared catalog | `src/content/userCatalog.ts` adapts saved entries into the existing catalog. Built-in objects/order stay intact; existing search and flashcard algorithms are reused. Collections reload from IndexedDB before the app becomes ready. |
| UI | Collections page: file selection, preview, invalid/duplicate review, confirmation, list, rename, JSON export and confirmed deletion. Shared Collection filter in Phrases, Words and Flashcards. Navigation wraps on desktop and uses two rows on small screens to fit the added page. |
| State | One new preference, `settings.collectionFilter`. Collection-specific deck keys preserve saved positions across rename/reload. Existing unfiltered `all` and topic keys keep their meaning. |

Native reimports skip identical IDs without writing collection/entry records. Changed fields under an existing ID block the proposal; imports never silently overwrite or merge meanings. New IDs append, while current collection metadata stays unchanged. CSV always proposes a new collection; warnings make repeated text deliberate.

An explicit word link joins its phrase's card; equal-text unlinked entries remain independent. Imported phrases support existing learned/hidden/Focus behavior; imported words support existing hidden/Focus behavior and flashcard learning. Topics and collection names are searchable through the shared catalog. No new search engine, lazy loading or built-in pack changes were introduced.

## Deletion and persistence policy

Removing a collection deletes only its metadata and vocabulary entries. **Learning progress, Focus IDs, hidden IDs and saved deck order are deliberately retained.** Missing IDs are omitted from catalog-backed views and counts. Reimporting the same native JSON restores progress under the same identities. The confirmation UI explains this and recommends exporting first. Other progress is never cleared by deletion. Reset progress still resets managed learning state without deleting collections. Exports contain vocabulary only, not progress.

Collection writes are separate from the existing optimistic progress queue: a failed import/rename/delete never publishes an in-memory success. Cross-tab changes to the same collection cause a conflict rather than an overwrite. Other tabs' catalogs refresh on reload; live synchronization is outside scope. Continue-without-saving mode disables collection management.

## Validation and evidence

Environment: Windows, Node 24.18.0, npm 11.17.0. [Evidence and reproduction](../evidence/eng-v2-02b/README.md).

| Check | Result |
|---|---|
| `npm run check` | **0 errors, 0 warnings** |
| `npm test` | **10/10 content/build tests; 182/182 v2 Vitest tests** (129 retained, 53 added) |
| Parser tests | 35: CSV/JSON, malformed inputs, limits, namespaces, links, multiple meanings, inert HTML-like text and export round-trip |
| Collection/storage tests | 18: migration preservation, blocked/aborted upgrade, stable ordering/identity, shared search, independent flashcards, native no-op imports, conflicts, atomic abort/quota/deletion failure and progress retention |
| `npm run check:v1` / `npm run test:v1` | **0 errors/warnings; 68/68 tests** |
| `npm run build:site` | **PASS**, including required `npm run build`, independent v1 build, assembly and structural/content hash checks |
| `npm run verify:content` | **PASS**: 1,538 built-in records, complete values/order, 566 explicit links and published content preserved; v1 unchanged |
| Native Chromium 151.0.7922.34 | **5/5 groups passed** |
| Native Firefox 153.0 | **5/5 groups passed** |
| Git scope/whitespace | No v1, built-in source, workflow, dependency or lockfile changes; diff check clean |
| Existing release evidence | **12/12 files byte-identical** |

The native browser runner serves the actual combined build at a local `/eng-trainer/` base, with a fresh context per group. It never opens the owner's profile or real vocabulary. Both engines verify:

1. Upgrade from the real four-store version-1 schema with zero startup writes; CSV preview and acknowledgment; combined catalog/search and collection filters; safe text display; independent learning/hidden/Focus state; reload/saved deck; rename; native download/reimport no-op; deletion cancellation, confirmation and reimport restoring progress. A 390-pixel viewport also has reachable navigation and no horizontal document overflow.
2. Malformed CSV/JSON, invalid rows, oversized files and native ID conflicts reject without partial writes.
3. Native transaction abort after request success and injected quota failure leave metadata, entries, existing progress and the catalog unchanged; explicit retry succeeds.
4. A held version-1 connection causes a visible blocked-upgrade error; closing it and retrying preserves every record.
5. V1 loads only its own monolith, opens no v2 database, preserves localStorage learning through reload, and leaves the populated v2 database untouched.

Final runs have **zero uncaught page errors, console errors or failed requests**. External fonts were loaded normally. Failures are controlled injections, not a claim to exhaust physical disk quota. Screenshots show only synthetic data.

During development, old database snapshots needed the two new empty stores added to their expectations. An upgrade-abort regression then exposed an unobserved `idb` upgrade-transaction completion promise; the open path now observes it and still reports the failure. The first browser run stopped at the Collection selector's accessible name; the new control now has an explicit label. The final complete native rerun passed after the navigation layout was adjusted. No prior review report was rewritten.

## Limits and review focus

- Native JSON is the stable-ID backup/exchange path. CSV export, arbitrary column mapping, entry editing, replacement imports and conflict-resolution UI are not implemented. Correct a conflicting file or use genuinely new IDs for new learning items.
- Import files and collection exports are capped; catalogs remain eager. No new performance benchmark was run for many large collections.
- Desktop Chromium/Firefox and one narrow viewport were checked. Safari, real mobile/touch, audible speech, process termination, physical quota exhaustion and exhaustive multi-tab progress behavior were not exercised. Same-collection stale-write rejection and blocked upgrades are covered.
- No GitHub Actions or production run was triggered; these are local candidate checks. Database version 2 has no downgrade path to the old application.
- N1–N7 from the 02A review remain separate deferred follow-ups. No pronunciation assessment/model, cloud sync, account, external import API, backend, or broad visual redesign was added.
- Review the atomic write/condition lifecycle, namespace/link validation, retained-progress deletion policy, native repeat imports and new-store migration. The test/evidence fixtures are synthetic and may be recreated safely in disposable contexts.

## Exact Git state

Branch: `feature/eng-v2-02b-vocabulary-import`. HEAD/base: `020babfaf24a14a0a1fdc15c13c90dde00ea9633`. Nothing is staged; all tracked implementation changes are unstaged and all new files are untracked. The 02A release files remain untracked and unchanged. There are no new commits and no remote feature branch created by this task.

See [full status](../evidence/eng-v2-02b/git-status.txt) and the [candidate file inventory with hashes](../evidence/eng-v2-02b/candidate.json) for the complete review scope. Dependencies, generated manifests/packs, build output, temporary tooling and browser profiles remain ignored. Do not omit the authored new files when preparing a later integration candidate.

**ENG-V2-02B — IMPLEMENTED / READY FOR INDEPENDENT REVIEW**

## Corrective iteration — ENG-V2-02B-RC1 (2026-11-21)

The owner requested fixes for F1 and F2 from [Fable's independent review](../reviews/ENG-V2-02B-FABLE.md), which recorded **READY_FOR_PR** for the preceding candidate. This section describes the subsequent, uncommitted correction; it does not revise that independent verdict or its evidence. Fable must re-review this delta before integration.

Before editing, the complete non-ignored tree was inventoried. All **356** files in Fable's candidate fingerprint matched, as did the **47** files in the original implementation inventory and its **12** protected release files. Live `git ls-remote origin refs/heads/main` returned `020babfaf24a14a0a1fdc15c13c90dde00ea9633`, matching HEAD. Repository instructions and the absence of a verified framework binding were rechecked; no external memory was loaded.

### Root causes and corrections

**F1:** `resolveSession()` correctly filters unavailable cards for display, but answers and shuffle saved that filtered order directly. This permanently removed absent collection IDs from shared `all` and `topic:…` sequences. `preserveUnavailableCards()` now reconciles a visible result with the previous saved order before persistence. It retains absent `user:` slots, removes available cards that leave the learning pool, and appends new IDs. The cursor follows the next visible card, including wraparound. Restoring a collection therefore restores its earlier slots without jumping away from the current card. Display and counts still use the filtered session; there are no ghost cards. Shuffle and single-deck reset use the same preservation rule, and other deck records stay untouched. The existing `{ order, index }` format and database version are unchanged.

**F2:** the toolbar condition used the entire hidden-ID list, and `unhideAll()` replaced that list with `[]`. The state operation now requires an explicit list of available IDs; the views pass catalog-known hidden entries and show the action only when that list is nonempty. Its existing global scope for the entry type is preserved, independent of collection/search/category filters. Both built-in and available imported entries can be unhidden, while absent collections retain their flags. The verbs caller uses the same required scope argument; imports still support only words and phrases.

The [architecture contract](../architecture/USER-COLLECTIONS.md#deletion-policy) documents these rules. Collection identities, the JSON contract, parsing/duplicate handling, atomic writes, database name/version, built-in sources, v1, workflow and dependencies are unchanged from the reviewed candidate.

### Verification

New regressions: **6** session-algorithm cases in `flashcards.test.ts` and **5** service/IndexedDB/mounted-view cases in `retainedLearning.test.ts`. They cover shared all/topic orders through import → deletion → answers → reload → native reimport; independent same-text word/phrase identities; learned/Focus/hidden preservation; unrelated and collection-specific sessions; wraparound, exhaustion, new IDs, shuffle and single-deck reset; mixed available/absent hidden entries, empty bulk-unhide scope and restored controls.

| Check | RC1 result |
|---|---|
| `npm run check` | **0 errors, 0 warnings** |
| `npm test` | **10/10** content/build tests; **193/193** v2 tests (182 retained + 11 added) |
| `npm run check:v1` / `npm run test:v1` | **0 errors/warnings; 68/68** |
| `npm run build:site` | **PASS**, including the required root `npm run build`, v1 build, assembly and structural/content checks |
| `npm run verify:content` | **PASS**: 1,538 built-in records, exact values/order, all 11 packs and 566 links; v1 unchanged |
| Chromium 151.0.7922.34 / Firefox 153.0 | **3/3 RC1 scenarios per engine**, plus **5/5 original regression groups per engine** |
| Browser failures | **0** page/console errors or failed requests; RC1 explicitly records **0** unhandled rejections |
| Protected evidence | **12/12** release files, original implementation evidence and the entire independent review remain byte-identical |
| Git scope/whitespace | No staged changes; expected correction scope only; diff check clean |

The RC1 browser runner uses native IndexedDB and the actual combined build, with a fresh synthetic context for every scenario. It imports two collections through the UI, exports native JSON, seeds interleaved saved orders in the existing schema, then persists both shared decks with real answers. After deletion it answers remaining built-in cards, reloads, reimports, and compares complete saved orders, cursors, progress and entry records. It also verifies a no-write repeat import, normal appending of a genuinely new ID, and the original collection-specific position. The hidden-state scenario uses real Hide/Unhide controls with two removed entries of each kind, available imported entries and built-ins. Native restore/reload retains the hidden flags and controls work again when entries return.

The original browser runner was rerun into a separate RC1 output directory: import/export, migration and transaction/blocked-upgrade failures, search/learning and v1/localStorage isolation still pass. No owner's profile or actual vocabulary was accessed. Final screenshots were inspected. Harness-only corrections during development addressed the manifest's `url`/`content` envelope, navigation after a seeded reload (the URL hash takes precedence), and the Topic select's accessible label. They required no application changes.

Reproducible commands, sanitized logs, browser records/screenshots, build hashes and the before/after correction inventory are in [RC1 evidence](../evidence/eng-v2-02b-rc1/README.md). The original review report and evidence were not edited or rehashed in place. New command-log path/ANSI normalization is recorded separately.

### Deferred work and limitations

F3–F6 are explicitly deferred to a future UI/UX iteration: keyboard focus after file selection; guidance during a still-blocked upgrade retry; stale-write conflict wording; Cyrillic export filenames. None was implemented. ENG-V2-02A N1–N7 remain separate deferred findings.

Retained slots cannot recover order already discarded by an older build. Absolute numeric positions can shift when available cards are learned/removed; the next available identity remains the cursor. A global Reset progress still intentionally clears managed state. Existing multi-tab progress concurrency behavior, eager loading, and the absence of a database downgrade path are unchanged. Safari, real mobile/assistive technology, physical quota exhaustion and process termination were not newly tested. No CI or production run was requested or triggered.

### Exact Git state for re-review

Branch **`feature/eng-v2-02b-vocabulary-import`**; HEAD/base **`020babfaf24a14a0a1fdc15c13c90dde00ea9633`**. No commits or remote branch were created, and nothing was staged, pushed, merged or deployed. The earlier candidate and Fable report remain uncommitted alongside this correction. The 12 ENG-V2-02A release files remain untracked and unchanged. Generated content, dependencies, builds and temporary browser work remain ignored.

See the [complete final status](../evidence/eng-v2-02b-rc1/git-status.txt) and [RC1 delta with before/after hashes](../evidence/eng-v2-02b-rc1/candidate-delta.json). This delta modifies seven existing source/test files and two documents, and adds the mounted regression suite plus RC1 evidence. The independent review and original evidence are preserved for comparison.

**ENG-V2-02B-RC1 — READY FOR INDEPENDENT RE-REVIEW**
