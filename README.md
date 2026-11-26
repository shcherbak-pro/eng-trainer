# ShcherbakPro English Trainer

ShcherbakPro English Trainer is a responsive learning app for English speaking assessment preparation and practical workplace English.

## What the app helps you practice

- speaking answer patterns and ready-made answer structures
- useful phrases, connectors, hedging phrases, and advanced linking words
- workplace topics such as teamwork, remote work, leadership, time management, stress management, and conflict resolution
- AI, coding tools, agent framework, presentation, and cost-optimization vocabulary
- word index with translation, transcription, alternatives, and examples
- reverse practice from Ukrainian to English
- vocabulary flashcards with swipe, button, and keyboard answers
- irregular verbs with 3 forms, translation, transcription, and examples
- pronunciation and listening practice with browser speech synthesis

## Finding your way

The app has five main destinations. On phones they form the bar at the bottom of the screen; on wide screens they are in the side navigation.

| Destination | Screens (address) |
|---|---|
| **Home** | Learn Passes, topics, learning blocks, phrase or word of the day (`#index`) |
| **Library** | Phrases (`#phrases`), Words (`#wordIndex`), Verbs (`#irregularVerbs`), Patterns (`#patterns`), Answers (`#answers`), and an **Import words** link to Collections |
| **Practice** | Flashcards (`#flashcards`), Reverse practice (`#reverse`), Speaking prompts (`#practice`) |
| **Focus** | Your Focus list (`#favorites`) |
| **More** | Collections (`#collections`), Settings (`#settings`), and the previous version (v1) |

All earlier addresses still work, so saved links and the last opened page continue to open the same screens. **Settings** holds the theme, the number of listening repeats, a link to your collections, and **Reset learning progress…**. The reset asks for confirmation and lists exactly what it clears and what it keeps.

## Focus tools

The app includes several tools to keep learning focused:

- **Learn Passes** — create focused learning tracks and show only selected materials.
- **Focus List** — save important words, phrases, verbs, or learning blocks for repeated practice.
- **Hide / Show** — remove learned items from normal lists without deleting them. A message offers **Undo** right after hiding, and **Show hidden** brings hidden items back into view with a **Show** button on each. **Unhide all** asks for confirmation first.
- **Topics** — filter learning blocks by topic on Home.
- **Phrase or word of the day** — get a random item for quick daily practice.
- **Pagination** — control how many items are shown on each page.

## Flashcards

The **Flashcards** page shows one word or phrase at a time. The front has the English text, the transcription, and a pronunciation button. Tap or click the card to see the translation and an example.

- **Swipe right**, press **I know it**, or press the right arrow key to mark the item as learned. Learned items leave the deck.
- **Swipe left**, press **Keep learning**, or press the left arrow key to keep the item. It comes back on the next round.
- **Enter** or **Space** flips the card.
- **All Vocabulary** studies every word and phrase once. **By Topic** studies one category. The learned status is shared between them and with the **Phrases** page.
- **Review learned vocabulary** lists learned items, where **Learn again** returns an item to the deck; the message that follows offers **Undo**. **Reset progress** for the selected deck is in that list and on the **Deck complete** screen, and it asks for confirmation first.

Each phrase is one card, together with the Word Index entry that is linked to it. A card is learned exactly when its phrase is learned on the **Phrases** page and in the **Focus List**. If the material lists the same or a similar text as two entries (for example `consequently` in Conjunctions and `Consequently, …` in Advanced Linking Words), these are two cards with separate progress.

Items hidden on the Phrases or Words page are left out of the flashcards.

## Listening practice

For phrases, words, irregular verbs, and Focus List items, the app can read the visible materials aloud. You can choose the number of repeats and use the feature for passive listening or pronunciation practice.

## Your vocabulary collections

