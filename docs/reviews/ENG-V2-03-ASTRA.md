# ENG-V2-03 — Independent implementation review

22 November 2026, Europe/Kyiv. Reviewer: Astra/Codex.

One new P2 keyboard usability defect requires correction: Small Talk situation chips can retain keyboard focus and selection while most of their label is clipped. The content, canonical identity, Home calculations, preservation checks and documented builds passed independent verification. The disclosed Reset rejection is reproducible in the released baseline as well as the candidate, under the original forced test schedule; it is not established as a new user-facing regression.

**Reviewed candidate and boundaries**

| Item | Verified value |
|---|---|
| Worktree | `eng-trainer/.worktrees/eng-v2-03` |
| Branch | `feature/eng-v2-03-learning-topics` |
| Base and HEAD | `03f1267f1ef4287580227ce5db67615988c98177` |
| Candidate | Uncommitted, unstaged; 24 modified tracked files and 68 untracked files |
| Candidate SHA-256 | `be282772e3b5989941148be9ac7c795dcc2604b943247fe0079c4450d0e66f1a` |
| Acceptance source | Owner's `ENG-V2-03-IMPLEMENTATION-TASK.md`; attached independent-review brief |
| Reviewer additions | This report and `docs/reviews/eng-v2-03-astra/` only |

The attachments supplied acceptance criteria and review context. They did not authorize implementing fixes or releasing the feature. No application code, implementation tests, authored content, dependency files, developer runners or historical evidence were edited. Nothing was staged, committed, pushed, merged or deployed; no PR was created.

Before testing, `preserve.mjs` captured every candidate file, including untracked content and evidence, plus the binary-capable Git diff. The fingerprint above hashes the sorted changed/untracked entries, each containing its relative path, byte SHA-256 and Git-state flags, excluding the new reviewer location. Full inventories are in [preservation-before.json](eng-v2-03-astra/preservation-before.json) and [preservation-after.json](eng-v2-03-astra/preservation-after.json). Local exact copies remain in the reviewer directory's ignored `candidate-snapshot/` and `candidate.patch`.

**Required finding — F1, P2: reveal the complete focused situation chip**

Location: [TopicPage.svelte](../../src/features/topics/TopicPage.svelte), lines 106–109, and [app.css](../../src/app.css), lines 755–765.

The new horizontal chip strip relies on the browser to reveal focused buttons. Both tested engines leave a partly visible button in its current position. Consequently, Tab can focus a chip whose label and focus outline extend beyond the clipped scroll area; Enter selects it without revealing the rest of the label.

Reproduction, with the intended fonts loaded:

1. Open `#topic/small-talk` at 320 × 844 or 390 × 844.
2. Tab to **All situations**, then Tab twice to **Before a work meeting**.
3. Observe the clipped label and focus outline. Press Enter: the chip is selected but remains clipped.
4. Continue tabbing. **Free time and weekends** has the same problem. At 200% text, additional labels are mostly outside the visible strip.

| Case | Focused chip bounds | Visible viewport | Result |
|---|---:|---:|---|
| Chromium, 390 px | x = 282.84–444.34 | 0–390 | Rightmost 54.34 px clipped |
| Firefox, 390 px | x = 282.82–444.27 | 0–390 | Same behavior |
| Chromium, 320 px | x = 282.84–444.34 | 0–320 | Only the first 37.16 px visible |
| 390 px, 200% text, Coffee and lunch breaks | x = 351.66–665.50 | 0–390 | Only the first 38.34 px visible |

This is a sighted-keyboard usability problem, particularly at narrow widths or enlarged text: learners must select a partly unreadable option or scroll separately to identify it. All chips remain keyboard activatable, `aria-pressed` works, and there is **no horizontal page overflow**. Those facts do not resolve the clipped focused label.

Correction requested: reveal each focused chip within the horizontal scroller, including enough space for its focus outline, while preserving the established vertical focus behavior. An appropriate focus handler with inline scrolling, or an equivalent layout solution, would address this. Add a regression check for complete focused-chip visibility at 320/390 px and enlarged text in both engines.

