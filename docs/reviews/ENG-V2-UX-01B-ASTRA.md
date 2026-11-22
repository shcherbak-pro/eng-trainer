# ENG-V2-UX-01B — Independent Astra review

**CHANGES_REQUIRED.** Five corrections remain: stale Undo invalidation, focus recovery, focus on invalid import records, font-distribution permission evidence, and language markup. The ordinary learning/import paths, documented checks and combined build pass. The passing implementation suite does not cover the failing interactions below.

| Review identity | Value |
|---|---|
| Date | 22 November 2026, Europe/Kiev |
| Candidate | `feature/eng-v2-ux-01b-spoken-line`, **uncommitted working tree**, including untracked source, fonts, assets and documentation |
| HEAD / design-release baseline | `f14dd4e33de2dfcbd8b80e1b72dbfec4326823d3` |
| Independent fingerprint | `1df5517c9fedb1ef909d74e4788e5f943c40a34ca7f6e8d65f47c9c39b5e0231` — SHA-256 of the ordered path/hash manifest, including deleted paths as null |
| Captured paths | 696 tracked/nonignored candidate paths; review additions excluded |
| Verification | Original working tree, then its freshly assembled `site-dist`; no checkout of HEAD substituted for the implementation |
| Environment | Windows; Node 24.18.0; npm 11.17.0; Playwright 1.65.1; Chromium 159.0.8154.6; Firefox 159.0 |
| Evidence | [Review directory](eng-v2-ux-01b-astra/README.md), [candidate manifest](eng-v2-ux-01b-astra/candidate-before.json), [final protection check](eng-v2-ux-01b-astra/preservation-after.json) |

The parent `AGENTS.md` was read. Its web-school/Angular architecture guidance does not change this explicitly requested Svelte review; repository scope, no commits and required build were followed. No local/nested `AGENTS.md`, bootstrap or verified Agent Framework binding was found; workspace `.agents` and `.codex` were empty. No external framework memory was assumed. The UX-01A proposal, UX-01B handoff/evidence, ENG-V2-02B handoff, original review and RC1 review were read. Relevant implementation diffs, existing behavioral tests and added source/tests were inspected; the complete tracked diff was also captured separately.

## Findings requiring correction

**F1 — High: Undo can overwrite newer intent and retained callbacks can resurrect pre-reset progress. Blocks integration.**

Visible reproduction in **both native browsers**:

1. Seed one learned phrase and a saved `all` deck whose first slot is that phrase. In the evidence this is `agent-vocab-001`; this is synthetic learning state over public built-in content.
2. Open Flashcards → Review learned vocabulary → Learn again for that phrase.
3. Return to flashcards. The phrase is now the current card. Choose **Keep learning**.
4. Before its notification expires, choose the old **Undo**.

Expected: a deliberate stale-action rule prevents the older Undo from reversing the newer answer. Actual: `learnedPhrases` gains the phrase again, even though the latest answer was Keep learning. This is persisted, rather than merely a misleading counter. The independent `learn-again-same-card-new-intent` scenario fails in Chromium and Firefox.

There is also a reset-boundary failure. The separate mounted-component test captures the real Learn again toast callback, opens the production Settings confirmation and presses **Reset progress**, waits for storage, then invokes that retained callback. Expected: the reset remains authoritative. Actual: the callback writes the pre-reset learned flag back to IndexedDB. An old Hide callback is initially harmless after Reset because the item is no longer hidden; if a new Hide later targets the same ID, the old callback can unhide it and restore its **pre-reset** learned and Focus flags. The same stale Hide behavior occurs after Show/newer same-entry choices without Reset.

**Reachability distinction:** the normal Settings UI replaces the old toast with “Learning progress was reset”; a visible old Undo button was **not** left behind. The post-reset reproduction explicitly retains and invokes the callback, as required by the review brief. The Keep learning reproduction is a normal, visible UI path. No claim is made that a disappeared toast is normally clickable.

Cause: [FlashcardsPage.svelte](../../src/features/flashcards/FlashcardsPage.svelte), lines 184–194, captures an ID and restores its learned flag whenever absent. [HideButton.svelte](../../src/shared/entries/HideButton.svelte), lines 33–62, captures two booleans and checks only whether the ID is currently hidden. Neither records an entry mutation version or reset generation. [state/index.ts](../../src/state/index.ts), line 50, resets state without invalidating callbacks. Replacing a notification is not callback invalidation.

Small correction: invalidate old operations across global Reset and later relevant changes to the same entry. Keep the inverse scoped to that ID; do not restore a whole progress/deck snapshot. Add regression assertions for the reset callback and newer same-entry answer paths.

