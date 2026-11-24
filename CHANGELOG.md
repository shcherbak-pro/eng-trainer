# Changelog

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
