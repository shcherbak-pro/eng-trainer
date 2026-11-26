# Changelog

## Unreleased — ENG-V3-R1A (2026-11-25)

Full backup and recovery in the experimental product: the first half of the Data Safety Gate. Nothing changes for users: the experimental product is not published, and the published site stays byte-identical to the ENG-V2-03 release.

- **Backup screen (experimental product only), at `#backup` under More.**
  - **Make a backup file** writes one JSON file with the saved data of all three versions: the experimental database, the stable database and the two records of v1. Progress, the Focus list, Learn passes, flashcard places, preferences and imported collections keep their original identities.
  - **Recover from a backup file** checks and shows a file and says where each part can go. Each part is recovered on its own, into the version it belongs to, after a confirmation that names that version, and only where that version holds no learning data. It never overwrites and never merges.
  - The stable version is recovered into its own database. That database is never created, upgraded or deleted from here: where it does not exist yet, the screen asks the learner to open the stable version once.
  - v1 is recovered into its two records. A browser cannot write two records in one step. A recovery that stops after the first is reported as not complete, never as a success, and can be completed later as long as the recovered data was not changed.
- **The file.** Format `eng-trainer-backup`, version 1. Each part names its product, storage and schema version and has a SHA-256 digest. It holds no speech model, cache entry or recording.
- **Validation is strict.** A file is accepted or refused as a whole, from the file alone. Unknown or missing members, another format or schema version, a part that does not match its digest, and any record that the application would repair or skip are refused, with the reason.
- **The other versions are reached on the Backup screen only.** They are read when the learner asks for a backup, and for the preview of a part that a selected file holds. They are written by one recovery writer, a file of its own that is loaded after the learner confirmed a recovery, and at no other time. The stable database is always opened without a version. No record of v1 is ever removed.
- **A recovery of a database is one transaction.** The destination is judged again inside it. After the write the database is read back and compared with the file's digest, and only then is the result reported.
  - A guard makes the transaction commit only when every write was issued. Without it, Firefox committed half a recovery when the tab was closed during the writes. The browser test found that, and now closes the page at four points of the write, for both databases.
  - The guard's record is an empty list of learned phrases, which both versions write themselves. A stop between the guard's own two requests therefore leaves nothing invalid.
- **A recovery has three results.** Rolled back: nothing was changed. Recovered: written, read back and equal to the file. Written, but not checked: the transaction completed, and the read-back or the comparison failed. The third is never reported as "nothing was recovered".
  - A destination that holds exactly the data of the file is shown as "nothing to recover", never as data to be reset.
- **The running application hands over to a recovery of its own database in one step.**
  - Until then a change is accepted and saved as always. The recovery waits for the save that is running and for what is queued behind it, and judges the destination with all of it in place. A change that could not be saved stops the recovery, and stays on screen with its way to try again.
  - Then changes are held: the state services and the collections accept none, nothing of the tab is written, and the Backup screen stays open, whatever the Back button or the address asks for. A change is either saved before the recovery or not accepted. None is accepted and then lost.
  - A refused or rolled-back recovery leaves the tab as it was: nothing is loaded again or switched off. Once the recovery is written, the tab is detached from its storage, and saving comes back only when the recovered state was loaded from the database. Otherwise the tab says that saving is off and asks for a reload.
  - The hold is in shared code, behind the compile-time constant of the Backup screen. The stable build contains none of it.
- A new gate keeps the reads of other versions in the Backup screen's file and the writes in the recovery writer, which only that file loads. It allows one call that writes a key-value record, in the writer, and no removal, database deletion, store creation or request. Thirty-two deliberate faults prove that it can fail.
- 304 new tests: 297 of the feature, 5 of the hold on changes and 2 of the shell under it. A browser acceptance test with 188 checks in Chromium and in Firefox.
- No dependency was added or changed.

## Unreleased — ENG-V3-02A-RC1 (2026-11-25)

Corrections from Astra's independent review of ENG-V3-02 stage A. Nothing changes for users: the experimental product is not published, and the published site stays byte-identical to the ENG-V2-03 release.