Evidence: [Chromium focused and selected chip](eng-v2-03-astra/chromium-chip-focused-selected-clipped.png), [Firefox focused and selected chip](eng-v2-03-astra/firefox-chip-focused-selected-clipped.png), and [all measurements](eng-v2-03-astra/browser-additional.json). The diagnostic waits for native scrolling to settle and uses real Tab/Enter events. ArrowRight can scroll the strip separately; a single press still left this chip partly clipped. The implementation browser harness checks activation and vertical focus but does not assert complete horizontal visibility.

**Independent content and preservation results**

`content-oracle.mjs` parses the owner's original Markdown, rather than taking the developer's editorial fixture or mapping as its expected text. It found all 72 practice pairs exactly once: 18 conditional examples, 36 Small Talk phrases and 18 interview frames. It verified the six conditional groups' patterns/use/time distinctions, usage note, six situations, twelve translated interview questions, six structures and six translated model answers. Descriptions, literal brackets, shared notes and the fictional/hypothetical labels match the source. The documented quotation marks around “Shall we get started?” are harmless presentation changes.

All 72 source-to-catalog mappings were independently resolved from the required English/Ukrainian pairs, then compared with the supplied mapping. There is no exact reuse of a released practice text, no artificial word-index growth, and no extra flashcards from supporting content. Native checks confirmed visible fictional/hypothetical labels on both Topic and Answers screens and English listening invocation for the final interview model answer. See [content-oracle.json](eng-v2-03-astra/content-oracle.json) and [editorial-mapping.json](eng-v2-03-astra/editorial-mapping.json).

The preservation oracle reconstructs `03f1267` directly from Git's descriptor and eleven pack sources, without the candidate's projection helper. This reconstruction equals the historical `c84ef30` monolith structurally, including order. Original IDs, field values, all 566 explicit word links and the ID-less answers/patterns/drills remain intact. All eleven generated pack bodies and content-addressed URLs match the independently reconstructed release.

Six mutation probes were rejected by both the candidate's preservation check and the independent oracle: changing an original field, deleting an original, changing a link, reordering originals, moving an original into a new pack, and altering an ID-less answer. Moving a record is detected through the released-pack comparison even when its relative catalog position could otherwise remain valid. The independent search oracle tested 745 queries in each of the four search domains against released records and their expected ordering.

Derived totals are **1,622 records, 14 packs, 638 canonical cards and 34 subject topics**. The delta is 3 blocks, 72 phrases, 6 supporting answers and 3 topic-metadata records; Words remain 566 and Verbs 339. No historical fingerprint was replaced with a larger-catalog fingerprint.

The optional metadata extension is compatible with old packs and answers without IDs/labels. Seventeen independent malformed fixtures failed at both generation and runtime boundaries. They cover unknown topic/subsection keys, malformed field types, duplicate IDs/titles, incorrect blocks, absent/wrong-category/duplicate/unlisted phrase references, and an `answerId` pointing to an existing phrase instead of an answer. Pack IDs, topic-address IDs and learning-record IDs were tested as distinct namespaces. Imported vocabulary still merges after built-in validation. A malformed new pack in each native browser produced the branded startup error with no partial catalog or learning writes, then recovered on retry.

**Independent metrics and state results**

The set oracle enumerates all 16 learned subsets of four explicit canonical identities: a phrase, a same-text independent phrase, a hidden available phrase and an independent word. A linked word gives one phrase membership in a second topic. Expected memberships are literal sets independent of `homeStats.ts` and `buildFlashcards`. Global deduplication, overlapping word/phrase detail counts, both topic completions, empty cases, unavailable learned IDs and input immutability passed. Focus includes available blocks/words/verbs and excludes retained unavailable favorites.

The native same-name boundary passed in Chromium and Firefox:

| Step | Vocabulary | Conditionals | Eligible topics |
|---|---:|---:|---:|
| Learn all built-in examples | 18 / 638 | Complete, 18 / 18 | 34 |
| Import one unlearned independent word in `Conditionals` | 18 / 639 | Incomplete, 18 / 19 | 34 |
| Hide the imported word | 18 / 639 | Still incomplete | 34 |
| Undo Hide, learn it, then remove its collection | 18 / 638 | Complete, 18 / 18 | 34 |
| Native reimport with retained learned state | 19 / 639 | Complete, 19 / 19 | 34 |

Home's topic card correctly describes the shared deck as “18 of 19 practice cards learned.” The authored screen correctly lists “18 practice phrases” and makes no conflicting completion claim. **Practice this topic** includes the imported member with All collections, keeps Built-in vocabulary when selected, and changes a selected user collection to All collections. These adjustments leave Home totals and existing saved deck sessions intact.

