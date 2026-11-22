# ENG-V2-03-RC1 — Independent correction review

22 November 2026, Europe/Kyiv. Reviewer: Astra/Codex.

**CHANGES_REQUIRED. F1 remains open for the required focused-resize behavior.** RC1 fixes the original horizontal Tab/Enter clipping at 320 × 844 and 390 × 844, including 200% text and oversized labels. A height-only resize can still leave the focused label and outline behind the fixed bottom navigation in both engines. The remaining P2 item below is a chip-visibility acceptance gap; this review does not establish that it was newly introduced by RC1.

All required project gates, the existing 24-test independent suite, the existing 12 browser scenarios per engine, and the refreshed budgets pass. No unrelated integration blocker was found.

**Required correction — F1-RC1 / P2: reveal the focused chip after viewport-height changes**

Location: [revealFocusedChip.ts](../../src/features/topics/revealFocusedChip.ts), lines 42–47; the vertical correction at lines 35–38 needs an applicable scheduling trigger.

The action schedules on focus and on strip/button size changes. Reducing viewport height moves the fixed navigation upward without resizing those observed elements. The current keyboard focus owner therefore receives no corrective reveal. This is the brief's focused-resize and bottom-navigation visibility case.

Reproduce with Chromium **159.0.8154.6** or Firefox **159.0**:

1. Open a fresh synthetic context at **320 × 844**, on `#topic/small-talk`.
2. Set actual text to **200%** (`html { font-size: 200% !important; }`); wait for the intended fonts. Chip text measures **28px**, versus 14px normally.
3. Use Tab to reach **All situations**, then Tab three times to **Coffee and lunch breaks**. Leave focus there. The chip is fully readable, with two lines and its complete outline.
4. Resize only the viewport height to **320 × 480**. Do not click, refocus, or scroll. Wait one second.
5. The fixed navigation covers the second-line word **breaks** and the lower outline. Focus remains on Coffee. Tab away and Shift+Tab back restores full visibility.

| Engine | Focus outline bottom after resize | Effective visible bottom / navigation top | Covered extent | Page scroll before → after resize |
|---|---:|---:|---:|---:|
| Chromium | 416.109px | 379.219px | **36.891px** | 430 → 430px |
| Firefox | 415.700px | 379.200px | **36.500px** | 430.5 → 430.5px |

This exceeds the 0.75px rounding tolerance substantially. The approximately 104.4px full outline footprint can fit above the navigation; refocusing demonstrates recovery. Resizing to 640px height passes, which explains why checking only larger heights misses this case.

Evidence: [Chromium failure](eng-v2-03-rc1-astra/shots/rc1-chromium-height-only-480.png), [Firefox failure](eng-v2-03-rc1-astra/shots/rc1-firefox-height-only-480.png), [Firefox after keyboard refocus](eng-v2-03-rc1-astra/shots/rc1-firefox-height-only-480-refocused.png), [measurements](eng-v2-03-rc1-astra/viewport-resize.json), and [reproduction script](eng-v2-03-rc1-astra/viewport-resize.mjs). A second fresh-context run reproduced the same measurements; the first is preserved in [viewport-resize-attempt1.json](eng-v2-03-rc1-astra/viewport-resize-attempt1.json). The final runner exits 1 for this application failure. Both runs had zero page errors.

Focused correction requested: schedule the existing guarded reveal when the available viewport height changes, with appropriate lifecycle cleanup. Continue to reveal only the connected keyboard focus owner and preserve manual scrolling of an unfocused selection. Add a regression that changes height without changing strip/button dimensions, including the 200% case above. Production code was left unchanged for the implementation agent.

**Candidate provenance and correction scope**

| Item | Independently verified value |
|---|---|
| Worktree | `eng-trainer/.worktrees/eng-v2-03` |
| Branch | `feature/eng-v2-03-learning-topics` |
| Base and HEAD | `03f1267f1ef4287580227ce5db67615988c98177` |
| State before this review | 24 modified tracked files; 373 untracked files; nothing staged |
| Original candidate fingerprint | `be282772e3b5989941148be9ac7c795dcc2604b943247fe0079c4450d0e66f1a` |
| Corrected fingerprint, excluding original review additions and RC1 evidence | `01c6ec10666ed943fbb3804101637cd00458ed60a8caaf319586e84e44e7039c` |
| Full changed/untracked fingerprint before this review | `e35c25bb3b30e4fd08dcfd9f6341de25f195c6bcd2faa77091d490c995a4a501` |

