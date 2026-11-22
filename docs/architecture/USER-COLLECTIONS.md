# User vocabulary collections (ENG-V2-02B)

V2 combines the eagerly loaded built-in catalog with local user vocabulary. Importing does not alter `content/`, fetch a separate search index, or send a file to a server. The Collections page parses files in the browser, previews the proposal, and saves only after confirmation. V1 remains independent.

## Storage and migration

Database `eng-trainer-v2` advances from version 1 to **version 2**. The upgrade adds two stores with explicit string keys:

| Store | Key and value |
|---|---|
| `userCollections` | Collection ID → `{ id, name, description, version: 1, createdAt, updatedAt, revision, lastImport }` |
| `userEntries` | Entry ID → native entry fields plus `{ collectionId, position }` |

`lastImport` contains `{ fileName, format, importedAt, added, skipped }`; it retains only the latest successful addition. Dates are ISO strings. `position` preserves import order. Collections sort by creation date and ID, entries by collection and position, including after reload.

The existing `progress`, `settings`, `learnPasses`, and `flashcardSessions` stores and their records are untouched by migration. No v1 data or localStorage is read. Opening and reading storage does not write defaults. Invalid saved user records stop startup with the existing storage error screen; they are not silently discarded.

The browser upgrades the schema transactionally. An aborted upgrade preserves version 1 and its records. A blocked upgrade explains how to close the other tabs and keeps waiting. The app opens by itself once they are closed.

Since ENG-V2-UX-01B, `openStorage()` keeps at most one open request in flight:
- **Check again** joins that request instead of starting a competing one, and the latest caller receives the connection.
- **Continue without saving** abandons the request. If it completes later, the connection is closed, so a late result cannot switch saving back on.

Older application builds that request database version 1 cannot open version 2; no downgrade is implemented.

## CSV

Save as **CSV UTF-8** with a header row:

```csv
english,translation,topic,example,kind
bank,банк,Money,I visited the bank.,word
bank,берег,Nature,We walked along the river bank.,word
Let me explain,Дозвольте пояснити,Speaking,Let me explain my decision.,phrase
```

`english` and `translation` are required. `topic`, `example`, and `kind` are optional; the default kind is `word`. Headers ignore case and surrounding whitespace. Comma and semicolon separators, UTF-8 BOM, CRLF/LF, quoted delimiters, doubled quotes, and multiline quoted fields are supported. Empty records are ignored. A field-count mismatch or malformed quoting is an error. Unsupported/duplicate headers are rejected. Other encodings, delimiter conventions, Excel `.xlsx`, and arbitrary column mapping are unsupported.

The Collections page shows the same rules in a short guide next to the file picker. `src/collections/importGuide.ts` is its only source.
- The short example is `english,translation` / `reliable,надійний` / `improve,покращувати`.
- **Download CSV template** saves exactly that text, with a UTF-8 byte-order mark, as `eng-trainer-vocabulary-template.csv`.
- **Copy example** copies the same text.
- The limits shown come from the parser's constants.
- The JSON reference in the details is produced by the real exporter, with identities created when the page opens. There is deliberately no reusable JSON template with shared identities.
- Viewing, copying or downloading help never reads or writes saved data.

Every CSV selection proposes a new collection and fresh IDs. Equal English text remains separate, including distinct meanings. Possible duplicates against current words/phrases and within the file are flagged; confirmation requires an explicit acknowledgment. CSV is not a stable-ID exchange format: use native JSON for repeat imports and backups.

## Native JSON version 1

```json
{
  "format": "eng-trainer-vocabulary",
  "version": 1,
  "collection": {
    "id": "user:00000000-0000-4000-8000-000000000001",
    "name": "My vocabulary",
    "description": "A local collection"
  },
  "entries": [
    {
      "id": "user:00000000-0000-4000-8000-000000000001:entry:00000000-0000-4000-8000-000000000002",
      "kind": "phrase",
      "english": "Let me explain",
      "translation": "Дозвольте пояснити",
      "topic": "Speaking",
      "examples": [{ "en": "Let me explain my decision.", "translation": "Дозвольте пояснити моє рішення." }]
    }
  ]
}
```