Open **Collections** (from **More**, or **Import words** in the Library) to import CSV UTF-8 or native JSON, review the proposed entries and possible duplicates, then confirm the import. CSV headers are `english,translation,topic,example` with optional `kind` (`word` or `phrase`); only English and translation are required. Files are limited to 2 MiB and collections to 1,000 entries. Invalid entries or conflicting IDs block the whole import.

Next to the file picker, **How to prepare your file** shows the formats, the required columns, the limits and a short example. **Download CSV template** saves exactly that example as `eng-trainer-vocabulary-template.csv` (UTF-8), and **Copy example** copies the same text. **More format details** explains separators, optional columns, quoting, spreadsheet export and the native JSON structure. Error messages name the missing column, the record or entry and the field, and offer the template when it helps.

Imported content is saved locally in IndexedDB and joins the existing search, Phrases/Words, Flashcards and Focus functionality. Collection and topic filters let you narrow what you study. Collections can be renamed, exported as JSON, or removed after confirmation. An export is named after the collection, including Cyrillic names (for example `Мої-слова-2026-11-22.json`). Reimporting an unchanged native export creates no duplicates.

Removing a collection retains its progress under the original IDs, so importing the same native JSON restores it. Export a content backup before removing a collection; JSON exports do not contain learning progress. Reset progress does not remove vocabulary collections. See [the format, migration and deletion policy](docs/architecture/USER-COLLECTIONS.md).

## Personal progress

Learning state is saved in the browser, in the IndexedDB database `eng-trainer-v2`. This includes learned and hidden items, the Focus List, Learn Passes and the selected pass, flashcard progress, the theme, speech repeats, list filters, page sizes, and expanded panels.

Search text, the current page of a list, and the current practice prompt are not saved. They start fresh after a reload.

If the browser cannot save a change, the app shows a notice with a **Try saving again** button. If another eng-trainer tab keeps an older version of the saved data open, the app explains how to close it, keeps waiting, and opens by itself once the other tab is closed; **Check again** never starts a competing attempt, and **Continue without saving** stays in effect even if the other tab closes later. If the saved progress cannot be opened at all, the app stops and offers to try again or to continue without saving.

The theme is saved in IndexedDB like the other preferences, so it is applied once the app has read its settings. Until then the system theme is shown; colour transitions are switched on only after that, so the change is not animated. The app uses no `localStorage` and no cookies.

## Two versions

| Version | Address | Source | Storage |
|---|---|---|---|
| v2 (current) | https://shcherbak-pro.github.io/eng-trainer/ | repository root | IndexedDB `eng-trainer-v2` |
| v1 (preserved) | https://shcherbak-pro.github.io/eng-trainer/v1/ | [`v1/`](v1/) | `localStorage` |

The two versions are separate applications. They do not share code, data files, or progress. v2 starts with empty progress and does not read v1 data. v2 links to v1 from the side navigation on wide screens, from **More** on phones, and from **Settings**.