Learn, Learn again, valid Undo, Hide/Undo, Reset and reload passed native checks. Reset remained on Settings until navigation. Cancelled and deliberately failed imports/removals changed neither the published catalog counts nor retained progress. Removing/reimporting a favorite word changed In Focus from 2 → 1 → 2 while an existing verb favorite stayed available.

A restricted Learn Pass, topic/collection selections, search and Small Talk chips did not alter global totals. Pagination remains outside the selector inputs and is memory-only; existing integration checks exercise the display settings. Learned vocabulary was checked through the Flashcards review view.

Actual IndexedDB `put/add/delete/clear`, write transactions and localStorage writes were instrumented. After setup and save settlement, opening/closing Home details produced **zero operations**. Navigating back to Home produced only the existing `settings.activePage` write and its transaction. Selectors neither mutate their inputs nor persist summary data. The database remains version 2 and the import/export contract is unchanged. See [independent test results](eng-v2-03-astra/independent-final.json), [native state evidence](eng-v2-03-astra/browser-independent.json), and [reactivity checks](eng-v2-03-astra/browser-additional.json).

**Reset rejection classification**

The original failing schedule is preserved in the candidate snapshot and reproduced in `race-probe.test.ts`: open Reset, confirm, flush Svelte synchronously after each click, then navigate Home and flush again without yielding. The developer's added `await app.saved()` and timer turn are at `App.home.test.ts`, lines 261–263.

Both `03f1267` and this candidate reject with `TypeError: Cannot read properties of null (reading 'contains')` at `ConfirmDialog.svelte:49`. The close branch awaits `tick()`, navigation unmounts the dialog and clears its binding, then the continuation dereferences that binding. The diagnostic reproduces this without explicit focus manipulation or DOM removal. Its dedicated configuration deliberately captures expected unhandled rejections; the two diagnostic tests assert their presence rather than claiming error-free execution.

In native Chromium and Firefox, Confirm, Cancel and Escape followed immediately by ordinary Home clicks or browser history navigation passed against both builds, with no page errors or unhandled rejections. Reset itself does not unmount Settings: that page is always available, and the local active-page variable remains Settings. Collection removal also exercised the opener-removal/fallback path successfully.

Classification: **inherited deferred-focus defect exposed by a forced synchronous harness schedule; nonblocking for this milestone**. It deserves a guarded binding in future maintenance. The added wait is not proof of harmlessness, and “a person cannot leave sooner” is too categorical; the evidence supports the narrower baseline/reachability conclusion above. Stacks and exact probe are in [reset-race.json](eng-v2-03-astra/reset-race.json).

**Routing, shared components and visual checks**

Fresh topic links, reload, back/forward, unknown/malformed topic addresses and unavailable topics under a Learn Pass behaved correctly. Library selection, base-aware Home branding, skip link and page-heading focus remain intact. New rows share their learning identity across Topic, Phrases, Focus and Flashcards. Small Talk combines search and chips, retains them in memory across navigation, and resets them on reload.

Released Pattern/Answer markup matches the baseline after ignoring non-rendered Svelte markers/whitespace. Listening and language protection were also exercised after extraction. Native inspection checked explicit `lang="en" translate="no"` on teaching text and `lang="uk"` on built-in translations, rather than relying solely on a Cyrillic scan. Imported translations retain the existing unknown-language convention.

At 390, 320 and desktop widths, the implementation harness found no page overflow or controls below its 44 px target check. The phone header is 47 px and grows with enlarged text. Home's first topic entry starts at 639 px, above the tab bar at 779 px. Study content begins at 203 px for Phrases/Words and 247 px for Flashcards. Verbs at 255 px is proportionate to the approximate 250 px target and is not a finding. Topic rules/questions are meaningful study content; their different introductory layout is not treated as a list-geometry defect. F1 is the distinct horizontal keyboard-focus failure discovered beyond that harness.

**Commands, browsers and budgets**

All candidate commands ran from the reviewed worktree. [Command records and logs](eng-v2-03-astra/commands-native/commands.json) contain actual outcomes.