Collection IDs use `user:<lowercase UUID>`; entry IDs use `<collection-id>:entry:<lowercase UUID>`. New IDs use `crypto.randomUUID()`. Built-in IDs are never reused. `kind` is `word` or `phrase`. Topic and examples may be omitted (defaults: empty string/array); description may be omitted (empty string). A word may optionally specify `sourcePhraseId` pointing to a phrase **in the same collection and included in the JSON**. No links are inferred from text. Duplicate IDs, foreign IDs, missing link targets, wrong types, unsupported fields/versions, and invalid envelopes are rejected.

The export is exactly this importable format. It excludes internal revision/order/import bookkeeping and learning progress. A repeated native import skips identical existing IDs without writing any collection or entry records. Existing collection metadata is retained. Additional IDs append to the collection. An existing ID with different fields blocks the entire proposal; import never overwrites an existing learning item. Rename uses the dedicated UI. Give a different learning item a new ID.

## Limits and transactions

Files and each resulting native export are limited to **2 MiB UTF-8**; each collection is limited to **1,000 entries**. Name: 100 characters; description: 1,000; English: 300; translation: 2,000; topic: 100; up to five examples, each with at most 4,000 characters per English/translation field. Empty required text and unsupported control characters are rejected. Text is trimmed. **Any error blocks confirmation**; there is no implicit valid-subset import.

Problems are listed with the field, using the parser's own numbering:
- CSV: "Record 3, column “translation”: …". The header row is record 1, blank lines are skipped, and a quoted value may span several lines. These are records, not line numbers.
- Native JSON: "Entry 2, field “translation”: …", counting the position in `entries`.

File-level failures throw `ImportError` with a code, and the page gives each its own message:
- unsupported file type
- file too large
- not UTF-8
- damaged JSON (a syntax error)
- JSON that is not an eng-trainer export
- an invalid export
- an empty CSV
- missing columns (each column is named, and the template is offered)
- unsupported columns
- a quoting problem near a record
- no entries
- too many entries

Focus moves to the error summary of a rejected file. For a file that was read, it moves once the final plan has rendered:
- if records block the import (for example a missing translation, an invalid kind or a changed entry under an existing identity), to the named summary of those problems;
- otherwise, possibly with duplicate warnings to acknowledge, to the review heading.

File selection is guarded by a selection number:
- Only the latest selection may update the preview, the messages or the focus.
- **Cancel** invalidates a file that is still being read.
- The input is cleared after each selection, so the same corrected file can be chosen again.

Collection metadata and every new entry are written in one IndexedDB transaction. A condition read in that same transaction compares the previously viewed collection record with the saved one, preventing stale previews from overwriting another session. Native no-op imports also verify this condition. In-memory collections and the shared catalog update only after `tx.done`. Abort/quota/write failures retain the preview, report that nothing was saved, and allow an explicit retry; collection writes are not added to the optimistic progress-save queue.

Rename and deletion are also atomic and guarded against stale metadata. Different tabs do not automatically refresh each other's catalogs; reload to see external changes. Existing progress concurrency behavior is unchanged.

The service throws `CollectionError`, whose `kind` the page turns into a message shown next to the action that failed:
- `conflict`: the collection changed in another tab or window. The message offers **Reload page**.
- `unavailable`: saving is off in this session.
- `quota`: the only kind that gives storage-space advice.
- `storage`: any other write failure.
- `stale`, `busy` and `validation`.

The storage adapter reports the underlying condition as `StorageConflictError` or as `StorageError` with `kind` set to `quota` or `failure`. The message is shown only after the transaction has completed or failed.

An export is named after the collection, then the local date, then `.json`:
- The name is NFC-normalised and keeps letters and combining marks of every script (Cyrillic included), digits, apostrophes, `_` and `-`.
- Any other run of characters becomes a single `-`.
- The name is capped at 80 code points, so no character is split.
- Windows device names are prefixed with `_`. An empty result falls back to `vocabulary`.
- Example: `Мої слова` exports as `Мої-слова-2026-11-22.json`. See `src/collections/fileName.ts`.

Imported strings use ordinary escaped Svelte text nodes, never HTML rendering. Export downloads a local JSON Blob. The parser and collection service have no network or localStorage access.

## Catalog, filters and learning identity

`combineCatalog()` adapts entries into the existing phrase/word contracts and calls the existing `createCatalog()`. Built-in records and their order remain unchanged. Imported topics become categories; the collection name is the section, so shared search also finds it. Phrases appear in Phrases, words in Words; both participate in flashcards, and explicit links share the phrase's identity under the existing rules. Reverse practice and Focus receive the same combined catalog where they already support those entry types.

