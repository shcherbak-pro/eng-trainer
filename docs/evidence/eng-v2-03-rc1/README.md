# ENG-V2-03-RC1 — Small Talk focused-chip visibility

22 November 2026, Europe/Kyiv. Correction of Astra's **F1, P2**. Implementation is ready for an independent re-review; this evidence does not constitute approval or release.

**Starting candidate and preservation**

Worktree `eng-trainer/.worktrees/eng-v2-03`, branch `feature/eng-v2-03-learning-topics`, HEAD `03f1267f1ef4287580227ce5db67615988c98177`.

Before application edits, [preserve.mjs](preserve.mjs) verified every reviewed candidate entry and the changed/untracked fingerprint **`be282772e3b5989941148be9ac7c795dcc2604b943247fe0079c4450d0e66f1a`**: 24 modified tracked files and 68 untracked files. [baseline.json](baseline.json) accounts separately for 166 later public review additions and hashes the review directory's 506 entries, including ignored evidence and copies. It records the dependency junction without traversing it. The main checkout still had its original 92 untracked files, with no additional owner files at capture.

An exact copy of the existing combined build and copies of the candidate files were captured under ignored `local/` before editing. The preserved build matches all 33 files in Astra's artifact audit. The new native regression ran against that copy before the first application edit. Original review screenshots, measurements, scripts and implementation evidence were not overwritten.

**Cause and correction**

The strip relied on native focus scrolling, which permits partially visible buttons to remain clipped. Its 2px vertical padding was also smaller than the 2px focus outline plus 2px offset. Unwrapped enlarged labels could exceed the width available for the complete control and outline.

- `TopicPage.svelte` attaches one small Svelte action to the existing labelled button group. The click handlers, button order, authored labels and `aria-pressed` remain unchanged.
- `revealFocusedChip.ts` reveals the current keyboard focus owner after native focus/layout work. Horizontal scrolling is confined to the strip and bounded by both its client area and the viewport. The calculation reserves at least the authored 4px outline clearance and rounds outward for fractional font metrics.
- A `ResizeObserver` covers the strip and its labels, so width or text-size changes also reveal the focused chip. It does not follow selection or listen to scrolling. Manual scrolling remains in place when the selected chip is unfocused.
- Vertical scrolling occurs only if the focused control's outline is outside the visible page area, including the fixed phone tab bar. Already visible strips do not cause page jumps. Ordinary native vertical focus revelation remains active.
- Deferred work verifies that the action is alive, the strip and target are connected, and the target still owns keyboard focus. Focus leaving the strip cancels pending work; destruction also disconnects observation. Late callbacks cannot scroll an old target or steal focus.
- `.chip-row > .chip-toggle` limits each chip to the strip's content width, permits text wrapping and adds vertical padding. Height grows naturally. The full label and outline are retained. Phones keep horizontal scrolling; desktop rows keep wrapping.

The shared `.chip-toggle` rule was inspected and left unchanged. Its other consumers are the Show hidden controls on Phrases, Words, Verbs and Topic pages. The new sizing rule applies only to situation chips; the existing all-route browser checks passed for those other controls.

**Exact correction scope**

| Path | Change |
|---|---|
| `src/features/topics/TopicPage.svelte` | Import and attach the strip action |
| `src/features/topics/revealFocusedChip.ts` | New focus/reflow action, with cleanup |
| `src/app.css` | Situation-only sizing, wrapping and outline clearance |
| `src/features/topics/revealFocusedChip.test.ts` | Three forced deferred-lifecycle regressions |
| `docs/handoffs/ENG-V2-03.md` | Append RC1 section; original bytes retained as an exact prefix |
| `docs/evidence/eng-v2-03-rc1/` | New runners, inventories, results, logs and screenshots |

Full before/after SHA-256 values for every changed application/test/handoff file, and SHA-256 values for all new public RC1 evidence files except the hash inventory itself, are in [preservation-after.json](preservation-after.json). [summary.json](summary.json) also records the four application/test file hashes and representative measurements. No other candidate files changed.