- **F1:** Cancel and a hidden page now release the microphone also while the recorder is still starting.
  - The recorder waits for the permission and then for the audio device. Either wait can stay pending. A microphone that the browser had already handed over stayed live until the audio device answered.
  - The session now ends a start that is in progress. The recorder stops an acquired microphone at once, and one that arrives later as it arrives.
- **F2:** Cancel and leaving the screen during the preparation now release what was prepared.
  - An audio context whose script was still loading was not closed when the screen was left, and stayed open afterwards.
  - Cancel during that step let the preparation finish: the screen became ready with the model loaded. It now ends at once, releases the model and the audio context, and offers loading again.
- **F3:** A Worker that fails after the model was loaded no longer leaves a recognition waiting for ever.
  - Its error and message-error events are handled for as long as it lives. The Worker is ended, what waits is refused with the reason, and the screen offers to load the model again.
  - A Worker that does not answer a recording within 120 seconds counts as failed.
  - The recognizer tells the screen at once, so a recording in progress is ended and the microphone is released.
- 47 new tests cover the three cases, with the real recorder, session and recognizer and only the browser faked. The browser acceptance test has 11 more checks, in Chromium and Firefox.

## Unreleased — ENG-V3-02 stage A (2026-11-24)

A first pronunciation prototype in the experimental product. Nothing changes for users: the experimental product is not published, and the published site stays byte-identical to the ENG-V2-03 release.

- **Pronunciation screen (experimental product only).** Pick a phrase, record it, and read what a speech recognizer heard. Record again as often as wanted.
  - Recognition runs in the browser, in a Worker, with a pinned model (Moonshine tiny) on ONNX Runtime Web. Audio is not stored and not sent.
  - The result is the recognizer's text. There is no score, no comparison and no history, and nothing is marked as learned.
  - The microphone is asked for only by the click on Record, and released on stop, cancel, a hidden page and when the screen is left.
- **For disposable browser profiles only.** No build contains a speech model. A local server (`npm run prototype:serve`) offers the pinned files, and the screen offers the download on a loopback address only.
- **Model files.** Pinned by size and SHA-256. A file is checked before it is stored and again before it is used. An installation is usable only when it is complete; a failed, cancelled or interrupted one leaves nothing behind.
- **Network boundary.** The experimental page declares a Content-Security-Policy. The recognizer's Worker is started from a `blob:` address and inherits it, also on hosting that sends no policy header. Shown for Chromium and Firefox.
- **Spoken targets.** The rules that turn an entry into what the learner says, and the revision of that text, are implemented with their regression cases. Nothing uses a revision yet.
- **Builds and gates.**
  - A stable build no longer reads the experimental-only sources at all. Without that, files of the speech feature would have been written into the stable build folder.
  - The gate on the experimental build now checks its page policy, its pinned runtime, and that it holds no model file and names no other host. `npm run check:negative` has 34 cases.
  - One runtime dependency was added at an exact version: `onnxruntime-web` 1.31.1.
- Not included: backup and capacity checks (the Data Safety Gate), feedback, attempt history, phones and Safari. See `docs/architecture/PRONUNCIATION-PROTOTYPE.md`.

## Unreleased — ENG-V3-01-RC3 (2026-11-24)

Correction from Astra's independent review of ENG-V3-01-RC2. Nothing changes for users: the application code is untouched, and the published site stays byte-identical to the ENG-V2-03 release.

- **F1-RC2:** A build can no longer write through a `.git` entry in its output folder.
  - Vite keeps an entry named `.git` when it empties an output folder. With a link at that place, `--manifest .git/main.ts` or `--assetsDir .git` wrote into the folder that the link leads to.
  - A build now refuses an output folder that holds an entry named `.git`, whatever that entry is, and leaves the entry as it is.
  - A build accepts no other place for a generated file: `assetsDir` must be `assets`, and no manifest is written.
- New tests with real builds cover the three reproductions of the review. One more test pins that Rollup judges a file name by its text only.
- The implementation handoff of ENG-V3-01 is a local record and no longer part of the repository. `docs/architecture/PRODUCTS-AND-ROUTES.md` now lists the open gates for later milestones itself.
## Unreleased — ENG-V3-01-RC2 (2026-11-24)

