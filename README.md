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

## Focus tools

The app includes several tools to keep learning focused:

- **Learn Passes** — create focused learning tracks and show only selected materials.
- **Focus List** — save important words, phrases, verbs, or learning blocks for repeated practice.
- **Hide / Unhide** — remove learned items from normal lists without deleting them.
- **Tag Cloud** — filter materials by topic tags.
- **Phrase / Word of the Day** — get a random item for quick daily practice.
- **Pagination** — control how many items are shown on each page.

## Flashcards

The **Flashcards** page shows one word or phrase at a time. The front has the English text, the transcription, and a pronunciation button. Tap or click the card to see the translation and an example.

- **Swipe right**, press **I know it**, or press the right arrow key to mark the item as learned. Learned items leave the deck.
- **Swipe left**, press **Keep learning**, or press the left arrow key to keep the item. It comes back on the next round.
- **Enter** or **Space** flips the card.
- **All Vocabulary** studies every word and phrase once. **By Topic** studies one category. The learned status is shared between them and with the **Phrases** page.
- **Review learned vocabulary** lists learned items, where **Learn again** returns an item to the deck. **Reset progress** clears the learned items of the selected deck after a confirmation.

Each phrase is one card, together with the Word Index entry that is linked to it. A card is learned exactly when its phrase is learned on the **Phrases** page and in the **Focus List**. If the material lists the same or a similar text as two entries (for example `consequently` in Conjunctions and `Consequently, …` in Advanced Linking Words), these are two cards with separate progress.

Items hidden on the Phrases or Words page are left out of the flashcards.

## Listening practice

For phrases, words, irregular verbs, and Focus List items, the app can read the visible materials aloud. You can choose the number of repeats and use the feature for passive listening or pronunciation practice.

## Your vocabulary collections

Open **Collections** to import CSV UTF-8 or native JSON, review the proposed entries and possible duplicates, then confirm the import. CSV headers are `english,translation,topic,example` with optional `kind` (`word` or `phrase`); only English and translation are required. Files are limited to 2 MiB and collections to 1,000 entries. Invalid entries or conflicting IDs block the whole import.

Imported content is saved locally in IndexedDB and joins the existing search, Phrases/Words, Flashcards and Focus functionality. Collection and topic filters let you narrow what you study. Collections can be renamed, exported as JSON, or removed after confirmation. Reimporting an unchanged native export creates no duplicates.

Removing a collection retains its progress under the original IDs, so importing the same native JSON restores it. Export a content backup before removing a collection; JSON exports do not contain learning progress. Reset progress does not remove vocabulary collections. See [the format, migration and deletion policy](docs/architecture/USER-COLLECTIONS.md).

## Personal progress

Learning state is saved in the browser, in the IndexedDB database `eng-trainer-v2`. This includes learned and hidden items, the Focus List, Learn Passes and the selected pass, flashcard progress, the theme, speech repeats, list filters, page sizes, and expanded panels.

Search text, the current page of a list, and the current practice prompt are not saved. They start fresh after a reload.

If the browser cannot save a change, the app shows a notice with a **Try saving again** button. If the saved progress cannot be opened at all, the app stops and offers to try again or to continue without saving.

## Two versions

| Version | Address | Source | Storage |
|---|---|---|---|
| v2 (current) | https://shcherbak-pro.github.io/eng-trainer/ | repository root | IndexedDB `eng-trainer-v2` |
| v1 (preserved) | https://shcherbak-pro.github.io/eng-trainer/v1/ | [`v1/`](v1/) | `localStorage` |

The two versions are separate applications. They do not share code, data files, or progress. v2 starts with empty progress and does not read v1 data. A link at the bottom of every v2 screen opens v1.

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

### Structure of v2

```text
src/
  app/         Application shell: startup, navigation, loading and error screens, theme
  content/     Shared built-in/user content catalog and search
  collections/ Validated CSV/native JSON import, transactional collection service and export
  storage/     IndexedDB adapter: database, object stores, transactions
  state/       Progress and settings services, the save queue, in-memory view state
  features/    Screens: home, vocabulary, flashcards, exercises, focus, collections
  shared/      Components and helpers used by several features (ui, entries, speech)
  test/        Test setup (in-memory IndexedDB) and database helpers
content/       Authored built-in content: course descriptor and thematic JSON packs
public/data/   Generated manifest and content-addressed packs (ignored by Git)
scripts/       Content generation/validation, site assembly and artifact checks
v1/            The preserved v1 application (independent project)
```

IndexedDB is used through [`idb`](https://github.com/jakearchibald/idb), a small promise wrapper. Only `src/storage/database.ts` imports it.

### Built-in content

Edit the thematic JSON files in [`content/packs/`](content/packs/) and the course metadata/navigation in [`content/catalog.json`](content/catalog.json). The v2 monolithic `materials.json` has been removed. v1 retains its own independent file.

`npm run content:generate` validates the source and produces `public/data/manifest.json` and hashed files under `public/data/packs/`. It also runs automatically before `npm run dev`, `npm run check`, `npm test`, and `npm run build`. Generated files must not be edited or committed. After editing pack sources while the dev server is running, restart `npm run dev` to regenerate them.

The shared catalog loads every listed pack before the app becomes ready. Search includes all built-in material immediately, regardless of which screens have been opened. IDs, explicit word-to-phrase links, and original entry order are preserved. The built-in pack migration itself did not change IndexedDB; ENG-V2-02B adds user collections through database version 2.

See [the pack format and authoring rules](docs/architecture/BUILT-IN-CONTENT.md) and [ENG-V2-02A review handoff](docs/handoffs/ENG-V2-02A.md). `npm run verify:content` compares the new sources and generated catalog against the released ENG-V2-01 Git object, including complete records, order, links, and v1 preservation.

### Deployment

`.github/workflows/deploy.yml` builds both applications, assembles `site-dist/`, and is the only GitHub Pages publisher. Pull requests to `main` run the checks and builds without publishing. Pushes to `main` publish the assembled site.

## Live app

https://shcherbak-pro.github.io/eng-trainer/
