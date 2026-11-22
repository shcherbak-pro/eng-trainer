**READY_FOR_PR.** F1–F5 are resolved in the actual uncommitted RC1 candidate. The corrective changes introduce no integration blocker in the reviewed behavior. Production code and implementation tests were not edited.

| Candidate identity | Verified value |
|---|---|
| Review date | 22 November 2026, Europe/Kiev |
| Branch | `feature/eng-v2-ux-01b-spoken-line` |
| HEAD / release baseline | `f14dd4e33de2dfcbd8b80e1b72dbfec4326823d3` |
| Original reviewed fingerprint | `1df5517c9fedb1ef909d74e4788e5f943c40a34ca7f6e8d65f47c9c39b5e0231` |
| RC1 working-tree fingerprint | `74b28dc728ceaa01f35a4c63ad5d713012f2fa50bf5e6e0731ba7ef8e83112c0` |
| Capture | 1,025 tracked/nonignored path states, including untracked implementation, fonts and prior evidence; this re-review's additions excluded |
| Runtime | Windows; Node 24.18.0; npm 11.17.0; Playwright 1.65.1; Chromium 159.0.8154.6; Firefox 159.0 |
| Evidence | [Index](eng-v2-ux-01b-rc1-astra/README.md), [candidate capture](eng-v2-ux-01b-rc1-astra/candidate-before.json), [delta verification](eng-v2-ux-01b-rc1-astra/delta-verification.json) |

The parent `AGENTS.md`, original review, corrective handoff, RC1 evidence and relevant source/tests were read. No nested repository instructions were found. The explicit eng-trainer review governs this Svelte project; the parent's web-school architecture guidance was not applied to it. Repository scope, the required build and the prohibition on staging/commits were observed.

**Closure table**

| Finding | Closure | Independent evidence |
|---|---|---|
| F1 — stale Undo | **Resolved** | Original seven reviewer tests all pass. Nine additional affected-key tests pass. Same-key cross-deck answers invalidate Undo; different identities and unrelated fields preserve it. Invalid retained callbacks change no state and write nothing. |
| F2 — focus recovery | **Resolved** | Chromium and Firefox recover to connected learned rows/headings, the closed-list opener, surviving Learn Pass controls or Create. Render-boundary focus ownership, toast cleanup, confirmations, cancellation and expiry pass. |
| F3 — returned import issues | **Resolved** | Each blocking issue kind focuses a named, focusable summary within the current file's named review section. Controlled post-render cancellation and supersession produce no stale focus or preview. |
| F4 — font distribution/rendering | **Resolved** | Four renamed derivatives reproduce byte for byte with pinned tools. Primary names, notices, font tables and assembled assets pass inspection. The independently adjusted full 22-case suite passes in both engines; declared/loaded faces, asset loads and raster glyph checks confirm real use. |
| F5 — language/translation | **Resolved** | All 39 description classifications were inspected; Home, Focus and all three Verbs set notes have appropriate DOM language. Study text is protected and interface copy remains translatable. |

**F1: affected stored keys, identity and persistence.** `progress.ts` records monotonically increasing revisions for list/id keys and changes generation on every `reset()` and `hydrate()`. A successful token redemption is single-use. Learn again covers `learnedPhrases:<canonical card id>`. Phrase Hide covers its hidden, Focus and learned fields; word/irregular Hide covers its own hidden and Focus fields. The inverse uses ordinary entry operations and never restores a progress/session snapshot. Display text is not an identity.

The visible Learn again → same-card Keep learning → old Undo case passes, including persisted state after reload. The original retained-callback Reset reproductions now pass, including a later Hide recreating the earlier visible state. These remain deliberate callback invocations: Settings replaces the old visible toast. Hydration invalidation, single-use behavior, later same-entry Focus/learned intent and exact write boundaries were additionally checked using real issued callbacks and a storage-write spy.

The cross-deck check is explicit, not an interpretation of the handoff's loose “another deck” wording. A phrase in topic A and an explicitly linked word in topic B produce the same canonical phrase card; answering that card in B expires the older learned Undo. A different, equal-text phrase in another deck retains its newer answer when the earlier Undo succeeds. Native all-deck → topic-deck cases independently confirm both outcomes in each browser. Changes to phrase Focus or a linked word's hidden state do not expire a learned inverse that cannot restore those fields. Conversely, a word Hide inverse remains valid after a new answer to its linked phrase and restores only `hiddenWords`/`favoriteWords`.