Evidence: [final native failures](eng-v2-ux-01b-astra/native-failures-final/results.json), [independent component tests](eng-v2-ux-01b-astra/independent.test.ts), and their [logs](eng-v2-ux-01b-astra/logs/). Four of seven new component tests fail for stale callbacks; three pass. Ordinary Learn again → Undo restores saved state; answering another card then Undo preserves that answer, both deck records, cursor and unavailable slots. A failed queued pre-reset save followed by Reset and successful retry **does not** resurrect progress: queue replay ordering passed, distinct from callback invalidation.

**F2 — Medium: Learn again and its Undo discard keyboard focus; Learn Pass deletion has the same missing fallback. Blocks integration.**

Reproduction in both browsers: learn one card, open its learned list, focus **Learn again**, press Enter. The row/button disappears and `document.activeElement` becomes `BODY`. Focus the toast's Undo and press Enter: the row returns, but focus again becomes `BODY`. Expected: focus moves to a meaningful surviving control/row, then returns to the restored entry on Undo. Users otherwise lose their place and must rediscover the controls. Native focus measurements, not ARIA inference, establish both results.

Deleting a synthetic Learn Pass through its confirmation likewise ends on `BODY`: the opener was removed and no fallback is provided. Escape/Cancel restore focus correctly while the opener exists. Global Reset's surviving opener and the More sheet also behave correctly.

Locations: [FlashcardsPage.svelte](../../src/features/flashcards/FlashcardsPage.svelte), lines 184–194 and 394; [ToastRegion.svelte](../../src/shared/ui/ToastRegion.svelte), `act()` removes the focused action; [LearnPassManager.svelte](../../src/features/home/LearnPassManager.svelte), line 82; [ConfirmDialog.svelte](../../src/shared/ui/ConfirmDialog.svelte), line 39, restores focus only if the opener remains connected. Hide already demonstrates an entry-level focus recovery pattern.

Small correction: choose a surviving next row, review heading or return control after Learn again; restore the returned row after Undo. Supply an explicit fallback when deleting a Learn Pass removes the dialog opener. Preserve user focus if it has deliberately moved elsewhere.

Evidence: `learn-again-keyboard-focus` in [final failures](eng-v2-ux-01b-astra/native-failures-final/results.json), and `deck-and-pass-confirmations.focusAfterPassDeletion` in [native results](eng-v2-ux-01b-astra/native/results.json). Both action and Undo record `BODY`. A six-second toast is not the only recovery path: Show remains available for hidden entries, and the card can be answered again; restoring Focus/learned state after a Hide toast expires requires those separate controls. This does not resolve the focus defect.

**F3 — Medium: record-level import errors focus a normal review heading instead of the error summary. Blocks integration.**

Reproduction: choose `invalid-record.csv` containing:

```csv
english,translation
invalid,
```

Expected under UX-01A §5.4 and the review's F3 requirement: focus on the error summary explaining the missing translation and how to correct it. Actual in both browsers: focus is `h3#review-title`, “Review ‘invalid-record.csv’”. The blocking message is rendered farther down, and the import button is disabled. Whole-file errors such as missing headers or invalid JSON correctly focus the Notice; valid previews correctly focus the heading. Whole-import rejection and no-write behavior are sound.

Cause: [CollectionsPage.svelte](../../src/features/collections/CollectionsPage.svelte), line 99, always focuses `reviewHeading` after a successful parse, even when `plan.issues` is nonempty. The issue Notice at lines 295–309 has no focus target binding. The parser reports invalid entries as issues rather than throwing, so the catch branch is not reached.

Small correction: bind/focus the issue summary when the final plan has blocking issues, using the same selection token check already protecting preview/error focus. Test missing values, invalid kinds and native identity conflicts, not just thrown parser errors.

Evidence: `invalid-record-error-focus` in [final native failures](eng-v2-ux-01b-astra/native-failures-final/results.json); [Chromium screenshot](eng-v2-ux-01b-astra/native-failures-final/chromium-invalid-record-error-focus.png). The multiline fixture correctly reports **record 3**, skipping blank lines and counting a quoted multiline value as one record; this is not a line-numbering defect.

**F4 — Medium: the four self-hosted Source Sans 3 subsets lack verified RFN permission for this distribution. Blocks integration until resolved.**

Affected files are `src/assets/fonts/source-sans-3-{latin,latin-ext,cyrillic,greek}.woff2`, used under the Source Sans 3 family name in [fonts.css](../../src/styles/fonts.css). [asset-audit.json](eng-v2-ux-01b-astra/asset-audit.json) records exact SHA-256s, font metadata, published asset matches and upstream download URLs. All four are **byte-identical** to Google Fonts v20 WOFF2 subsets fetched during this review. Their internal version is **3.052**, they retain the primary Source Sans 3 names and the metadata notice reserving “Source”. Thus this is not a claim that Fable re-subsetted the files.

