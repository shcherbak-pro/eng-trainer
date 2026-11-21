# ENG-V2-02B — Independent review (Fable)

| | |
|---|---|
| Date | 2026-11-21 |
| Reviewer | Fable (Claude Code), independent of the implementation |
| Developer | Astra / Codex |
| Milestone | ENG-V2-02B — User Vocabulary Collections & Import/Export |
| Repository | `shcherbak-pro/eng-trainer`, branch `feature/eng-v2-02b-vocabulary-import` |
| Baseline | `020babfaf24a14a0a1fdc15c13c90dde00ea9633` (= `origin/main`, verified with `git ls-remote`) |
| Candidate | Uncommitted working tree on that branch; fingerprinted before any test ([candidate.sha256](eng-v2-02b-fable/candidate.sha256)) |
| Verdict | **READY_FOR_PR** |

## Summary

The implementation does what the handoff and [USER-COLLECTIONS.md](../architecture/USER-COLLECTIONS.md) say. I reproduced every data-safety property independently, with my own scripts, fixtures and browser harness, and did not reuse Astra's tests or runner:

- **Migration:** a version 1 database with real released-build data upgrades to version 2 in native Chromium and Firefox. All four existing stores stay byte-for-byte equal, and startup writes nothing.
- **Upgrade failures:** blocked and failed upgrades leave version 1 intact and recover on retry.
- **No partial writes:** imports, renames and deletions never leave partial data, under injected aborts (after requests succeeded) or injected quota errors. Two tabs can never overwrite each other's collection changes: six stale-write cases were all refused.
- **Built-in content:** the 1,538 built-in records are never changed or reordered. 78,752 built-in-versus-combined search comparisons gave 0 mismatches, and built-in flashcards are identical.
- **Deletion:** removing a collection retains progress as designed, and native reimport restores the same identities, learned/hidden/Focus state and the collection's own deck position.
- **Security and isolation:** imported text is inert everywhere it is shown. Prototype keys, malformed UTF-8 and pathological files are rejected safely, import and export make no network requests, and v1 is untouched.

I found **no mandatory defects**. Six low-severity findings (F1–F6) and several informational notes are listed in sections 12–13. None loses or corrupts data.

---

## 1. Exact candidate and file inventory

**Recorded before testing:** branch `feature/eng-v2-02b-vocabulary-import`, `HEAD` = baseline `020babf`, no commits on top, 0 staged files, no stash.

The working tree had 60 status entries:

| Group | Files | Notes |
|---|---:|---|
| Modified tracked files | 18 | `src/` (16), `README.md`, `CHANGELOG.md`; 154 insertions, 40 deletions |
| New candidate files | 30 | 8 source/test files, `USER-COLLECTIONS.md`, the handoff, 20 evidence files |
| Pre-existing ENG-V2-02A release evidence (`docs/releases/`) | 12 | Not part of this milestone; **left byte-identical** (hashes also match Astra's `candidate.json`) |

**New source:**

| File | Purpose |
|---|---|
| `src/collections/format.ts` (151 lines) | Validation, CSV and native JSON |
| `src/collections/service.ts` (159) | Persistence, preview plans, rename, removal and export |
| `src/content/userCatalog.ts` (26) | Adapter into `createCatalog` |
| `src/features/collections/CollectionsPage.svelte` (159) | The new page |
| `src/shared/ui/CollectionFilter.svelte` (19) | The shared collection filter |
| `src/collections/format.test.ts`, `src/collections/service.test.ts`, `src/test/collections.ts` | Tests and fixtures |

**Changes to existing code:**
- `database.ts` (version 2, write conditions, blocked/failed-upgrade handling);
- `catalog.ts` and `types.ts` (an optional `collections` / `collectionId`);
- flashcards (`collectionId` on cards and collection deck keys);
- Phrases and Words filters;
- `settings.collectionFilter`;
- `AppShell` (known-ID counts, navigation);
- `app.css` (two-row mobile navigation, desktop navigation wrapping);
- tests adjusted for the two new empty stores.

**Unchanged:** no diff against the baseline in `v1/`, `content/`, `.github/`, `scripts/`, `package.json`, `package-lock.json`, `vite.config.ts` or `tsconfig.json`.

**Fingerprints:**
- All 356 non-ignored working-tree files (excluding this review's own directory) were hashed into [candidate.sha256](eng-v2-02b-fable/candidate.sha256) before testing, and re-verified at the end: **all 356 byte-identical**, the same 60 status entries, nothing staged.
- The disposable copy used for testing matched the same fingerprint before and after.
- Astra's [candidate.json](../evidence/eng-v2-02b/candidate.json) lists 59 files. All 59 hashes match; the only status entry it omits is itself.

The status list at the start is saved as [candidate-status.txt](eng-v2-02b-fable/candidate-status.txt).

## 2. IndexedDB migration

**Code review.** `upgrade()`:
- creates the four state stores only when `oldVersion < 1`, and the two user stores when `oldVersion < 2`;
- if store creation fails, it records the failure, aborts the version-change transaction and reports it, with idb's `transaction.done` observed so the rejection is not left unhandled.

A blocked open rejects with close-other-tabs guidance. If that abandoned request later succeeds, it is closed. `blocking()` still closes this connection for a newer version.

**Native verification**: Chromium 151.0.7922.34 and Firefox 153.0, [browser-review.mjs](eng-v2-02b-fable/browser-review.mjs).

| # | Required check | Result (both engines) |
|---|---|---|
| 1 | Fresh initialization | Version 2, six empty stores, **0 writes** at startup |
| 2 | Upgrade from a populated version 1 database | **Pass.** Data written by the **released 020babf build through its own UI** (learned phrase, saved deck position) plus realistic seeded records. The candidate upgrades while the released tab is still open; all four stores are deep-equal before and after |
| 3 | Learned/hidden progress | Preserved: `phrase-005`, `phrase-084`, `phrase-001` learned; hero counts match the released build (3 Focus, 2 hidden) |
| 4 | Focus | Preserved: phrase, word and irregular-verb Focus IDs |
| 5 | Saved deck order and position | Preserved: the candidate shows the same card and position as the released build ("In my experience, …", card 4 of 561) |
| 6 | Settings and Learn Pass | Preserved: theme `dark`, active page, page size, flashcard mode; the Learn Pass is visible on Index; an unknown future progress key is kept |
| 7 | Failed/aborted upgrade | Two native injections: a throw inside `createObjectStore('userEntries')`, and an abort of the version-change transaction. Each gives a storage-error screen; the database stays **version 1 with identical records**; no unhandled rejection; Try again upgrades and preserves everything |
| 8 | Blocked upgrade (another connection without a `versionchange` handler) | The "Close other eng-trainer tabs…" error is shown. With a **realistic released tab**, the upgrade is *not* blocked, because the released build closes its connection |
| 9 | Retry after closing the blocking connection | Succeeds; all records preserved. Retry *while still blocked*: see F4 |
| 10 | No unexpected startup writes | 0 writes on fresh start, after the upgrade, and on every reload. Opening with a URL hash writes only `settings.activePage`, the existing behaviour |

**Two consequences of the cross-version design:**
- **Old tab after the upgrade.** After the candidate upgrades, the still-open released tab's next save fails visibly ("Your latest changes are not saved") and writes nothing.
- **Old build reloaded.** Reloading the *released* build against database version 2 shows its storage-error screen ("The requested version (1) is less than the existing version (2)" in Chromium; a similar message in Firefox) and loses no data.

This is the documented "no downgrade" behaviour.

## 3. CSV/JSON parser findings

[parser-probes.mjs](eng-v2-02b-fable/parser-probes.mjs) imports the candidate's `format.ts` directly (Node 24 type stripping): **126/126 probes behaved as documented** ([results](eng-v2-02b-fable/results/parser-probes.json), [log](eng-v2-02b-fable/logs/parser-probes.log)).

**CSV, accepted:**
- UTF-8 BOM, CRLF/LF and lone CR;
- comma or semicolon delimiter, chosen from the header; a semicolon file may contain literal commas and vice versa;
- quoted delimiters, doubled quotes and multiline quoted fields (CRLF normalized to `\n`);
- quoted header names, and headers in any case, order or surrounding whitespace;
- empty and whitespace-only records, which are ignored;
- tabs inside fields;
- trimmed values;
- an empty `kind`, which means `word`;
- `example`, which becomes one example without a translation;
- HTML-like or formula-like text, kept literally;
- equal text with different meanings, which gets distinct IDs (`bank/банк`, `bank/берег`, `Bank!/банк`).

**CSV, rejected:**
- **Whole file:** missing `english`/`translation`; duplicate (case-insensitive), unsupported or empty headers; empty file, BOM-only file, header-only file; an unclosed quote; a quote inside an unquoted field; text after a closing quote.
- **Per record (blocking issues):** field-count mismatches; empty required values; an invalid `kind`; NUL/BEL control characters.
- **Strict RFC 4180:** whitespace before an opening quote or after a closing quote is also rejected. This is documented as malformed quoting.

**JSON:**

| Area | Behaviour |
|---|---|
| Envelope | Version must be the number `1` (a string `"1"` or `2` is rejected); `format` is checked; unknown fields in the envelope or collection reject the whole file, unknown entry fields produce a blocking issue |
| Required fields and defaults | Collection metadata, name and kind are required; topic, examples and description are optional and default to empty |
| Namespaces | Built-in IDs, other collections' IDs, upper-case UUIDs and trailing text are all rejected; duplicate IDs are rejected |
| Links | Rejected: links to a word, self-links, links from a phrase, links to built-in `phrase-001`, to another collection, dangling links and `null`. Accepted: a link declared before its phrase, several words linked to one phrase |

**Identity (RC1 rules):**
- IDs are `user:<uuid>` and `<collection>:entry:<uuid>`. They are never derived from text, and collisions with built-in IDs or other collections are impossible by construction.
- Nothing merges entries by normalized or punctuation-stripped text.
- Links are explicit, same-collection and word→phrase only. A linked word joins only its phrase's card, as in RC1.

**Limits and boundaries:**

| Limit | Accepted | Rejected |
|---|---|---|
| Entries | Exactly 1,000 (also with 500 extra empty lines) | 1,001 |
| File size | Exactly 2,097,152 bytes | 2,097,153 bytes |
| Field lengths | 300 / 2,000 / 100 / 4,000 / 100 / 1,000 | One character more |
| Examples | 5 | 6 |

- Lengths are measured after trimming. The byte limit counts UTF-8 bytes, so 1,048,577 Cyrillic characters are rejected.
- The UI checks `file.size` before reading, so it rejects an oversized file without processing it.
- **Pathological 2 MiB inputs** finish in at most about 320 ms in Node. These include all-comma records, one quoted field of escaped quotes, an odd number of quotes, ~2 MiB of newlines, about a million one-character records (stopped early at record 1,002) and a 2 MiB single field.
- About 1 million nested JSON brackets give "Invalid JSON" or "File must be an object" with no crash, in Node and both browsers.

The schema is **not** stricter than documented: every documented example and optional field is accepted. The minor rough edges are in section 13.

## 4. Import preview and duplicate handling

| # | Check | Result |
|---|---|---|
| 1 | CSV proposes a new collection | Yes; fresh random IDs on every parse; the name comes from the file name and can be edited |
| 2 | Invalid records found before persistence | Yes; listed as "Record N: …" in an `alert` region |
| 3 | Any invalid record blocks the import | Yes; Confirm stays disabled, and `acceptImport` refuses independently |
| 4 | Duplicate warnings visible | "2 entries have possible text duplicates…" plus a per-row "Possible duplicate" label. Duplicates are checked against built-in, other collections and the file itself, normalized by case and whitespace only |
| 5 | Acknowledgment enforced | Confirm stays disabled until checked; the service also refuses without it |
| 6 | Existing IDs identified | Yes: shown as "Existing ID" and counted as skipped |
| 7 | Identical native reimport keeps IDs | Yes |
| 8 | No duplicated records | Yes: "No changes needed" and **0 put/delete operations**; the database is unchanged |
| 9 | Changed content under an existing ID | Blocking "ID conflict…"; a file mixing identical, changed and new entries writes nothing |
| 10 | New IDs append | Positions continue (0–4), revision +1, `lastImport` updated, name and description kept even when the file differs |
| 11 | Confirmation saves the approved proposal | One read-write transaction: one `userCollections` put plus one put per entry; state stores untouched |
| 12 | Cancel writes nothing | 0 writes; the preview closes |

**Stale previews have two independent guards:**
1. **Same tab:** `acceptImport` compares the plan's collection record with the in-memory one. A concurrent double-confirm of one CSV plan creates exactly one collection (the second call gets "already being saved"; a later repeat gets "collection changed").
2. **Across tabs:** a condition read inside the write transaction compares the stored collection record with the record the preview saw. The no-op path uses the same check.

**A new word cannot link to an existing phrase that the file omits.** This is the documented contract; including the identical phrase in the file makes the link valid and it is skipped.

## 5. Transaction failure and concurrency

All faults were injected into **native** IndexedDB in the page ([browser-review.mjs](eng-v2-02b-fable/browser-review.mjs) `instrument()`).

| Case | Result in Chromium and Firefox |
|---|---|
| Import aborted after the collection put and 3 entry puts **succeeded** | Error shown; database unchanged; hero counts unchanged; preview kept |
| Import with a `QuotaExceededError` from an entry put | Same |
| Retry after removing the fault | Succeeds: one collection, 6 entries |
| Rename aborted after its put succeeded | Error shown; database and visible name unchanged; retry succeeds |
| Deletion aborted after the collection delete and 2 entry deletes **succeeded**, then a quota-like error | Database unchanged; collection still listed; retry succeeds |
| Reload after completed transactions | State matches the database |
| Unhandled rejections, page errors, console errors | **0** in all 30 scenario runs |

These are **injected** faults (a synchronous `QuotaExceededError` and `IDBTransaction.abort()` after request success). Real disk exhaustion was not exercised.

**Two tabs in one browser context, sharing the origin and database:**
- Tab B renames collection X; stale tab A then tries to rename X, remove X, append new entries to X, and no-op reimport X. **All four are refused** with "Saved data changed in another session", and the database still equals B's state.
- A *new-collection race*: both tabs preview the same native file, B confirms first, and A's confirmation is refused.
- After B removes X, A's stale no-op reimport is refused too.
- A keeps showing its old in-memory name until reload; live synchronization is out of scope.

**Ordering:**
- The service publishes to the store only after `storage.write` resolves, which includes `tx.done`. The catalog never changed after any failed write.
- Collection writes use their own transactions and a per-tab `writing` guard. They are not part of the progress save queue.

## 6. Collection deletion and restoration

| Step | Result (both engines) |
|---|---|
| Import X (6 entries, one explicit link, a duplicate `xenon`) and Y (CSV) | OK |
| Learn a phrase, hide a word, add a phrase and a word to Focus, save a collection-specific deck | Deck at "card 2 of 3" |
| Export X | `Xavier-set.json` |
| Remove → **Keep collection** | 0 writes; database identical |
| Remove → **Confirm** | X's collection and entries gone; Y intact; built-in unchanged; **progress, Focus, hidden, sessions and settings deep-equal** |
| Views and counts | Hero counts drop by exactly X's share (Focus 5→3, hidden 3→2, phrases 568→566, words 572→568); X is absent from Words, Phrases, Focus, the Flashcards filter options and decks. No ghost entries |
| Reload while removed | Same |
| Reimport the exported JSON | Same IDs; Focus and hidden counts restored to 5 and 3; phrase learned again, word hidden again; **collection deck restored to the same card and position** |
| Reset progress (Index) | Learning state cleared; **both collections and all 8 entries kept and visible** |

**Deck order while a collection is absent.** The collection-specific deck key, `collection:["<id>","all"]`, is never answered while its collection is absent, so it is restored exactly.

Shared decks (`all`, `topic:…`) are different. The existing `resolveSession` reconciliation drops absent IDs the next time the learner answers a card in that deck. In my run, X's 3 card IDs left the saved `all` order after one answer. After reimport those cards come back at the end of the shared deck. Learned state is unaffected. See **F1**.

**Orphaned hidden IDs.** With no built-in hidden items, removing a collection with hidden entries correctly shows "0 hidden" and lists nothing even with "Show hidden words". However, "Unhide all words/phrases" stays visible, and pressing it silently discards the retained hidden state of the removed collection: after reimport, that word is no longer hidden. See **F2**.

## 7. Catalog, search, Focus and flashcard integration

**Differential.** [integration/collections-review.test.ts](eng-v2-02b-fable/integration/collections-review.test.ts) ran in the disposable copy: 10/10 tests ([results](eng-v2-02b-fable/results/integration.json)). It loaded three collections through the real service and fake-indexeddb, with 1,208 entries in total:
- 1,000 entries reusing built-in text, built-in category names and upper-cased built-in phrases, with explicit links;
- 200 Ukrainian entries;
- 8 markup and edge-case entries.

| Check | Result |
|---|---|
| Built-in records | The first 566 phrases and 566 words are the **same objects** (`toBe`) as in the built-in catalog. Verbs, patterns, answers, drills, verb sets and block order are equal. `realMaterials` is unchanged (JSON snapshot) |
| Search | 9,844 queries plus upper-case variants across `searchPhrases`, `searchWords`, `searchVerbs` and `searchBlocks`: **78,752 comparisons, 0 mismatches**. Each combined result equals the built-in result followed by an independent raw-record oracle of user entries, in saved order. The oracle covers English, translation, examples, topic (or "My vocabulary") and collection name; queries include Ukrainian (ґ, ї, є, apostrophe), case and empty queries |
| Flashcards | Built-in cards identical. User cards: one per phrase plus one per unlinked word; linked words join only their own phrase's card; no card spans two collections; the six RC1 pairs remain separate single cards |
| Filters | They partition exactly: built-in = 566 + 566; each collection = its own entries |

**Browser results:**
- Imports appear in Words, Phrases, Flashcards and the hero counts **without reload**.
- After reload, the **first rendered app shell already includes the imported entries**. Collections load in `initState` before the content phase, and the hero counts at first paint were 567 phrases and 570 words.
- Collection + category + hidden + "show hidden" filters combine correctly.
- Ukrainian and case-insensitive search work, and the collection name is searchable.
- The existing `all` deck keeps its saved position (card 3), with imported cards appended at the end.
- The new "Built-in vocabulary" filter uses a new key, so it starts at card 1 (documented).
- Collection deck keys contain the collection ID, so a rename does not change them.

**Info.** Imported topics become categories, as documented. A topic equal to a built-in category name therefore joins that category's filter, its topic deck and the Index daily-item pool. No built-in record or block changes.

## 8. Export/import round trip

| Check | Result (both engines) |
|---|---|
| Format | `format: "eng-trainer-vocabulary"`, `version: 1`; keys exactly `format, version, collection, entries` |
| Identity and content | Collection ID, name and description preserved; all 6 entry IDs and values equal the source; the explicit link preserved; key order normalized |
| Deterministic | Two exports are byte-identical; `serialize → parse → serialize` is byte-identical (format probe) |
| Vocabulary only | No progress, revision, position, timestamps or `lastImport` in the export |
| Reimport into the same environment | "No changes needed. All 6 entries are already present."; 0 put/delete operations; database unchanged |
| Import into a fresh environment | Entry records identical; an export from there is **byte-identical** to the original |

## 9. Security and UI/accessibility

**Security** (both engines):

| Check | Result |
|---|---|
| Inert text | Script, image and SVG event-handler payloads were placed in collection name and description, English, translation, topic, examples and file name. They were shown in the preview, collection card, rename and removal prompts, Words list and card, Phrases, Flashcards (front and back), Focus and the filter `<option>`. **No execution** (`window.__xss` unset), no injected `img`, `svg[onload]` or `script` elements, text shown literally. The code has no `{@html}` or `innerHTML` |
| Object-property safety | `__proto__` in the envelope, collection, entry and example, plus `constructor` keys, are rejected as unsupported fields; `Object.prototype` is not polluted. Parsed values are rebuilt from allowed fields only |
| Malformed input | Invalid UTF-8 bytes and UTF-16 with BOM give "could not be read as UTF-8" (the decoder is fatal). Oversize files are rejected from `file.size`. Deep JSON, 2 MiB of quotes and 400k rows each get a clear message. No page errors |
| Export file names | Restricted to `[A-Za-z0-9_-]`, at most 80 characters, plus `.json`. Examples: `../../etc/passwd` → `-etc-passwd.json`; `CON` → `_CON.json` (Chromium) or `Untitled.json` (Firefox) after browser sanitizing. Cyrillic names lose their characters: see **F6** |
| No transmission | **0 HTTP requests** during import and export; all non-local requests were blocked and logged, and none occurred apart from the stubbed Google Fonts stylesheet. The parser and service have no `fetch` or `localStorage`; v2 made **0 localStorage calls** |

**UI and accessibility:**
- **Workflow:** the file → preview → acknowledge → confirm flow is clear. Issues and errors use `role="alert"`, results use `role="status"`, and the removal prompt explains the retention policy and recommends exporting first.
- **Labels:** the file input, collection name, duplicate checkbox, the scrollable `region` "Import entries" (keyboard-focusable), the Collection `<select>`, and every action button ("Rename/Export/Remove *name*") have accessible names.
- **Keyboard:** the full import works by keyboard alone (Tab, Space on the checkbox, Enter on Confirm). The disabled Confirm button is correctly skipped until acknowledged.
- **Focus:** when a file is chosen with the input focused, focus falls to `<body>` because the input is disabled while busy. This happens in Chromium for both preview and error, and in Firefox for the preview. Tab still continues from the input's position, to "Collection name". See **F3**.
- **Inline forms:** rename and removal confirmation are inline, not modal. Focus stays on the triggering button and the new controls follow it in tab order. Acceptable, but nothing announces them.
- **Export feedback:** export triggers a download but shows no status message (minor).
- **Layout:**
  - at 1440 and 1000 px the desktop navigation wraps onto two rows, nothing is clipped and Collections is reachable;
  - at 390×844 and 320×640: no horizontal document scroll; the bottom navigation has 8 buttons in 2 rows of 4, each at least 48 px high and inside the viewport;
  - every destination opens and every action is clickable;
  - with a 100-character collection name and a 300-character unbroken entry, the preview table scrolls inside its own region;
  - long names make the action buttons tall (cosmetic).
- **Footer clearance:** [mobile-bottom-probe.mjs](eng-v2-02b-fable/mobile-bottom-probe.mjs) shows the page end clears the fixed navigation in both engines (footer bottom 688 < navigation top 727 at 390 px). The released build left its footer 19 px under the one-row navigation, so this is an improvement.

## 10. Unit, build and native-browser results

Run in a disposable full copy with fresh `npm ci` (root and `v1`). The logs are in [logs/](eng-v2-02b-fable/logs/).

| Command | Result |
|---|---|
| `npm run check` | 0 errors, 0 warnings (219 files) |
| `npm test` | `node:test` **10/10**; Vitest **8 files, 182/182** |
| `npm run check:v1` | 0 errors, 0 warnings (189 files) |
| `npm run test:v1` | **68/68** (3 files) |
| `npm run build:site` | PASS, including the required `npm run build`, the v1 build, assembly and `check:site` (manifest, 11 pack hashes, identities, counts and links) |
| `npm run verify:content` | PASS: 1,538 records, exact content and order, 566 links, published content and v1 unchanged |
| `git -c core.whitespace=cr-at-eol diff --check` | Clean |
| `npm run build` in the developer workspace | PASS. Regenerated `public/data` is byte-identical to the copy's; `dist/` (git-ignored) was rebuilt |

**Review-specific runs:**

| Suite | Result |
|---|---|
| Parser probes | 126/126 |
| Integration spec | 10/10 |
| Native browser scenarios | **15 × 2 engines = 30/30 PASS**, with 0 page errors, 0 console errors and 0 blocked external requests ([Chromium](eng-v2-02b-fable/browser/browser-chromium.json), [Firefox](eng-v2-02b-fable/browser/browser-firefox.json)) |
| Mobile bottom probe | 16 measurements |

The browser tests used the assembled `site-dist` from the candidate and a local build of `020babf` for the released-tab scenarios, served from one origin so both share IndexedDB. Every scenario used a fresh, disposable context; the owner's profile and real vocabulary were never touched.

**Astra's tests.** These were reviewed, not reused:
- **`format.test.ts`** (35 cases) covers the main CSV/JSON paths, malformed input, limits just above the boundary, namespaces, inert text and the round trip.
- **`service.test.ts`** (18) covers atomic import and reload ordering, the no-op reimport, conflicts, duplicate acknowledgment, explicit links, rename/remove/reimport with progress, stale previews (same tab and in the transaction), the invalid-subset refusal, continue-without-saving, a blocked or failed upgrade, version 1 upgrade without writes, abort after success, quota, failed deletion and corrupt records.

These are good tests. The gaps I covered independently:
- exact-boundary acceptance (exactly 1,000 entries, exactly 2 MiB);
- a realistic released tab;
- two real browser contexts;
- deletion/restoration with collection-specific and shared decks;
- the built-in search differential.

Astra's [browser evidence](../evidence/eng-v2-02b/README.md) was not modified.

**v1:** no source changes; it loads only `/eng-trainer/v1/` assets and `v1/data/materials.json`, opens no IndexedDB, keeps its localStorage state, and leaves the populated v2 database untouched.

## 11. Performance observations

Single-machine, single-sample measurements on the production artifact over local HTTP. They are observations, not requirements.

| Measure | Chromium | Firefox |
|---|---|---|
| Choose file → preview with 1,000 rows rendered: 1.97 MB file (1,000 entries, ~1.9 KB each) | 765 ms | 528 ms |
| Same, for four 0.42 MB files with 1,000 entries each | 229–404 ms | 354–371 ms |
| Confirm → saved (1,000 entries, one transaction) | 426–506 ms | 523–565 ms |
| Long tasks during the five imports | 7 tasks, at most 220 ms | (API not available) |
| Words search per keystroke, 4,316 words (566 built-in + 3,750 user) | 6–19 ms | 13–25 ms |
| Open Flashcards with 5,566 cards | 354 ms | 371 ms |
| Switch Flashcards to one collection | 37 ms | 51 ms |
| Navigation → first app shell, empty vs **five 1,000-entry collections** | 87 vs 344 ms | 317 vs 390 ms |
| JS heap after GC (CDP): empty → after five imports → after reload | 5.5 → 20.0 → 14.2 MB | n/a |

The first shell after reload already showed "1816 phrases 4316 words", so all 5,000 entries loaded before the app rendered. No interface freeze was observed.

The ~200–220 ms long tasks come from parsing plus rendering a 1,000-row preview table, and from rebuilding the combined catalog. They are acceptable for an explicit import action.

## 12. Confirmed defects, prioritized

**Mandatory defects: none.**

Confirmed low-severity defects. None loses user vocabulary or corrupts the database; each can be fixed after integration.

| ID | Severity | Finding | Evidence | Suggested follow-up |
|---|---|---|---|---|
| F1 | Low (behaviour vs documentation) | "Saved deck order is retained" holds for collection-specific decks only. While a collection is absent, the next answer in a **shared** deck (`all`, `topic:…`) prunes that collection's card IDs from the saved order. In the run, 3 of X's IDs were removed after one answer. After reimport they return at the end of the shared deck, not at their previous positions | `delete-retains-progress-and-reimport-restores` → `sharedAllDeck` | Document it precisely ("collection decks restored; shared decks re-append restored cards"), or keep unknown `user:` IDs in place during reconciliation |
| F2 | Low (orphaned-progress affordance) | "Unhide all words/phrases" is shown when only orphaned hidden IDs of a removed collection remain, so the control has no visible effect. Pressing it **silently discards** the retained hidden state the removal policy promises to keep | `orphaned-progress-affordances-after-removal` | Base the condition on catalog-known IDs (as `AppShell.knownCount` already does) and unhide only known IDs |
| F3 | Low (accessibility) | Choosing a file disables the focused file input, so focus falls to `<body>` (Chromium: preview and error; Firefox: preview). Keyboard continuation still works, but screen-reader context is lost and the new preview or error is not focused | `ui-keyboard-and-responsive-layout` → `focusAfter*` | Keep the input enabled with `aria-busy`, or move focus to the "Review import" heading or the error |
| F4 | Low (UX) | Pressing Try again while the upgrade is *still* blocked leaves the app on "Loading training materials…" with no guidance. The second open request queues behind the first and receives no `blocked` event. It completes by itself once the other tab closes | `blocked-upgrade-…` → `retryWhileBlocked: "still loading"`, `afterHolderClosed: "recovered without another click"` | Show the close-tabs guidance while a previous blocked attempt is pending |
| F5 | Low (message wording) | Stale-write conflicts on rename and removal say "…Reload and review **the import** again. **Check available browser storage** and try again." The storage advice is misleading for a conflict, and retrying without reload always fails | `two-tabs-stale-writes-are-refused` → `outcomes` | Give conflicts their own message ("Changed in another tab — reload to continue") |
| F6 | Low (UX, Ukrainian audience) | Export file names keep only `[A-Za-z0-9_-]`. A Cyrillic collection name such as "Мої слова" exports as `-.json`, and "Слова 2026" as `-2026.json`; several Ukrainian-named collections get colliding names | `security-…` → `exportFileNames` | Allow Unicode letters and digits (`\p{L}\p{N}`), removing only reserved characters |

## 13. Non-blocking improvements (informational)

**CSV convenience** (all documented or harmless):
- `kind` is case-sensitive (`Phrase` is rejected);
- "Record N" counts non-empty records, so empty lines and multiline fields make it differ from spreadsheet row numbers;
- whitespace around quoted fields is rejected;
- the CSV collection name is cut at 100 UTF-16 units and can split an emoji;
- in native JSON, `null` for optional topic, examples or description is accepted as absent;
- the BOM counts toward the byte limit only when `parseImport` is called directly (the UI decoder strips it).

**Duplicate warnings** normalize case and whitespace only. Punctuation variants ("Consequently,") are not flagged, which matches the never-merge rule. Only the second occurrence within a file is flagged.

**Startup strictness.** A single invalid saved user record stops startup with the storage-error screen, as documented. "Continue without saving" then also disables progress, and there is no in-app repair. No path that writes such a record was found: the write-time and read-time validation are symmetric.

**Collection names** are not unique, so identical names appear twice in the filter and produce identical export names. Every action button repeats the full name, which makes buttons tall for long names; consider visually-hidden text.

**Topic and category merging.** User topics equal to built-in category names merge into those built-in categories, topic decks and the daily pool. Worth one sentence in the user docs.

**Other UI notes:**
- export shows no confirmation message;
- inline rename and removal panels are not announced and do not take focus.

**Test quality:**
- Astra's blocked-upgrade tests use a raw connection without a `versionchange` handler. Real released tabs close instead, so the blocked path is rare in practice. Both paths are now verified natively.
- Exact-boundary acceptance tests could be added to `format.test.ts`.

**02A follow-ups.** The deferred ENG-V2-02A findings N1–N7 are unchanged and remain separate.

## 14. Verification limitations and evidence paths

**Not verified:**
- Safari/WebKit, real mobile devices or touch, and assistive technology (only DOM, keyboard and focus checks);
- real disk-quota exhaustion and process termination during a transaction (faults were injected);
- more than two tabs, and bfcache;
- Firefox long tasks and heap (no API);
- GitHub Actions and production deployment (not required for this local review).

The released baseline was a local build of `020babf`, not the deployed site. Performance numbers are single samples on one machine.

**Harness corrections** made while building the review suite. These were all bugs in my own scripts, not candidate defects:
- my XSS payload exceeded the 100-character name/topic limits, so the file was correctly rejected;
- opening with a hash legitimately writes `activePage`, so I compare against a post-startup snapshot;
- the duplicate acknowledgment was missing in one test;
- my "heavy" performance fixture exceeded 2 MiB;
- my seed placed phrase IDs in word lists, and the candidate correctly counts only catalog-known IDs;
- answers save only after the card's exit animation, so the suite now runs with reduced motion and waits for the write;
- smooth scrolling, and Firefox settling layout after a viewport change, affected one measurement, which now scrolls twice;
- three search assertions collided with legitimate built-in matches ("review csv", "берег" inside "зберегти");
- parser probe expectations for three pathological inputs, and an all-digit UUID in the upper-case probe, were wrong.

All final runs are clean.

**Reproduction:**
1. Copy the non-ignored working tree to a disposable folder outside the repository and outside `%TEMP%`.
2. Run `npm ci` in the root and in `v1/`, then run the commands in section 10.
3. Build `020babf` with `git archive` → `npm ci` → `npm run build`.
4. Run:
   - `node parser-probes.mjs <copy> <out.json>`;
   - the integration spec from `<copy>/src/review-fable/`;
   - `node browser-review.mjs <copy>/site-dist <baseline>/dist <playwright-tools> <out-dir>`;
   - `node mobile-bottom-probe.mjs` (same arguments).

**Evidence**, all under [eng-v2-02b-fable/](eng-v2-02b-fable/). Absolute local paths are replaced as in [SANITIZATION.md](SANITIZATION.md), and ANSI colour codes are stripped:

| Path | Content |
|---|---|
| `candidate.sha256`, `candidate-status.txt` | Pre-review fingerprint (356 files) and status (60 entries) |
| `parser-probes.mjs`, `results/parser-probes.json` | Independent parser probes |
| `integration/collections-review.test.ts`, `results/integration.json` | Catalog differential and service probes |
| `browser-review.mjs`, `browser/browser-*.json`, `browser/*-collections-390.png` | Native scenarios, results and screenshots |
| `mobile-bottom-probe.mjs`, `browser/mobile-bottom/` | Footer and navigation clearance, released vs candidate |
| `collect-evidence.mjs` | Log collection and sanitizing |
| `logs/` | Command logs (`check`, `test`, `check-v1`, `test-v1`, `build-site`, `verify-content`, `diff-check`, `command-summary.txt`), installs, baseline build, integration, parser, browser, mobile probe, workspace build |

**Workspace effects:**
- The only additions to the repository are this report and the `docs/reviews/eng-v2-02b-fable/` directory.
- `npm run build` regenerated the git-ignored `public/data` (byte-identical) and `dist/`.
- The candidate, Astra's handoff and evidence, and the 12 `docs/releases/` files are unchanged.
- Nothing was staged, committed, pushed, merged or deployed.

---

**Verdict: READY_FOR_PR.** No mandatory defects remain. F1–F6 are low-severity follow-ups that can be scheduled after integration.