[Affected-key tests](eng-v2-ux-01b-rc1-astra/affected-keys.test.ts) verify zero callback-attributable writes and unchanged in-memory object identity for invalid callbacks, including hydration/Reset and recreated state. Valid Undo writes only its affected lists; unrelated answers, both deck records, cursor positions and unavailable IDs survive. The original failed-save → Reset → retry test and save-failure browser paths pass. The queue, database/schema, record-reading/reset coordinator and flashcard identity/model files are byte-identical to the original review inventory ([invariants](eng-v2-ux-01b-rc1-astra/source-font-invariants.json)). No saved revision fields or cross-tab protocol were added.

**F2: recovery and focus ownership.** Learn again moves keyboard focus to the next learned row, otherwise the preceding row or learned-list heading. Undo returns to the restored row; with that list closed, it focuses Review learned vocabulary. Toast removal happens before the inverse completes, and subsequent cleanup respects a focus target already chosen by the action/user. Learn Pass deletion returns to the next/previous Delete control; deleting the last pass focuses Create a Learn Pass. Cancel and Escape retain their surviving opener.

The native RC1 checks also pass for Unhide all → search field and deck reset → current card. The independent collection-removal check confirms the Your collections heading receives focus, entries/collection disappear, and retained progress/deck records survive. Cancel and Escape leave storage unchanged. Message expiry leaves focus alone.

Controlled native cases move focus to Back to flashcards immediately after Learn again and after activating Undo, before their awaited updates finish. Both keep that later focus. A MutationObserver moves focus to Create a Learn Pass after the dialog closes and before its awaited restoration; the earlier deletion does not steal focus for the next row. All selected targets are connected. The last-resort `main#main[tabindex="-1"]` remains a meaningful content/navigation position containing the page heading; its lack of a button-style outline is not treated as a defect. Evidence: [focused cases](eng-v2-ux-01b-rc1-astra/browser-focused/results.json), [RC1 checks](eng-v2-ux-01b-rc1-astra/browser-rc1/results.json).

**F3: returned issues and render boundaries.** Missing translation, invalid kind and native identity conflict each focus `.review__problems`, an alert with `tabindex="-1"` and an accessible name supplied by its title. The enclosing section is named by `#review-title`, which contains the current filename; the focused summary contains the corresponding record/column or identity-conflict content. Import stays disabled, and none of these selections changes learning/collection records or writes to persistence.

Valid and importable duplicate previews still focus the review heading; the duplicate acknowledgement enables the existing import action. Thrown whole-file errors focus their error summary. New MutationObserver tests intervene after an issue summary enters the DOM, before focus: Cancel leaves no review and focuses the picker; a newer selection immediately clears the old review, prevents the old summary focus, and later focuses only the replacement heading. The existing five file-reading race cases also still pass, but are credited as regression guards. Parser/service hashes are unchanged, and the error matrix retains whole-import rejection, quoted multiline record numbering and no-write behavior. Evidence: [focused native results](eng-v2-ux-01b-rc1-astra/browser-focused/results.json), [complete adjusted suite](eng-v2-ux-01b-rc1-astra/browser-adjusted/results.json).

**F4: the concrete RFN condition is closed.** The downloaded originals match all four documented Google Fonts v20 SHA-256s and the original review inventory; internal font version is 3.052. The derivation was rerun into this review's separate `fonts/reproduced/` directory using Python 3.14.7, fontTools 4.68.0 and brotli 1.2.1. All four output hashes match the candidate exactly. The candidate assets were only read.

Inspection confirms these specific fonts contain Windows 3/1/0x409 name records. IDs 1, 3, 4 and 6 change consistently to the Eng Trainer Sans family/unique/PostScript names. Other naming records, copyright/RFN notice, license URL, styles and variation-instance names remain. There is no missing typographic-family rename: ID 16 is absent in these inputs. Original Adobe/Paul D. Hunt attribution and legitimate Source Sans 3 mentions remain in the FONTLOG and documentation. The renamed OFL file is byte-identical to the previously distributed license. The unchanged `ADBO` OS/2 vendor identifier is metadata, not the derivative's primary font name.

