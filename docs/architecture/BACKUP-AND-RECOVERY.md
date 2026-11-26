# Backup and recovery (ENG-V3-R1A)

The three versions of the trainer keep their learning data in the browser, on one origin. A browser can remove that data. A backup file is the only copy outside the browser.

This document describes what ENG-V3-R1A implemented in the experimental product: a full backup of all three products in one file, and the recovery of each product from such a file. It is the first half of the Data Safety Gate (R1). The second half, R1-B, covers storage capacity, the model cache and persistence, and is not started. The gate stays open until both have passed.

## What exists, and what does not

| | State |
|---|---|
| Backup of `experimental-v3`, `stable-v2` and `legacy-v1` into one file | Implemented |
| Strict validation of a backup file | Implemented |
| Recovery of the `experimental-v3` section into the experimental product's own, empty database | Implemented |
| Recovery of the `stable-v2` section into the stable database, where it exists and holds no learning data | Implemented |
| Recovery of the `legacy-v1` section into the first version's two records, where they hold no learning data | Implemented |
| Creating the stable database from here | Not implemented, on purpose. Only the stable product creates it, see [The stable product](#the-stable-product) |
| Recovery into a profile that holds learning data, and merging | Not implemented. Planned for the promotion milestone |
| Copying the stable section into the experimental product | Not implemented. That is a migration, not a recovery |
| Pronunciation records in a backup | Not implemented. No database schema has them yet, see [Pronunciation records](#pronunciation-records) |

The feature exists in the experimental product only. That product is not published.

## Where the code is

Everything is in `src/features/backup/`. The folder is experimental-only, like `src/features/pronunciation/`: shared code reaches it through one guarded dynamic import in `App.svelte`, and a stable build reads none of its files ([Products and routes](PRODUCTS-AND-ROUTES.md#experimental-only-sources)).

| File | What it does |
|---|---|
| `format.ts` | The format: names, storage identities, types, the canonical JSON text, the digest, and the guard's record |
| `validate.ts` | Reads a file: size, UTF-8, JSON, structure, digests, records |
| `records.ts` | Strict checks of the records, with the application's own readers as the reference |
| `snapshot.ts` | The read-only reader of an IndexedDB database |
| `legacyStorage.ts` | The read-only reader of the first version's two records |
| `exportBackup.ts` | Collects the sections and composes the file |
| `summary.ts` | Counts for the screen; the rules for "holds no learning data" |
| `destinations.ts` | What the storage of the other two products holds now, for the preview. It only reads |
| `restore.ts` | Judges this product's database and writes the experimental section in one transaction |
| `recoveryWriter.ts` | **The recovery writer.** Writes the stable section and the first version's section. The only module that writes another product's storage |
| `BackupPage.svelte` | The screen, at `#backup` under **More** |

The build makes two lazily loaded files of the folder. One holds the Backup screen and everything it needs to make, read and show a backup and to recover this product. The other is the recovery writer. The Backup screen's file loads it after the learner confirmed a recovery of another product, and nothing else loads it.

The constant `__ENG_BACKUP__` switches the screen on. It is `true` for `experimental-v3` and `false` for `stable-v2`. It follows from the product in `scripts/site-config.mjs` and cannot be set in `site.config.json`.

One part of the feature is outside the folder, in shared code and behind the same constant: the hold on changes that a recovery of this product takes ([The handover](#the-handover)).

| Shared file | What it holds |
|---|---|
| `src/state/persistence.ts` | `holdChanges`, `releaseChanges`, `changesHeld`: the hold itself. The write queue writes nothing while it lasts |
| `src/collections/service.ts` | `holdCollections`: the collections' part. No change of a collection is started while it is set |
| `src/state/index.ts` | `holdState`, `releaseState`, `stateHeld`: both parts together. This is what the recovery and the shell use |
| `src/state/progress.ts`, `src/state/settings.ts` | `update` asks before it changes the state |
| `src/app/App.svelte` | The two functions that change the screen ask first |

## The file

One JSON file, UTF-8, named like `eng-trainer-backup-20261125-140322.json` (the time is UTC).

```json
{
  "format": "eng-trainer-backup",
  "version": 1,
  "exportedAt": "2026-11-25T14:03:22.123Z",
  "exportedBy": { "product": "experimental-v3" },
  "sections": {
    "experimental-v3": {
      "database": "eng-trainer-v3",
      "schemaVersion": 1,
      "stores": { "progress": [], "learnPasses": [], "flashcardSessions": [], "settings": [], "userCollections": [], "userEntries": [], "meta": [] }
    },
    "stable-v2": {
      "database": "eng-trainer-v2",
      "schemaVersion": 2,
      "stores": { "progress": [], "learnPasses": [], "flashcardSessions": [], "settings": [], "userCollections": [], "userEntries": [] }
    },
    "legacy-v1": {
      "storage": "localStorage",
      "records": { "englishAssessmentTrainer.svelteState.v1": "…", "englishAssessmentTrainer.theme.v1": "dark" }
    }
  },
  "integrity": {
    "algorithm": "SHA-256",
    "sections": { "experimental-v3": "…", "stable-v2": "…", "legacy-v1": "…" }
  }
}
```

- **A section per product.** A product that has saved nothing in the browser has no section. A file has at least one.
- **A store is a list of `[key, value]` pairs**, in ascending key order, exactly as the database holds them. Nothing is derived, renamed or renumbered. Every identity in the file is the original one: entries, collections, Learn passes, deck keys and positions.
- **The first version's records are raw text.** That application keeps members of its state that it does not know, so the text is not interpreted.
- **A section names its storage and schema.** A file can be judged without the application that wrote it.
- **A digest per section.** It is the SHA-256, in lower-case hexadecimal, of the section's canonical JSON text: object members in ascending order of their names, list items in their order, no white space. The digest shows damage and later changes. It is not a signature: whoever can edit the file can compute a new one.
- **What a file never holds:** a speech model, a cache entry, a recording, or data of anything else on the origin. The readers take the two named databases and the two named records, and nothing else.

Format version 1 holds no record of the content catalog or of the build that wrote the file. A later format version adds them when something needs them.

## Validation

A file is accepted as a whole or refused as a whole, with the reason. The checks use nothing but the file. No record of an earlier export, no key and no setting has to survive in the browser.

Order of the checks:

1. Size (at most 32 MiB), UTF-8, JSON.
2. Format name and version. Another version is refused, with a note when the file comes from a newer application.
3. Structure. Every member at every level must be a documented one, and none may be missing. A section must name exactly the database, schema version and stores of its product. Keys of a store must be text, in ascending order, without repetition.
4. Digest of every section.
5. Every record, see below.

One part that fails refuses the whole file, also its good parts.

### Records

The application reads four of its six stores leniently: a record it does not understand is repaired in memory or skipped. A backup must not depend on that. A file could then look complete and restore less than it shows.

So the reference for a record is the application's own reader. A record is accepted only when that reader returns it unchanged:

| Store | Rule |
|---|---|
| `progress` | A known key. A list is a list of distinct, non-empty identities. |
| `learnPasses` | The key is the pass's `id`. Exactly the six members, the name as the application stores it. |
| `flashcardSessions` | A sequence of distinct identities and a position inside it. |
| `settings` | A known preference with a value that the application accepts. |
| `userCollections`, `userEntries` | The application's strict reader accepts them all together: identities, positions, links, sizes. In addition, no unknown member, and no text that reading would trim. |
| `meta` (experimental) | Exactly `schema`, equal to the section's schema version, and `createdAt`, a time. |
| first version | The state is the text of a JSON object. The theme is one of the three values that version writes. |

One value is accepted on purpose although the reader would replace it: a selected Learn pass that no longer exists. The application can store that, when the pass is deleted in another tab. It then shows the default pass. The backup keeps the text as it is, and the recovered profile behaves like the original.

The same checks run when a backup is made. A file that this version writes is therefore one that this version accepts. The composed text is also read back once, by the reader that a recovery uses, before the learner gets it.

## Making a backup

The learner chooses **Make a backup file** on the Backup screen. Start-up and learning never read the other two products.

- **This product's database** is read after the changes that are on their way to it have been saved. If a change could not be saved, no file is made, and the learner is told to retry saving first.
- **The stable database** is read by the reader in `snapshot.ts`:
  - It opens the database without a version. An existing database opens at its version and is never upgraded.
  - It does not create a database. Where the browser lists its databases, an absent one is not opened. Elsewhere the open request starts to create it, and the reader cancels that creation.
  - It reads only version 2 with exactly the six stores. An older or newer database is reported and not read.
  - It reads all stores in one read-only transaction. It never starts a read-write transaction.
  - It closes its connection when the read has finished, and at once when the stable product wants to upgrade its database.
- **The first version's records** are read by name, through an object that has `getItem` and nothing else.

Making a backup writes nothing: no database, no record, and no note that a backup was made. The application cannot know whether the learner kept the file, and the screen says so.

**When a product cannot be read.** Its data may be of another schema, damaged, or refused by the browser. Then no file is made at first. The screen names the product and the reason. The learner can then ask for the file without that product. The screen, and the file's list of sections, show that the backup is incomplete. A product is never left out silently.

The file reaches the learner through the existing download helper (`src/shared/download.ts`). Making a backup sends no request.

## Recovery

The learner chooses a file. It is validated and shown: when it was made, and what each part holds. Under each part the screen says where it would go and whether that is possible now. For that, the destination of each part that the file holds is read, and only read.

Each part is recovered on its own, into the product it belongs to, after a confirmation that names that product. The file stays open, so the parts can be recovered one after the other. A recovered part says so and is not offered again.

### The contract

It holds for all three products.

1. **Explicit.** One part at a time, after validation, a preview and a confirmation. Never at start-up, never without a file, never while a backup is made.
2. **Only into a destination without learning data**, judged by value at the moment of writing. Nothing is overwritten and nothing is merged. Preferences are replaced by those of the backup, and the confirmation says so.
3. **Fixed destinations.** Each writer names its storage in its own code. No argument, file content or address can name another database or another record. A part is judged by the storage identity it states: the stable section under the experimental name is refused, and so is the reverse.
4. **The released schema, and nothing else.** No database is created, upgraded or deleted. A database of another version, or with other stores, is never written.
5. **Read back.** After the write the storage is read again and compared with the backup. Only then is a part called recovered.
6. **Three results, not two.** A write that failed was rolled back, and nothing was changed. A write that completed and was checked is a recovery. A write that completed and could not be checked is neither: it is reported as written but not checked, see [After the transaction has completed](#after-the-transaction-has-completed).

"No learning data" means: every progress list is empty, the selected Learn pass is the default one, and there is no Learn pass, no saved place in a flashcard deck, no collection and no entry. After **Reset learning progress** the lists still exist, and they are empty, so such a profile is eligible again. Anything unexpected counts as data.

A refused part shows why, and what the learner can do. **Check again** looks at its destination once more, for example after the learner made room in another tab. It only reads.

A database is compared with the digest of its part of the file. A destination that holds exactly that data is shown as "nothing to recover", never as data to be reset. So a file that is chosen again after a recovery says that the recovery is in place.

### This product

`restore.ts` writes the database that this build was made for. It takes no database name.

1. The file's section is validated again, and its digest is compared again.
2. The database is opened. Until the next step the tab works as always: a change is accepted and saved.
3. **The handover.** The recovery waits until everything that this tab has accepted is in the database, and then takes the hold on changes, see [The handover](#the-handover). If a change could not be saved, or the Backup screen was closed in the meantime, the recovery stops here, and nothing was touched.
4. One read-write transaction is opened over the seven stores, in the same step as the hold.
5. Inside it the six learning stores are read and judged. If learning data is there, from this tab a moment ago or from another tab, the recovery stops.
6. Every store is cleared and written, behind the guard described below. All requests are issued together.
7. When the transaction has completed, the tab is detached from its storage: the state that it holds is now the state from before the recovery.
8. The database is read again. Its digest must be the digest in the file.
9. The running application loads the recovered state from the database. That is what attaches it to its storage again. The hold ends, and no reload is needed.

A refusal or a failed write changes nothing, in the database or in the tab. The hold ends, and the application goes on with the state and the storage it had. Nothing is loaded again, so nothing that the tab held is replaced.

After the transaction has completed, saving comes back in one way only: the state is loaded from the database. There is no path on which the tab keeps its old state and saves it over recovered data.

### The handover

The running application holds state in memory, and two parts of it write the database: the queue of the state services (`src/state/persistence.ts`), and the collections (`src/collections/service.ts`). A recovery replaces the saved state under them. Two things must not happen then: a change that the tab accepted is lost, or state from before the recovery is written after it.

**Until the hold, nothing is different.** While the recovery validates the file and opens its database, a change is accepted and saved as always. The recovery waits for all of it, in a loop:

1. It waits for the write that is running, and for what is queued behind it.
2. Then, with nothing awaited in between, it asks its questions and takes the hold:
   - Was the Backup screen closed? Then the recovery does not start.
   - Could a change not be saved? Then the recovery is refused. The change stays on screen and in the queue, the application's notice "Your latest changes are not saved" stays, and **Try saving again** saves it. The recovery never tries that itself, and never asks for a reload here: a reload would lose the change.
   - `holdState()` answers `held` only when nothing is queued, scheduled or being written. If something still waits that nothing is writing, it is started, and the loop begins again.

Waiting for "the running write" is not enough on its own, and the loop does not rely on it: the hold itself looks at the queue.

**From the hold on, no change is accepted.** The state services ask before they touch their state (`update` in `progress.ts` and in `settings.ts`), and the collections ask before they start a change. A change is not queued for later, and not kept in memory: it does not happen, so there is nothing that could be lost. The write queue writes nothing while the hold lasts, whoever asks. A change of the collections that was already being saved has its transaction, which the browser runs before the recovery's own.

So for every change one of two things is true: it was accepted before the hold, and is in the database when the recovery judges the destination; or it was not accepted. Learning data that was accepted fills the destination, and the recovery refuses it, as it refuses any destination with learning data.

**The screen stays.** While changes are held, the application opens no other screen: the Back button, a typed address and a link all leave the Backup screen open, and the address is put back. The confirmation says that the tab accepts no changes until the recovery has finished.

**The hold ends** when the recovery has ended, in one place, by the call that took it:

| The transaction | The tab afterwards |
|---|---|
| was not started (refused) | as before: its state, its storage, its queue |
| was rolled back | as before |
| completed, and the data was checked and loaded | the recovered state, saving on |
| completed, and the check or the loading failed | detached: the old state on screen, saving off until a reload |

The hold is in shared code, which the stable product is built from too. Every question about it stands behind the constant `__ENG_BACKUP__`, so the stable build contains none of it: its files are the released ones, byte for byte, and the released-site lock checks that. Two rules keep it so, and a source test checks both. The question is a bare `if (__ENG_BACKUP__ && …)` of its own. And no module got a new import for it: an import between shared modules changes the order of the stable build even when nothing of it is used, so the collections keep their part of the hold themselves, and `holdState` in `src/state/index.ts` sets both parts together.

### The stable product

`recoveryWriter.ts` writes the database `eng-trainer-v2`, version 2, exactly six stores, in the same way: the section is validated again, one read-write transaction is opened over the six stores, the destination is judged inside it, every store is cleared and written behind the guard, and the database is read back and compared with the file. This tab holds none of the stable product's state, so nothing is detached and nothing is loaded afterwards. The writer opens the database through the reader's request, which names no version.

**It creates no database.** If the stable database does not exist, the part waits. The screen says that the stable version creates its storage when it is opened, gives a link to it, and asks the learner to open it once, change nothing there, come back and choose **Check again**.

The reason is the guard. A database is created by making its stores, and making a store is not a request, so no guard can stand in front of it. A script that stopped between two of those steps could leave a database of version 2 with stores missing, in a browser that commits when a script is cancelled. The stable product cannot open such a database, and nothing here may delete or upgrade it. So the only code that creates the stable database is the stable product's own.

### After the transaction has completed

When the writing transaction has completed, the data is in the database. Whatever fails after that is not "nothing was recovered". It is a third result, **written, but not checked**:

- the read-back is refused by the storage;
- the digest cannot be computed, or it is not the digest of the file;
- for this product, the application cannot load the recovered state.

**This product.** The tab was detached from its storage when the transaction completed, with the application's own switch for running without saving (`initStateWithoutStorage`), and it stays detached. It still shows the state from before the recovery, and nothing that the learner does in it is saved: marking a phrase, opening another screen, a reset, an import. The screen says that the data was written, why it could not be checked, and that the tab saves nothing until the page is reloaded, and it offers the reload. The application's notice "Saving is off" is shown on every screen. After the reload the application starts on what the database holds. The file, chosen again, then says whether that is exactly its data.

**The stable product.** This tab is not affected: it holds none of the stable product's state. The screen says that the data may already be written, links to the stable version, and looks at the destination again. If the stable database now reads as exactly the data of the file, the part says so. Otherwise it says "written, but not checked" and tells the learner not to reset anything because of it. **Check again** compares the storage with the file once more.

**The first version** has no transaction to complete. Its own third result is "not complete", described below.

### The first version

The first version keeps two records in the browser's key-value storage: its state, which holds the learning data and its preferences, and its theme. That storage has no transaction. Two records cannot be written in one step.

`recoveryWriter.ts` handles that as follows.

1. The two records are read, and a plan is made from them (`planLegacyRecovery` in `destinations.ts`). The reading, the plan and the writes are one run without a pause, so no other code of the page runs between them.
2. The state is written first and read back. Then the theme is written and read back. Then both are read once more.
3. If the state cannot be written, nothing was changed.
4. If the theme cannot be written after the state, the result is **not complete**. It is reported as that, never as a success.

The plan is what makes the rest safe, also after the page was closed between the two writes:

| The storage holds | Plan |
|---|---|
| no state, or a state without learning data | Write the state, then the theme |
| a state that is the text of the backup, character for character, and another theme | **Complete**: write the theme only. The equality proves that the state was not changed since it was recovered. It is not written again |
| both records of the backup | Nothing to write |
| a state with other learning data | Refuse. This includes a recovered state that the first version has changed since |
| a state that cannot be read | Refuse |

The completion needs nothing from the interrupted session. A new session finds it from the file alone. It goes through a confirmation of its own, which says that only the theme is written and carries the same warning about other tabs as the first one: for a new session it is the only confirmation there is.

The writer never removes a record. A theme in the browser stays as it is when the backup has none.

### The guard against half a recovery

A browser commits a transaction when its requests are done and no script adds more. It does not know that the script meant to add more. If the script stops between two writes, no `catch` block runs, and the writes issued so far are committed.

This happened in the acceptance test in Firefox. The tab was closed while the recovery issued its writes. Firefox cancelled the script and committed 10 of 22 records.

Both database writers therefore start their writes with a guard: a record is written, and then added again under the same key. The second request must fail. A failed request aborts its transaction, unless a handler stops that. The handler stops it only when every write was issued. The transaction can commit in one case only: the script reached the end of the list and was still there to say so.

The guard's record is an empty list of learned phrases. Both database products write that record themselves, it is no learning data, and a destination that passed the check has no learned phrase. That matters at one moment, the one between the guard's own two requests. If the script stops there, the first request is committed alone. In Firefox the acceptance test shows exactly that. What is committed is an empty list, and the profile is as valid and as empty as before.

The shared storage adapter writes several records in one transaction without such a guard, for example when a collection is imported. That code is part of the released stable product and is not changed here. It is a task of its own for a stable release.

### While a recovery runs

The confirmation is a modal dialog. It stays open, and ignores Cancel and Escape, until the data was written and checked. The rest of the page cannot be used in that time. This product does not rely on that: while it recovers its own database, changes are held ([The handover](#the-handover)), so a change that reaches the state services anyway, from a key, a timer or the Back button, is not accepted, and the Backup screen stays open.

A recovery of this product that is still being prepared, and has not taken the hold, does not keep the screen open: the learner can leave. The recovery then does not start, and what the learner does on the other screen is ordinary use.

Another tab is not covered. A tab of the product that is recovered still holds its old, empty state and can save it later, over the recovered data. The confirmation asks the learner to close such tabs first. A browser gives a page no way to see or close the tabs of another application.

## Product boundaries

| | Experimental product reads | Experimental product writes |
|---|---|---|
| Its own database | at start-up; for a backup; for a recovery | in ordinary use; in a recovery |
| The stable database | for a backup; for the preview of a recovery, when the selected file holds the stable section | in a confirmed recovery of that section, into an existing database without learning data. Never created, upgraded or deleted |
| The first version's two records | for a backup; for the preview of a recovery, when the selected file holds that section | in a confirmed recovery of that section, where they hold no learning data. Never removed |
| Anything else on the origin | never | never |

Start-up, learning and making a backup write nothing of another product. The stable product and the first version are unchanged. The published site is the 33 released files, byte for byte.

Three layers keep this true:

- **Source.** Tests of the sources (`scripts/product-gates.test.mjs`) check each module's part. Outside the recovery writer, one file requests a database, without a version, one file reaches the key-value storage and can only read it, and one file starts a read-write transaction and takes no database name. The writer requests no database itself, creates no store, holds one call that writes a key-value record, and writes its two records in a function without a pause. Only the Backup screen asks for the writer, in the handler of the button that confirms. For the hold: the application writes its database in two places, each state service changes its saved state in one function, and all of them ask for the hold first, behind the bare constant.
- **Build.** The gate `experimental-backup` in `scripts/product-gates.mjs` checks the built files. The Backup screen is one lazily loaded file, the writer is one more, and only the first names the second. Only those two name the stable database, the first version's records or the key-value storage. The screen's file holds no call that writes a key-value record, creates no store and opens a database without a version. The writer holds one such call and one read-write transaction, requests no database and creates no store. No file removes a key-value record or deletes a database, and neither file makes a request. `npm run check:negative` breaks copies of the build on purpose, in 32 ways for this gate, and each must fail.
- **Browser.** The acceptance test compares every database, every key-value record and the caches of the origin before and after each step, and records every database request, transaction, store creation and key-value call of the page.

A gate on built files cannot see which database a transaction belongs to, or under which key a record is written. The tests of the feature and the acceptance test show that.

## Pronunciation records

The experimental database has no store for pronunciation attempts or hints at schema version 1. Whether attempts are stored at all is an open decision.

The format reserves the member `pronunciation` of the experimental section for them. This version writes no such member. It refuses a database that has such stores and a file that has the member. It does not leave records out. The milestone that adds the stores changes the schema version, and must extend the backup in the same step: until then such a database cannot be backed up at all, and that is visible at once.

## Limits

- **Browsers.** Shown in Chromium and Firefox on a desktop. Safari and phones are not shown.
- **Other tabs.** See [While a recovery runs](#while-a-recovery-runs). Every confirmation of a recovery says so.
- **The notice of a detached tab is the application's general one.** Outside the Backup screen it reads "Saving is off. The browser storage could not be opened…", which names another cause. Its advice, to reload, is the right one. The text belongs to the shared shell, which the stable product uses too.
- **A change that is not accepted is not announced where it was made.** While a recovery of this product writes, the state services do nothing when they are asked for a change. The learner cannot ask: the confirmation covers the page, says so, and the screen stays. A timer or a late handler of another screen gets no error. The collections do report it, as a change that could not be started.
- **The recovery waits for a save that hangs.** It cannot know that a write will never finish. The confirmation then stays open with "Recovering…". A reload ends it, and nothing was recovered.
- **One more connection.** After a recovery of this product the application has loaded its state through a new connection to its database. The one from start-up stays open, unused, until the page is closed. It closes by itself when a newer version of the application asks to upgrade the database.
- **The stable product must have been opened once** in the browser before its part can be recovered.
- **The first version's two records are not one step.** A recovery can stop between them. That state is detected, reported and completed, as described above.
- **The key-value storage has no lock.** A tab of the first version that saves its state in the instant between the plan and the write is not seen. The read-back after each write, and the last one after both, catch a record that was changed by then.
- **Size.** A file larger than 32 MiB is refused, also when it is made: no file is handed out that could not be read back. Saved data of that size cannot be backed up by this version.
- **Not a signature.** The digests detect damage and careless edits, not a deliberate forgery.
- **A copy, not a merge.** A recovery into a profile with learning data is refused.
- **The catalog.** A backup does not record which content catalog its identities belong to. Identities that a later catalog no longer has stay in storage, unseen, as before.

## Tests

```text
npm run test:v3                                  the feature's tests run for the experimental product
npm run check:products                           the gates, after the builds
npm run check:negative                           the gates must fail on deliberate faults

npm run prototype:build                          all three products -> .site-test/
node scripts/acceptance/backup.mjs chromium      the browser acceptance test; also: firefox
```

The acceptance test needs an installed Playwright, named by `PROBE_PLAYWRIGHT`. It uses new browser profiles and made-up data only. It covers:

- a profile with data of all three products, each accepted by its own product;
- the backup: explicit, read-only, complete, with digests that the test computes again;
- the recovery of this product in a new profile, from the file alone, and deep equality of every store;
- files that are refused, and destinations that hold data or have another schema;
- the recovery of the stable product: its storage is not created from here, one read-write transaction, deep equality, and the released stable product starting on the result;
- the recovery of the first version: two records, a write that fails after the first, the completion, and the released first version starting on the result;
- writes that fail, and pages that are closed in the middle of the writes, for each product;
- a recovery that was written and whose check then failed, for both databases: the result is not "nothing was recovered", and the same tab, used without a reload, saves nothing over the recovered data;
- the handover: a save that is being written, a change queued behind it and a change that could not be saved, each made while a recovery is prepared, are all kept; a refused or rolled-back recovery loads nothing again; and while the recovery writes, the Back button, a typed address and Escape leave the Backup screen open;
- all three products from one file after a complete loss, with the whole origin deeply equal to the one that the backup was made from.