Before running checks, the reviewer captured branch, HEAD, status, SHA-256 for tracked and untracked files, an exact local snapshot, and a binary-capable diff. See [scope.json](eng-v2-03-rc1-astra/scope.json), [preservation-before.json](eng-v2-03-rc1-astra/preservation-before.json), and [Git status](eng-v2-03-rc1-astra/git-status-before.txt).

The inventory difference is fully accounted for: the original 1,308 files became **1,613** through **166** original-review additions, **137** RC1 evidence files, and **two** new implementation/test files. Original implementation untracked files increased from 68 to 70; 70 + 166 + 137 = 373. The main checkout has no additional files beyond its original inventory.

The exact substantive delta against the original inventory matches the implementation's preservation record:

- `TopicPage.svelte`: imports and attaches the action to the existing labelled situation group.
- New `revealFocusedChip.ts`: guarded deferred horizontal/vertical revelation and resize observation.
- `src/app.css`: situation-strip clearance plus child-only wrapping, width and padding rules.
- New `revealFocusedChip.test.ts`: three deferred-lifecycle tests.
- Handoff: RC1 append; the original **33,108 bytes** remain an exact prefix.

The shared `.chip-toggle` rule is unchanged. No authored content, IDs, metadata, Home calculation, storage/import/export, flashcard, dependency, or v1 implementation changed in RC1. The original 92 changed/untracked snapshot files match their original hashes. All 33 files of the preserved before build match Astra's original artifact audit; that authenticated build was copied into this new review's ignored local directory. No active worktree reset or before-source reconstruction was required.

**Independent fail-before / pass-after evidence**

The new [focused runner](eng-v2-03-rc1-astra/focused.mjs) and [geometry oracle](eng-v2-03-rc1-astra/browser-support.mjs) independently test the native result. Their SHA-256 values are recorded in [focused.json](eng-v2-03-rc1-astra/focused.json). The same decisive matrix function runs on the authenticated original and rebuilt RC1.

All target chips are reached with real Tab or Shift+Tab. There is no test-side chip focus helper, preliminary chip click, or `scrollIntoView()`. Enter and Space activate every chip. The oracle waits 220ms, intersects axis-specific clipping ancestors with the viewport and fixed navigation, expands the button by the computed **2px outline + 2px offset**, records line boxes, and checks every non-space character. A **0.75 CSS px** tolerance accounts for integral client dimensions versus fractional text metrics. The largest typical passing vertical difference for a wrapped chip is about 0.4px.

Actual root text enlargement produces 28px chip text; device pixel ratio and screenshot scaling are not used. Each context waits for `document.fonts.ready` and verifies that the self-hosted **Eng Trainer Sans** face is loaded.

| Representative case | Original | RC1 |
|---|---|---|
| Chromium, 390 × 844, 100%, Enter on Before a work meeting | Outline x=278.844–448.344; right clip at 390; **58.344px clipped**, including “meeting” | x=219.844–389.344; complete label and outline |
| Firefox, same sequence | x=278.817–448.267; **58.267px clipped** | x=219.817–389.267; complete label and outline |
| Chromium, 320 × 844, 200%, Coffee | Single-line 313.844 × 44px button; outline reaches x=634.5 | **288 × 96.375px**, two readable lines, complete outline within tolerance |
| Firefox, same enlarged case | Single-line 313.850 × 44px button; outline exceeds both viewport edges and vertical strip clearance | **288 × 96.400px**, two readable lines, complete outline within tolerance |

At 200%, Coffee's text alone measures approximately **287.85px** unwrapped; its available inner width after padding/borders is **262px**. The two-line treatment makes the complete label fit. Horizontal scrolling alone could not provide that inner width.

