# ENG-V2-UX-01B — Implementation handoff

| | |
|---|---|
| Date | 22 November 2026 |
| Developer | Fable (Claude Code) |
| Status | **Implemented and validated locally; ready for Astra's independent review.** Nothing was committed, staged, pushed, merged or deployed. |
| Direction | Concept B, “Spoken Line”, from the [UX-01A proposal](../design/ENG-V2-UX-01A.md), approved by the owner |
| Evidence | [`docs/evidence/eng-v2-ux-01b/`](../evidence/eng-v2-ux-01b/README.md) |

## 1. Baseline and preserved work

- **Baseline.** The baseline is `f14dd4e33de2dfcbd8b80e1b72dbfec4326823d3`, the ENG-V2-02B merge (#4). The branch is `feature/eng-v2-ux-01b-spoken-line`, taken from that commit; HEAD is still the baseline.
- **Pre-existing untracked files.** 101 files were fingerprinted before any change and are all byte-identical now ([`preservation.json`](../evidence/eng-v2-ux-01b/preservation.json)):
  - 45 ENG-V2-02A/02B release files under `docs/releases/`
  - the 56 files of the ENG-V2-UX-01A design proposal under `docs/design/`
- **Unchanged.** No historical review, report, screenshot, inventory or review script was edited. The v1 source, built-in content, workflow, dependencies and lockfiles are unchanged.
- **Instructions followed.** The parent `AGENTS.md` describes Angular web-school work; the explicit eng-trainer request governs this Svelte milestone. Its rules were followed: work only in this repository, no commits, and `npm run build` before reporting.
- **Tools.**
  - Browser checks reused the Playwright 1.65.1 runner and its browsers from the ENG-V2-02B release folder (`.git/eng-v2-02b-release/`), read-only.
  - The design skills were the ones already enabled.
  - Nothing was installed or reconfigured.

## 2. Owner decisions and how they were applied

| Decision | Applied as |
|---|---|
| Concept B; compact rows may follow Concept C | Literata study lines with Source Sans 3 interface text. Vocabulary is shown as compact rows: a round Listen button, then the term, translation, transcription, metadata and labelled actions. |
| Navigation: Home, Library, Practice, Focus, More | Phones: a bottom tab bar, with More as a sheet. Wide screens (from 900 px): a side navigation. Library and Practice use section tabs. Every earlier `#` route still works (§4). |
| Self-hosted fonts | Literata (Latin, roman and italic) and Source Sans 3 (Latin, Latin Extended, Cyrillic, Greek) as Google's own WOFF2 subsets with `unicode-range` and `font-display: swap`. Licences are published at `/eng-trainer/fonts/`; provenance and checksums are in `src/assets/fonts/README.md`. There are no Google requests. |
| Bundled SVG icons instead of Material Symbols | About 40 original icons in `src/shared/ui/icons.ts`, rendered by `Icon.svelte`. The 3.1 MB icon font, and the raw icon names it showed while loading, are gone. |
| Simple, consistent English UI copy | One wording per action, used throughout. Examples: **Hide**/**Show**, **Undo**, “Reset progress for …”, “Import N entries”. Errors explain what happened and what to do next. Developer wording (`npm`, generator names) was removed from user screens. |
| Mark known Ukrainian; do not assume imported translations are Ukrainian | Built-in translations: `lang="uk"`. Imported translations: `lang=""`, via `translationLang()`, keyed on the collection. English study text: `lang="en"` and `translate="no"`. The application chrome is not marked `translate="no"`. |
| Theme: IndexedDB only, with the startup mitigation | The theme is still read from IndexedDB. Colour transitions are switched on (`data-theme-ready`) only after the saved theme is applied, and the loader is minimal. No `localStorage` or cookies. |
| Reset moves to More → Settings, with an explicit confirmation | `#settings` → **Reset learning progress…**. The dialog's list comes from `RESET_PROGRESS_SUMMARY`; a test checks that it covers every state field and preference. Focus starts on **Cancel**, and Cancel or Escape changes nothing. |

## 3. Changes by area, in three reviewable steps

The steps describe review order and grouping; they are not separate commits. [`candidate.json`](../evidence/eng-v2-ux-01b/candidate.json) lists every changed or new file with its hash.

### Step 1 — Foundation, shell and startup

| Area | Files | Change |
|---|---|---|
| Tokens and base | `src/styles/tokens.css`, `base.css`, `fonts.css`, `src/app.css` | Semantic colour roles for light and dark, a type scale, spacing, radii, `--target: 44px`, motion and layers. A 2 px focus ring (§7). Skip link. `scroll-padding` above the tab bar. Reduced motion. The old global styles are replaced. |
| Fonts | `src/assets/fonts/*`, `public/fonts/OFL-*.txt`, `index.html` | Six WOFF2 subsets (296 KB in total; a typical screen loads 133–193 KB). Google Fonts links removed. |
| Shared controls | `src/shared/ui/`: `Button`, `IconButton`, `Icon`, `icons.ts`, `Notice`, `ConfirmDialog`, `ToastRegion`/`toast.ts`, `SearchField`, `EmptyState`, `PaginationControls`, `CollectionFilter` | One button system (primary, secondary, quiet, danger, known, focus) with a visible label or an `aria-label` that contains it. Notices are distinguished by icon and title, not colour alone. Native `<dialog>`, with focus on Cancel and restored to the opener. One persistent polite live region for messages with **Undo**. `MaterialIcon.svelte` was deleted. |
| Shell and navigation | `src/app/AppShell.svelte`, `navigation.ts`, `ThemeToggle.svelte`, `theme.ts` | The banner is removed. Five destinations, with `aria-current` in every navigation. More is a button (`aria-haspopup="dialog"`, `aria-expanded`); its sheet contains real links. Each new screen starts at the top, with focus on its `h1`. The space kept free above the phone tab bar follows its measured height, and keyboard focus is kept above it. The v1 link is in the side navigation, the More sheet and Settings. |
| Startup | `src/app/App.svelte` | Loading, blocked-upgrade, storage-error and content-error screens use plain wording; technical details sit behind a disclosure. F4: see §6. |
| Settings | `src/features/settings/SettingsPage.svelte` | Theme, listening repeats, a Collections link, Reset learning progress and the previous version. |
| Build check | `scripts/check-site.mjs` | Adds a v2 font section: it rejects Google Fonts references, requires every declared WOFF2 under `/eng-trainer/assets/` and requires both licences. Historical inventories are untouched. |

### Step 2 — Study screens and safeguards

| Area | Files | Change |
|---|---|---|
| Vocabulary rows | `src/shared/entries/PhraseCard`, `WordCard`, `IrregularVerbCard`, `FocusButton`, `HideButton`, `EntryExamples`; `src/shared/speech/*` | The term is a heading (`h3`). Visible **Focus**, **Mark as learned**/**Learned** and **Hide**/**Show** labels. Examples and alternatives sit in a disclosure. A word whose “pronunciation” repeats the term no longer shows it twice. |
| Library pages | `src/features/vocabulary/*` | A toolbar with search, filters and a **Show hidden (N)** toggle. A live count. The first entry is within 250 px of the top on a phone (§8). **Unhide all** keeps the RC1 scope and now asks for confirmation. |
| Home, Focus and exercises | `src/features/home/*`, `focus/*`, `exercises/*` | Reset is removed from Home. Learn Pass deletion uses the dialog, not `window.confirm`. Focus items are grouped under headings. Reverse practice has labelled **Check answer**, **Show answer** and **Next phrase** buttons and a status region. |
| Flashcards | `src/features/flashcards/FlashcardsPage.svelte` | The answer buttons (**Keep learning**, **Flip card**, **I know it**) are on the first screen on phones and desktops. **Reset progress for …** moved from the toolbar to the learned list and the Deck complete screen, behind a dialog. **Learn again** offers **Undo**. Swipe, arrow-key and session logic are unchanged. |
| State helpers | `src/state/index.ts`, `progress.ts`, `settings.ts`, `src/shared/text.ts` | `RESET_PROGRESS_SUMMARY`; `PROGRESS_KEYS` and `SETTING_KEYS` exported for the coverage test; `translationLang()`. No new state fields. |

### Step 3 — Collections, import guidance and F3–F6

| Area | Files | Change |
|---|---|---|
| Import guidance | `src/collections/importGuide.ts`, `src/features/collections/ImportHelp.svelte` | See §5. |
| Typed errors | `src/collections/format.ts`, `service.ts`, `src/storage/database.ts`, `src/features/collections/importFeedback.ts` | `ImportError` codes, `FieldError` fields, `StorageError` kinds and `CollectionError` kinds. Every parser message is unchanged. The page turns each code or kind into its own message, shown next to the action. |
| File selection (F3) | `src/features/collections/CollectionsPage.svelte` | Each selection gets a number, and only the latest may update the preview, messages or focus. The picker stays enabled while a file is read. **Cancel** invalidates pending work. Focus moves to the review heading or the error summary. The input is cleared after each selection, so the same corrected file can be chosen again. Whole-file validation stays: nothing is saved until the import is confirmed. |
| Blocked upgrade (F4) | `src/storage/database.ts`, `src/app/App.svelte`, `src/state/index.ts` | See §6. |
| Conflict wording (F5) | `importFeedback.ts`, `CollectionsPage.svelte` | Conflict, stale, unavailable, busy, quota and storage failures are worded separately, for the action that failed (import, rename, removal, export). Storage-space advice appears only for quota failures. A conflict offers **Reload page**. Success is reported only after the transaction completes. |
| Export names (F6) | `src/collections/fileName.ts` | `Мої слова` → `Мої-слова-2026-11-22.json` (rules in [USER-COLLECTIONS.md](../architecture/USER-COLLECTIONS.md)). |
| Downloads | `src/shared/download.ts` | One helper for the template and exports. |

### Tests added or changed

There are 54 new Vitest tests: 193 at the ENG-V2-02B-RC1 baseline, 247 now. No earlier test was removed. Changed tests keep their assertions; only selectors and flows follow the new interface.

| File | Tests | Covers |
|---|---|---|
| `src/collections/importGuide.test.ts` | 8 (new) | The displayed example, the template and Copy share one source, and the template adds a UTF-8 byte-order mark. The limits come from the import contract. The detailed and semicolon examples parse as described, as do the stated columns, kinds and default. The JSON reference is a valid native export with fresh identities each time. |
| `src/collections/importErrors.test.ts` | 10 (new) | Every `ImportError` code. Parser messages are unchanged. Field and record locations, missing and unsupported columns, and when technical detail is shown. |
| `src/collections/fileName.test.ts` | 6 (new) | Cyrillic letters and digits, distinct names giving distinct files, path separators and reserved and control characters, the 80-character cap without splitting a character, Windows device names, and the fallback. |
| `src/collections/serviceErrors.test.ts` | 4 (new) | `CollectionError` kinds for conflict, quota, storage and unavailable. Nothing is saved on failure. |
| `src/storage/openStorage.test.ts` | 4 (new) | A blocked open waits and then recovers. A retry joins the open request, with one `indexedDB.open` and the latest caller winning. Abort closes a late connection. Callers without `onBlocked` keep the old behaviour. |
| `src/state/reset.test.ts` | 2 (new) | The reset summary covers every progress and settings key. Reset keeps collections and the theme. |
| `src/features/collections/CollectionsPage.test.ts` | 7 (new) | The help card shows formats, encoding, columns, limits and the example without writing anything. F3: the picker stays usable while reading, the latest selection wins, a cancelled selection never comes back, focus moves to the review or the error summary, and the same corrected file can be chosen again. Success is reported only after the transaction. F5: the rename conflict appears next to the form. F6: the export file name. |
| `src/app/navigation.test.ts` | 3 (new) | Every released route maps to one destination; `#practice` sits in Practice; the pages offered for a Learn Pass. |
| `src/shared/entries/hideUndo.test.ts` | 2 (new) | Undo is an entry-level inverse, other lists are untouched, and **Show** is permanent. |
| `src/app/App.test.ts` | 21 (7 new) | Blocked start-up: guidance on Check again, automatic recovery, a late connection after Continue without saving. The Settings reset dialog. Language marking. The More sheet. `aria-current` and heading focus. Keyboard focus after Hide and after Undo. |
| `src/features/flashcards/FlashcardsPage.test.ts` | 28 (1 new) | Learn-again Undo restores exactly the earlier state. Deck reset goes through the dialog. |
| `src/features/collections/retainedLearning.test.ts` | changed | Reset and Unhide all now go through their confirmations; the retention assertions are unchanged. |

## 4. Route map

| Destination | Screens and routes | Notes |
|---|---|---|
| Home | Home `#index` | Learn Pass, Topics, Learning blocks, Phrase or word of the day. Reset was removed from here. |
| Library | Phrases `#phrases`, Words `#wordIndex`, Verbs `#irregularVerbs`, Patterns `#patterns`, Answers `#answers` | Section tabs, plus an **Import words** link to `#collections`. |
| Practice | Flashcards `#flashcards`, Reverse practice `#reverse`, Speaking prompts `#practice` | `#practice` keeps its address, under its own name. |
| Focus | Focus list `#favorites` | Shows the item count. |
| More | Collections `#collections`, Settings `#settings` (new), Previous version (v1) | On phones, a button that opens a sheet of links. On wide screens, a group in the side navigation. |

Every route released by ENG-V2-02B still opens the same screen. Saved “last page” values use the same identifiers. `availablePagesFor()` always offers Focus, Collections and Settings, plus the screens of the active Learn Pass. `navigation.test.ts` checks that each route maps to exactly one destination.

## 5. Import guidance and the CSV template

- **Card.** A compact **How to prepare your file** card sits next to the picker on wide screens and below it on phones. It does not recreate the old introduction. It shows:
  - the formats (CSV, or a JSON file exported from eng-trainer)
  - the encoding (UTF-8)
  - the required columns, `english` and `translation`
  - the limits, read from the parser's constants (2 MiB, 1,000 entries)
  - the example `english,translation` / `reliable,надійний` / `improve,покращувати`
- **Template and Copy.** Both use the same constant as the example on screen.
  - **Download CSV template** saves the text with a UTF-8 byte-order mark as `eng-trainer-vocabulary-template.csv`.
  - **Copy example** copies it, and falls back to a message when the clipboard is unavailable.
  - In both engines the downloaded file equals the displayed text, and the text handed to the clipboard equals it too.
  - Neither action reads or writes saved data.
- **More format details** (a native `<details>`) covers:
  - comma and semicolon separators
  - required and optional columns (`topic`, `example`, `kind`)
  - kinds (`word`, `phrase`; default `word`)
  - header rules and quoting rules, with a fuller example that has an explicit phrase and quoted commas and quotes. A test parses this example exactly as described.
  - blank lines and record numbering, and whole-file validation
  - spreadsheet export as **CSV UTF-8** in Excel and Google Sheets; `.xlsx`, PDFs and images are not accepted
- **JSON.**
  - CSV is presented as the simple way to create a collection.
  - The required sentence is used verbatim: “For JSON, choose a file exported from eng-trainer. Other JSON structures are not supported.”
  - Reimport keeps identities, an unchanged reimport changes nothing, and a changed entry under an existing identity is blocked as a conflict, not an overwrite.
  - The reference example is produced by the real exporter, with identities created when the page opens. There is no reusable JSON template with shared identities.
- **Errors.**
  - Each `ImportError` code has its own title and fix. A missing column names the column and offers the template.
  - Damaged JSON, JSON that is not an eng-trainer export, an invalid export, unsupported types, encoding problems and size or count limits are all distinguished.
  - Row problems use the parser's own numbering: “Record 3, column “translation”: …” for CSV, counting the header as record 1 (not line numbers); “Entry 2, field “translation”: …” for JSON.
  - Technical detail is shown only when it adds information, such as the JSON syntax position.

## 6. Persistence, identity and learning preservation

- **Database.** `eng-trainer-v2`, version **2**, with the same six stores, explicit string keys and record shapes. There is no migration and no new progress or settings field; the state diff only exports `PROGRESS_KEYS` and `SETTING_KEYS`.
- **Browser storage.** v2 source has no `localStorage`, `sessionStorage` or `document.cookie`.
- **Identities.** Built-in IDs, order and links are unchanged (`verify:content`). Collection and entry identity rules and the native JSON format are unchanged.
- **Transactions.** Collection writes keep one transaction with a condition read. The interface reports a result only after `tx.done` or a failure. Optimistic UI was not generalised: progress keeps the existing save queue and notice.
- **Retention.** Deletion still keeps progress, hidden flags, Focus and deck slots. **Unhide all** keeps the RC1 scope (catalog-known hidden IDs, regardless of filters).
- **Hide and Undo.**
  - Undo is an entry-level inverse with no snapshot: it shows the entry again, and re-adds Focus or the learned flag only if hiding removed them and they are still absent.
  - Other lists are untouched (`hideUndo.test.ts`). **Show** stays on every hidden entry, with no time limit.
  - Keyboard focus follows the list: after hiding, it moves to the entry that took the hidden one's place; Undo returns it to the restored entry (`App.test.ts`, and both browsers).
- **Learn again and Undo.**
  - Learn again only removes that card's learned flag (`relearnFlashcards`); deck order and position are not touched.
  - Undo restores only that flag, and only if it is missing. The test compares the whole saved state before Learn again with the state after Undo.
- **Reset learning progress** clears exactly the summary's items:
  - learned phrases
  - hidden lists
  - Focus
  - Learn Passes and the selected pass
  - flashcard positions
  - preferences other than the theme

  It keeps collections, the theme and the built-in material.
- **F4, the storage open coordinator.**
  - At most one IndexedDB open request is in flight. **Check again** joins it, so attempts never compete, and the latest waiter receives the connection.
  - The waiting guidance stays on screen (“Still waiting for the other tabs to close.”), and the app continues by itself when the other tab closes.
  - **Continue without saving** aborts this attempt. A connection that arrives later is closed, so saving stays off for the session. `initState()` also checks the abort signal before hydrating.
- **v1.** `git diff -- v1` is empty. The built v1 files equal the released artifact once Windows CRLF conversion is ignored, and its JavaScript and CSS are byte-identical ([`v1-preservation.json`](../evidence/eng-v2-ux-01b/v1-preservation.json)).

## 7. Accessibility work and its real testing level

- **Targets and focus.**
  - Interactive targets are at least 44 × 44 px.
    - The browser run enforces this on every screen at three widths, and in the More sheet, dialogs, Undo message, import help and error, and startup screens.
    - Links inside running text are exempt.
    - For radio buttons and the file picker, the clickable label is the target.
  - The focus ring is 2 px with a 2 px offset. Light theme: `#2c5bd6`, 5.44:1 on the page and 5.87:1 on surfaces. Dark theme: `#8db2ff`, 8.77:1 and 7.95:1.
  - Control borders are at least 3.44:1, and muted text at least 5.68:1.
  - The UX-01A amber ring measured 2.00–2.15:1.
- **Structure and messages.**
  - A skip link and one `h1` per screen.
  - Labelled landmarks and section navigation.
  - Field labels, and live regions for counts and messages.
  - Dialogs with an initial focus and focus restored on close.
  - `aria-pressed` toggles. Language marking as in §2. Reduced motion is respected.
- **Reflow and keyboard.**
  - Layouts reflow at 320 px and with 200 % text.
  - Keyboard focus is kept above the phone tab bar by `scroll-padding`, with a small focus handler for Firefox (§10).
- **Measurement.** These properties were measured by scripts in Chromium and Firefox and by component tests in jsdom (§8).
- **Assistive technology.** **No screen reader** (NVDA, JAWS, Narrator, VoiceOver or TalkBack), voice control, switch access, Windows contrast themes or physical phone were used. The accessibility-tree snapshots in the evidence are machine output. This is **not a WCAG conformance claim**.

## 8. Verification

**Environment.**
- Windows 11, Node 24.18.0 and npm 11.17.0.
- Browsers: Playwright 1.65.1 driving Chromium 159.0.8154.6 and Firefox 159.0, from the release runner, read-only.
- Final run: 21 November 2026, 23:53 UTC (22 November, local time).

Logs, results and reproduction steps are in the [evidence README](../evidence/eng-v2-ux-01b/README.md).

| Required check | Result |
|---|---|
| `npm run check` | **0 errors, 0 warnings** (243 files) |
| `npm test` | **10/10** content and build tests; **247/247** Vitest tests in 18 files (54 new, §3) |
| `npm run check:v1` / `npm run test:v1` | **0 errors, 0 warnings**; **68/68** |
| `npm run build` / `npm run build:site` | **Pass.** JS 236.81 KB (78.25 KB gzip), CSS 41.64 KB (7.91 KB gzip). `check:site` confirms the six self-hosted fonts and licences, and no Google Fonts references. |
| `npm run verify:content` | **Pass:** exact built-in content and order, exact published content, 566 links, `v1Unchanged: true` |
| `git -c core.whitespace=cr-at-eol diff --check` | **Clean** (only Git's CRLF conversion warnings) |
| Chromium and Firefox, isolated, synthetic data | **16/16 scenarios in each engine.** Fresh contexts; requests to other hosts are refused. Errors appear only in the deliberate failures and the unchanged v1 page's refused Google Fonts request. |
| Phone, narrow and desktop, both themes | 390 × 844, 320 × 640 and 1440 × 900, light and dark, all 12 screens, in both engines. No horizontal overflow, one `h1`, no stretched icon buttons, no target under 44 px. |
| Keyboard | Skip link. No focus under the tab bar on 7 screens. First entry control at the 11th or 12th Tab stop. Hide and Undo keep focus in place. The More sheet button state, Escape and focus return. Dialogs start on Cancel. |
| Zoom and reflow | The 320 px layouts are the CSS-pixel equivalent of 400 % zoom on a 1280 px window. Text enlargement used a 200 % root font size at 320 px: no overflow, and the tab bar and reserved space adapt. Browser zoom itself was not driven. |
| Reduced motion | Transitions cut to 0.01 ms; the next card appears at once |
| Assistive technology | **None used** (§7). The accessibility-tree snapshots and jsdom tests are machine checks. |
| First study content within 250 px | **Pass** on all ten study screens (table below) |
| Flashcard answers reachable | Phone: the buttons end at 624 px, and the tab bar starts at 779 px. Desktop 1440 × 900: 618 px. Front and back, both engines. |
| First-load budget | **Pass** (table below) |
| No Google Fonts request | v2 made **no** request to any other host in any scenario. `check:site` rejects Google Fonts references. |
| Fallback text when fonts are slow or fail | Fonts delayed by 5 s, or refused: text is shown at once in system fonts, with no overflow ([slow](../evidence/eng-v2-ux-01b/screenshots/chromium-phone-fonts-slow.png), [refused](../evidence/eng-v2-ux-01b/screenshots/chromium-phone-fonts-failed.png)) |
| Build validation | `scripts/check-site.mjs` has a new font section. No historical inventory, report or script was changed. |
| Protected files and v1 | 101/101 protected files unchanged. The v1 build matches the release apart from CRLF, with byte-identical JS and CSS. |

**First study content on a 390 × 844 phone** (top of the first entry or card). The before row is UX-01A §1.2 (production).

| | Phrases | Words | Verbs | Patterns | Answers | Flashcards | Reverse | Prompts | Focus | Collections |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Before | 1,117 | 1,474 | 1,233 | — | — | — | — | — | 883 | 1,057 |
| After | 236 | 236 | 236 | 161 | 137 | 232 | 136 | 72 | 60 | 60 |

With the fonts refused, the fallback fonts put the first phrase at 264 px in Chromium (236 px in Firefox). The 250 px target is met with the designed fonts.

**First-load budget.** Defined here: a cold cache, one route, a 390 × 844 phone, until the network is idle. Sizes are gzip of the built files; fonts are counted as served WOFF2.

| | Budget | Result |
|---|---|---|
| App code (HTML + CSS + JS, gzip) | ≤ 100 KiB | **86,700 B** |
| Fonts on a first screen | ≤ 200 KiB | **133,040 B** (Home, Phrases); **193,128 B** (Words, with the IPA subset) |
| Total first load (gzip estimate) | ≤ 550 KiB | **450,043 B** (Home, Phrases); **510,131 B** (Words) |
| Requests to other hosts | 0 | **0** |

The built-in content is unchanged (230,303 B gzip). The UX-01A production first load was about 3.4 MB, of which 3,132,808 B was the icon font.

**Theme start-up.** Measured with a saved Dark theme, a light system theme and 4× CPU slowdown, over six reloads:
- First paint, the loader: 44–128 ms.
- Dark theme applied: 159–308 ms.
- Study screens shown: 409–625 ms.

In every run the study screens appeared after the theme was applied, and transitions were switched on only then.

## 9. Before and after

**Before:** the UX-01A audit of production (ENG-V2-02B, 21 November 2026), [`docs/design/eng-v2-ux-01a/audit/screenshots/`](../design/eng-v2-ux-01a/audit/screenshots/), unchanged. **After:** this build, from the final browser run, in [`docs/evidence/eng-v2-ux-01b/screenshots/`](../evidence/eng-v2-ux-01b/screenshots/). After images are Chromium unless named `firefox-…`.

| Screen or finding | Before | After |
|---|---|---|
| Phone, Phrases, first screen | [01](../design/eng-v2-ux-01a/audit/screenshots/01-mobile-phrases-first-screen.png) | [phone-light-phrases](../evidence/eng-v2-ux-01b/screenshots/chromium-phone-light-phrases.png) |
| Phone, Home | [02](../design/eng-v2-ux-01a/audit/screenshots/02-mobile-index-first-screen.png) | [phone-light-index](../evidence/eng-v2-ux-01b/screenshots/chromium-phone-light-index.png) |
| Desktop, Phrases | [03](../design/eng-v2-ux-01a/audit/screenshots/03-desktop-phrases.png) | [desktop-light-phrases](../evidence/eng-v2-ux-01b/screenshots/chromium-desktop-light-phrases.png) |
| Phone, Flashcards | [04](../design/eng-v2-ux-01a/audit/screenshots/04-mobile-flashcards.png) | [phone-flashcards-front](../evidence/eng-v2-ux-01b/screenshots/chromium-phone-flashcards-front.png), [back](../evidence/eng-v2-ux-01b/screenshots/chromium-phone-flashcards-back.png) |
| Desktop Flashcards, 1440 × 900 (answers were below the fold) | [05](../design/eng-v2-ux-01a/audit/screenshots/05-desktop-flashcards-1440x900.png) | [desktop-flashcards-front](../evidence/eng-v2-ux-01b/screenshots/chromium-desktop-flashcards-front.png) |
| Phone, import preview | [06](../design/eng-v2-ux-01a/audit/screenshots/06-mobile-import-preview-table.png) | [phone-collections-review](../evidence/eng-v2-ux-01b/screenshots/chromium-phone-collections-review.png) |
| F4, blocked upgrade and a retry | [07](../design/eng-v2-ux-01a/audit/screenshots/07-f4-blocked-upgrade.png), [08](../design/eng-v2-ux-01a/audit/screenshots/08-f4-retry-while-still-blocked.png) | [phone-blocked-wait](../evidence/eng-v2-ux-01b/screenshots/chromium-phone-blocked-wait.png) (after two **Check again**), [Firefox, after Continue without saving](../evidence/eng-v2-ux-01b/screenshots/firefox-phone-blocked-continue.png) |
| F5, stale write | [09](../design/eng-v2-ux-01a/audit/screenshots/09-f5-stale-write-message.png) | [phone-collections-conflict](../evidence/eng-v2-ux-01b/screenshots/chromium-phone-collections-conflict.png) |
| Content error wording | [10](../design/eng-v2-ux-01a/audit/screenshots/10-content-error-copy.png) | [phone-content-error](../evidence/eng-v2-ux-01b/screenshots/chromium-phone-content-error.png) |
| Fonts still loading | [11](../design/eng-v2-ux-01a/audit/screenshots/11-icon-font-still-loading.png) (raw icon names) | [phone-fonts-slow](../evidence/eng-v2-ux-01b/screenshots/chromium-phone-fonts-slow.png), [fonts refused](../evidence/eng-v2-ux-01b/screenshots/chromium-phone-fonts-failed.png) |
| Theme start-up | [12a](../design/eng-v2-ux-01a/audit/screenshots/12a-theme-flash-252ms.png), [12b](../design/eng-v2-ux-01a/audit/screenshots/12b-theme-flash-385ms.png), [12c](../design/eng-v2-ux-01a/audit/screenshots/12c-theme-flash-485ms.png) | Measured (§8): the loader may still paint in the system theme, but the study screens never do, and nothing animates |
| 320 px Verbs (overflowed) | [13](../design/eng-v2-ux-01a/audit/screenshots/13-320px-verbs-overflow.png) | [narrow-light-irregularVerbs](../evidence/eng-v2-ux-01b/screenshots/chromium-narrow-light-irregularVerbs.png) |
| Phone, Words | [14](../design/eng-v2-ux-01a/audit/screenshots/14-mobile-word-index.png) | [phone-light-wordIndex](../evidence/eng-v2-ux-01b/screenshots/chromium-phone-light-wordIndex.png) |
| Focus ring (amber, 2.15:1) | [15](../design/eng-v2-ux-01a/audit/screenshots/15-amber-focus-ring.png) | [phone-keyboard-focus](../evidence/eng-v2-ux-01b/screenshots/chromium-phone-keyboard-focus.png) |
| Phone, dark Phrases | [16](../design/eng-v2-ux-01a/audit/screenshots/16-mobile-dark-phrases.png) | [phone-dark-phrases](../evidence/eng-v2-ux-01b/screenshots/chromium-phone-dark-phrases.png), [narrow dark](../evidence/eng-v2-ux-01b/screenshots/chromium-narrow-dark-phrases.png) |

New screens and states, after only:
- Collections: [import guidance](../evidence/eng-v2-ux-01b/screenshots/chromium-phone-light-collections.png), [details open](../evidence/eng-v2-ux-01b/screenshots/chromium-phone-collections-help.png), [missing-column error](../evidence/eng-v2-ux-01b/screenshots/chromium-phone-collections-error.png) ([Firefox](../evidence/eng-v2-ux-01b/screenshots/firefox-phone-collections-error.png)), [remove dialog](../evidence/eng-v2-ux-01b/screenshots/chromium-phone-collections-remove-dialog.png).
- Navigation and Settings: [More sheet](../evidence/eng-v2-ux-01b/screenshots/chromium-phone-more-sheet.png), [Settings](../evidence/eng-v2-ux-01b/screenshots/chromium-phone-light-settings.png), [Settings at 200 % text, 320 px](../evidence/eng-v2-ux-01b/screenshots/chromium-narrow-text200-settings.png).
- Empty and confirmation states: [empty Focus list](../evidence/eng-v2-ux-01b/screenshots/chromium-phone-light-favorites.png), [Reset dialog](../evidence/eng-v2-ux-01b/screenshots/chromium-desktop-reset-dialog.png), [Unhide all dialog](../evidence/eng-v2-ux-01b/screenshots/chromium-desktop-unhide-dialog.png), [Hide with Undo](../evidence/eng-v2-ux-01b/screenshots/chromium-desktop-hide-undo-toast.png).
- Wide screens: [desktop dark Words](../evidence/eng-v2-ux-01b/screenshots/chromium-desktop-dark-wordIndex.png), [Firefox desktop dark Flashcards](../evidence/eng-v2-ux-01b/screenshots/firefox-desktop-dark-flashcards.png).

The final run captured 118 screenshots; 34 are published. The others are listed with their hashes in [`browser/screenshots.json`](../evidence/eng-v2-ux-01b/browser/screenshots.json) and can be recreated with the runner.

## 10. Problems found during verification

These came from the browser runs and from reviewing their screenshots. Each was fixed, re-verified in both engines, and is now guarded by the runner or a test.

| Problem | Fix | Guard |
|---|---|---|
| Round Listen buttons stretched into tall ovals over the whole entry row, in both engines. In Firefox this also left focused buttons partly under the tab bar. | Icon buttons have a fixed 44 px height. | `stretchedIconButtons` must be 0 on every surveyed screen. |
| Small buttons, chips, selects and segmented buttons were 38–40 px tall; disclosures 36 px; the side-navigation and v1 links 36–40 px; the startup **Technical details** had no minimum. | All use the 44 px target. The compact variant keeps its smaller text and padding. | No target under 44 × 44 px on any surveyed screen, or in the More sheet, dialogs, Undo message, import help and error, or startup screens. |
| At 200 % text on 320 px, the Flashcards segmented control widened the page by 99 px. | It wraps. | No horizontal overflow at 200 % text. |
| At 200 % text, the tab bar labels ran into each other, while the space kept free stayed at 64 px. | Labels wrap inside their own columns. AppShell measures the bar, and the page padding, focus scroll padding and message position follow it. | Labels stay inside their columns, and the space kept free is at least the bar height. |
| In Firefox, a control already inside the window could keep keyboard focus 6 px under the tab bar: Firefox ignores `scroll-padding` there. | AppShell lifts keyboard focus (`:focus-visible`) above the bar. It does nothing where the browser has already scrolled, and nothing for pointer focus. | No focus under the tab bar on Phrases or across 50 Tab presses on six more screens, in both engines. |
| Hiding an entry with the keyboard dropped focus onto the page body. | Focus moves to the entry that took its place; Undo returns it to the restored entry. | `App.test.ts`, and the keyboard scenario in both engines. |
| The 44 px targets moved the first phone entry to 248 px, close to the 250 px limit. | The hidden page header no longer keeps a bottom margin: the first entry is now at 236 px. | First content at most 250 px on all ten study screens, from Library and Practice to Focus and Collections. |
| Copy: “System(follow the device setting)” lacked a space. Import errors repeated the parser text as technical detail. “spelled exactly like that” contradicted the case-insensitive headers. | Fixed. Detail is shown only when it adds information. Column lists read “a, b and c”. | `importErrors.test.ts`. |

Runner-only corrections; the application was unchanged:
- When focus leaves the page after the last control, the page body was counted as a covered control. It is now excluded.
- The download used for the native reimport has no file extension, so it is passed with its suggested name.
- The clipboard check compared text after a round trip through the Windows clipboard, where Chromium returned different line endings. The page's clipboard is now replaced inside the page, and the check verifies the exact text the app hands over.
  - Side effect: the first run wrote the synthetic CSV example to this computer's clipboard. No later run touched it.
- The preserved v1 page still requests Google Fonts. The runner now refuses every request to another host and records it, so the whole run is hermetic.

## 11. Limitations and deferrals

**Deferred by the owner to later milestones:**
- session sizes and session summaries
- word-by-word highlighting while listening
- desktop shortcuts beyond the existing flashcard keys
- word-detail routing and the reading stand
- spaced repetition
- pronunciation assessment
- content cleanup
- full localisation

Concept B elements that depend on these were not built: the session view with a size option, the slower-speech control and the full-screen flashcard session.

**Known limitations of this implementation:**
- **Theme start-up.** The theme is mitigated, not eliminated. When the saved theme differs from the system theme, the minimal loader can paint in the system theme before IndexedDB has been read (§8). The study screens never appear in the wrong theme, and the switch is not animated. Removing the loader frame would need a synchronous store such as `localStorage`, which the owner excluded.
- **Very large text.** At 200 % text on a 320 px screen, tab labels break inside words (“Prac/tice”): neither tested browser applied hyphenation there. Labels stay inside their columns and nothing overlaps.
- **Fallback fonts.** When the web fonts fail, the system fallback fonts are not metric-matched. In Chromium they move the first phone entry from 236 px to 264 px. The text stays intact and nothing overflows. Metric overrides (`size-adjust`) could reduce this shift later.
- **Section tabs.** The tabs scroll sideways without a visible scrollbar, and the partly visible last tab is the only cue. Keyboard focus scrolls them into view.
- **Messages.** Only one message is shown at a time. A new message replaces the old one, and its **Undo** goes with it; **Show** stays on hidden entries, and Learn again can be reversed with **I know it**.
- **Page weight.**
  - JavaScript grew from 179 KB to 236 KB raw (59 KB to 78 KB gzip) for the icons, dialogs, messages, import guidance and typed errors; CSS is 41 KB raw (8 KB gzip).
  - Fonts add 133–193 KB on a first screen.
  - The 3.1 MB icon font is gone, so the total first load is far smaller (§8).
  - Transfer was estimated from gzip of the built files, because the local server does not compress. Production compression was not measured.
- **Fonts and licensing.** Source Sans 3 carries the Reserved Font Name “Source”. The files are Google Fonts' own published subsets, unmodified and under their original family names, with both licences published. A reviewer may want to confirm that serving these subsets is acceptable under OFL 1.1, and any future re-subsetting or modification must take the RFN clause into account.
- **Not tested.** Safari/WebKit, physical phones and tablets, screen readers and other assistive technology (§7), Windows contrast themes and forced colours, audible speech (headless browsers do not speak), production deployment and real storage quota exhaustion. Browser checks are scripted, not exploratory.
- **Unchanged from earlier milestones.** Existing multi-tab progress behaviour, eager catalog loading, the absence of a database downgrade path, and the deferred ENG-V2-02A findings N1–N7.

## 12. Review instructions for Astra

1. **Scope.** Review the working tree on `feature/eng-v2-ux-01b-spoken-line` against `f14dd4e`. [`candidate.json`](../evidence/eng-v2-ux-01b/candidate.json) lists every changed, deleted and new file with its hash. The protected release and design files are listed in [`preservation.json`](../evidence/eng-v2-ux-01b/preservation.json) and are not part of this change. Nothing is staged.
2. **Order.** Review in the three steps of §3: foundation and shell, then study screens and safeguards, then collections, import guidance and F3–F6. The [UX-01A proposal](../design/ENG-V2-UX-01A.md) explains the design intent behind each rule.
3. **Reproduce** from the repository root, with root and v1 dependencies installed:

   ```powershell
   npm run check
   npm test
   npm run check:v1
   npm run test:v1
   npm run build
   npm run build:site
   npm run verify:content
   git -c core.whitespace=cr-at-eol diff --check
   ```

   Then run the browser suite against `site-dist` with your own Playwright installation. It serves the site itself, uses fresh contexts and synthetic data only, and refuses requests to other hosts:

   ```powershell
   $env:PLAYWRIGHT_BROWSERS_PATH = '<isolated-browser-binaries>'
   node docs/evidence/eng-v2-ux-01b/browser-check.mjs '<playwright-node_modules>' site-dist '<output-dir>'
   ```

4. **Areas that most deserve independent scrutiny:**
   - **The storage open coordinator** (`beginOpen`, `requestConnection` and `openStorage` in `src/storage/database.ts`) together with the attempt token and `AbortController` in `src/app/App.svelte`. Probe repeated **Check again**, closing the other tab at different moments, **Continue without saving** followed by a late success, and an open that fails outright.
   - **Error typing** from storage to service to page (`StorageError` → `CollectionError` → `describeCollectionError`). Each failure should surface once, next to its action, with quota advice only for quota.
   - **The import selection guard** in `CollectionsPage.svelte`: the selection number, Cancel, clearing the input, and focus after a failure while another file is being read.
   - **The Undo contracts** in `HideButton.svelte` and `FlashcardsPage.svelte`: entry-level operations, no snapshots, and the RC1 **Unhide all** scope.
   - **The reset summary versus the reset operation** (`RESET_PROGRESS_SUMMARY`, `resetSummaryCoverage`, `resetAllState`).
   - **Accessibility semantics:**
     - the More button and sheet, and the dialogs' initial and returning focus
     - live regions (one polite message region; counts as `status`)
     - `lang` and `translate` marking, and label-in-name for **Focus** and **Hide**
     - focus after navigation and after Hide or Undo
   - **Visual tokens** in both themes (`src/styles/tokens.css`) and the 44 px rule in compact controls.
   - **Font licensing** (§11) and `scripts/check-site.mjs`.
5. **Hands-on checks that this handoff could not do:** a screen reader pass, Safari and a real phone, 400 % browser zoom, and Windows contrast themes.

Fixtures and downloads in the evidence are synthetic. Do not use a personal browser profile or real learning data.

## 13. Exact Git state

- **Branch and commits.** Branch `feature/eng-v2-ux-01b-spoken-line`; HEAD is the baseline `f14dd4e33de2dfcbd8b80e1b72dbfec4326823d3`. There are no new commits and no remote branch, and nothing is staged.
- **Changes.**
  - 45 tracked files are modified: the source, three test files, `index.html`, `scripts/check-site.mjs`, `README.md`, `CHANGELOG.md` and `docs/architecture/USER-COLLECTIONS.md`.
  - One is deleted: `src/shared/ui/MaterialIcon.svelte`.
  - 37 are new: the source, styles, fonts and licences, tests, and this handoff.
  - All are listed with hashes in [`candidate.json`](../evidence/eng-v2-ux-01b/candidate.json).
- **New evidence.** [`docs/evidence/eng-v2-ux-01b/`](../evidence/eng-v2-ux-01b/README.md) is new and untracked.
- **Unchanged.** The 101 protected untracked files (`docs/releases/`, `docs/design/`) are byte-identical and stay out of this change.
- **Ignored.** Generated content, dependencies, `dist/`, `site-dist/`, browser binaries and the local run directory remain ignored or outside the repository.

See the [complete status](../evidence/eng-v2-ux-01b/git-status.txt). When preparing an integration candidate, include the new files; they are untracked.

**ENG-V2-UX-01B — IMPLEMENTED / READY FOR INDEPENDENT REVIEW**

## Corrective iteration — ENG-V2-UX-01B-RC1 (22 November 2026)

[Astra's independent review](../reviews/ENG-V2-UX-01B-ASTRA.md) returned **CHANGES_REQUIRED** with five findings. This section describes the uncommitted correction. It does not revise the review or the sections above, which describe the candidate as it was reviewed. Evidence: [`docs/evidence/eng-v2-ux-01b-rc1/`](../evidence/eng-v2-ux-01b-rc1/README.md).

### Starting point

- **Instructions.** The repository instructions were read again: the parent `AGENTS.md` (no nested ones). Work stayed in this repository, with no commit, and the root build was run.
- **Git state.** Branch `feature/eng-v2-ux-01b-spoken-line`, HEAD `f14dd4e33de2dfcbd8b80e1b72dbfec4326823d3`, nothing staged.
- **Comparison with Astra's inventory.** Before any edit, the candidate matched Astra's captured inventory exactly:
  - the same 696 paths, with no differences
  - tree fingerprint `1df5517c9fedb1ef909d74e4788e5f943c40a34ca7f6e8d65f47c9c39b5e0231`
  - HEAD and index unchanged

  The only additions were Astra's 257 review files. No unexpected change was found.
- **Snapshot.** A complete snapshot of all 953 files, including the review files, was taken for the RC1 delta and the preservation checks.

### Findings and fixes

| Finding | Root cause | Correction |
|---|---|---|
| **F1** Stale Undo | Undo callbacks kept an id and two booleans and checked only current values. Nothing recorded newer intent: “Keep learning” on an unlearned card changes nothing that is stored. Reset did not invalidate callbacks; replacing the visible message is not invalidation. | An in-memory operation-validity mechanism in the progress store (`src/state/progress.ts`). Every learned, Focus, Hide/Show, flashcard-answer, deck-reset and bulk-unhide operation records a revision for the stored entry state it touches, also when nothing stored changes (`noteIntent`). `reset()` and every `hydrate()` start a new generation. `issueUndo`/`redeemUndo` give single-use tokens. Hide and Learn again issue tokens and check them before applying their inverse. |
| **F2** Lost keyboard focus | The focused control disappeared with its row, message or dialog opener, and nothing chose a successor. `ConfirmDialog` restored focus right after closing, and only to an opener that still existed. | Learn again moves focus within the learned list. The message region owns focus after its own action, using the target the action returns. `ConfirmDialog` restores focus after the change has rendered, with an explicit `returnFocus` fallback. Every step rechecks who owns focus after rendering. |
| **F3** Returned import issues | After a successful parse the page always focused the review heading. The parser reports invalid records as plan issues rather than errors, and the issue summary was not focusable. | Once the final plan has rendered and the selection token has been checked again, a plan with blocking issues focuses the issue summary. The summary is named by its title (`aria-labelledby`) and has `tabindex="-1"`. Importable plans, including those with duplicates to acknowledge, focus the heading. Thrown errors keep their summary focus. |
| **F4** Reserved font name | The four Source Sans 3 subsets were served under the reserved name “Source” with no documented authorization for this distribution. None was available to verify. | The bounded default: a renamed OFL derivative, **Eng Trainer Sans**. Only naming records 1, 3, 4 and 6 changed in each subset. The CSS, tokens, licence file name, FONTLOG, documentation and site check were updated, and the old files removed. |
| **F5** Language and translation | Block descriptions were marked `uk` unconditionally. Some English study text lacked the translation opt-out. | A table keyed by stable block id (`src/content/descriptionLanguage.ts`), used on Home, Focus and the Verbs set note. Unknown ids are `''`. `translate="no"` was added to the Answers questions, the current prompt, All prompts, the Reverse practice prompt and the import-preview example. Interface copy stays translatable. |

### Undo validity rules

- **Keys.** Validity is keyed by the stored list and the id it holds: `learnedPhrases:<flashcard id>`, `hidden<Kind>:<id>` and `favorite<Kind>:<id>`. It never uses display text.
  - A Hide Undo covers the entry's hidden and Focus flags and, for a phrase, its learned flag.
  - A Learn again Undo covers the learned flag of that flashcard identity.
  - Hidden and Focus state are separate per kind, so hiding a word does not expire a phrase's Undo, even for the same id.
- **Newer intent.** Any newer operation on one of those keys expires an Undo, whether or not the stored value changes. Examples: Mark as learned, a flashcard answer (recorded the moment it is chosen), Learn again, Hide, Show, Focus, a deck reset covering the card, and Unhide all.
- **Reset and reload.** Reset in Settings and every reload of the saved state start a new generation, so an earlier Undo stays invalid even if the entry later returns to the same values.
- **Single use.** An Undo is used at most once.
- **Unrelated entries.** An action on a different entry, or on another deck, does not expire it.
- **What a valid Undo restores.** Only what its own action removed, for that one identity, with the ordinary entry operations. Never a progress object, deck or catalog snapshot. Deck orders, cursors and absent collection identities are untouched.
- **Scope of the mechanism.** It lives in memory only: no migration, no saved revision fields, no history store and no cross-tab protocol. The save-queue retry ordering is unchanged.

### Focus-recovery rules

- **Learn again.** Focus moves to the “Learn again” button of the row that took the removed row's place, else the row before it, else the “Learned vocabulary” heading.
- **Undo from the message.** Focus goes to the restored entry: the Hide button of a restored row, or the Learn again button of a restored learned card. If the learned list is closed, it goes to “Review learned vocabulary (N)”. If nothing restored is on screen, focus returns to where the user came from into the message, else to the main content.
- **Learn Pass deletion.** Focus moves to the next pass's Delete button, else the previous one's. After the last pass it goes to “Create a Learn Pass”.
- **Other removed openers.**
  - Deck reset: the current card, or the list heading.
  - Unhide all: the list's search field.
  - Collection removal: the “Your collections” heading.
  - Anything else: the main content, never the page body.
- **Unchanged behaviour.** Cancel and Escape still return focus to an opener that still exists. Reset in Settings, the More sheet and Hide behave as before.
- **Ownership.** Focus moves only when the user's own focused control was removed, and only after the change has rendered. If focus has meanwhile moved elsewhere, nothing moves. A message that simply expires never moves focus.

### Font provenance, transformation and verification

- **Originals.** The originals are Google Fonts Source Sans 3 v20 (font version 3.052) WOFF2 subsets: Latin, Latin Extended, Cyrillic and Greek. Their exact URLs and SHA-256 are in [`public/fonts/FONTLOG-EngTrainerSans.txt`](../../public/fonts/FONTLOG-EngTrainerSans.txt). The preparation script refuses any other input.
- **Preparation.** [`scripts/fonts/derive_eng_trainer_sans.py`](../../scripts/fonts/derive_eng_trainer_sans.py) ran with Python 3.14.7, fontTools 4.68.0 and brotli 1.2.1 in a separate virtual environment ([`requirements.txt`](../../scripts/fonts/requirements.txt)). It saves without recalculating bounding boxes or timestamps. The application build does not run it, and needs no new runtime dependency.
- **Naming changes.** The files contain only Windows naming records (3/1/0x409):

  | Name ID | Record | Before | After |
  |---|---|---|---|
  | 1 | Family | Source Sans 3 ExtraLight | Eng Trainer Sans ExtraLight |
  | 3 | Unique identifier | 3.052;ADBO;Source Sans 3 ExtraLight-ExtraLight;ADOBE | 3.052;ENGT;EngTrainerSans-Roman |
  | 4 | Full name | Source Sans 3 | Eng Trainer Sans |
  | 6 | PostScript name | SourceSans3-Roman | EngTrainerSans-Roman |

  Kept unchanged:
  - the copyright notice with the Reserved Font Name (ID 0)
  - the version (5) and licence URL (14)
  - the style, axis and instance names (2, 17, 257–308)
  - the OFL text, now published as `OFL-EngTrainerSans.txt` (byte-identical to the previous `OFL-SourceSans3.txt`)
  - the Adobe attribution and trademark notice in the FONTLOG
- **Decoded comparison** ([`font-check.json`](../evidence/eng-v2-ux-01b-rc1/fonts/font-check.json)).
  - In every subset these 21 tables are identical to the original, compared as decoded XML: `BASE`, `GDEF`, `GPOS`, `GSUB`, `HVAR`, `MVAR`, `OS/2`, `STAT`, `avar`, `cmap`, `fvar`, `gasp`, `glyf`, `gvar`, `head` (apart from its checksum), `hhea`, `hmtx`, `loca`, `maxp`, `post` and `prep`.
  - That covers glyphs, character mapping and coverage (unchanged codepoint counts), shaping, metrics, the `wght` 200–900 axis and its variation data.
  - Decoded fonts are 24 bytes smaller: the strings changed length.
  - The WOFF2 files were compressed again: Latin 28,832 B, Latin Extended 60,136 B, Cyrillic 18,412 B, Greek 14,504 B, between −84 and +48 B each and −100 B in total. Output is deterministic: two runs produced byte-identical files.
- **Browsers.** In Chromium and Firefox, all four “Eng Trainer Sans” subsets report `loaded`, and no “Source Sans 3” face is declared. A canvas comparison finds no English, Ukrainian (і ї є ґ, capitals, ʼ) or IPA character falling back. The body font resolves to Eng Trainer Sans, and only `eng-trainer-sans-*` and `literata-*` font files are requested. Font-failure layout and the first-load budgets were rechecked by the unchanged runner (below).
- **Site check.** `npm run check:site` now requires both licences and the FONTLOG, and a declared “Eng Trainer Sans” family. It rejects any “Source Sans 3” family declaration and any published `source-sans-3*` or `*SourceSans3*` file.
- **Unchanged.** Literata and v1 are unchanged.

### Regressions before and after

**Method.**
- The candidate Astra reviewed was rebuilt in a separate folder and verified with Astra's own capture rule. Its fingerprint is `1df5517c…`, identical to the review.
- 30 files were rebuilt from:
  - HEAD plus Astra's captured diff
  - the pre-RC1 texts of the files RC1 changed that Git does not track yet
  - the verified original fonts
  - RC1's reversible text replacements, undone
- The same test files then ran against that tree and against the corrected one.

Reports and the reconstruction record are in [`before-after/`](../evidence/eng-v2-ux-01b-rc1/before-after/summary.json).

| Test file | Tests | Reviewed candidate | Corrected |
|---|---:|---|---|
| `src/state/undoValidity.test.ts` (new) | 8 | 0 pass, 8 fail (the validity interface did not exist) | 8 pass |
| `src/features/flashcards/learnAgainUndo.test.ts` (new) | 11 | 3 pass, 8 fail | 11 pass |
| `src/shared/entries/hideUndoValidity.test.ts` (new) | 5 | 1 pass, 4 fail | 5 pass |
| `src/features/home/LearnPassManager.test.ts` (new) | 2 | 0 pass, 2 fail | 2 pass |
| `src/features/collections/CollectionsPage.test.ts` (8 tests added) | 15 | 10 pass, 5 fail | 15 pass |
| `src/features/exercises/studyText.test.ts` (new) | 3 | 0 pass, 3 fail | 3 pass |
| `src/content/descriptionLanguage.test.ts` (new) | 3 | cannot run (the table did not exist) | 3 pass |
| `src/app/App.test.ts` (1 test added) | 22 | 21 pass, 1 fail | 22 pass |
| Astra's `independent.test.ts` (unchanged) | 7 | 3 pass, 4 fail, as reviewed | 7 pass |

**What the failures cover.** The tests that fail before and pass after cover every case the brief lists:
- **F1:**
  - Learn again → same-card Keep learning → old Undo, including after a reload
  - a retained Learn again callback after a Reset confirmed in Settings (the visible message is replaced and offers no Undo; the test invokes the retained callback on purpose)
  - a retained Hide Undo after Reset, and after a new Hide of the same id
  - Hide → Show → a newer choice → old Undo
  - repeated invocation of the same callback
  - a storage failure and retry with a stale Undo in between
  - the store-level rules
- **F2:** focus after Learn again, after Undo (with the list open or closed), after deck reset and after Learn Pass deletion, including the last pass.
- **F3:** a missing translation, an invalid kind, a native identity conflict, and a newer problem file superseding an older importable one.
- **F5:** block languages, study-text protection and the import-preview example.

**The 35 tests that pass on both are guards and earlier behaviour.** Among them:
- ordinary Learn again → Undo → reload
- Learn again → answer another card → Undo, keeping the newer answer and both deck records
- an expiring message not moving focus
- a valid Hide Undo restoring exactly its own fields
- an importable file with duplicates focusing the heading
- a superseded problem result not taking focus
- a Cancel after rendering but before focus moves
- every earlier App and Collections test

### Native browsers

Runs used Chromium 159.0.8154.6 and Firefox 159.0 against the assembled `site-dist`, each with fresh contexts and synthetic data, refusing requests to other hosts.

| Run | Chromium | Firefox |
|---|---|---|
| UX-01B runner, unchanged (16 scenarios) | 16/16 | 16/16 |
| Astra's `browser-independent.mjs`, unchanged, with a new output path (22 cases) | 21/22 | 21/22 |
| The same harness with the glyph case's family name adjusted (1 case) | 1/1 | 1/1 |
| RC1 checks ([`rc1-browser-check.mjs`](../evidence/eng-v2-ux-01b-rc1/scripts/rc1-browser-check.mjs), 5 scenarios) | 5/5 | 5/5 |

- **Astra's failing cases.** All five now pass in both engines:
  - `learn-again-same-card-new-intent`: learned stays empty.
  - `learn-again-keyboard-focus`: focus goes to the “Learned vocabulary” heading, then to the restored row's Learn again.
  - `invalid-record-error-focus`: focus goes to the named issue summary.
  - `english-block-language`: the description is `lang="en"`.
  - `study-text-translation-protection`: nothing is left unprotected.
  - `deck-and-pass-confirmations` now records focus on “Create a Learn Pass”, no longer the page body.
- **The one remaining failure.** It is `long-content-reflow-and-glyphs`, by design. The case loads and measures the family named “Source Sans 3”, which RC1 removes.
  - Its reflow assertion passes (no overflow).
  - Its “missing” list contains every character, plain ASCII included, which shows an absent family rather than lost coverage.
  - A copy of the harness differing only in that family name (one line, [`astra-font-adjustment.diff`](../evidence/eng-v2-ux-01b-rc1/browser/astra-font-adjustment.diff)) keeps the assertion and passes, with nothing missing.
  - Astra's original script and evidence are unchanged.
- **RC1 checks** verify `document.activeElement` after every action:
  - Learn again and its Undo, the list closed, and message expiry
  - Learn Pass deletion, including the last pass and Escape
  - Unhide all and deck reset
  - all three returned-issue kinds, plus a valid preview and a whole-file error
  - loading of all four “Eng Trainer Sans” subsets
  - effective language and translation in Focus, Home, Answers, Speaking prompts, Reverse practice and the import preview
- **First load, measured by Astra's harness.** Cold load of `#wordIndex`, with gzip body bytes and no headers:

  | | Code | Fonts | Total |
  |---|---:|---:|---:|
  | Chromium | 88,768 B | 193,052 B | 512,123 B |
  | Firefox (also fetches its 209 B favicon) | 88,768 B | 193,052 B | 512,332 B |
  | Budget | 100 KiB | 200 KiB | 550 KiB |
  | UX-01B, Chromium | 86,700 B | 193,128 B | 510,131 B |

- **Unchanged from UX-01B.**
  - First study content on the phone is still at 236 px or less.
  - The flashcard answers are reachable, the study screens never appear before the saved theme, and fonts that fail or are slow still leave no overflow.
  - The accepted fallback-font position (264 px in Chromium) is unchanged.
  - Logs contain only the deliberate failures and v1's refused Google Fonts request.

### Commands

| Check | Result |
|---|---|
| `npm run check` | 0 errors, 0 warnings (250 files) |
| `npm test` | 10/10 content and build tests; 288/288 Vitest tests in 24 files (41 more than UX-01B) |
| `npm run check:v1` / `npm run test:v1` | 0 errors, 0 warnings (189 files); 68/68 |
| `npm run build` / `npm run build:site` | Pass. JS 241.96 KB (80.33 KB gzip), CSS 41.66 KB (7.91 KB gzip). `check:site` confirms the fonts, both licences and the FONTLOG, no Google Fonts references and no replaced subsets. |
| `npm run verify:content` | Pass: exact built-in content and order, 566 links, v1 unchanged |
| `git -c core.whitespace=cr-at-eol diff --check` | Clean (only CRLF conversion warnings) |
| Astra's independent tests, unchanged | 7/7 |
| Font equivalence check | Pass for all four subsets |

### Changed files and preservation

[`rc1-delta.json`](../evidence/eng-v2-ux-01b-rc1/rc1-delta.json) lists 29 changed, 15 added and 5 removed files, with hashes before and after. Nothing is staged.

| Area | Files |
|---|---|
| F1 | `src/state/progress.ts`, `src/shared/entries/HideButton.svelte`, `src/features/flashcards/FlashcardsPage.svelte` |
| F2 | `src/shared/ui/ToastRegion.svelte`, `toast.ts`, `ConfirmDialog.svelte`, `IconButton.svelte` (passes `data-` attributes through), `FlashcardsPage.svelte`, `src/features/home/LearnPassManager.svelte`; focus fallbacks in `PhrasesPage`, `WordIndexPage`, `IrregularVerbsPage` and `CollectionsPage` |
| F3 | `src/features/collections/CollectionsPage.svelte`, `src/shared/ui/Notice.svelte` (named by its title) |
| F4 | Four `eng-trainer-sans-*.woff2` added and four `source-sans-3-*.woff2` removed; `public/fonts/OFL-EngTrainerSans.txt` (renamed, same bytes) and `FONTLOG-EngTrainerSans.txt`; `src/styles/fonts.css`, `tokens.css`; `src/assets/fonts/README.md`; `scripts/check-site.mjs`; `scripts/fonts/` |
| F5 | `src/content/descriptionLanguage.ts`, `src/content/catalog.ts` (verb sets carry their block id), `IndexPage`, `FocusListPage`, `IrregularVerbsPage`, `AnswersPage`, `PracticePage`, `ReversePracticePage`, `CollectionsPage` |
| Tests | Seven new files; `src/app/App.test.ts` and `CollectionsPage.test.ts` extended |
| Documents | `README.md`, `CHANGELOG.md`, `docs/architecture/USER-COLLECTIONS.md`, this section |

- **Line endings.** `FlashcardsPage.svelte` and `IndexPage.svelte` mixed CRLF and LF before RC1 (from an earlier splice) and are now uniformly CRLF. Git normalizes this, so `git diff` shows only their content changes.
- **Preservation** ([`preservation.json`](../evidence/eng-v2-ux-01b-rc1/preservation.json)). Unchanged:
  - the 101 protected release and design files
  - Astra's 257 report and evidence files
  - the 81 UX-01B evidence files
  - 760 other historical documents
  - v1: `git diff -- v1` is empty, and the build matches the release apart from CRLF
  - built-in content, IDs, order and links
  - the IndexedDB schema and version, the stored records and the save queue
- **Scratch folders removed.** The reviewed-candidate reconstruction lived in ignored folders (`.git/eng-v2-ux-01b-rc1`, then `dist/rc1-reviewed`). Both were deleted after use. Directory junctions were removed with `rmdir`, and `npm ls --all` confirmed `node_modules` intact.

### Remaining limitations

- **Undo scope.** Undo offers live in memory and in one tab, as before. A change made in another tab does not expire an Undo here; there is no cross-tab protocol. Multi-tab progress behaviour is unchanged.
- **Messages.** Only one is shown at a time. A new message replaces the old one and its Undo; Show and the answer buttons remain.
- **Last-resort focus target.** When no meaningful control survives, focus goes to the main content, which shows no focus ring.
- **Eng Trainer Sans.**
  - It is an OFL derivative prepared from Google's published subsets, following SIL's guidance on reserved names; no third party was contacted.
  - The OS/2 vendor id (`ADBO`) is left as it is, so that every table other than `name` stays identical. The unique identifier no longer names Adobe as vendor.
  - This is an engineering correction, not a legal opinion.
- **Testing level.** DOM and machine checks only: no screen reader, browser-translation session, Safari, physical device, forced colours or audible speech.
- **Accepted limitations from UX-01B remain:** the theme-startup loader frame, the fallback-font layout and tab labels at 200 % text. Session sizes, highlighting, pronunciation and localization remain deferred.

### Re-review instructions for Astra

1. **Reproduce** from the repository root:

   ```powershell
   npm run check; npm test; npm run check:v1; npm run test:v1; npm run build; npm run build:site; npm run verify:content
   git -c core.whitespace=cr-at-eol diff --check
   node node_modules/vitest/vitest.mjs run --config docs/reviews/eng-v2-ux-01b-astra/vitest.config.ts
   ```

2. **Browsers.** Use your read-only Playwright runner, with output outside the review folder:

   ```powershell
   $env:PLAYWRIGHT_BROWSERS_PATH = (Resolve-Path '.git/eng-v2-02b-release/browsers').Path
   $env:REVIEW_OUT = '<new-output-dir>'; node docs/reviews/eng-v2-ux-01b-astra/browser-independent.mjs
   node docs/evidence/eng-v2-ux-01b/browser-check.mjs (Resolve-Path '.git/eng-v2-02b-release/tools/node_modules').Path (Resolve-Path 'site-dist').Path '<new-output-dir>'
   node docs/evidence/eng-v2-ux-01b-rc1/scripts/rc1-browser-check.mjs (Resolve-Path '.git/eng-v2-02b-release/tools/node_modules').Path (Resolve-Path 'site-dist').Path '<new-output-dir>'
   ```

   Expect `long-content-reflow-and-glyphs` to fail only on the removed family name. The adjusted copy is described above.
3. **Fonts.** In a fresh Python virtual environment with `scripts/fonts/requirements.txt`:
   - `scripts/fonts/derive_eng_trainer_sans.py --download --input-dir <originals> --output-dir <out>` should reproduce the four files byte for byte.
   - `--check` repeats the table comparison.
4. **Review focus:**
   - the store-level validity in `progress.ts`: the keys, newer intent without a value change, the generation on Reset and reload, single use
   - Undo applying only its own fields
   - the focus ownership checks in `ToastRegion`, `ConfirmDialog` and `FlashcardsPage`
   - the issue-summary focus and its token checks in `CollectionsPage`
   - the hand-classified description table
   - the naming records and the FONTLOG

### Exact Git state

- **Branch and commits.** Branch `feature/eng-v2-ux-01b-spoken-line`, HEAD `f14dd4e33de2dfcbd8b80e1b72dbfec4326823d3`. No commit, stage, push, merge or deployment.
- **Changes.** The RC1 changes are in the working tree with the UX-01B candidate. New files are untracked.
- **Protected files.** The protected release and design files, Astra's review and both evidence folders stay as listed above.
- **Status.** See the [complete status](../evidence/eng-v2-ux-01b-rc1/git-status.txt).

**ENG-V2-UX-01B-RC1 — IMPLEMENTED / READY FOR INDEPENDENT RE-REVIEW**