Correction from Astra's independent review of ENG-V3-01-RC1. Nothing changes for users: the application code is untouched, and the published site stays byte-identical to the ENG-V2-03 release.

- **F1-RC1:** A Rollup output option can no longer make a build delete sources.
  - Vite empties every folder that `build.rollupOptions.output` names with `dir`, in place of `build.outDir`. The build check of RC1 looked at `outDir` only.
  - A build now accepts no Rollup output option at all, as an object or as a list. The builds of this repository need none.
  - The check covers every set of build options that Vite holds, for the configuration file, the JavaScript API and the command line.
  - A build also refuses `emptyOutDir: false`, so its output folder is always emptied before a file is written to it.
- New tests run real Vite builds in disposable copies of the application and compare every file before and after. `npm run check:negative` has one more case (16 in all).
- The check was read and tested against Vite 6.4.3 with Rollup 4.63.1. A test pins both versions, so an update of either has to repeat that reading.

## Unreleased — ENG-V3-01-RC1 (2026-11-23)

Correction from Astra's independent review of ENG-V3-01. Nothing changes for users: the application code is untouched, and the published site stays byte-identical to the ENG-V2-03 release.

- **F1:** A folder name in `site.config.json` can no longer make a script or a build delete sources.
  - Every product folder is now fixed in code. The file must state exactly that folder; any other value is an error, also another spelling of the same folder (`SRC`, `Dist`) and a file name (`index.html`).
  - One shared guard, `scripts/generated-dirs.mjs`, lists the folders that scripts generate. It runs immediately before every removal: content staging, both assemblies and the work areas of the checks. It refuses a folder that is not on the list, and a listed folder that is a file, a link or another spelling on disk.
  - Vite empties its output folder itself. The build configuration now checks that folder first, for every build and also for `--outDir`.
  - A refusal removes nothing and repairs nothing.
- New tests run each case in a disposable copy of the repository and compare every file before and after. `npm run check:negative` has two more cases (15 in all).

## Unreleased — ENG-V3-01 (2026-11-23)

Dual-product foundation. Nothing changes for users of v2 or v1: the published site stays byte-identical to the ENG-V2-03 release.

- The source tree now builds two products, chosen at build time: `stable-v2` (the released v2, still the default) and `experimental-v3`. `site.config.json` names the products, their routes and a committed `publish` flag per route. A validated reader fails closed on unknown products, colliding routes, unsafe or overlapping folders and inconsistent publication settings.
- `experimental-v3` is built and tested but **not published**. Only a reviewed change of the committed `publish` flag can add it to the site: no command-line argument, environment variable or workflow input can.
- `experimental-v3` has its own database, `eng-trainer-v3`, a new lineage at version 1 with the six shared stores plus `meta`. It never opens `eng-trainer-v2` and never touches `localStorage`. There is no migration, copy or backup yet.
- The two links to v1 now start at the base path of the whole site, so they are correct from a product published under a sub-path. Content and the brand link keep using the product's own base path.
- Content is generated per product into separate folders. The experimental overlay (`content/v3/overlay.json`) must be empty, so both products publish the released catalog.
- A new gate, `npm run check:products`, runs as the last step before the Pages upload. It compares the assembled site with the 33 released files (path, size and SHA-256), and checks the chunk inventory, forbidden tokens, the released catalog and that nothing of an unpublished product is in the site. `npm run check:negative` proves on deliberately broken copies that each gate fails.
- `npm run assemble:test` builds a local three-product site for browser checks, and `npm run rehearse:promotion` rehearses a route swap and its rollback. Neither publishes anything.
- The experimental product has one placeholder screen, **Pronunciation**, loaded as a separate chunk. It records, recognizes and downloads nothing. The stable build contains neither the screen nor a request for it.
- No dependency was added or changed.

## Unreleased — ENG-V2-UX-01B-RC1 (2026-11-22)

Corrections from Astra's independent review of ENG-V2-UX-01B:

- **F1:** An Undo can no longer override newer intent. Every learned, Focus and Hide/Show action records an in-memory revision for the stored entry state it touches, also when nothing stored changes ("Keep learning" on an unlearned card). Reset and every reload start a new generation. An Undo is used at most once and restores only what its own action changed. Nothing new is saved.
- **F2:** Keyboard focus is kept in place when a control disappears:
  - Learn again moves focus to the next learned card, else the list heading.
  - Undo returns focus to the restored entry.
  - Deleting a Learn Pass moves focus to the next pass, else "Create a Learn Pass".
  - Deck reset and Unhide all have defined targets too.
  - An expiring message never moves focus.
- **F3:** A file that is read but has blocking problems (a missing value, an invalid kind, an identity conflict) now focuses the named summary of those problems instead of the review heading.
- **F4:** The interface font is served as **Eng Trainer Sans**, a renamed OFL derivative of the four Source Sans 3 subsets. Only the font names changed. The licence and a FONTLOG are published with it, and the preparation script is `scripts/fonts/derive_eng_trainer_sans.py`.
- **F5:**
  - Learning-block descriptions are marked with their actual language, from a table keyed by block id.
  - English Answers questions, speaking prompts, the Reverse practice prompt and import-preview examples are kept out of browser translation.

## Unreleased — ENG-V2-UX-01B (2026-11-22)

- Redesign v2 in the approved "Spoken Line" direction:
  - Design tokens for light and dark themes.
  - Self-hosted Literata for English study text and Source Sans 3 for the interface, Ukrainian text and transcriptions, both under the SIL Open Font License, with no Google Fonts requests.
  - A bundled SVG icon set replaces the 3.1 MB Material Symbols font.
  - Shared buttons, fields, notices, dialogs and messages with 44-pixel targets and a visible focus ring.
- Replace the banner and the long navigation with five destinations (Home, Library, Practice, Focus, More): a bar at the bottom of the screen on phones, a side navigation on wide screens. Every earlier `#` address still works. Add a Settings screen (`#settings`) and an **Import words** link in the Library.
- Show Phrases, Words, Verbs and the Focus list as compact rows, with the first entry within 250 pixels of the top on a 390 × 844 phone. **Hide** offers **Undo**. **Unhide all**, Learn Pass deletion and deck reset ask for confirmation in an accessible dialog. **Reset learning progress** moves from Home to Settings, and its confirmation lists what it clears and what it keeps.
- Keep the flashcard answer buttons on the first screen on phones and desktops. **Learn again** offers **Undo**.
- Add "How to prepare your file" to Collections: formats, required columns, limits, a short example, **Download CSV template**, **Copy example** and more format details. Import errors name the problem, the missing column, and the record or entry. The template is offered when it helps.
- Resolve review findings F3–F6:
  - F3: focus moves to the review or the error summary. The latest file selection wins, **Cancel** stops reading, and the same corrected file can be chosen again.
  - F4: a blocked upgrade keeps its guidance, recovers by itself, and never starts competing attempts. A late connection is closed when you continue without saving.
  - F5: conflicts, unavailable storage, quota and other storage failures get separate messages next to the action.
  - F6: export file names keep Cyrillic collection names.
- Mark English study text as `lang="en"` and `translate="no"` and built-in translations as Ukrainian. Imported translations are not assumed to be Ukrainian.
- Theme transitions start only after the saved theme is applied. The theme is still saved only in IndexedDB.
- `check:site` also verifies the self-hosted fonts and their licences, and rejects Google Fonts references.
- The database schema and version, identities, saved learning state, built-in content and v1 are unchanged.

## Unreleased — ENG-V2-02B (2026-11-21)

- Add local user collections with CSV/native JSON validation, preview, duplicate acknowledgment, atomic import, rename, confirmed removal and JSON export.
- Upgrade IndexedDB to version 2 by adding collection and entry stores while preserving all existing records. Handle blocked/failed upgrades and transactional import failures visibly.
- Include imported vocabulary in the shared catalog, search, collection/topic filters, flashcards and Focus. Preserve explicit relationships and independent learning identities.
- Make native JSON reimports idempotent and retain deleted collections' progress for restoration with the original IDs. Add focused parser, migration, rollback, catalog and browser checks.

## 2026-11-21 — ENG-V2-02A