**Same native regression: fail before, pass after**

[focused-chips.mjs](focused-chips.mjs) is identical in both recorded runs, SHA-256 `b25897fda9727d947c3a878a4ba0ec67cfa80b7a94f0c2939762d028cf633fff`.

| Engine | Reviewed build | RC1 | Existing implementation runner |
|---|---|---|---|
| Chromium 159.0.8154.6 | 7 scenarios fail complete label/outline visibility | 7/7 pass; 157/157 visibility measurements pass | 12/12 pass |
| Firefox 159.0 | Same visibility failures | 7/7 pass; 157/157 visibility measurements pass | 12/12 pass |

The reviewed run exited 1 because of the visibility assertions. All other assertions in that run passed. The RC1 run exited 0. Both had zero page errors and unhandled rejections. Results are [reviewed.json](reviewed.json), [rc1.json](rc1.json) and [implementation-browser/results.json](implementation-browser/results.json). The historical implementation runner was invoked unchanged with a new output directory.

Each engine covers 320px and 390px at ordinary and 200% text. Every chip, including both ends, receives real Tab and Shift+Tab events. Every chip is activated with Enter and Space; the same DOM button retains focus, the expected authored rows appear and selection remains visible. Focus alone does not select. Traveling plus `have you` returns exactly the two expected phrases. Selection/search survive navigation in memory and reset on reload.

Additional cases retain Coffee focus while changing 390 → 320px and 100 → 200% text, verify no vertical movement while the strip is visible, bring a genuinely offscreen strip back with native Shift+Tab, preserve manual horizontal wheel scrolling, and deliver held/canceled animation callbacks after focus leaves or the topic unmounts. Three unit regressions separately force the lifecycle boundaries. Firefox's additional native scroll-container Tab stop is retained and handled explicitly by the runner.

The geometry oracle intersects every clipping ancestor's client area with the page viewport and fixed tab bar. It expands the button's border box by computed outline width plus offset, checks the text Range rectangles inside the button, and rejects ellipsis or missing focus indication. A **0.75 CSS px tolerance** covers integral client dimensions and fractional font metrics. Measurements occur after 250ms settling. The runner never focuses or reveals chips through locator helpers or test-side scrolling before measuring them; the deliberate manual/offscreen scroll operations are separate, labelled behavior setups.

For example, at 390px in Chromium, **Before a work meeting** had an outline footprint x=278.84–448.34 before correction and x=219.84–389.34 after. **Free time and weekends** changed from x=284.27–463.83 to x=210.27–389.83. Enter and Space preserve the corrected bounds. At 320px and 200% text, Coffee's button becomes 288 × 96.375px with two complete lines and the full ring, instead of attempting to fit its original 313.84px unwrapped width plus the outline.

Representative screenshots were opened and visually inspected, in addition to the numeric checks:

- [Reviewed Chromium, clipped selected label](shots/reviewed-chromium-matrix-390-100-selected-2.png) and [RC1 Chromium, complete selected label](shots/rc1-chromium-matrix-320-100-selected-2.png).
- [RC1 Firefox, complete selected label](shots/rc1-firefox-matrix-390-100-selected-2.png).
- [RC1 Chromium, 320px and 200% text](shots/rc1-chromium-matrix-320-200-selected-3.png) and [RC1 Firefox, 320px and 200% text](shots/rc1-firefox-matrix-320-200-selected-3.png).

**Final verification**

| Check | Result |
|---|---|
| `npm run check`, `npm run check:v1` | 0 errors, 0 warnings |
| `npm test` | 15/15 content/build tests; 338/338 v2 tests in 29 files |
| `npm run test:v1` | 68/68 tests |
| `npm run build`, `npm run build:site` | Passed, including the required root build |
| `npm run verify:content` | Exact legacy content/order match; v1 unchanged |
| Tracked and untracked whitespace | Passed; repeated after final documentation |
| Content, identity, Home and dependency preservation | Passed |
| Native focus and existing browser scenarios | Passed in both engines |

