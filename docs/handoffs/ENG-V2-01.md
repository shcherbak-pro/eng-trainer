# ENG-V2-01 — Handoff for testing and review

Preserve v1 as an independent application under `v1/`, turn the root application into a modular v2 with IndexedDB persistence, build both, and publish them as one GitHub Pages site.

Date: 2026-11-21. Status: implemented, development checks pass, **not tested in a browser**.

> **Update, corrective iteration ENG-V2-01-RC1 (2026-11-21):** Astra's independent review (`docs/reviews/ENG-V2-01-ASTRA.md`) returned `CHANGES_REQUIRED` with findings F1 and F2. Both are corrected. See [section 10](#10-corrective-iteration-eng-v2-01-rc1). Sections 1 to 9 describe the first iteration and are kept as written; where section 10 gives a newer number or rule, section 10 applies.
>
> **Update, integration (2026-11-21):** Astra's re-review (`docs/reviews/ENG-V2-01-RC1-ASTRA.md`) returned `READY_FOR_PR`. The work was then committed on `feature/eng-v2-01-modular-foundation` and a pull request to `main` was opened. Sections 1 and 10.8 describe the uncommitted working tree as it was at each handoff; the commits and the pull request are the current state.

## 1. Branch and working tree

| Item | Value |
|---|---|
| Branch | `feature/eng-v2-01-modular-foundation` (local only, not pushed) |
| Created from | `origin/main` at `45564ca` (merge of PR #1) |
| Result | **Uncommitted working tree.** No commit was requested, so nothing is committed or staged. |
| Default branch | `main` (the Pages workflow publishes from it) |

Notes on the starting state:

- The checkout was on `feature/vocabulary-flashcards` at `90d7941`. Its tree is identical to `45564ca`.
- The only uncommitted file was an untracked root `package-lock.json`. The repository has never had a committed lockfile.
- The local `main` branch is behind `origin/main`. It was not touched.

**Before opening a pull request, commit both lockfiles** (`package-lock.json` and `v1/package-lock.json`). The workflow now uses `npm ci`, which fails without them.

## 2. Baseline copied into v1

`v1/` contains the tracked application files of commit `45564ca`, plus the untracked root `package-lock.json` as it was at the start (SHA-1 `0f24a6c9a936365b6c28cb0ddc0b80763d068dd8`).

Copied: `src/`, `public/` (vocabulary data and favicon), `index.html`, `package.json`, `package-lock.json`, `svelte.config.js`, `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts`, `vitest.config.ts`, `.gitignore`, and the three existing test files.

Not copied: `.git`, `.github/`, `node_modules/`, `dist/`, the root `README.md` and `CHANGELOG.md`.

Changes made in v1, and nothing else:

| File | Change |
|---|---|
| `v1/vite.config.ts` | `base` is `/eng-trainer/v1/` |
| `v1/package.json`, `v1/package-lock.json` | package name is `english-assessment-trainer-v1` |
| `v1/README.md` | new file that describes the copy |

Every other v1 file has the same text as the baseline (compared file by file, ignoring line endings). v1 keeps its `localStorage` persistence and imports nothing from v2.

## 3. Structure

```text
eng-trainer/
  index.html, vite.config.ts, package.json, ...   v2 application (base /eng-trainer/)
  public/data/materials.json                      v2 built-in content
  src/
    main.ts
    app/        App.svelte, AppShell.svelte, ThemeToggle.svelte, navigation.ts, theme.ts
    content/    types.ts, catalog.ts, search.ts, builtIn.ts
    storage/    database.ts
    state/      index.ts, persistence.ts, progress.ts, settings.ts, viewState.ts
    features/
      home/        IndexPage, LearnPassManager, ExpansionPanel
      vocabulary/  PhrasesPage, WordIndexPage, IrregularVerbsPage
      flashcards/  FlashcardsPage, flashcards.ts, types.ts
      exercises/   ReversePracticePage, PracticePage, PatternsPage, AnswersPage
      focus/       FocusListPage
    shared/
      ui/        IconButton, MaterialIcon, EmptyState, PaginationControls
      entries/   PhraseCard, WordCard, IrregularVerbCard, FocusButton, HideButton
      speech/    speech.ts, sectionSpeech.ts, speechFormatters.ts, SpeakButton, SectionSpeechControl
      text.ts, pagination.ts
    test/       setup.ts, database.ts
  scripts/      assemble-site.mjs, check-site.mjs
  v1/           independent v1 application (base /eng-trainer/v1/)
  docs/handoffs/ENG-V2-01.md
```

Responsibilities:

| Area | Where | What it does |
|---|---|---|
| Application shell | `src/app` | Startup order (saved state, then content, then first screen), hash navigation, loading and error screens, storage notice, theme, link to v1 |
| Content catalog | `src/content` | `ContentCatalog` interface. `loadBuiltInCatalog()` fetches `data/materials.json` from the app's own base path. Search over phrases, words, verbs and blocks is prepared once in memory and covers the whole catalog |
| Storage adapter | `src/storage/database.ts` | The only module that uses IndexedDB. One read transaction at startup, one write transaction per batch of changes |
| Progress service | `src/state/progress.ts` | Learned, hidden, Focus List, Learn Passes, selected pass, flashcard deck sequences |
| Settings service | `src/state/settings.ts` | Theme, speech repeats, filters, page sizes, panels, selected deck, last screen |
| Save queue | `src/state/persistence.ts` | Orders writes, exposes `saveStatus` (`idle`, `saving`, `saved`, `error`, `disabled`) |
| View state | `src/state/viewState.ts` | Search text, current page of each list, practice prompt. Memory only |
| Features | `src/features` | Screens. They read content from the catalog and state from the services |
| Shared | `src/shared` | Components and helpers used by at least two features |

Decisions worth reviewing:

- Screens receive the catalog as a prop. There is no registry or dependency-injection layer.
- `idb` 8 is the IndexedDB wrapper (about 1 kB, typed, `tx.done` resolves when a transaction completes). `fake-indexeddb` is a dev dependency, used only by tests, because jsdom has no IndexedDB.
- Removed from v2 because nothing used them: `Toolbar.svelte`, `includesId`, the `reverseMode` field. They remain in v1.
- No router, service worker, or new search engine was added. Neither application has a service worker.
- The application has no screen that searches across all sections. Search exists per section (phrases, words, verbs, Learn Pass blocks), as before.

## 4. Commands

```bash
# install
npm ci
npm run install:v1        # npm ci inside v1/

# run
npm run dev               # v2: http://localhost:5173/eng-trainer/
npm run dev:v1            # v1: http://localhost:5173/eng-trainer/v1/  (stop the v2 server first, or it takes another port)

# check
npm run check             # svelte-check, v2
npm test                  # vitest, v2
npm run check:v1
npm run test:v1

# build and assemble
npm run build             # v2 -> dist/
npm run build:v1          # v1 -> v1/dist/
npm run assemble          # -> site-dist/ (v2) and site-dist/v1/ (v1)
npm run check:site        # structural check of site-dist/
npm run build:site        # the four steps above

# look at the assembled site
npx vite preview --outDir site-dist     # http://localhost:4173/eng-trainer/ and /eng-trainer/v1/
```

`dist/`, `v1/dist/` and `site-dist/` are ignored by Git. Neither build writes into the other's output directory.

## 5. v2 database

Database `eng-trainer-v2`, version 1. Four object stores, all with explicit string keys.

| Store | Key | Value | Owner |
|---|---|---|---|
| `progress` | `learnedPhrases`, `hiddenPhrases`, `hiddenWords`, `hiddenIrregular`, `favoriteBlocks`, `favoritePhrases`, `favoriteWords`, `favoriteIrregular` | `string[]` of dataset ids | `state/progress.ts` |
| `progress` | `selectedLearnPassId` | `string` | `state/progress.ts` |
| `learnPasses` | Learn Pass id | `{ id, name, description, blockIds, createdAt, updatedAt }` | `state/progress.ts` |
| `flashcardSessions` | deck key (`all` or `topic:<category>`) | `{ order: string[], index: number }` | `state/progress.ts` |
| `settings` | setting name | one value per record | `state/settings.ts` |

Setting names: `theme`, `speechRepeatCount`, `activePage`, `phraseCategory`, `wordCategory`, `irregularSet`, `irregularGroup`, `indexTagFilter`, `showHiddenPhrases`, `showHiddenWords`, `showHiddenIrregular`, `indexPageSize`, `phrasePageSize`, `wordPageSize`, `irregularPageSize`, `indexLearnPassExpanded`, `indexLearningBlocksExpanded`, `indexTagCloudExpanded`, `indexDailyExpanded`, `flashcardMode`, `flashcardTopic`.

Rules:

- A record exists only after its value has changed at least once. A missing record means "default".
- Entries are identified by dataset ids (`phrase-001`, `word-phrase-001`, `iv-001-be`, block ids). `learnedPhrases` holds phrase ids, and word ids for flashcards that have no phrase. This model is inherited from the flashcards feature.
- Built-in content is not copied into IndexedDB.
- Not saved: search text, current page numbers, practice prompt, search structures.
- Startup: the database is opened and read in one transaction, the services replace their defaults with the saved records, and only then are they connected to storage. Nothing is written during startup.
- A failed open or read stops startup with an error screen. Defaults are never written over data that could not be read.
- Malformed records are repaired or ignored when read (for example a non-string id in a list, an unknown page size).
- All changes made in one tick are saved in one transaction. `saved` is reported only after that transaction completes. A failed transaction is rolled back, its changes stay queued, and the next change or **Try saving again** saves them.
- **Reset progress** (Index page) clears the progress records and returns the settings to their defaults, except the theme. It touches only this database.
- v2 does not read, write, or clear `localStorage`.

## 6. Checks performed

All commands were run on Windows 11 with Node 24.18.0 and npm 11.17.0 (CI uses Node 22).

| Command | Result |
|---|---|
| `npm run check` | svelte-check: 207 files, 0 errors, 0 warnings |
| `npm test` | 5 files, 96 tests passed |
| `npm run check:v1` | svelte-check: 189 files, 0 errors, 0 warnings |
| `npm run test:v1` | 3 files, 68 tests passed (the original v1 suite, unchanged) |
| `npm run build` | v2 production build succeeded (154 modules) |
| `npm run build:v1` | v1 production build succeeded (143 modules) |
| `npm run assemble` | `site-dist/` and `site-dist/v1/` created |
| `npm run check:site` | passed: both `index.html` files, their `assets/`, `data/materials.json` and `favicon.svg` exist, and each entry page references only its own assets |
| `npm ci` in clean copies of both `package.json` + lockfile pairs | both succeeded |
| `npx vite preview --outDir site-dist` plus HTTP requests | 200 for `/eng-trainer/`, `/eng-trainer/v1/`, and each app's script, stylesheet, `data/materials.json` and `favicon.svg` |
| Search of the built bundles | the v2 bundle contains no `localStorage`, `sessionStorage` or `serviceWorker`; it contains `eng-trainer-v2` |
| File-by-file comparison of `v1/` with `45564ca` | only `package.json` and `vite.config.ts` differ |

Tests: the three existing suites were kept. The flashcard logic suite is unchanged apart from import paths. The flashcards page suite keeps all 26 tests and now seeds IndexedDB where it used to seed `localStorage`. The progress suite was rewritten for IndexedDB: tests that asserted `localStorage` contents and compatibility with older saved data were replaced by tests for the same behavior in IndexedDB, plus tests for storage failures and isolation from `localStorage`. New suites cover the catalog and a jsdom smoke run of the shell.

Not done:

- No browser testing of any kind. The tests run in jsdom with an in-memory IndexedDB.
- The workflow was not run and was not checked with a YAML or Actions linter. It was reviewed by reading only.
- `npm ci` was not run in the working copy of the root project. VS Code's Svelte extension held `esbuild.exe`, so the lockfile was verified in a clean copy.

## 7. Known limitations and open points

1. **Theme at startup.** The system theme is shown until the settings have been read from IndexedDB. A user who chose a theme different from the system one may see a short flash on load. This follows from the rule that v2 keeps nothing in `localStorage`.
2. **Behavior change: transient state.** Search text, the current page of each list and the practice prompt are no longer restored after a reload. Filters (category, verb set, group, tag), page sizes, panels and the last screen are restored.
3. **Existing users.** After deployment the root address shows v2 with empty progress. Earlier progress stays in `localStorage`, and v1 at `/eng-trainer/v1/` reads the same keys on the same origin, so earlier progress should appear there. This was not verified in a browser.
4. **Reset progress has no confirmation** and also resets preferences other than the theme. Both match v1.
5. **Several tabs.** Each v2 tab keeps its state in memory and saves the records it changes. Tabs do not see each other's changes until reload. If two tabs change the same record, the last write wins.
6. **Continue without saving** is offered when storage cannot be opened. The app then runs on defaults, shows a permanent notice, and writes nothing.
7. **The link from v2 to v1** works in the assembled site. In the v2 dev server it leads to a missing page.
8. **v1 has no link to v2.** v1 was left as it was.
9. **Patterns, answers and drills have no ids** in the dataset. No saved state refers to them.
10. **Line endings.** Six baseline files are committed with CRLF. With `core.autocrlf=true` Git may normalize their copies in `v1/` when they are committed. The text is identical.
11. **Action versions** (`checkout@v6`, `setup-node@v6`, `configure-pages@v6`, `upload-pages-artifact@v5`, `deploy-pages@v5`) are the ones the existing workflow already used. They were not changed.

## 8. GitHub Pages: prepared, not applied

The workflow file is changed. No repository setting was changed, nothing was merged, and no deployment was triggered.

To confirm in the repository settings before the first merge:

- **Settings → Pages → Source** is "GitHub Actions". The previous workflow already required this.
- **Settings → Environments → github-pages → Deployment branches** allows only `main`. The workflow also refuses to deploy from any other ref.
- If branch protection uses required checks, the check to require is `Check, build and assemble` (the job name changed; the old job was `deploy`).

Workflow behavior (`.github/workflows/deploy.yml`, the only Pages publisher):

| Event | Checks, builds, assembly | Upload and deploy |
|---|---|---|
| Pull request to `main` | yes | no |
| Push to `main` | yes | yes, one artifact (`site-dist`), one deployment |
| Manual run on `main` | yes | yes |
| Manual run on another branch | yes | no |

The `deploy` job needs the `build` job. Deployments share the concurrency group `pages` and are not cancelled while running. Both applications are rebuilt on every run.

## 9. What to verify

**Entry addresses and paths**

- [ ] `/eng-trainer/` opens v2 and `/eng-trainer/v1/` opens v1, from the assembled site.
- [ ] Each app loads its own script, stylesheet, favicon and `data/materials.json` from its own path (network panel: no request from v2 goes under `/v1/`, and none from v1 goes outside `/v1/`).
- [ ] Opening a v2 address with a hash (for example `/eng-trainer/#phrases`) opens that screen. The same in v1.
- [ ] Reloading either app on any screen stays in that app.

**Link from v2 to v1**

- [ ] The link at the bottom of every v2 screen opens v1.
- [ ] The link is visible and usable on a phone, above the bottom navigation.

**Search**

- [ ] Phrases, Words and Verbs search finds items that are not on the current page and items in sections not opened in this session.
- [ ] Search matches translations, examples, alternatives, categories and tags, as in v1.
- [ ] The material search in the Learn Pass builder finds blocks by title, description, type, category and tag.
- [ ] Search combined with category, group, verb set and "show hidden" gives the same results as v1.

**Learning and speech flows**

- [ ] Index: Learn Pass create, edit, delete, select; tag cloud; pagination; phrase or word of the day; opening a block.
- [ ] Phrases, Words, Verbs: filters, pagination, learned, hide and unhide, Focus List buttons.
- [ ] Flashcards: swipe, buttons, keyboard, All Vocabulary and By Topic, review list, Learn again, deck reset.
- [ ] Reverse practice, Patterns, Answers, Practice screens.
- [ ] Focus List screen shows blocks, phrases, words and verbs and opens blocks.
- [ ] Single-item speech and "Listen" section playback with 10, 20 and 50 repeats, including Stop. Speech was not exercised by any automated test.

**Persistence after reload**

- [ ] Learned and hidden items, Focus List, Learn Passes and the selected pass.
- [ ] Flashcard deck, position in the round, learned cards.
- [ ] Theme, speech repeats, categories, verb set and group, tag filter, page sizes, expanded panels, "show hidden", last screen.
- [ ] Search text, page numbers and the practice prompt are empty after reload (intended).

**No localStorage in v2**

- [ ] With DevTools open on v2, `localStorage` stays empty through a full session, including theme changes and Reset progress.
- [ ] IndexedDB shows the database `eng-trainer-v2` with the four stores in section 5.
- [ ] v2 does not pick up progress that exists in v1.

**Loading and storage errors**

- [ ] Content request blocked or failing: error screen with **Try again**, which recovers.
- [ ] IndexedDB unavailable (for example blocked site data, or a private window in a browser that denies it): the storage error screen appears, **Try again** and **Continue without saving** work, and the "Saving is off" notice stays visible.
- [ ] A failed write (for example storage quota set very low in DevTools): the "not saved" notice appears and **Try saving again** clears it once writing works.
- [ ] Theme flash on load with a non-system theme: judge whether it is acceptable (limitation 1).

**Isolation between the applications**

- [ ] **Reset progress** in v2 leaves v1 progress unchanged.
- [ ] **Reset progress** in v1 leaves v2 progress unchanged.
- [ ] Clearing the `eng-trainer-v2` database does not affect v1. Clearing v1's `localStorage` keys does not affect v2.
- [ ] Progress made on the live site before this change is visible in v1 after deployment (limitation 3).

**Assembled site and workflow**

- [ ] `npm run build:site` from a clean clone (after `npm ci` and `npm run install:v1`) produces `site-dist/` with `index.html`, `assets/`, `data/`, and the same under `v1/`, and no source files.
- [ ] A pull request to `main` runs the job and publishes nothing.
- [ ] After merge, one run on `main` uploads one artifact and makes one deployment that serves both applications.
- [ ] A manual run from a branch other than `main` does not deploy.

## 10. Corrective iteration ENG-V2-01-RC1

Date: 2026-11-21. Scope: the two confirmed findings of `docs/reviews/ENG-V2-01-ASTRA.md`, nothing else. Status: both corrected, checks pass, native-browser scenarios run in Chromium and Firefox. Ready for re-review.

Not changed in this iteration: `v1/`, the module structure, the database schema, the workflow, dependencies and lockfiles. v2 still uses no `localStorage`. Astra's report and evidence under `docs/reviews/` were not edited.

### 10.1 F1 — flashcard identity

**Root cause.** `buildFlashcards` created cards by display text with punctuation and case removed. Phrases with the same normalized text shared one card, and a word-index entry could join a card by text. The card then carried several ids (`learnIds`): "I know it" saved all of them, and the card counted as learned when any one of them was learned. The Phrases page and the Focus List check one id each, so the views disagreed, and distinct entries such as `C++` and `C#` were learned together.

**Correction.** Identity now comes from dataset ids and the explicit link only:

| Rule | Detail |
|---|---|
| One phrase, one card | The card id is the phrase id. Phrases are never joined by text. |
| Linked word-index entry | An entry whose `sourcePhraseId` names an existing phrase belongs to that phrase's card. This is the only way an entry joins a phrase. |
| Word-index entry without a phrase | No `sourcePhraseId`, or one that names no phrase: the entry is its own card, and the card id is its word-index id. |
| Learned | A card is learned exactly when its own id is in `learnedPhrases`. For a phrase card that is the phrase id, the same id the Phrases page and the Focus List use. A linked word-index id is never written as progress. |
| Hidden | A card is left out when its phrase is hidden or one of its linked word-index entries is hidden. Unchanged. |
| One id, one card | If the content ever repeats an id, the first entry keeps the card and the later one gets none, so two cards cannot share progress. A catalog test keeps the built-in content free of this. |

The `Flashcard` type lost `phraseIds` and `learnIds`. It now has `phraseId` (one id or `null`) and `wordIds`. The page saves, relearns and resets with `card.id`. Text normalization is still used in one place, to decide whether a pronunciation hint differs from the term; it no longer takes part in identity.

**Visible effect.** In the built-in content six texts exist under two phrase ids each. They were one card each and are now two cards each, so All Vocabulary has 566 cards instead of 560:

| Text | Ids (category) |
|---|---|
| From my perspective, … | `phrase-005` (Start answer), `hedging-005-from-my-perspective` (Hedging Phrases) |
| That being said, … | `phrase-013` (Contrast), `advanced-linking-008-that-being-said` (Advanced Linking Words) |
| consequently / Consequently, … | `phrase-084` (Conjunctions), `advanced-linking-004-consequently` (Advanced Linking Words) |
| As a result,... / As a result, … | `presentation-phrase-085` (Presentation Phrases), `advanced-linking-009-as-a-result` (Advanced Linking Words) |
| More importantly,... / More importantly, … | `presentation-phrase-087` (Presentation Phrases), `advanced-linking-012-more-importantly` (Advanced Linking Words) |
| To some extent,... / To some extent, … | `presentation-phrase-088` (Presentation Phrases), `hedging-008-to-some-extent` (Hedging Phrases) |

All 566 word-index entries of the built-in content name an existing phrase, one entry per phrase, so every card is a phrase card today.

### 10.2 F2 — aborted read transaction

**Root cause.** `readAll` in `src/storage/database.ts` awaited the requests first and awaited `tx.done` only afterwards. When the transaction aborted, the request await rejected, the function left through `catch`, and the rejection of `tx.done` had no handler. A second gap had the same effect: a request issued just before a failing one was not tracked.

**Correction.** The completion promise is tracked when the transaction is created, every request is tracked when it is issued, and one `Promise.all` awaits all of them. On failure, a shared helper `releaseAfterFailure` aborts the transaction if it is still open and attaches handlers to the promises of that one transaction. The first error is still the one reported, wrapped in `StorageError('read' | 'write')`. The write path uses the same helper; its behavior is unchanged.

Unchanged and re-verified: the storage error screen, **Try again**, **Continue without saving**, and the rule that a failed read connects nothing to storage, so defaults cannot overwrite data that was not read.

### 10.3 Changed files

Compared with the SHA-256 inventory in Astra's `candidate.json` (the 127 files of the original reviewed candidate): 13 files changed, 114 unchanged, none under `v1/`.

| File | Change |
|---|---|
| `src/features/flashcards/flashcards.ts` | Identity by id and `sourcePhraseId`; no text merging |
| `src/features/flashcards/types.ts` | `phraseId` and `wordIds`; identity rules documented |
| `src/features/flashcards/FlashcardsPage.svelte` | Three calls use `card.id` |
| `src/storage/database.ts` | Read transaction handling; shared `releaseAfterFailure` |
| `src/features/flashcards/flashcards.test.ts` | Updated and new tests, see 10.4 |
| `src/features/flashcards/FlashcardsPage.test.ts` | Updated and new tests, see 10.4 |
| `src/app/App.test.ts` | Four new tests, see 10.4 |
| `src/state/progress.test.ts` | One new test |
| `src/content/catalog.test.ts` | Two new tests |
| `src/test/database.ts` | Helpers: asynchronous read abort, unhandled-rejection watcher |
| `README.md`, `CHANGELOG.md` | Flashcard identity and the two fixes described |
| `docs/handoffs/ENG-V2-01.md` | This handoff: the update note at the top and section 10 |

Added outside that inventory: the new evidence folder `docs/reviews/eng-v2-01-rc1-fable/`.

*Corrected after the re-review:* this section first said 12 changed and 115 unchanged, and counted the handoff as outside the inventory. The handoff is one of the 127 files. The counts above are the ones Astra confirmed in `docs/reviews/ENG-V2-01-RC1-ASTRA.md`.

### 10.4 Regression tests

`npm test` went from 96 to 118 tests.

**Case A, shipped entries `phrase-084` and `advanced-linking-004-consequently`**

- `App.test.ts`: mark the first learned, add the second to Focus, reload. Focus and Phrases show the second as not learned. Advanced Linking Words has 0 learned and an empty review list, Conjunctions and All Vocabulary have 1 learned (`consequently`). The database holds `learnedPhrases: ['phrase-084']` only.
- `flashcards.test.ts`: the two are separate cards with one topic each; every built-in entry whose text exists under another id is its own card.

**Case B, Astra's fixture `review-cpp` (`C++`) and `review-csharp` (`C#`)**

- `App.test.ts`: two phrase cards and two flashcards. Learning `C++` saves only `review-cpp`. After a reload `C#` is still to learn on Phrases and on Flashcards, and can then be learned on its own.
- `flashcards.test.ts`: entries that differ only in punctuation or case are separate cards; identical text under two ids is two cards.
- `FlashcardsPage.test.ts`: the fixture entry `p4` is now `Good morning!` next to `p1` `Good morning`. Learning one leaves the other to learn, also after a reload.

**Case C, explicit phrase and word-index link**

- `flashcards.test.ts`: a linked entry joins its phrase card even when the texts differ; an entry with the same text and no link does not join; a link to a missing phrase makes a separate card; several entries linked to one phrase stay on that card; a phrase card is not learned through its word-index id; a card without a phrase is learned through its own id; repeated ids never produce two cards.
- `App.test.ts`: "I know it" on the first built-in card saves the phrase id and no word-index id. Phrases shows it learned; unlearning it there returns it to the deck; hiding the linked word-index entry removes exactly that one card.
- `catalog.test.ts`: phrase and word-index ids are unique together; every `sourcePhraseId` names an existing phrase.

**F2**

- `progress.test.ts`: a read transaction that is aborted asynchronously from a successful request (the same injection Astra used, on the in-memory IndexedDB). Startup rejects with `StorageError('read')`, no unhandled rejection occurs, the database is unchanged, a change made afterwards is not saved, and a second `initState()` loads the saved progress and settings. This test failed before the correction with one unhandled `DOMException`.
- `App.test.ts`: the same abort at application level. The storage error screen appears, no unhandled rejection occurs, the database is unchanged, and **Try again** restores the saved screen, learned state and theme.

**Existing tests that changed, and why.** Tests that asserted the old merging now assert the corrected rule: "merges the same text listed in two categories", "never shows the same vocabulary item twice" (it required unique texts), "keeps the learned status the same in every topic deck", and the page tests whose counts and learned ids followed from the merged `Good morning` card (3 cards and `['p1', 'p4']` became 4 cards and `['p1']`). No interaction, deck, hidden-state or reload test was removed. The page suite has 27 tests (was 26) and the logic suite 44 (was 30).

### 10.5 Commands and results

Windows 11, Node 24.18.0, npm 11.17.0. Logs: `docs/reviews/eng-v2-01-rc1-fable/logs/`.

| Command | Result |
|---|---|
| `npm run check` | 207 files, 0 errors, 0 warnings |
| `npm test` | 5 files, 118 tests passed, no unhandled errors |
| `npm run check:v1` | 189 files, 0 errors, 0 warnings |
| `npm run test:v1` | 3 files, 68 tests passed |
| `npm run build:site` | v2 build (154 modules), v1 build (143 modules), assembly and structural check passed |

`npm run build:site` includes `npm run build`. The browser runs below used the `site-dist/` produced by this run.

### 10.6 Native browser outcomes

Tooling: Astra's `browser-review.mjs` and `browser-support.mjs`, unmodified, with Playwright 1.62.1 installed in a temporary folder outside the repository. Browsers: Chromium 151.0.7922.34 and Firefox 153.0, headless, isolated contexts. Target: the assembled `site-dist/` served by Astra's static server. New evidence is in `docs/reviews/eng-v2-01-rc1-fable/`; Astra's evidence folder was not written to.

Astra's full suite, 17 scenario groups per engine:

| Scenario | Review | Now (both engines) |
|---|---|---|
| `failed-initial-read-preserves-populated-database` (F2) | FAIL | **PASS**. The first transaction is recorded as `readonly:abort`, no page error, no write, database unchanged, Retry loads the saved state |
| `built-in-duplicate-entry-consistency` (F1) | FAIL | **PASS**. Focus shows the entry unlearned, topic learned count 0, review list empty, database `['phrase-084']` |
| `distinct-entry-identities-with-similar-display-text` (F1) | FAIL | **FAIL as scripted, behavior corrected.** See below |
| The other 14 groups | PASS | PASS |

Totals: 16 of 17 in Chromium and 16 of 17 in Firefox, with no uncaught page error in any scenario.

**The remaining FAIL.** That scenario presses "I know it" once and then waits for the heading "Deck complete" before it reads the database. The heading appeared in the review only because `C++` and `C#` were one card. With two cards the deck continues with `C#`, so the wait times out and the scenario never reaches its own assertion. Its recording shows the corrected behavior: `cardCount` is 2, and the only learned write is `["review-cpp"]` with the remaining sequence `["review-csharp"]`. The script was left as it is. For re-review, the wait in that scenario needs to target the next card instead of "Deck complete".

To cover what that scenario could not reach, `docs/reviews/eng-v2-01-rc1-fable/identity-supplement.mjs` runs three scenarios with the same server, instrumentation and fixture. All three pass in both engines:

| Supplemental scenario | What it asserts |
|---|---|
| `distinct-similar-entries-stay-independent` | Astra's `C++`/`C#` fixture: two cards; learning `C++` saves `['review-cpp']` and does not complete the deck; after reload only `C++` is learned on Phrases, Flashcards and in the review list; `C#` is then learned on its own; unlearning `C++` on Phrases returns only that card |
| `built-in-duplicate-counts-agree-in-every-deck` | Case A in Focus, Advanced Linking Words (0 learned), Conjunctions (1), All Vocabulary (1 of 566); then learning the Focus entry from its own card saves exactly its id |
| `phrase-and-linked-word-are-one-identity` | Case C: one answer saves the phrase id and no word-index id; Phrases agrees after reload; unlearning returns the card; hiding the linked word-index entry removes one card |

Run it the same way as Astra's script:

```text
node docs/reviews/eng-v2-01-rc1-fable/identity-supplement.mjs <candidate-root> <tools-directory-containing-node_modules> <evidence-directory>
```

In Firefox the supplement records, and does not fail on, a console message about an interrupted download of the icon font from `fonts.gstatic.com` when a page is reloaded. Any other console error fails a supplemental scenario.

Evidence files: `browser-chromium.json`, `browser-firefox.json` and `astra-suite-run.log` (Astra's suite), `identity-supplement-chromium.json` and `identity-supplement-firefox.json` (supplement), `artifact.json` (hashes of the tested `site-dist/`), two screenshots of the remaining FAIL, and `logs/`.

### 10.7 Remaining limitations

1. **Astra's `C++`/`C#` scenario still reports FAIL** for the reason in 10.6. The behavior it was written to check is verified by its own recording and by the supplement.
2. **Six texts appear twice in All Vocabulary** (table in 10.1). This follows from treating separate ids as separate learning entries. The dataset has no field that declares two phrases to be one entry. If they should be one, the content needs an explicit link or the duplicates need to be removed from the content; neither is part of this iteration.
3. **Phrase ids and word-index ids share one id space** in `learnedPhrases` and in card ids. The built-in content keeps them unique, a catalog test checks this, and the card builder refuses a second card for an id.
4. **The unit-level read-abort regression uses the in-memory IndexedDB.** The abort itself is asynchronous and real for that implementation. The native check is Astra's scenario, which passes in both engines.
5. Still not tested, as in the review: Safari and WebKit, real mobile devices, audible speech, natural quota exhaustion, abrupt termination during a write, several tabs, Node 22 on Ubuntu, an actual GitHub Actions run and a live Pages deployment.
6. Sections 7 and 8 of this handoff still apply.

### 10.8 Git state

| Item | Value |
|---|---|
| Branch | `feature/eng-v2-01-modular-foundation`, local only |
| HEAD | `45564ca` (unchanged) |
| Index | empty; nothing staged |
| Commits, stashes, pushes | none |
| Tracked changes | 11 modified, 40 deleted (the old `src/App.svelte` and `src/lib/**`): the same 51 paths as at the review |
| Untracked | `docs/`, `package-lock.json`, `scripts/`, `src/app/`, `src/content/`, `src/features/`, `src/shared/`, `src/state/`, `src/storage/`, `src/test/`, `v1/` |
| Ignored build output | `dist/`, `v1/dist/`, `site-dist/`, both `node_modules/` |

Both lockfiles are unchanged since the review and still have to be committed with the implementation.