An experimental third version, v3, is built from the same source tree as v2. It is **not published**. It has its own database (`eng-trainer-v3`) and one feature of its own: a prototype of pronunciation practice, for local testing in disposable browser profiles. See [Products and routes](#products-and-routes).

## Fonts and icons

v2 serves its own fonts; it makes no requests to Google Fonts or any other font service. English study text uses **Literata**. The interface, Ukrainian text and transcriptions use **Eng Trainer Sans**, which covers every IPA symbol in the material. Eng Trainer Sans is the Source Sans 3 design under its own name: Source Sans 3 reserves the name “Source”, and web subsets count as modified versions, so only the font names were changed (glyphs, metrics and shaping are identical). Both typefaces are published under the SIL Open Font License 1.1; the licences and the derivative's FONTLOG are served at `/eng-trainer/fonts/`. The font files are split by script (`unicode-range`), so a page loads only the subsets it uses, and text appears at once in a system font if a font is slow or missing. Provenance and checksums are in [`src/assets/fonts/README.md`](src/assets/fonts/README.md); the renamed files are prepared by [`scripts/fonts/derive_eng_trainer_sans.py`](scripts/fonts/derive_eng_trainer_sans.py), which the build does not run.

Icons are a small bundled SVG set (`src/shared/ui/icons.ts`), not an icon font.

## Development

Requirements: Node.js 22 or newer.

```bash
npm ci                # install v2 dependencies
npm run install:v1    # install v1 dependencies (v1/ has its own package.json and lockfile)

npm run dev           # v2 dev server: http://localhost:5173/eng-trainer/
npm run dev:v1        # v1 dev server: http://localhost:5173/eng-trainer/v1/

npm run check         # svelte-check for v2        (v1: npm run check:v1)
npm test              # vitest for v2              (v1: npm run test:v1)

npm run build         # v2 -> dist/
npm run build:v1      # v1 -> v1/dist/
npm run assemble      # dist/ + v1/dist/ -> site-dist/ and site-dist/v1/
npm run check:site    # structural check of site-dist/
npm run build:site    # all four steps above in order
```

To look at the assembled site locally: `npx vite preview --outDir site-dist`, then open `http://localhost:4173/eng-trainer/`.

The link from v2 to v1 works in the assembled site. In the v2 dev server it leads to a missing page, because v1 runs in its own dev server.

### Products and routes

The source tree in the repository root builds two products. The product is chosen when the application is built, never by the address it runs at.

| Product | Published at | Database | Notes |
|---|---|---|---|
| `stable-v2` | `/eng-trainer/` | `eng-trainer-v2` | The released v2. Every command above builds and tests this product. |
| `experimental-v3` | not published (`/eng-trainer/v3/` in local test builds) | `eng-trainer-v3` | Same code and content, its own database, and two screens of its own. **Pronunciation** is a prototype: it records a phrase and shows what a speech recognizer in the browser heard. No scoring. No build contains a speech model. **Backup** makes one backup file with the saved data of all three versions, and recovers each version from such a file. |
| `legacy-v1` | `/eng-trainer/v1/` | `localStorage` | The frozen project in `v1/`. |

```bash
npm run dev:v3              # experimental dev server: http://localhost:5173/eng-trainer/v3/
npm run test:v3             # the shared suite as the experimental product
npm run build:v3            # experimental-v3 -> dist-v3/

npm run check:products      # the released-site lock and the product gates (after build:site and build:v3)
npm run check:negative      # proves that those gates fail on deliberate faults
npm run assemble:test       # all three products -> .site-test/, for local checks only
npm run rehearse:promotion  # local rehearsal of a route swap and of its rollback
```

The pronunciation prototype runs from a local server, in a new and empty browser profile with made-up data only:

```bash
npm run prototype:build     # all three products -> .site-test/
npm run prototype:model     # once: the pinned speech model (31.9 MB) -> .local/models/, from the Hugging Face Hub
npm run prototype:serve     # http://127.0.0.1:4173/eng-trainer/v3/#pronunciation, for this computer only
```

Recognition runs on the device. Nothing is scored, stored or sent. How it works, its network boundary and what is still open are in [Pronunciation prototype](docs/architecture/PRONUNCIATION-PROTOTYPE.md).

The Backup screen is at `#backup`, under **More**. Making a backup reads the saved data of the three versions and changes nothing. A recovery writes one version at a time, after a confirmation, and only where that version holds no learning data. The stable version must have been opened once in the browser before it can be recovered: only it creates its own storage. The file format, the checks and the limits are in [Backup and recovery](docs/architecture/BACKUP-AND-RECOVERY.md). Its browser test needs an installed Playwright:

```bash
npm run prototype:build                       # all three products -> .site-test/
node scripts/acceptance/backup.mjs chromium   # also: firefox. New browser profiles and made-up data only
```

Run the two test suites one after the other, not at the same time.

- [`site.config.json`](site.config.json) names the products and their routes. Whether a product is part of the published site is the committed `publish` flag of its route. Nothing else can publish it: no command-line argument, environment variable or workflow input.
- The stable build must stay **byte-identical** to the released site. `npm run check:products` compares `site-dist/` with the list of the 33 released files and fails on any extra, missing or changed file. That list is never updated to make a change pass.
- A checkout with CRLF line endings fails that comparison for eight files, by carriage returns only. CI builds from LF files.

See [Products and routes](docs/architecture/PRODUCTS-AND-ROUTES.md) for the configuration rules, the compile-time constants and the gates.

### Structure of v2

```text
src/
  app/         Application shell: startup, navigation, loading and error screens, theme
  content/     Shared built-in/user content catalog and search
  collections/ Validated CSV/native JSON import, transactional collection service and export
  storage/     IndexedDB adapter: database, object stores, transactions
  state/       Progress and settings services, the save queue, in-memory view state
  features/    Screens: home, vocabulary, flashcards, exercises, focus, collections, settings
  shared/      Components and helpers used by several features (ui, entries, speech)
  styles/      Design tokens (colours, type, spacing, light and dark), font faces, base styles
  assets/      Self-hosted font files and their provenance
  test/        Test setup (in-memory IndexedDB) and database helpers
content/       Authored built-in content: course descriptor and thematic JSON packs
content/v3/    Content overlay of the experimental product (empty)
public/data/   Generated manifest and content-addressed packs (ignored by Git)
scripts/       Content generation/validation, product configuration, site assembly and artifact checks
scripts/locks/ The list of released files that the stable build must reproduce exactly
site.config.json  Products, routes and publish flags
v1/            The preserved v1 application (independent project)
```

`src/features/pronunciation/` and `src/features/backup/` belong to the experimental product only. Shared code reaches each through one guarded dynamic import, and a stable build reads none of their files, so the stable build contains neither.

The experimental product has one more runtime dependency, [`onnxruntime-web`](https://www.npmjs.com/package/onnxruntime-web) at an exact version: the WebAssembly runtime of the speech recognizer. The stable build does not contain it.

IndexedDB is used through [`idb`](https://github.com/jakearchibald/idb), a small promise wrapper. Only `src/storage/database.ts` imports it.

### Built-in content

Edit the thematic JSON files in [`content/packs/`](content/packs/) and the course metadata/navigation in [`content/catalog.json`](content/catalog.json). The v2 monolithic `materials.json` has been removed. v1 retains its own independent file.

`npm run content:generate` validates the source and produces `public/data/manifest.json` and hashed files under `public/data/packs/`. It also runs automatically before `npm run dev`, `npm run check`, `npm test`, and `npm run build`. Generated files must not be edited or committed. After editing pack sources while the dev server is running, restart `npm run dev` to regenerate them.

The shared catalog loads every listed pack before the app becomes ready. Search includes all built-in material immediately, regardless of which screens have been opened. IDs, explicit word-to-phrase links, and original entry order are preserved. The built-in pack migration itself did not change IndexedDB; ENG-V2-02B adds user collections through database version 2.

See [the pack format and authoring rules](docs/architecture/BUILT-IN-CONTENT.md) and [ENG-V2-02A review handoff](docs/handoffs/ENG-V2-02A.md). `npm run verify:content` compares the new sources and generated catalog against the released ENG-V2-01 Git object, including complete records, order, links, and v1 preservation.

### Deployment

`.github/workflows/deploy.yml` builds the applications, assembles `site-dist/`, and is the only GitHub Pages publisher. Pull requests to `main` run the checks and builds without publishing. Pushes to `main` publish the assembled site.

The workflow also tests and builds the experimental product, but copies it into the site only if its route is committed as published. It is not. The last step before the upload is `npm run check:products`: a site that is not exactly the released one stops the job there.

## Live app

https://shcherbak-pro.github.io/eng-trainer/