All 21 other decoded tables compare equal, allowing only the whole-font checksum adjustment in `head`: glyph order/outlines, character mappings, metrics, shaping tables and `wght` 200–900 variation data are preserved. The isolated reproduction, name records and table results are in [equivalence.json](eng-v2-ux-01b-rc1-astra/fonts/equivalence.json) and [source-font-invariants.json](eng-v2-ux-01b-rc1-astra/source-font-invariants.json). Literata's two binaries and license are unchanged. The fresh 30-file combined artifact contains the six intended fonts, two licenses and FONTLOG; each published font matches its source bytes, with no replaced subsets or reserved-family declaration. [Artifact audit](eng-v2-ux-01b-rc1-astra/asset-audit.json).

This resolves the specific distribution condition in original F4: the derivative's primary names are changed and the attribution/OFL are retained, consistent with condition 3 of the [upstream license](https://raw.githubusercontent.com/google/fonts/main/ofl/sourcesans3/OFL.txt) and SIL's [webfont/RFN guidance](https://openfontlicense.org/webfonts-and-reserved-font-names/). No further permission search is needed for that finding.

The untouched historical browser harness independently returns **21 pass / 1 fail per engine**, solely `long-content-reflow-and-glyphs`; its reflow assertion passes and the absent-family glyph probe fails. A new reviewer copy changes only the two family references on that single line, preserving every assertion ([exact adjustment](eng-v2-ux-01b-rc1-astra/harness-adjustment.json)). The **complete adjusted 22-case run is 22/22 in each browser**, not a combined partial result. The original harness and failure evidence remain intact.

Independent native checks find four declared matching Eng Trainer Sans faces, all loaded; CSS rules reference the four derivative assets, actual requests include every required subset, and the representative English/Ukrainian/IPA canvas raster is invariant across three fallback families. A generic fallback produces a different raster. Screenshots of both browsers' glyph samples were visually inspected. The obsolete historical `fonts.sourceSans: true` is not counted as evidence of a declared/loaded family; `document.fonts.check()` alone cannot establish that.

| Cold `#wordIndex` response-body transfer | Chromium | Firefox | Existing budget |
|---|---:|---:|---:|
| HTML/JS/CSS | 88,768 B | 88,768 B | 102,400 B |
| Fonts | 193,052 B | 193,052 B | 204,800 B |
| Total | 512,123 B | 512,332 B | 563,200 B |

Measurements use fresh contexts, gzip level 9 for text, unchanged WOFF2, a 390×844 viewport, font/network completion and the existing extra 500 ms wait. They exclude headers; Firefox's extra 209 B is the favicon. Slow/failed-font cases remain readable without page overflow. The accepted Chromium first-entry position of 264 px remains; Firefox measures 236 px. Existing 200% text tab-label limitations and theme-startup behavior are retained.

**F5: language and study text.** All 39 actual descriptions were read against the explicit stable-ID mapping: 23 English and 16 Ukrainian, including Ukrainian wording containing English study expressions. The mapping is presentation metadata; frozen content is unchanged ([description audit](eng-v2-ux-01b-rc1-astra/description-language-audit.json)). Both browsers verify English/Ukrainian descriptions on Home and Focus and English notes for all three Verbs sets. Unknown ordinary block IDs return `''`; the existing passing tests and unchanged `translationLang` continue to give imported translations an explicit unknown language instead of assuming Ukrainian.

The `catalog.ts` addition is only `VerbSet.blockId = block.id` plus its type member. It preserves the existing stable block ID and does not change entry IDs, set IDs, filtering, source order, search construction, decks or persistence. Answers questions, random/current speaking prompts, every All prompts item, reverse-practice study text and English import examples have effective translation protection. Prompt hints, labels, help and errors remain translatable. This is DOM/source verification, supported by mounted tests and both browser engines; screen-reader pronunciation and browser translation were not exercised.

**Verification and evidence quality**

| Check against RC1 | Actual result |
|---|---|
| `npm.cmd run check`; `npm.cmd run check:v1` | Both 0 errors, 0 warnings |
| `npm.cmd test` | 10/10 content/build; 288/288 v2 tests in 24 files |
| `npm.cmd run test:v1` | 68/68 |
| `npm.cmd run build:site` | PASS, including the required root `npm run build`, v1 build, assembly and site checks |
| `npm.cmd run verify:content` | Exact content/order/published match, 566 phrase links, v1 unchanged |
| `git -c core.whitespace=cr-at-eol diff --check` | PASS |
| Unchanged original independent component suite | 7/7 |
| New reviewer affected-key tests | 9/9 |
| Unchanged 16-scenario regression runner | 16/16 per engine |
| Unchanged original 22-case runner | 21/22 per engine; obsolete family expectation only |
| Full independently adjusted 22-case runner | 22/22 per engine |
| Existing five RC1 browser scenarios | 5/5 per engine |
| New independent focused browser scenarios | 10/10 per engine |
| Separate font derivation/table comparison | Four byte-identical reproductions; all comparisons pass |

The first command attempt hit esbuild's ancestor/config filesystem restriction. A scoped unsandboxed rerun passed; those initial logs are retained separately. A reviewer log filename exceeded Windows' component limit during the first font command; shortening new log names allowed a recorded rerun. These are harness/environment issues. The passing v2 suite emits nine `lifecycle_double_unmount` cleanup warnings in four reload tests: their explicit `close()` remains registered for `afterEach`. This is a nonblocking test cleanup defect, not an application/browser failure; making cleanup idempotent or deregistering closed mounts would remove it. Tests were left unchanged as requested.

Historical before/after evidence was inspected without rebuilding the entire original tree. Its reconstruction manifest reports the original fingerprint with no mismatches. The raw old-tree report has **35 passing and 31 failing assertions**, plus one unrun module containing three tests. Eight failures are missing new validity APIs; seven stop at new DOM hooks/markup; sixteen reach behavioral mismatches. The summary's “32 failed” includes the synthetic failed-module row, not 32 executed assertions. Neither missing APIs/modules nor absent new selectors independently reproduce an old user-visible defect. The original seven reviewer tests, original native failures and fresh reruns supply the direct evidence. The 35 old/new passes remain regression guards. [Detailed audit](eng-v2-ux-01b-rc1-astra/before-after-evidence-audit.json).

Original/adjusted/focused/RC1 native runs report no unexpected page/console errors or unhandled rejections. The unchanged regression log contains only deliberately failed font loads, the deliberate content 503 in Chromium, and v1's refused external font request. New browser data is synthetic, contexts are nonpersistent, and clipboard calls are intercepted in-page; no owner profile, saved owner learning data or system clipboard was used.

**Delta and preservation.** The actual delta matches every before/after hash in `rc1-delta.json`: 29 changed, 15 added, 5 removed, without unexplained paths. Separately accounted: source/build 20 changed + 1 new; tests 2 changed + 6 new; font distribution/CSS/provenance 3 changed + 8 new − 5 removed; general documentation 4 changed. The 62 RC1 evidence files are separate additions, not silently folded into source. The handoff's “seven new test files” is a counting typo; six new test files agree with the increase from 18 to 24 suites.

The documented line-ending normalization is verified against hash-matched originals: FlashcardsPage changes from 318 CRLF + 206 bare-LF lines to 567 CRLF lines; IndexPage from 195 CRLF + 95 bare-LF to 291 CRLF. This accompanies the reviewed content edits and is not an unexplained binary change.

[Final preservation](eng-v2-ux-01b-rc1-astra/preservation-after.json) confirms all 1,025 candidate path states, HEAD and Git index are unchanged. All **101 protected files**, **257 original review files**, **81 earlier implementation evidence files** and **62 prior RC1 evidence files** are byte-identical to re-review start. The protected files also match the original review inventory. v1 source remains unchanged; built JS/CSS match the retained release exactly, while the same three text files retain documented line-ending differences, including the single CRCRLF in HTML. Only this report and its new evidence directory were added; ignored build outputs and isolated font tooling were used for verification.

The accepted design, theme-startup/fallback-font limitations and single-tab in-memory Undo scope stand. Safari/WebKit, real mobile/touch hardware, screen readers, browser translation, forced colors, actual 400% browser zoom and audible speech were not tested. No new pronunciation, session-size, database-history or cross-tab features were required. Nothing was staged, committed, pushed, published, deployed or submitted as a PR.

**Final verdict: READY_FOR_PR.**