[commands/commands.json](commands/commands.json) and its logs contain the actual command outcomes. Existing `lifecycle_double_unmount` warnings from the unchanged Learn again Undo tests also appear in Astra's old test log; there are no new native correction errors or rejections.

[artifacts.json](artifacts.json) verifies byte-identical manifest/all 14 packs, all five built v1 files, six WOFF2 assets and font notices. All authored source content, the original eleven pack hashes, 72-item identity mapping, Home selectors/tests, storage/import/export code and dependency manifests/lockfiles remain unchanged. Totals remain 1,622 records, 14 packs, 638 canonical cards and 34 subject topics; Words 566 and Verbs 339. The full suite and unchanged native Home/import scenarios passed.

**Response-body budgets**

The established method is unchanged: fresh 390 × 844 contexts, intended fonts loaded, network idle plus 500ms, local gzip level 9 except stored WOFF2, browser response-body bytes excluding headers. All five measured routes pass. The heaviest is `#wordIndex` in each engine; [budget.json](budget.json) contains all requests and per-route totals.

| Build / engine | Code | Fonts | Content | Other | Total |
|---|---:|---:|---:|---:|---:|
| Reviewed / Chromium | 96,631 | 193,052 | 240,899 | 0 | 530,582 |
| RC1 / Chromium | 97,264 | 193,052 | 240,899 | 0 | 531,215 |
| Reviewed / Firefox | 96,631 | 193,052 | 240,899 | 209 | 530,791 |
| RC1 / Firefox | 97,264 | 193,052 | 240,899 | 209 | 531,424 |
| Limits | 102,400 | 204,800 | — | — | 563,200 |

RC1 adds 633 B of compressed code. Fonts and content are unchanged; the limits were not raised.

**Historical clarifications and remaining limitations**

- The previous worst transfer total was **530,791 B in Firefox**; 530,582 B was Chromium.
- Consistent Windows path casing established local build reproduction, not a new Linux CI run. RC1 was also verified locally on Windows.
- Astra verified that the ten documented browser groups expand to twelve actual scenarios, because the route group runs at three viewport sizes.
- The Reset race remains an **inherited deferred-focus defect exposed by a forced synchronous harness schedule, nonblocking for ENG-V2-03 under Astra's classification**. It was not changed or re-probed as part of this correction. Reset and Undo code and historical evidence remain untouched.
- No Safari/WebKit, physical mobile device, assistive-technology, audible speech or deployment verification is claimed. Native contexts were synthetic and nonpersistent, with outside requests refused and speech/clipboard replaced. Horizontal wheel scrolling was tested; real-device touch gestures were not. Touch/pointer event handling and native scrolling remain unchanged.

**Reproduction**

Run from the candidate worktree with its installed root/v1 dependencies and the same existing isolated Playwright installation used by Astra. No new dependency is required. Use fresh result names to preserve the supplied failing and passing evidence.

```powershell
node docs/evidence/eng-v2-03-rc1/focused-chips.mjs docs/evidence/eng-v2-03-rc1/local/reviewed-site reproduce-reviewed
node docs/evidence/eng-v2-03-rc1/focused-chips.mjs site-dist reproduce-rc1
node docs/evidence/eng-v2-03-rc1/verify.mjs commands
node docs/evidence/eng-v2-03-rc1/verify.mjs browser
node docs/evidence/eng-v2-03-rc1/budget.mjs
node docs/evidence/eng-v2-03-rc1/verify.mjs artifacts
node docs/evidence/eng-v2-03-rc1/summarize.mjs
node docs/evidence/eng-v2-03-rc1/preserve.mjs after
```

The initial `preserve.mjs before` is deliberately one-shot. Exact local snapshots and development diagnostics remain ignored; public evidence uses repository-relative paths and synthetic data. [final-checks.json](final-checks.json) records the final whitespace/privacy audit, and [preservation-after.json](preservation-after.json) records the final preservation and hash inventory.

Nothing staged, committed, pushed, merged or deployed.

**ENG-V2-03-RC1 — IMPLEMENTED / READY FOR INDEPENDENT RE-REVIEW**
