# ENG-V2-03 — Implementation handoff

| | |
|---|---|
| Date | 22 November 2026 |
| Developer | Fable (Claude Code) |
| Status | **Implemented and validated locally; ready for independent review.** Nothing was staged, committed, pushed, merged or deployed. |
| Scope | Three learning topics (Conditionals, Small Talk, Interview English), the shared header on every screen, and the Home statistics (Your progress, Library overview) |
| Evidence | [`docs/evidence/eng-v2-03/`](../evidence/eng-v2-03/README.md) |

## 1. Baseline, branch and preserved work

- **Base.** `main` at `03f1267f1ef4287580227ce5db67615988c98177`, the released Spoken Line (UX PR #5, production verified). The remote `main` had the same hash when work started.
- **Branch and isolation.** `feature/eng-v2-03-learning-topics`, created from that commit in a linked worktree at `.worktrees/eng-v2-03`. HEAD is still the base: the work is uncommitted.
  - The main checkout keeps branch `main` and HEAD `03f1267`, with no tracked or staged change. Its own files were not touched.
  - `/.worktrees/` was added to the local `.git/info/exclude`, which is not versioned, so the worktree does not appear in the main checkout's status.
- **Pre-existing untracked files.** The main checkout held **92** untracked files, not the 53 mentioned earlier:
  - three release reports in `docs/releases/`;
  - the 81 files of the three production evidence folders;
  - 8 font files under `docs/reviews/eng-v2-ux-01b-rc1-astra/fonts/`.

  All 92 were fingerprinted before any change and are byte-identical now ([`preservation.json`](../evidence/eng-v2-03/preservation.json)).
- **Unchanged.**
  - v1: its source, content and persistence. `git diff 03f1267 -- v1` is empty, and the built `site-dist/v1` matches the released artifact.
  - Every historical review, report, evidence folder and review script.
  - Dependencies and lockfiles, and the IndexedDB schema (`eng-trainer-v2`, version 2).
  - The native CSV/JSON import format.
- **Instructions.** The parent `AGENTS.md` describes Angular web-school work; this Svelte repository follows the explicit task. Its general rules were kept: this repository only, no commits, and `npm run build` before reporting.
- **Tools.** Playwright 1.65.1, Chromium 159.0.8154.6 and Firefox 159.0 from the earlier release folder (`.git/eng-v2-02b-release/`), used read-only. A temporary extract of the base commit was built once for the budget and markup comparison and removed afterwards. Nothing was installed or reconfigured.

## 2. Summary

| Area | Result |
|---|---|
| Content | 72 practice items as phrases in three new packs, through the existing generator: 18 conditional examples, 36 Small Talk phrases and 18 interview frames. Six model answers join the existing Answers collection. A small optional `topics` collection describes each topic. |
| Topic screen | One data-driven screen, `#topic/<id>`, in the Library. It composes the existing phrase rows, a shared pattern card and a shared answer card. It offers **Practice this topic** (the existing topic deck), **Listen to all**, Focus, Hide and learned state. Small Talk adds an **All situations** chip, six situation chips and a search field. |
| Header | One compact “Eng Trainer” brand panel on every screen, including the start-up and error screens. On phones it is a 47 px bar in normal flow; on wide screens it takes the place of the former side-navigation brand. It shows no counts. |
| Home | Heading, then **Your progress**, then **Library overview**, then three topic cards and the existing practice access. Values come from pure selectors; nothing new is saved. |
| Preservation | The frozen fingerprints now apply to a legacy projection, and every one of them passes. The eleven released pack files are byte-identical. Released search results keep their order. |

## 3. Content architecture

### 3.1 Packs, topics and subsections stay separate

| Concept | Where | Example |
|---|---|---|
| Physical pack | `content/packs/<id>.json`, generated and hashed by the existing pipeline | `small-talk.json`, order 130 |
| User-visible topic | the phrase category, plus a `topics` record in the same pack | “Small Talk”: a flashcard topic and the screen `#topic/small-talk` |
| Subsection or situation | the record's `sections[].id`, repeated as each phrase's `tag`; its title is the phrase's `section` | `coffee-and-lunch`, “Coffee and lunch breaks” |

Existing metadata expresses the grouping wherever it can:
- The category makes each topic a deck in the existing flashcard topic selector.
- `section` groups the rows on the Phrases screen.
- `tag` makes situations searchable.
- New phrase-category blocks (`topic-conditionals`, `topic-small-talk`, `topic-interview-english`, appended to `catalog.json`) put the topics in Learning blocks, Tags, Learn Passes and the Focus list.

### 3.2 The one extension: an optional `topics` collection

Some material had no field to live in: rules, notes, typical questions with translations, answer structures and the link to a model answer. It is held in an optional pack collection, `topics`, documented in [`BUILT-IN-CONTENT.md`](../architecture/BUILT-IN-CONTENT.md#learning-topics-eng-v2-03).
- **Compatible default.** A pack without `topics` has none, so the eleven released pack files are unchanged.
- **Strict shape.** Unknown keys are rejected.
- **Explicit reference validation after assembly** (`src/content/packFormat.js`):
  - the topic's block exists and is the phrase-category block for its title;
  - every listed phrase exists, belongs to the topic's category and is listed once;
  - every phrase of that category is listed;
  - every `answerId` exists;
  - topic IDs and titles are unique.
- **Answers.** An answer may now carry an optional `id`, included in the global unique-ID check, and an optional English `label`. Released answers have neither.

The manifest counts gain `topics`. Each released pack's entry reads `topics: 0`; its file and URL are unchanged.

### 3.3 Canonical identity and the ID mapping

- **One new record per item.** Each of the 72 items is one new phrase record and one card whose ID is the phrase ID.
- **No artificial words.** No word-index entry was created, so the Words inventory and Words learned are unchanged.
- **Only the practice items are cards.** Headings, rules, questions, structures and model answers are supporting material.
- **No exact reuse.** No editorial item equals released vocabulary text exactly (test `topics.test.ts`).
  - Near matches stay separate records and are not merged: “The main difference is that …”, “For example,…”, “As a result, …”.
  - One typical question, “Tell me about a time you solved a difficult problem.”, equals a released speaking prompt. Prompts have no ID and are not cards; both stay as they are.

**Mapping rule.** Catalog ID = pack ID + the editorial ID without its short prefix: `cond-` → `conditionals-`, `small-` → `small-talk-`, `interview-` → `interview-english-`. The full list of 72 pairs is in [`id-mapping.json`](../evidence/eng-v2-03/id-mapping.json); the fixture `src/test/fixtures/eng-v2-03-editorial.json` records the source text, and the tests compare every item with it.

| Topic (pack, block, address) | Subsection | Key | Editorial IDs | Catalog IDs |
|---|---|---|---|---|
| Conditionals (`conditionals`, `topic-conditionals`, `#topic/conditionals`) | Zero Conditional | `zero-conditional` | `cond-zero-01…03` | `conditionals-zero-01…03` |
| | First Conditional | `first-conditional` | `cond-first-01…03` | `conditionals-first-01…03` |
| | Second Conditional | `second-conditional` | `cond-second-01…03` | `conditionals-second-01…03` |
| | Third Conditional | `third-conditional` | `cond-third-01…03` | `conditionals-third-01…03` |
| | Mixed — Past condition, present result | `mixed-past-to-present` | `cond-mixed-past-01…03` | `conditionals-mixed-past-01…03` |
| | Mixed — General condition, past result | `mixed-general-to-past` | `cond-mixed-present-01…03` | `conditionals-mixed-present-01…03` |
| Small Talk (`small-talk`, `topic-small-talk`, `#topic/small-talk`) | Meeting new people | `meeting-new-people` | `small-meet-01…06` | `small-talk-meet-01…06` |
| | Before a work meeting | `before-a-meeting` | `small-meeting-01…06` | `small-talk-meeting-01…06` |
| | Coffee and lunch breaks | `coffee-and-lunch` | `small-coffee-01…06` | `small-talk-coffee-01…06` |
| | Free time and weekends | `free-time-and-weekends` | `small-weekend-01…06` | `small-talk-weekend-01…06` |
| | Conferences and events | `conferences-and-events` | `small-event-01…06` | `small-talk-event-01…06` |
| | Traveling | `traveling` | `small-travel-01…06` | `small-talk-travel-01…06` |
| Interview English (`interview-english`, `topic-interview-english`, `#topic/interview-english`) | Comparing concepts | `comparing-concepts` | `interview-compare-01…03` | `interview-english-compare-01…03`; answer `interview-english-answer-compare` |
| | Explaining how something works | `explaining-how-it-works` | `interview-explain-01…03` | `interview-english-explain-01…03`; answer `…-answer-explain` |
| | Defining a concept | `defining-a-concept` | `interview-define-01…03` | `interview-english-define-01…03`; answer `…-answer-define` |
| | Describing a process | `describing-a-process` | `interview-process-01…03` | `interview-english-process-01…03`; answer `…-answer-process` |
| | Discussing options and trade-offs | `discussing-options` | `interview-options-01…03` | `interview-english-options-01…03`; answer `…-answer-options` |
| | Describing experience and solving problems | `describing-experience` | `interview-experience-01…03` | `interview-english-experience-01…03`; answer `…-answer-experience` |

The Small Talk and Interview keys are the editorial ones; the Conditionals keys were added here.

### 3.4 Editorial decisions

All English and Ukrainian text is the editorial source, character for character. The following presentation decisions were made:

| Source | Implemented as |
|---|---|
| Situation note “Use Shall we get started? to move from small talk into the meeting.” | Quotation marks around the study phrase: “Use “Shall we get started?” to move…”. The only change to authored text. |
| Model-answer labels “hypothetical server-backed application”, “fictional practice example” | Shown visibly, in sentence case, above the answer on the topic screen and the Answers screen. |
| “These are common introductory patterns, not an exhaustive grammar…”, with references G1, G2, T1–T3 | Kept in documentation (this section, §11). On screen, the usage note's last sentence says the same: “These formulas are a starting point; other modal and tense combinations exist.” |
| Editorial constraints (hypothetical application; invite genuine experience; do not attribute the story) | Conveyed by the visible labels and the shared note: “Model answers are examples, not statements about your experience. Replace details with information that is true for you.” |
| “Model answer to the first question” | Each model answer is an Answers-collection record whose `question` is the first typical question. The topic screen names it (“Question: …”). |

The task's spelling is already American (traveled, organized, favorite, practice). The interface adds only English copy.

### 3.5 Legacy preservation and totals

- **The projection.** `src/test/legacyProjection.js` removes, by identity and never by text, exactly what ENG-V2-03 added: the objects of the three new packs and the three new blocks. Everything else stays in catalog order.
- **Frozen baseline: unchanged and fully applied.** `content-baseline.json` is checked against the projection for:
  - meta, counts and record hashes of every collection;
  - ID hashes;
  - the 566 `sourcePhraseId` links.
- **The guard is real.** A test shows that a changed or added released record changes the fingerprint, and that a released record moved into a new pack leaves the projection.
- **`npm run verify:content`.** It compares the source projection, and the projection of the published files, with the released v2 JSON from Git (`c84ef30`), and checks v1.
- **Released packs.** `legacy-pack-urls.json` freezes the eleven released content-addressed pack URLs; they still appear unchanged in the manifest. They are also the URLs recorded in the production release evidence.
- **Released search results.** Projected onto released IDs, phrase-search results equal the released catalog's results, in order. This was checked for every new item text, 120 released texts and common words. Word, verb and released-block searches are unchanged.

Totals, derived from the generated manifest ([`content-totals.json`](../evidence/eng-v2-03/content-totals.json)):

| | Blocks | Phrases | Words | Verbs | Patterns | Answers | Drills | Topics | Packs | Records |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Released | 39 | 566 | 566 | 339 | 7 | 6 | 15 | — | 11 | 1,538 |
| Now | 42 | 638 | 566 | 339 | 7 | 12 | 15 | 3 | 14 | 1,622 |
| Delta | +3 | +72 | 0 | 0 | 0 | +6 | 0 | +3 | +3 | +84 |

Flashcards: 566 → 638. Flashcard topics: 31 → 34. Explicit word-to-phrase links: still 566.

Four existing tests encoded the old catalog size; their meaning is kept:
- `builtIn.test.ts` and `service.test.ts` now derive the phrase count instead of hard-coding 566.
- The block-language test keeps the 39 released blocks at 23 English and adds the three new English blocks.
- One App fixture replaces every phrase and block, so it no longer carries the real topics, whose references it would break.

## 4. The topic screen

`src/features/topics/TopicPage.svelte` (one component for all three topics) and the pure `topicView.ts`.

- **Place in the app.** `#topic/<id>` is a Library screen with a visible `h1` and no section tabs. Released page IDs never contain a slash, so the two kinds of address cannot collide.
  - It is available when the active Learn Pass contains the topic's block. Otherwise the address falls back to Home, as other unavailable screens do.
  - Ways in: the Home topic cards, the topic's learning block (Home, Focus), a link on the Phrases screen when that category is selected, and the address itself.
- **Layout.** Description and topic notes, then **Practice this topic**, then (Small Talk) search and chips, then the count with **Listen to all**, then the subsections:
  - **Conditionals:** each rule as a shared pattern card (“Pattern: …”, “Use: …”) above its examples. “Mixed Conditionals” is a group heading over its two directions, and the usage note comes last.
  - **Small Talk:** a situation note where one exists.
  - **Interview English:** the subheadings *Typical questions* (each with its translation and a listen button), *Answer structure*, *Answer frames* (the cards), *Model answer* (with its label and a listen button) and *Translation*. The model answers also appear on the existing Answers screen.
- **Rows.** The existing `PhraseCard`, so listening, the visible translation, **Mark as learned**, Focus, Hide with Undo, and the shared IDs behave as on the Phrases screen. Hidden rows follow the Phrases rule: they are left out until **Show hidden (N)**.
- **Practice this topic.** Sets the existing flashcard deck to *By Topic* and this topic, then opens Flashcards. A selected user-collection filter would leave the built-in deck empty, so it is reset to *All collections*; a *Built-in vocabulary* filter is kept.
- **Chips and search.** Small Talk's **All situations** and six situation chips are real buttons with `aria-pressed` in a labelled group. Search uses the shared phrase search, so it matches the same fields as the Phrases screen, including the situation title. Chip and search combine. Both are kept in memory (view state), not saved, and change no progress.
- **Placeholders.** Bracketed text is literal; there is no interpolation. Topics that contain it show “Replace the text in brackets with your own details.”
- **Shared components.** `PatternCard` and `AnswerCard` were extracted from the Patterns and Answers screens and are used there too. In both browsers, the released patterns and answers render the same markup as the release; only Svelte's empty block markers and one whitespace node differ ([`budget-and-markup.json`](../evidence/eng-v2-03/budget-and-markup.json)). `PhraseCard` gained a `headingLevel` option for the outline.

## 5. The shared header

`src/app/AppHeader.svelte`, used once by the shell and on the start-up and error screens.

- **Content.**
  - “Eng Trainer” links to Home through the base-aware address `/eng-trainer/#index`, navigating in place. Its accessible name is “Eng Trainer, Home”.
  - “Practice English at your pace” where it fits; it is hidden below 360 px.
  - No progress, counts or banner. The start-up and error screens show the same brand without a link.
- **Integration.**
  - Phones: a 47 px bar in normal flow (the 44 px brand target, 1 px padding and a divider).
  - Wide screens: the same element sits at the top of the navigation column, replacing the former side-navigation brand, so nothing is stacked above the page.
  - Existing global controls stay in their single places (theme and previous version in the side navigation, the More sheet and Settings), so nothing is duplicated.
  - The skip link is still first, and each page keeps its own `h1` in `main`.
- **Compact phones.** To keep study content high under the new bar:
  - section tabs attach directly below the header;
  - a single filter shares the search row (two or more keep their own row);
  - controls above lists and decks use 8 px spacing.

  Measured first study content at 390 × 844, in both engines:

  | Screen | Released | Now |
  |---|---:|---:|
  | Phrases, Words | 236 px | **203 px** |
  | Flashcards | 232 px | **247 px** |
  | Verbs | 236 px | **255 px** (two selects; see §10) |
  | Patterns, Answers, Reverse practice, Speaking prompts, Focus, Collections | 60–161 px | 99–188 px |

  On Home, the first topic card starts at 639 px, above the tab bar at 779 px. At 200 % text the header grows to two lines without clipping.

## 6. Home statistics

`src/features/home/homeStats.ts`: pure selectors with no stored summary, migration, analytics or writes. `HomeOverview.svelte` and `TopicCards.svelte` render them.

**Definitions.**
- **U** is the set of canonical practice-card IDs of the merged catalog (built-in plus imported), before Hide, search, filters, Learn Passes and pagination. It is built with the existing flashcard identity rules:
  - a phrase card keeps its phrase ID;
  - a word joins only through an explicit `sourcePhraseId`;
  - an independent word keeps its own ID.
- **L** is the learned-ID set.
- **Vocabulary learned** = |U ∩ L| / |U|, with a named progress bar (`aria-labelledby` “Vocabulary learned”, `aria-valuetext`). The percentage is rounded down, so it never shows 100 % early and shows “<1%” for a start.
- **Topics completed** = topics whose cards are all in L, out of topics with at least one card.
  - Topics are the flashcard topic selector's list (`getTopics`), including the new topics and imported topics.
  - Excluded: All Vocabulary, collection decks, Learn Passes, tags and situation chips.
  - A card in two topics counts in both but once in U. An empty topic is never complete.
- **In Focus** is the same selector as the navigation badge. It was moved from `AppShell` into `homeStats.ts` and is now shared.
- **View details** (a native disclosure):
  - **Words learned**: words for which `L` contains `sourcePhraseId ?? id`, the Words-screen rule.
  - **Phrases learned**: phrases whose own ID is in L.
  - **Remaining vocabulary**: |U ∖ L|.
  - “These categories can overlap.”: Words and Phrases learned are never summed.
- **Library overview:** Words, Phrases, Verbs, Topics and Your collections, with “Built-in content and your collections”. There is no summed total. Verbs counts all three verb sets.

**Behavior.**
- Retained IDs of a removed collection stop counting and count again after a native reimport.
- Hidden items stay in the denominators.
- Hide keeps its established effect: hiding a phrase clears its learned flag.
- Empty sets show “No vocabulary yet” and “No topics yet”, never 100 %, NaN or Infinity.
- Statistics render only after the catalog has loaded, so loading never looks like an empty library.

**Copy shown:**
- “Progress reflects the vocabulary currently in your library.”
- “A topic is complete when all its practice cards are marked as learned. Hidden vocabulary is included.”
- “These categories can overlap.”

**Order on Home.** Heading → Your progress → Library overview → Learning topics → Learn Pass → Tags → Learning blocks → Phrase or word of the day. The block-tag panel was renamed from “Topics” to **Tags** (its group label to “Tag filter”), because “Topics” now means the flashcard topics counted above.

**Metric tests 1–10.**
- `src/features/home/homeStats.test.ts`, using the real collection service on fake IndexedDB, covers tests 1, 2, 3, 4, 5, 7, 8, 9 and 10.
- `src/app/App.home.test.ts` covers test 6 (Learn on a topic, a flashcard answer, Learn again with Undo, Reset, reload), and tests 9 and 10 through the interface.
- `docs/evidence/eng-v2-03/browser-check.mjs` repeats the Home counting and import, removal and reimport in both browsers.

## 7. Language and accessibility

- **English interface; Ukrainian translations marked.** Every new label, heading, rule, note, chip, button, helper and accessible name is English. Ukrainian learning translations carry `lang="uk"`, and English study text `lang="en" translate="no"`. Imported translations keep the existing unknown-language rule.
- **Checked automatically.** The tests and browser runs look for Cyrillic outside `lang="uk"` on every screen. The import-help sample file text (`<pre>`, unchanged since ENG-V2-02B) is file content and is excluded.
- **Unchanged by this milestone:** Spoken Line typography, the self-hosted fonts, SVG icons, both themes, Undo validity, dialogs and focus ownership.
- **Navigation focus.** Moving to a topic screen focuses its `h1`, and the brand link moves focus to the Home heading.
- **Targets and reflow:**
  - every control meets the 44 px target on all routes at 390, 320 and 1440 px;
  - there is no horizontal overflow;
  - the chips are one scrollable row on phones and wrap from 700 px.
- **Keyboard.** The order is skip link, brand, then page content. No focused control sits under the tab bar.

## 8. Verification

Final run on 22 November 2026 (Windows, Node 24.18.0); the logs are in [`logs/`](../evidence/eng-v2-03/logs/) and [`commands.json`](../evidence/eng-v2-03/commands.json).

| Check | Result |
|---|---|
| `npm run check` | 0 errors, 0 warnings (264 files) |
| `npm test` | 15/15 content and build tests; 335/335 Vitest tests in 28 files. Before: 10/10 and 288/288 in 24 files. |
| `npm run check:v1` / `npm run test:v1` | 0 errors, 0 warnings / 68 of 68 |
| `npm run build`, `npm run build:site` | Pass; the site check verifies the 14 pack hashes, identities, counts, links and fonts |
| `npm run verify:content` | Pass: the legacy projection equals the release from both source and published files; 566 links; v1 unchanged |
| `git -c core.whitespace=cr-at-eol diff --check` | Clean |
| Browser checks, Chromium 159 and Firefox 159 | **12/12** scenarios in each engine (below) |
| Response-body budgets, both engines | Pass (§8.2) |
| Released Patterns and Answers markup | Identical to the release in both engines |
| Preservation: main checkout, untracked files, released packs, v1 | Pass |

### 8.1 Browser scenarios

These ran on the combined local build (`site-dist`), each in a fresh non-persistent context with synthetic data. Requests to other hosts were refused, and speech synthesis and the clipboard were replaced inside the page.
1. **Every route at 390 × 844, 320 × 640 and 1440 × 900** (12 screens and 3 topics):
   - one header at the top, linked to `/eng-trainer/#index` and without numbers;
   - one `h1` inside `main`, with the skip link first;
   - statistics only on Home;
   - no overflow, no target under 44 px, no unmarked Cyrillic;
   - the phone header between 44 and 56 px.
2. **Conditionals.**
   - Opened from the Home card, with focus on the heading.
   - The outline includes Mixed Conditionals and the Usage note, with 18 rows.
   - **Listen to all** speaks the first row in English, then its translation in Ukrainian.
   - Learned state on the final subsection survives a reload.
   - **Practice this topic** opens the Conditionals deck (18 cards, 1 learned).
3. **Small Talk.**
   - Chip group and states.
   - Keyboard activation of **Traveling** shows six rows, ending with the final phrase.
   - Chip plus search “have you” leaves two rows.
   - The selection is kept across screens and reset by a reload.
   - Progress and settings are unchanged by filtering.
4. **Interview English.** The five subheadings in all six categories, the final category's last frame, both labels, the placeholder hint, and the model answer's listen action.
5. **Shared search and Focus.**
   - The new items are found in English and Ukrainian.
   - A topic row added to Focus appears in the Focus list, and Home shows In Focus = 1.
6. **Home counts.**
   - Start: 0 / 638, 0 / 34, and the inventory.
   - After learning all 18 conditionals: 18 / 638, 1 / 34, and the card reads “18 of 18”.
   - Details: 0 / 566 words, 18 / 638 phrases, 620 remaining.
   - The same after a reload. Only `learnedPhrases` and `activePage` are stored.
7. **Import, removal and reimport.**
   - Import: 1 / 640, 35 topics, 1 collection.
   - A canceled removal changes nothing.
   - Removal: 0 / 638, with the learned ID retained.
   - Native reimport restores the first state exactly.
8. **Keyboard.** Tab order skip link → brand → **Practice this topic**; nothing focused under the tab bar; Enter on the brand opens Home with focus on its heading.
9. **Enlarged text (200 %).** The header grows and does not clip, with no overflow on Home, Small Talk or Verbs.
10. **Start-up error and v1.** The content-error screen keeps the brand without a link. `/eng-trainer/v1/` is the separate v1 app, without the v2 header.

### 8.2 Response-body budgets

Measured with the UX-01B review harness method:
- a cold load in a fresh context at 390 × 844;
- a local server sending gzip -9 bodies (WOFF2 as stored);
- browser response-body bytes, without headers.

| Chromium | Code | Fonts | Content | Total |
|---|---:|---:|---:|---:|
| Budget | 102,400 | 204,800 | — | 563,200 |
| Released `03f1267`, `#wordIndex` | 88,775 | 193,052 | 230,303 | 512,130 |
| Now, `#wordIndex` (the heaviest route) | 96,631 | 193,052 | 240,899 | 530,582 |
| Now, Home, Phrases and both measured topic screens | 96,631 | 132,916 | 240,899 | 470,446 |
| **Delta** | **+7,856** | **0** | **+10,596** | **+18,452** |

Firefox shows the same code, font and content bytes (totals +209 B: Firefox also fetches the favicon). The budget was not raised. The code delta covers the topic screen, the header, the Home statistics and the shared cards. The content delta is the three packs and the larger manifest. No UI framework, chart library, icon font or external font was added.

## 9. Changed files

**New**
- `content/packs/conditionals.json`, `small-talk.json`, `interview-english.json`
- `src/app/AppHeader.svelte`
- `src/features/topics/TopicPage.svelte`, `topicView.ts`
- `src/features/home/HomeOverview.svelte`, `TopicCards.svelte`, `homeStats.ts`
- `src/shared/entries/PatternCard.svelte`, `AnswerCard.svelte`
- `src/test/legacyProjection.js`, `src/test/fixtures/eng-v2-03-editorial.json`, `legacy-pack-urls.json`
- Tests: `src/content/topics.test.ts`, `src/features/topics/topicView.test.ts`, `src/features/home/homeStats.test.ts`, `src/app/App.home.test.ts`
- `docs/handoffs/ENG-V2-03.md`, `docs/evidence/eng-v2-03/`

**Changed**
- Content:
  - `content/catalog.json` (three blocks appended)
  - `src/content/packFormat.js` (the `topics` collection, answer IDs and labels, reference validation)
  - `types.ts`, `catalog.ts`
  - `descriptionLanguage.ts` (three English entries)
- Shell: `src/app/App.svelte`, `AppShell.svelte`, `navigation.ts`, `src/app.css`.
- Screens:
  - `src/features/home/IndexPage.svelte`
  - `src/features/vocabulary/PhrasesPage.svelte` (topic link)
  - `src/features/focus/FocusListPage.svelte` (block link)
  - `src/features/exercises/PatternsPage.svelte`, `AnswersPage.svelte` (shared cards)
  - `src/shared/entries/PhraseCard.svelte` (heading level)
  - `src/state/viewState.ts` (topic search and chip, in memory)
- Preservation scripts and tests: `scripts/verify-content-migration.mjs`, `scripts/content-build.test.mjs`.
- Count-bound tests (§3.5): `src/content/builtIn.test.ts`, `descriptionLanguage.test.ts`, `src/collections/service.test.ts`, `src/app/App.test.ts`; also `src/app/navigation.test.ts` (new address tests).
- `docs/architecture/BUILT-IN-CONTENT.md`

## 10. Deviations, limitations and untested areas

- **Verbs first content at 255 px**, against the approximately 250 px target. Only Verbs has two filter selects above its list: the header (47), the tabs (45), search, two selects and the listen row, each spaced 8 px. Going lower would need gaps below the 8 px rhythm or a different filter layout, and was not done.
- **Topic screens.** The first subsection starts at 319 px (Conditionals), 430 px (Interview English) and 441 px (Small Talk). These new screens show the required description, practice action, notes and, for Small Talk, search and six chips first. The first rule card or question is on the first screen.
- **Same topic name in an imported collection.** An imported entry whose topic is exactly “Conditionals”, “Small Talk” or “Interview English” joins that topic's deck and its Home completion, as any matching flashcard topic does. The topic screen lists only its authored rows.
- **Existing dialog edge case, not changed.** `ConfirmDialog` returns focus one tick after it closes. A test that navigated away in that same tick made its focus step read the unmounted element and raise a rejection. A person cannot leave the screen that quickly, and the dialog is reviewed code outside this scope, so the test now waits.
- **Scoped style class names in local builds.** Building from a lower-case `c:` working directory makes Svelte hash absolute file names, giving local-only class names. The evidence build was run from `C:\…`, so it matches the released hashing and CI.
- **Not tested:**
  - Safari or WebKit, real mobile devices and real screen readers;
  - real speech output (speech synthesis was replaced, so only invocation, text and language were checked);
  - GitHub Pages deployment, and the production compression the budget method approximates.

## 11. Reproduction and references

From the worktree root, with root and v1 dependencies installed and a working directory written as `C:\…`:

```powershell
node docs/evidence/eng-v2-03/run-commands.mjs <output-dir>
$env:PLAYWRIGHT_BROWSERS_PATH = '<isolated-browser-binaries>'
node docs/evidence/eng-v2-03/browser-check.mjs '<playwright-node_modules>' site-dist '<browser-output-dir>'
node docs/evidence/eng-v2-03/compare-builds.mjs '<playwright-node_modules>' '<released-dist>' site-dist '<compare.json>'
node docs/evidence/eng-v2-03/collect-evidence.mjs docs/evidence/eng-v2-03 '<browser-output-dir>' '<compare.json>' '<main-checkout>' '<untracked-before.sha256>' '<released-artifact>'
```

`<released-dist>` is a build of `03f1267`: `git archive 03f1267`, link `node_modules`, then `node scripts/generate-content.mjs` and `npx vite build`.

Content references, kept in documentation as the task asks:
- [G1] British Council, Conditionals: zero, first and second — https://learnenglish.britishcouncil.org/free-resources/grammar/b1-b2/conditionals-zero-first-second
- [G2] British Council, Conditionals: third and mixed — https://learnenglish.britishcouncil.org/free-resources/grammar/b1-b2/conditionals-third-mixed
- [T1] Microsoft Learn, Authentication vs. authorization — https://learn.microsoft.com/en-us/entra/identity-platform/authentication-vs-authorization
- [T2] Microsoft Learn, Cache-Aside pattern — https://learn.microsoft.com/en-us/azure/architecture/patterns/cache-aside
- [T3] MDN, API glossary — https://developer.mozilla.org/en-US/docs/Glossary/API

G1 and G2 support the conditional coverage and time distinctions; T1–T3 support the technical distinctions in the first three model answers. The practice sentences and model answers are original teaching text.

---

**ENG-V2-03 — IMPLEMENTED / READY FOR INDEPENDENT REVIEW**

Branch `feature/eng-v2-03-learning-topics` in the worktree `.worktrees/eng-v2-03`, based on `main` at `03f1267`. All changes are uncommitted and unstaged. This is not independently approved or released.


## 12. RC1 — Small Talk focused-chip visibility

22 November 2026, Europe/Kyiv. Corrects **F1, P2** in [Astra's independent review](../reviews/ENG-V2-03-ASTRA.md). The original sections above remain byte-for-byte unchanged; this section records the correction and clarifies the historical statements.

**Starting point.** The branch and HEAD remain `feature/eng-v2-03-learning-topics` at `03f1267f1ef4287580227ce5db67615988c98177`, in `.worktrees/eng-v2-03`. Before application edits, the 24 modified tracked and 68 untracked candidate files matched the reviewed fingerprint `be282772e3b5989941148be9ac7c795dcc2604b943247fe0079c4450d0e66f1a`. Astra's later report/evidence additions were inventoried separately. The reviewed combined build was copied before editing and matches all 33 files in Astra's artifact audit. The main checkout and its 92 pre-existing untracked files are preserved; no additional owner files were present at capture.

**Fix.** Native focus scrolling left partly visible labels clipped; the strip also lacked the full 4px outline clearance, and enlarged unwrapped labels could exceed the available width. A small action on the existing situation group now reveals only its connected keyboard focus owner. It scrolls horizontally within the strip, accounts for both the actual container and viewport, reserves the authored outline space and rounds outward. It responds to focused-chip/strip resizing, adjusts the page vertically only when the focused outline genuinely leaves the visible area, and cancels/guards deferred work when focus moves or the topic unmounts. It does not follow an unfocused selection or respond to manual scrolling.

Situation-only CSS permits full labels to wrap, caps their width to the strip's content width and lets height grow naturally. The global chip style and its Show hidden consumers are unchanged. Tab order (including Firefox's native scroll-container stop), the labelled group, `aria-pressed`, Enter/Space filtering, All situations, search, memory-only state and native touch/pointer scrolling remain intact.

**Scope.** Three application files: `src/features/topics/TopicPage.svelte`, new `src/features/topics/revealFocusedChip.ts`, and `src/app.css`. Regression unit coverage is in new `src/features/topics/revealFocusedChip.test.ts`. Documentation changes are this append and new `docs/evidence/eng-v2-03-rc1/`. [The full evidence README](../evidence/eng-v2-03-rc1/README.md) describes the implementation and reproduction; [preservation-after.json](../evidence/eng-v2-03-rc1/preservation-after.json) contains exact before/after SHA-256 values, complete file scope and preservation results.

**Native regression.** The identical runner fails on the preserved reviewed build and passes on RC1 in Chromium 159.0.8154.6 and Firefox 159.0: seven focused scenarios and **157 complete-visibility measurements per engine**. Real Tab, Shift+Tab, Enter and Space cover every chip at 320/390px and ordinary/200% text. The oracle includes the full outline, actual clipping ancestors, viewport and text rectangles, with 0.75 CSS px fractional tolerance; it does not reveal chips before measuring. It also verifies focused reflow, vertical behavior, manual horizontal scrolling, stale callbacks, unmount, expected rows, Traveling plus `have you`, connected focus and memory-only state. Representative screenshots were inspected. No page errors or unhandled rejections occurred in the correction scenarios.

**Verification.** Both static checks report zero errors/warnings. All 15 content/build tests, 338 v2 tests (including three new lifecycle regressions), and 68 v1 tests pass. Root `npm run build`, `npm run build:site`, content verification and whitespace checks pass. The unchanged implementation browser runner passes all 12 scenarios per engine. Manifest/all 14 pack bodies, built v1, all font files/notices, identity mappings, Home rules, dependencies and historical evidence are preserved. Totals remain 1,622 records, 638 canonical cards and 34 subject topics; Words 566, Verbs 339.

**Budgets.** The same cold-load response-body method gives 97,264 B code, 193,052 B fonts and 240,899 B content on the heaviest route. Chromium totals **531,215 B**; Firefox includes 209 B for the favicon and totals **531,424 B**. RC1 adds 633 B of compressed code; content/fonts are unchanged. Limits remain 102,400 B code, 204,800 B fonts and 563,200 B total.

**Clarifications and limits.** The previous worst transfer total was **530,791 B in Firefox**; 530,582 B was Chromium. Consistent Windows path casing established local build reproduction, not a new Linux CI run. Astra confirmed that the ten documented browser groups expand to twelve actual scenarios. The Reset race remains an inherited deferred-focus defect exposed by a forced synchronous harness schedule, deferred and nonblocking under Astra's classification; it was not changed or re-probed here. Existing Learn again Undo test warnings also occur in the prior review logs. No Safari/WebKit, physical-device touch, assistive-technology, audible-speech or deployment verification is claimed.

Nothing staged, committed, pushed, merged or deployed. This correction is not independently approved or released.

**ENG-V2-03-RC1 — IMPLEMENTED / READY FOR INDEPENDENT RE-REVIEW**


## 13. RC2 — Focused chip after viewport-height changes

22 November 2026, Europe/Kyiv. Corrects **F1-RC1, P2** in [Astra's RC1 review](../reviews/ENG-V2-03-RC1-ASTRA.md): a viewport-height-only resize could leave the keyboard-focused situation chip's label and outline behind the fixed bottom navigation. The review classifies this as an outstanding focused-resize acceptance case and does not establish that RC1 introduced it. All sections above are byte-for-byte unchanged.

**Starting point.**
- Branch and HEAD are still `feature/eng-v2-03-learning-topics` at `03f1267f1ef4287580227ce5db67615988c98177`, with nothing staged.
- Before any edit, all 1,613 candidate inventory entries matched Astra's final RC1 record. The substantive fingerprint, excluding both review generations and the RC1 evidence, was `01c6ec10666ed943fbb3804101637cd00458ed60a8caaf319586e84e44e7039c`.
- The main checkout (1,332 entries, including its 92 pre-existing untracked files), the original review and the RC1 evidence also matched Astra's record. Astra's RC1 review additions (619 entries) were inventoried separately.
- The active build was RC1's: its `index.html` matches RC1's recorded hash, and its bundle sizes match Astra's measurements. An exact ignored copy served as the failing before-candidate; the worktree was not reset.

**Fix.** The reveal action scheduled work on focus and on strip/label size changes only. A height-only resize moves the fixed navigation without resizing either, so nothing was scheduled. `src/features/topics/revealFocusedChip.ts` now also calls its existing `schedule()` on window `resize` and removes that listener on destroy; two comments were updated. Nothing else in the application changed.
- **Reveal code unchanged.** The horizontal and vertical reveal code, outward rounding and authored outline clearance are untouched.
- **Coalescing.** `schedule()` cancels any pending frame first, so a burst of resize events yields one frame.
- **Guards.** The frame re-checks that the action is alive, the strip and target are connected, and the target still owns focus and is `:focus-visible`. Otherwise it reads no geometry and does nothing.
- **Only the focus owner.** No work is queued unless a chip in the strip has focus. Search, other controls and an unfocused selection, including its manual scroll position, are left alone.
- **Cleanup.** Destroy cancels pending work, disconnects the observer and removes all three listeners.
- **No loop.** A reveal's own scroll changes no size and fires no resize, so there is no correction loop or polling.
- **`visualViewport` not used.** The calculation stays in layout-viewport coordinates.

CSS, wrapping and horizontal clearance are unchanged; the built stylesheet is byte-identical.

**Native regression: RC1 fails, RC2 passes.** Astra's `viewport-resize.mjs` and oracle were copied with only their output folder and served build changed. On the authenticated RC1 build, at 320 × 480, Coffee's outline is covered by **36.891 px in Chromium 159.0.8154.6** and **36.500 px in Firefox 159.0**, and the probe exits 1. On RC2 it passes in both, with the 0.375/0.400 px fractional residual already present before the resize; it exits 0.

The full required sequence, run by one runner on both builds with Astra's unchanged `measureFocus` oracle and its 0.75 px tolerance:
1. 320 × 844, real 200 % text (28 px chip text) with the intended fonts loaded.
2. Native Tab to **All situations**, then three Tabs to **Coffee and lunch breaks**.
3. Height only to 480; restore 844; shrink to 480 again.

There is no test-side click, refocus or scroll. The strip (320 × 104.375 px, scroll width 1819) and Coffee (288 × 96.375 px, two lines) keep their sizes, so the case is a viewport-only change. Coffee keeps focus and All situations stays selected.

| | Chromium at 480 | Firefox at 480 | Second shrink |
|---|---|---|---|
| RC1 | 36.891 px covered, 6 characters clipped | 36.500 px covered, 6 characters clipped | fails again |
| RC2 | complete: outline bottom 379.109, navigation top 379.219; page 430 → 467 px | complete: outline bottom 379.200, navigation top 379.200; page 430.5 → 467 px | complete |

**Additional coverage.**
- **Native, per engine: RC1 4/8, RC2 8/8.**
  - Before/after cases: ordinary text at 320 px (RC1 30.4 px covered) and 200 % text at 390 px (RC1 about 30 px covered); a burst of six resizes, which now ends in one or two reveal scrolls and no further movement.
  - Lifecycle guards, passing on both builds: Search keeps focus and nothing scrolls; a wheel-scrolled, unfocused Traveling selection keeps its position; focus moving during a resize leaves the new owner visible; navigating Home immediately after a resize leaves no error or late scroll.
- **Unit tests.** Seven new tests in `revealFocusedChip.test.ts` were written before the fix: 3 failed and 7 passed against the unchanged RC1 action; all 10 pass after it. They dispatch real `resize` events while sizes stay fixed, and run either only still-requested frames or deliberately also canceled ones. They cover:
  - the reveal and a repeated reveal after restoring;
  - Search focus, and an unfocused manual scroll position;
  - no reveal of, and no reads from, a former owner;
  - destroy with detached elements and no errors;
  - burst coalescing with no follow-up loop.
- **Existing coverage on RC2.** The RC1 focused runner, copied with only its output changed, passes 7/7 scenarios and 157/157 visibility measurements per engine. The unchanged implementation runner passes 12/12 scenarios per engine.

**Verification.** The documented gates ran once as a set:
- `npm run check` and `npm run check:v1`: 0 errors and 0 warnings (266 and 189 files).
- `npm test`: 15/15 content and build tests and 345/345 v2 tests in 29 files (RC1: 338).
- `npm run test:v1`: 68/68.
- `npm run build`, `npm run build:site` and `npm run verify:content` pass.
- The tracked and new-file whitespace checks are clean, and were repeated after this documentation.

The 18 existing Learn again Undo `lifecycle_double_unmount` warnings are unchanged, and there are no new errors or unhandled rejections.

**Budgets.** The same cold-load response-body method gives code **97,280 B** (+16 B over RC1's 97,264 B), fonts 193,052 B and content 240,899 B on the heaviest route, `#wordIndex`. Fonts and content are unchanged. The larger total is **531,440 B** in Firefox (Chromium 531,231 B; RC1 531,424 B and 531,215 B). Limits remain 102,400 B code, 204,800 B fonts and 563,200 B total. These are local Windows measurements, not a CI or production run.

**Preservation.**
- 31 of 33 built files are byte-identical to RC1: only `index.html` and the renamed script differ. RC1's protected artifact groups are unchanged: the manifest and 14 packs, built v1, font notices and font assets.
- The source delta is exactly `revealFocusedChip.ts`, `revealFocusedChip.test.ts` and this handoff append. The earlier handoff bytes are an exact prefix.
- Unchanged: every other candidate file, the main checkout, both review generations, the RC1 evidence and the Git exclude file.
- Evidence and reproduction: [`docs/evidence/eng-v2-03-rc2/`](../evidence/eng-v2-03-rc2/README.md).

**Limits.**
- Height changes are covered when the browser reports them as a window `resize`. Changes only to the visual viewport are not claimed: pinch zoom, and on-screen keyboards or toolbars in browsers that do not resize the layout viewport.
- Not verified: Safari/WebKit, physical devices and touch hardware, assistive-technology output, audible speech, OS text settings, Linux CI and deployment.
- The inherited Reset-dialog finding remains deferred.

Nothing staged, committed, pushed, merged or deployed; no PR was created. This correction is not independently approved or released.

**ENG-V2-03-RC2 — IMPLEMENTED / READY FOR INDEPENDENT RE-REVIEW**