Screenshots were opened and visually inspected: [original Chromium](eng-v2-03-rc1-astra/shots/before-chromium-matrix-390-100-selected-2.png), [corrected Chromium](eng-v2-03-rc1-astra/shots/rc1-chromium-matrix-390-100-selected-2.png), [original Firefox](eng-v2-03-rc1-astra/shots/before-firefox-matrix-390-100-selected-2.png), [corrected Firefox](eng-v2-03-rc1-astra/shots/rc1-firefox-matrix-390-100-selected-2.png), [enlarged Chromium](eng-v2-03-rc1-astra/shots/rc1-chromium-matrix-320-200-selected-3.png), and [enlarged Firefox](eng-v2-03-rc1-astra/shots/rc1-firefox-matrix-320-200-selected-3.png).

Per engine, two original-build matrix scenarios produce **56 failing complete-visibility measurements**, with no other failures. Some failures are the old 2px vertical outline clearance even where text is readable; the representative label-clipping failures above reproduce F1 specifically. RC1's four matrices cover 320/390 × 844 at 100%/200%, all seven chips in both directions and both activation keys: **112/112 visibility measurements pass**.

**Interaction and lifecycle results**

The primary independent runner has **9 RC1 scenarios per engine**, with **126/126 visibility measurements passing**. The additional height-only probe is the separate failing tenth scenario per engine; its before/resize/refocus observations are not folded into that passing count.

- Keyboard focus alone preserves selection. Enter and Space select the intended situation and exact expected phrase rows. The labelled group, native buttons, order, and `aria-pressed` are intact; Firefox's extra native scroller Tab stop is retained.
- Traveling plus `have you` yields exactly the two expected phrases. All situations retains the query. Search and selection persist across navigation in memory and reset on reload.
- Retaining Coffee focus through 390 → 320px, 100% → 200% text, the desktop wrapping breakpoint, and return to phone passes. A 320 × 640 height change passes. The 320 × 480 case fails as documented above.
- Native horizontal pointer-wheel scrolling stays in place with selected, unfocused Traveling, including a width change. Native Shift+Tab reveals the chip from a deliberately offscreen strip and clears the fixed navigation.
- Ordinary visible-strip navigation produces no unnecessary vertical page jumps. Reflow and genuinely offscreen focus may scroll vertically; the oracle assesses final visibility rather than requiring zero movement.
- Forced lifecycle checks hold animation callbacks, deliberately deliver canceled callbacks after focus moves to search, change ownership within the strip, and navigate Home before release. They verify actual held/canceled work. Stale work leaves scroll/focus unchanged, performs **zero geometry reads on the old focus owner or detached controls**, and produces no page errors or unhandled rejections.

Source inspection confirms cancellation on focusout, observer disconnection on destroy, and guards for destruction, connected strip/target, current focus ownership and `:focus-visible`. The missing height-change scheduling trigger is the remaining gap.

Direct checks of **Show hidden** on Phrases, Words, Verbs and Topics compare the authenticated original with RC1 at 320 × 844 and 200% text. All four comparisons per engine pass: identical computed styles and dimensions, at least 44px height, no page overflow, correct hidden-row toggling, and no application of the situation-child selector. See [shared-controls.json](eng-v2-03-rc1-astra/shared-controls.json).

**Commands, counts and budgets**

The documented project gates ran once as a set; `build:site` includes its own required nested builds. Actual outcomes are in [commands.json](eng-v2-03-rc1-astra/commands/commands.json) and individual logs.

| Check | Actual result |
|---|---|
| `npm run check`; `npm run check:v1` | Each: 0 errors, 0 warnings |
| `npm test` | 15 content/build tests; 338 v2 tests in 29 files passed |
| `npm run test:v1` | 68 tests in 3 files passed |
| `npm run build`; `npm run build:site` | Passed |
| `npm run verify:content` | Passed; exact legacy content/order match and v1 unchanged |
| `git -c core.whitespace=cr-at-eol diff --check`; documented new-file whitespace check | Passed; new-file gate covered 95 text files at that point |
| Existing independent suite | **24/24** passed |
| Existing unmodified implementation browser runner | **12/12 scenarios per engine** |
| New focused runner | **9/9 RC1 scenarios; 126/126 geometry measurements per engine** |
| Additional height-only resize acceptance probe | **Fails in both engines**, reproduced twice |
| Other chip-style consumers | **4/4 before/after comparisons per engine** |