- Split v2 built-in learning material into 11 thematic JSON packs and a course descriptor. Build generation validates content and emits a central manifest with content-addressed pack URLs.
- Load every built-in pack through the shared catalog before the app becomes ready. Missing or invalid packs use the existing error and retry flow.
- Preserve all 1,538 records/items, field values, IDs, entry order and 566 explicit phrase relationships. Flashcards, Focus, saved learning state and IndexedDB version 1 remain compatible.
- Add migration fingerprints, a Git-object comparison, pack validation/loading/search tests and focused native-browser evidence. v1 source and the deployment workflow are unchanged.

## 2026-11-21 — ENG-V2-01

### Added

- Added `v1/`: an independent copy of the application as it was before this change, with its own data, dependencies, lockfile, and build. It is published at `/eng-trainer/v1/` and keeps its `localStorage` progress.
- Added a link to v1 at the bottom of every v2 screen.
- Added a notice when a change cannot be saved, with **Try saving again**, and a start screen for the case when saved progress cannot be opened.
- Added `npm run build:site`, which builds both applications and assembles them into `site-dist/`.
- Added tests for IndexedDB persistence, storage failures, the content catalog, and the application shell.

### Changed

- The root application is now v2. Its code is split into an application shell, a content catalog, a storage adapter, progress and settings services, feature screens, and shared components.
- v2 saves progress and preferences in the IndexedDB database `eng-trainer-v2`. It does not use `localStorage` and does not read v1 progress, so v2 starts with empty progress.
- Search text, the current page of each list, and the current practice prompt are no longer saved. They are kept while the app is open and start fresh after a reload.
- The saved theme is applied when the app has read its settings. Before that, the system theme is shown.
- The GitHub Pages workflow builds and publishes both applications as one site. Pull requests to `main` are checked and built without publishing.
- Flashcards in v2 no longer join entries because their text is the same or similar. Each phrase is one card with its linked Word Index entry, and "I know it" marks only that phrase as learned. The All Vocabulary deck therefore has 566 cards instead of 560: six texts that the material lists under two ids are now two cards each.

### Fixed

- A flashcard could be counted as learned while the same entry was shown as not learned on the Phrases page or in the Focus List, and one answer could mark several entries as learned (review finding F1).
- An aborted read of the saved progress showed the storage error screen but also left an unhandled error in the browser (review finding F2).

## 2026-11-11

### Added

- Added a **Flashcards** page for learning words and phrases with swipeable, flippable cards.
- Added two decks: **All Vocabulary** and **By Topic** (dataset categories). The learned status is shared between them.
- Added three ways to answer: swipe, buttons, and keyboard (left and right arrows, Enter or Space to flip).
- Added a list of learned vocabulary with **Learn again**, and **Reset progress** for the selected deck with confirmation.
- Added flashcard progress to the saved browser state. Existing learned, hidden, Focus List, and Learn Pass data is kept.
- Added a focused test suite. Run it with `npm test`.

### Changed

- Phrases and their mirrored Word Index entries are shown as one flashcard, so no item appears twice.
- The hero shows only the page title on the Flashcards page, and is hidden there on phones, so the card fits on the first screen.
- The mobile navigation has a **Flashcards** entry and uses four columns on phones.

## 2026-06-29

### Fixed

- Improved toolbar layout on **Phrases** and **Word Index** pages.
- Stacked **Search** and **Category** controls vertically and placed listening controls beside them to avoid overlap.

### Added

- Added a new **200 Irregular Verbs — Logical Groups** learning block.
- Grouped the new irregular verbs by form-changing patterns instead of alphabetical order:
  - all three forms are the same;
  - 2nd and 3rd forms match;
  - 3rd form ends with `-en`;
  - `i → a → u` vowel change;
  - mixed / three-form patterns.
- Added `verbSet` support so different irregular-verb blocks can exist as separate learning tracks.
- Added a short functional guide to `README.md`.
- Added `CHANGELOG.md` as a maintained project history file.

### Changed

- The Irregular Verbs page now supports switching between available verb sets.
- The daily learning card uses irregular verbs from the active Learn Pass context.