The shared Collection filter offers all content, built-in content, or one collection in Phrases, Words and Flashcards. Existing category/topic controls continue to work. `settings.collectionFilter` persists the choice. A removed collection resolves to all content until it is restored or another choice is made. Collection-specific flashcard sessions use `collection:<JSON([collectionId, existingDeckKey])>`; the old `all` and `topic:…` keys remain unchanged when no collection filter is active. A rename does not change these identities.

## Deletion policy

Confirmed removal deletes only the collection and its entries. **All learning progress is deliberately retained**, including its learned/hidden/Focus IDs and deck orders. Missing IDs are absent from catalog-backed views and counts. Reimporting the same native JSON restores the same IDs, so prior progress becomes visible again. This also avoids overwriting unrelated progress or racing its save queue. **Reset learning progress** (More → Settings since ENG-V2-UX-01B) still clears managed learning state; it does not delete vocabulary collections. Native exports are content backups, not progress backups.

Shared flashcard sessions keep absent `user:` IDs in their saved order while presenting only currently available, unhidden, unlearned cards. Answers remove known cards as usual, retain absent slots, and save the cursor on the next visible card (wrapping normally). Reimport restores those slots without jumping away from that current card. When a collection is removed and later restored without intervening card answers or other session writes, the saved cursor may return to a restored card. Shuffle and a single-deck reset reorder available slots while retaining absent ones; genuinely new IDs append under the existing reconciliation rules. An empty visible deck may therefore retain a saved order containing absent IDs, ready for a later reimport. The stored `{ order, index }` format is unchanged. This cannot reconstruct slots already discarded by an older build.

“Unhide all” retains its global scope for the entry type, independent of collection, category and search filters, but removes only IDs currently known to the catalog. The action is offered only when at least one such hidden entry exists. Hidden flags for absent collections remain stored and return on native reimport. The same scoped state operation is used by the verbs view; vocabulary import still supports only words and phrases.

There is no entry editor, automatic conflict resolution, CSV export, cloud synchronization, user account, new pronunciation model, or new search infrastructure in this milestone.

## Deferred non-blocking follow-ups

Fable's [independent review](../reviews/ENG-V2-02B-FABLE.md) findings F3–F6 were accepted as non-blocking follow-ups and were not part of the F1/F2 corrective iteration. [ENG-V2-UX-01B](../handoffs/ENG-V2-UX-01B.md) resolves them, as described above:
- F3: keyboard focus and races after file selection.
- F4: guidance and recovery while an upgrade is still blocked.
- F5: conflict-specific wording for stale writes.
- F6: useful Cyrillic export file names.

The review itself is unchanged.

The [ENG-V2-02A review](../reviews/ENG-V2-02A-FABLE.md#12-confirmed-defects-and-findings-by-severity) findings remain separate and unimplemented:

| ID | Deferred finding |
|---|---|
| N1 | Include the file or URL in parse, schema and network errors. |
| N2 | Eager manifest-to-pack loading adds a startup round trip. |
| N3 | Direct Vite commands can serve stale generated content; `check:site` checks consistency, not source freshness. Use the npm scripts. |
| N4 | Cleanup removes only hash-named packs; source discovery is case-sensitive; duplicate JSON keys use the last value. |
| N5 | Built-in loader failure tests should assert the expected error, not just any exception. |
| N6 | Immutable pack URLs still use `cache: 'no-store'`. |
| N7 | A future content-changing milestone must deliberately update or retire the frozen migration fingerprints. |

The [RC1 re-review](../reviews/ENG-V2-02B-RC1-FABLE.md#4-regression-test-quality-assessment) also records non-blocking test weaknesses: tautological assertions, an ambiguous same-text cursor assertion, missing checks for other hidden lists and the Verbs view, no mounted shuffle-cursor assertion, and fixed rather than randomized histories. Independent review checks cover these gaps; the application tests are preserved as reviewed.

Retained unavailable IDs can accumulate in shared deck orders, as learned, hidden and Focus IDs already do. There is no per-collection progress purge; native reimport restores availability and global Reset progress clears managed state. Stale unavailable verb IDs likewise remain hidden and uncounted. These [RC1 observations](../reviews/ENG-V2-02B-RC1-FABLE.md#8-remaining-non-blocking-findings) remain deferred; only the cursor clarification above is added for integration.