| Verification | Result |
|---|---|
| `npm run check`, `npm run check:v1` | Both: 0 errors, 0 warnings |
| `npm test` | 15 content/build tests and 335 v2 tests passed |
| `npm run test:v1` | 68 tests passed |
| `npm run build`, `npm run build:site` | Passed |
| `npm run verify:content` | Passed |
| Tracked and new-file whitespace checks | Passed |
| Independent Vitest suite | 24 / 24 passed |
| Expected-rejection Reset diagnostic | Baseline and candidate both reproduced |
| Unmodified implementation browser runner | 12 / 12 scenarios per engine |
| Independent native checks | Six main groups plus two focused groups per engine; F1 captured by focus geometry |

Native versions were Chromium 159.0.8154.6 and Firefox 159.0, using the existing isolated Playwright installation resolved through the worktree's common Git directory. Every context was synthetic and nonpersistent. No owner profile or system clipboard was used. Speech was mocked: invocation/text/language were tested, not audible output. Deliberately blocked content/v1 font requests and injected transaction failures are expected evidence, not unexplained application failures.

The established cold-load method was rerun: local gzip level 9, WOFF2 as stored, browser response-body bytes excluding headers. The heaviest measured route was `#wordIndex`.

| Build/engine | Code | Fonts | Content | Other | Total |
|---|---:|---:|---:|---:|---:|
| Release / Chromium | 88,775 | 193,052 | 230,303 | 0 | 512,130 |
| Candidate / Chromium | 96,631 | 193,052 | 240,899 | 0 | 530,582 |
| Release / Firefox | 88,775 | 193,052 | 230,303 | 209 | 512,339 |
| Candidate / Firefox | 96,631 | 193,052 | 240,899 | 209 | 530,791 |

Code grows by 7,856 B and content by 10,596 B; fonts are unchanged. Limits remain 102,400 B code, 204,800 B fonts and 563,200 B total. All measured routes pass. See [budget-comparison.json](eng-v2-03-astra/budget-comparison.json).

**Nonblocking documentation and harness observations**

- The ten numbered browser groups expand to twelve actual scenarios because the first group runs separately at phone, narrow and desktop sizes. The reported 12/12 is supported, rather than a missing-two-tests discrepancy.
- The evidence README's “worst total 530,582 B” is inaccurate. The actual worst result is Firefox's **530,791 B**. The Chromium-labelled handoff table is correct; both totals remain under budget.
- Matching Windows path casing reproduces the local build and archived release assets. A compiler-options probe confirms a case-mismatched root can change the scoped CSS hash. This does not prove execution equivalence with Linux CI; no new CI run occurred. [Artifact audit](eng-v2-03-astra/artifact-audit.json) records the narrower evidence.
- The built-in architecture document retains older statements about database version 1 and future collections; the unchanged actual storage contract and current collections document specify version 2. This inherited prose is not an implementation regression.
- Initial sandbox checks failed because Vite/esbuild could not read an ancestor directory. The same commands passed outside that filesystem sandbox. The first reviewer test configuration accidentally concatenated the implementation test glob; its initial verb-search expectation also included fields absent from the released search contract. These harness issues were corrected, and the isolated 24-test run passes. Browser selectors were corrected to visible UI labels. F1's clipping measurements were retained, not dismissed as a harness failure.

**Preservation and remaining limits**

Final inventories match the initial inventories exactly for all 1,308 candidate non-review files and all 1,332 main-checkout tracked/untracked files. Main remains on `main` at the same HEAD with no tracked/staged changes; its 92 pre-existing untracked files are byte-identical. The candidate's 24 modified/68 untracked files and fingerprint are unchanged. All 55 tracked v1 files, all 763 existing candidate historical-review files, developer evidence/runners and dependency files are preserved. Local Git exclusions were unchanged.

The review build reproduces the developer's complete recorded artifact byte-for-byte. Independently rebuilt baseline assets match the locally archived release. V1 JS/CSS are byte-identical to that archive; its HTML, JSON and SVG differ only in carriage returns, including a generated double-CR line in HTML. This is narrower than claiming every v1 artifact byte matches across platforms.

Untested: Safari/WebKit, real mobile devices, assistive-technology speech output, audible synthesis, Linux CI, live GitHub Pages deployment and production compression. No unrelated historical review campaign was rerun. Reproduction commands and evidence organization are in the [review evidence README](eng-v2-03-astra/README.md).

**CHANGES_REQUIRED**