The existing independent suite was copied with only two path substitutions: its released-materials import still reads historical evidence, and generated malformed fixtures go into the new review's ignored local directory. Its config changes only the selected test path. No assertion or historical file changed. [runner-adaptations.json](eng-v2-03-rc1-astra/runner-adaptations.json) records exact substitutions and hashes; [independent.json](eng-v2-03-rc1-astra/independent.json) records all 24 results.

The old Learn again Undo `lifecycle_double_unmount` warnings recur in unit logs. The wrapper also emits a Node subprocess deprecation warning. Neither is a new native application error. Forced canceled-frame delivery is explicitly labelled in the focused evidence. The implementation browser suite's deliberate content/font request failures are expected error-path coverage. The inherited Reset expected-rejection diagnostic was **not rerun or reopened**: its implementation and original evidence are byte-identical, and the correction did not demonstrate changed Reset behavior.

The established cold-load method was refreshed on five routes per engine for both builds: fresh 390 × 844 contexts, intended fonts loaded, network idle plus 500ms, local gzip level 9 except stored WOFF2, response-body bytes excluding headers. The heaviest route is `#wordIndex`.

| Build / engine | Code | Fonts | Content | Other | Total |
|---|---:|---:|---:|---:|---:|
| Original / Chromium | 96,631 | 193,052 | 240,899 | 0 | 530,582 |
| Original / Firefox | 96,631 | 193,052 | 240,899 | 209 | 530,791 |
| RC1 / Chromium | 97,264 | 193,052 | 240,899 | 0 | 531,215 |
| **RC1 / Firefox** | **97,264** | **193,052** | **240,899** | **209** | **531,424** |
| Limits | 102,400 | 204,800 | — | — | 563,200 |

The larger new total is **531,424 B**, with 31,776 B remaining. RC1 adds 633 B of compressed code; content and fonts are unchanged. All measured routes pass. See [budget.json](eng-v2-03-rc1-astra/budget.json).

Actual local tooling: Windows, Node **24.18.0**, npm **11.17.0**, Git **2.54.0.windows.1**, Playwright **1.65.1**, Vite **6.4.3**, Svelte **5.57.0**, Vitest **3.2.7**. Tooling and browser binaries were resolved through `git --git-common-dir`; the worktree's `.git` pointer was respected. The sandbox account's Git ownership check prevented the first capture attempt before any snapshot was written; the authorized native invocation succeeded. This was a tooling issue, not an application failure.

**Preservation and limits**

[Final preservation](eng-v2-03-rc1-astra/preservation-after.json) matches all **1,613** initial candidate files and all **1,332** main-checkout files, including its **92** pre-existing untracked files. Main remains on its original branch and HEAD with no staged changes. The original review's **506** entries including ignored copies, all **286** RC1 evidence entries including ignored snapshots, and Git exclusions are unchanged.

All 55 tracked v1 files and all existing release evidence are preserved. The rebuilt RC1 matches **29 protected before-build artifacts**: manifest/all 14 pack bodies, five v1 files, six font assets, and three font notices. Authored content, topic metadata and IDs, released fingerprints, original identity mappings, Home statistics/selectors, storage/import/export contracts, flashcard logic and dependency manifests remain identical. [Artifact authentication](eng-v2-03-rc1-astra/artifacts.json) records the before build and preserved outputs. The exhaustive original editorial audit was appropriately retained; unchanged inputs and the bounded suites support reuse.

All browser contexts were isolated and nonpersistent, using synthetic learning state and local assets; outside requests were refused. Speech/clipboard were replaced in the focused and implementation suites. Pointer-wheel scrolling was tested; physical touch hardware, Safari/WebKit, assistive-technology output, audible speech, OS text settings, Linux CI and production deployment remain unverified. Local Windows builds establish no new CI or GitHub Pages deployment result.

Only this report and `docs/reviews/eng-v2-03-rc1-astra/` were added. Public logs are sanitized; exact local copies remain ignored. [Evidence and reproduction](eng-v2-03-rc1-astra/README.md) and [final hygiene checks](eng-v2-03-rc1-astra/final-checks.json) describe the review artifacts. Nothing was staged, committed, pushed, merged or deployed; no PR was created.