The distribution nevertheless needs its own supported licensing basis. [Google's Source Sans 3 OFL](https://github.com/google/fonts/blob/main/ofl/sourcesans3/OFL.txt) condition 3 restricts modified fonts using reserved names without written permission. SIL treats preset glyph subsets as modified versions; identical redistribution of Google's subset does not make it the author's original complete font. [SIL webfont guidance](https://openfontlicense.org/webfonts-and-reserved-font-names/) explains the relevant distinction. Google's guide describes RFN agreements for Adobe fonts and gives permission wording scoped to Google and affiliates serving through Google Fonts; it does not establish permission for this independent self-hosted package. [Google Fonts license guide](https://googlefonts.github.io/gf-guide/license-file.html). SIL also says downstream users need to know whether a separate agreement covers them. [OFL FAQ §5.8](https://openfontlicense.org/ofl-faq/).

Expected: documented authorization covering these exact subsets and this self-hosting arrangement, or an author-original/appropriately renamed distribution. Actual: the candidate documents only that Google's files were copied unchanged; no applicable downstream authorization is supplied or established by the primary sources inspected. This is a concrete **unresolved distribution condition**, not a categorical legal finding based merely on the word “Source”.

Smallest correction: document an applicable written permission if one exists. Otherwise retain the typography while using a verifiably author-distributed original webfont, or rename the subset's primary names and CSS family consistently to comply with the RFN restriction, retaining attribution and OFL. Recheck bytes if the font payload changes. No font or typography changes were made during review.

Both OFL texts and copyright notices are included; font metadata preserves its own notices. The different copyright-year strings in Google's license copy and font metadata alone are not treated as a violation. Literata 3.103 has no comparable reserved-name issue in the supplied license. Its two files also match Google v40 exactly. Vite copies all six fonts byte for byte into hashed assets; it does not transform/subset them. The candidate README omits exact download URLs/version details, now independently recorded in the review evidence.

**F5 — Medium: English content is sometimes labelled Ukrainian, and English study questions/prompts remain translatable. Blocks integration.**

Two independently observed markup failures:

- Put the “100 popular irregular verbs” learning block in Focus. Its description begins “100 popular irregular verbs grouped by everyday/work context…”, but the rendered span has `lang="uk"`. Home uses the same unconditional attribute. The built-in manifest has 23 descriptions without Cyrillic letters, including unambiguously English descriptions; these cannot all be labelled Ukrainian. Expected: language metadata appropriate to the content, with English descriptions inheriting/using English. This can select the wrong pronunciation in assistive technology; no actual screen-reader pronunciation test is claimed.
- Open Answers, then Speaking prompts and choose Random prompt. The English answer questions, current speaking prompt and All prompts items have effective DOM `translate === true`. Expected: English study material opts out of browser translation, as the answer bodies and phrase terms already do. Actual: only part of these study screens is protected. A browser translation session was not invoked; the missing opt-out and its DOM behavior are verified.

Locations: [IndexPage.svelte](../../src/features/home/IndexPage.svelte), line 242; [FocusListPage.svelte](../../src/features/focus/FocusListPage.svelte), line 48; [AnswersPage.svelte](../../src/features/exercises/AnswersPage.svelte), line 20; [PracticePage.svelte](../../src/features/exercises/PracticePage.svelte), lines 15 and 23. The English example in the import preview also lacks the protection used on its English term (`CollectionsPage.svelte:328`).

Small correction: identify known description languages instead of marking every block Ukrainian, and apply `translate="no"` to English study questions/prompts/examples while keeping interface copy translatable. Preserve `lang=""` for imported translations of unknown language.

Evidence: `english-block-language` and `study-text-translation-protection` in [final native failures](eng-v2-ux-01b-astra/native-failures-final/results.json). Both browsers reproduce the same DOM results. Shared phrase/word/verb terms and examples otherwise use appropriate English/known-Ukrainian markup and preserve literal imported text.

## Verification and preservation

| Verification | Independent result |
|---|---|
| `npm.cmd run check` | 0 errors, 0 warnings |
| `npm.cmd test` | 10/10 content/build tests; 247/247 v2 tests, 18 files |
| `npm.cmd run check:v1` | 0 errors, 0 warnings |
| `npm.cmd run test:v1` | 68/68 |
| `npm.cmd run build:site` | PASS; includes the required root **`npm run build`**, v1 build, assembly and site check |
| `npm.cmd run verify:content` | PASS: 1,538 built-in records, exact values/order, 566 links, v1 unchanged |
| `git -c core.whitespace=cr-at-eol diff --check` | PASS; CRLF conversion warnings only |
| Existing browser runner, unchanged | 16/16 scenarios per browser |
| Independent native cases, with corrected harness assumptions | **17 pass / 5 fail per browser**, 22 distinct cases; failures map to F1, F2, F3 and the two parts of F5 |
| Independent mounted/source-state cases | 3 pass / 4 fail; failures are F1 variants |
| Protected release/design files | **101/101 byte-identical** to review start |
| Complete candidate / Git index / HEAD | All 696 path states unchanged; no staging or commits |

Commands, raw scenario results and screenshots are linked in the [evidence README](eng-v2-ux-01b-astra/README.md). Only review scripts, fixtures and evidence were added. Production source, implementation tests, handoffs, existing evidence, release inventories and design files were preserved. No push, PR, merge, deployment, package installation or owner-profile operation occurred. Browser contexts were fresh and nonpersistent. Clipboard calls were intercepted inside the page; the test verifies the exact text passed to `writeText`, **not** integration with the real OS clipboard. All new data is synthetic.

Independent native scenarios recorded no unexpected page/console errors; final failing-case reproductions also record zero unhandled rejections. Their failures are behavioral assertions. The unchanged regression runner records only expected refused-font requests, the deliberate 503 content failure in Chromium, and the preserved v1 page's blocked external font requests. Those are distinguished from application errors in the scenario-tagged logs.

**Reset and Undo coverage.** Opening, Cancel, Enter from initial Cancel, Escape and focus return passed. Native modal background controls remained inert; the browser may move focus out to browser chrome during Tab cycling. Confirmation writes the learned reset once. All specified learning lists, Learn Passes and sessions clear; imported entries/collections and dark theme remain; repeats reset to 10. Reload preserves the result, and a synthetic v1 localStorage sentinel is unchanged. Reset replaces the visible Hide Undo. Retained callback tests expose F1. Hide/Learn again action and Undo storage failures both show the existing unsaved notice; retry succeeds without partial persistence. Removed-collection slots/flags and another deck's cursor survive ordinary Undo and later answers.

**Import and collection coverage.** The actual downloaded BOM-prefixed CSV was selected through the production picker and imported. Its values match the displayed and intercepted copied text. The richer displayed CSV preserves quoted commas/quotes and explicit word/phrase kinds. The displayed JSON is a valid native preview; no reusable shared identities are introduced. Help, download, preview, cancellation and rejection leave collection/progress stores unchanged. Required headers, optional fields, UTF-8, comma/semicolon support, 2 MiB and 1,000-entry limits match the parser. Missing columns/values, invalid kind, unsupported type, malformed/unsupported JSON, invalid encoding and both limits produce useful errors and whole-import rejection. Multiline record locations are accurate. All five controlled reading races pass in both engines: valid A/valid B, invalid A/valid B, valid A/invalid B, cancel during A, and reselection of a corrected same-named file. A pending read clears the old importable preview; stale completions cannot change the current result, busy indicator or focus.

Conflict probes for import/rename/removal give operation-specific reload advice, without quota advice. A quota injection leaves the catalog and disk unchanged and does not report success. Empty rename is disabled; service validation remains distinct from storage errors. Native no-op/conflict rules, duplicate acknowledgement and atomic service boundaries retain their behavior in the implementation suites and browser regression. Remove/reimport retains progress and exact deck positions. Equal-text IDs and explicit links are checked by unchanged model/component assertions and identity-based independent cases; they are not deduplicated by display text. HTML-like imported text remains inert text. Cyrillic, reserved device, punctuation-only and path-character names download with the intended names and valid native contents; the pure filename suite also covers empty input and code-point length limits.

**F4 startup.** Source review confirms the shared pending-open coordinator, newest waiter selection, abort handling before hydration, and publication only by the current App attempt. Independent native tests repeat Check again four times while holding a version-1 connection: one open request, zero writes, useful guidance throughout. Releasing the holder preserves the seeded dark theme/learned flag with zero default writes. Choosing Continue without saving before release remains authoritative after the old open completes; later in-memory learning writes nothing. No page error or unhandled rejection occurred. Existing unit tests also cover callers without the blocked callback and abandoned late connections.

**Navigation, visuals and accessibility.** The unchanged runner surveys all 12 screens at 320×640, 390×844 and 1440×900 in light/dark, in both native engines. Direct routes remain available. Independent saved-page restoration checks cover all 12 IDs; Back/Forward, Library's import path and the existing `#practice` speaking screen work. The v1 link and isolated v1 load pass. Phone first study content is at 236 px for Phrases/Words/Verbs; Flashcard answer buttons fit above the bottom bar and on desktop. No whole-page horizontal overflow was measured. Long synthetic English/Ukrainian fields reflow at 320 px with 200% root text. Screenshots were visually inspected for representative light/dark, phone, desktop, long-text and font-fallback states; the automated geometry survey is broader than the individually viewed screenshots.

Skip link, visible focus, five-destination navigation, current-page state, More dismissal/return and Hide focus recovery pass. Keyboard focus clearance from the fixed bar is tested on seven screens. The runner's 44×44 checks target controls/links/disclosures/associated input labels, not decorative SVGs or text. Native modal dismissal/containment and destructive Cancel defaults pass, subject to F2 when an opener is removed. Toggle state and limited live-status regions were reviewed in source and accessibility snapshots. Reduced motion produces near-zero transitions and immediate answers. These are **not** a complete WCAG conformance result. No screen reader, real phone/touch hardware, Safari/WebKit, browser-driven 400% zoom, forced-colors mode or audible speech evaluation was performed; no new axe scan is claimed. The 320 px layout and 200% root-font test are not described as physical-device or actual browser-zoom tests.

**Font behavior and budget.** Delayed/failed-font runs remain readable; no icon-name flashes, broken controls or v2 Google Fonts requests occur. Representative English, Ukrainian and IPA characters render with Source Sans 3 in both browsers; canvas fallback comparisons and independent font metadata support coverage. The 264 px Chromium fallback-font position is accepted as the documented usability/reflow deviation; smaller text/clipping is not required. The brief system-theme loader before IndexedDB hydration remains the accepted storage-policy tradeoff.

The independent measurement serves the production build with gzip level 9 for text and unchanged WOFF2, uses a **fresh cold context**, a 390×844 viewport and **`#wordIndex`**, and waits for the shell, `document.fonts.ready`, network idle and a further 500 ms. It totals actual encoded **response body bytes**, excluding HTTP headers, including late font loads. Chromium: **510,131 B** total; Firefox: **510,340 B**, including its additional 209 B favicon. In each: code **86,700 B**, fonts **193,128 B**. These meet the stated 100 KiB code / 200 KiB fonts / 550 KiB total budgets. This is a controlled local compressed-transfer measurement, not a production/CDN claim or a comparison mixing decoded and transferred sizes.

**Combined site and v1.** The current site has **29 files**, with all six unchanged font binaries and both licenses present; the historical 21-file inventories are untouched. v1 JavaScript and CSS are byte-identical to the locally retained released artifact. Its three differing text files were examined individually: `favicon.svg` (4 CRLFs), `data/materials.json` (35,805 CRLFs), and `index.html` (45 CRLFs, including one **CRCRLF at line 45**). Removing only terminal carriage returns at those line boundaries makes each equal to the release. Ordinary single-CRLF normalization alone does **not** fully normalize the HTML. No blanket binary normalization was used; the exact repeated-carriage-return distinction is recorded in [asset-audit.json](eng-v2-ux-01b-astra/asset-audit.json). v1 source has no Git diff.

**Test quality and harness corrections.** Changed implementation tests retain behavioral assertions for identity, persistence/reload, source order and reset outcomes; selector changes follow the redesign. They are not merely snapshots of new markup. The new ordinary Undo test, however, cannot establish stale-callback behavior, and Hide's tests do not cross Reset. Invalid-import focus tests exercise thrown errors, missing returned-issue errors. Independent tests cover these gaps.

The initial command harness invoked `npm.ps1`, blocked by execution policy; `npm.cmd` fixed that. The filesystem sandbox then prevented esbuild from reading ancestor/config paths; the authorized scoped rerun passed outside that sandbox. Neither was an application failure, and no implementation changed. Two browser harness assumptions were corrected: native dialog Tab may briefly leave the document (it must not reach background app controls), and IndexedDB `getAll()` returns UUID-key order (template entries must be sorted by their stored position). Both corrected scenarios pass in both browsers; first results are retained separately. A short incomplete browser user-agent initially fetched static TTF references from Google; the corrected full user-agent retrieved the exact WOFF2 subset matches. These corrections are documented separately from F1–F5.

Unrelated session-size work, speech highlighting, pronunciation assessment, localization and earlier deferred findings remain out of scope. No historical exhaustive parser/model campaign was repeated where the underlying code remained unchanged.

**Final verdict: CHANGES_REQUIRED.**
