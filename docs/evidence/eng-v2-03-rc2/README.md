# ENG-V2-03-RC2 — focused chip after viewport-height changes

22 November 2026, Europe/Kyiv. Correction of **F1-RC1, P2** in [Astra's RC1 review](../../reviews/ENG-V2-03-RC1-ASTRA.md): a viewport-height-only resize could leave the focused situation chip's label and outline behind the fixed bottom navigation. This evidence supports an independent re-review; it is not an approval or a release.

## Starting candidate

Worktree `eng-trainer/.worktrees/eng-v2-03`, branch `feature/eng-v2-03-learning-topics`, HEAD `03f1267f1ef4287580227ce5db67615988c98177`, nothing staged.

Before any edit, [preserve.mjs](preserve.mjs) `before` authenticated RC1 with Astra's RC1-review definitions ([baseline.json](baseline.json)):

- **Candidate inventory.** All **1,613** candidate inventory entries equal Astra's final RC1 record (`docs/reviews/eng-v2-03-rc1-astra/preservation-after.json`): every file, hash, tracked/untracked state and change flag. The inventory leaves out the RC1 review's own files, as Astra's did.
- **Substantive fingerprint.** Excluding both review generations' additions and the RC1 evidence, it is **`01c6ec10666ed943fbb3804101637cd00458ed60a8caaf319586e84e44e7039c`**, as required.
- **Main checkout.** Its **1,332** entries, including the **92** pre-existing untracked files, equal Astra's record. Branch and HEAD are unchanged, and nothing is staged.
- **Review and evidence trees, including ignored files.** These match Astra's record: the original review's 506 entries and the RC1 evidence's 286 entries, plus the Git exclude file. The RC1 review's 619 entries and its report were recorded for the final comparison.
- **RC1 build.** The active `site-dist` was RC1's recorded build: its `index.html` SHA-256 is `cb488245…`, equal to RC1's `rc1.json`. The gzip-9 sizes of its two bundles equal Astra's RC1 measurements exactly (JS 87,860 B, CSS 8,749 B). It was copied, unchanged, to ignored `local/rc1-site/` and serves as the **failing before-candidate**. Copies of the three files RC2 may change are in `local/rc1-sources/`.

The worktree was not reset, and nothing was reconstructed.

## Cause and correction

`revealFocusedChip.ts` scheduled its guarded reveal on focus and on strip/chip size changes. Reducing only the viewport height moves the fixed navigation up without resizing the strip or any label, so nothing was scheduled. Astra measured this:

- Chromium: 320 × 480, 36.891 px of Coffee's outline covered.
- Firefox: the same viewport, 36.500 px covered.

The exact application delta:

```diff
-      // Native Tab focus normally handles the vertical axis. A font/width change can also move
-      // an already-focused chip out of view; only then adjust the page, clearing the phone bar.
+      // Native Tab focus normally handles the vertical axis. A font/width change, or a viewport-
+      // height change that moves the phone bar, can also leave an already-focused chip out of
+      // view; only then adjust the page, clearing the phone bar.
 …
   for (const chip of strip.children) observer?.observe(chip);
+  // A viewport-height change moves the fixed phone bar without resizing the strip or a label, so
+  // the observer never sees it. Each resize replaces any pending frame (one reveal per frame).
+  window.addEventListener('resize', schedule);
 …
       strip.removeEventListener('focusout', cancel);
+      window.removeEventListener('resize', schedule);
```

- **One trigger, existing reveal.** A window `resize` now calls the existing `schedule()`; the horizontal and vertical reveal code is unchanged.
- **Coalesced work.** `schedule()` cancels any pending frame first, so a burst of resize events leaves at most one frame. A reveal's own `scrollBy` causes neither a resize nor an element-size change, so there is no correction loop and no polling.
- **Existing guards.** `schedule()` only queues work while a chip in the strip owns focus, so Search, other controls and an unfocused selection are left alone, including its manual scroll position. When the frame runs, it re-checks that the action is alive, the strip and target are connected, the target still owns focus, and it is `:focus-visible`. Otherwise it reads no geometry and does nothing.
- **Cleanup.** Destroying the action cancels the pending frame, disconnects the observer and removes all three listeners, the new one included.
- **`visualViewport` is not used.** The calculation uses layout-viewport bounds (`innerHeight`, `clientWidth`, the fixed bar's rectangle), and layout-viewport changes fire window `resize`. A `visualViewport` listener would need a different coordinate model and was not required for this finding.

Unchanged: CSS (the built stylesheet is byte-identical), wrapping, horizontal clearance, selection, search, the labelled group, `aria-pressed`, Enter/Space, Tab order (including Firefox's scroller stop), memory-only state, content, IDs, Home statistics, persistence, import/export, flashcards, Reset/Undo, dependencies and v1.

## The exact native regression: RC1 fails, RC2 passes

**Astra's own probe.** `docs/reviews/eng-v2-03-rc1-astra/viewport-resize.mjs` with its oracle was copied to `astra-probe/`. The only changes are its output folder and the build it serves, each through one environment variable (exact substitutions and hashes in [runner-adaptations.json](runner-adaptations.json)). Assertions, timing and the 0.75 CSS px tolerance are unchanged. The originals and their evidence are untouched. The probe names its screenshots `rc1-*` in both output folders; those in `astra-probe/rc2/` show the RC2 build.

| Build | Engine | After 320 × 480: complete label and outline | Covered or clipped | Exit |
|---|---|---|---:|---|
| RC1 (authenticated copy) | Chromium 159.0.8154.6 | **no** | 36.891 px | 1 |
| RC1 | Firefox 159.0 | **no** | 36.500 px | |
| RC2 | Chromium | **yes** | 0.375 px (within 0.75) | 0 |
| RC2 | Firefox | **yes** | 0.400 px (within 0.75) | |

The same residual, 0.375 px (Chromium) and 0.400 px (Firefox), is already present before the resize, when the chip is fully visible; it is the fractional-metrics case the 0.75 px tolerance exists for. Neither build had page errors. Results: [rc1](astra-probe/rc1/viewport-resize.json), [rc2](astra-probe/rc2/viewport-resize.json).

**The full required sequence.** [height-resize.mjs](height-resize.mjs) is one runner for both builds and uses Astra's unchanged `measureFocus` oracle. Each case runs in a fresh synthetic context: reduced motion, local assets only, outside requests refused, Eng Trainer Sans verified loaded.

1. It opens `#topic/small-talk` at 320 × 844 and applies real 200 % text (`html { font-size: 200% !important; }`); chip text measures **28 px**.
2. It uses native Tab to reach **All situations** (Chromium 5 presses, Firefox 6 with its scroller stop), then exactly three more Tabs to **Coffee and lunch breaks**.
3. It changes only the height to 320 × 480, waits 1 s, restores 320 × 844 and shrinks once more.

The test never clicks, refocuses or scrolls.

| Build / engine | Before (844) | At 480 | Restored (844) | 480 again |
|---|---|---|---|---|
| RC1 / Chromium | complete | **36.891 px covered, 6 characters clipped** | complete | **36.891 px covered** |
| RC1 / Firefox | complete | **36.500 px covered, 6 characters clipped** | complete | **36.500 px covered** |
| RC2 / Chromium | complete | complete: outline bottom 379.109, navigation top 379.219, page 430 → 467 px | complete | complete |
| RC2 / Firefox | complete | complete: outline bottom 379.200, navigation top 379.200, page 430.5 → 467 px | complete | complete |

**Element sizes.** In both builds and engines the resize changed no element size:
- strip 320 × 104.375 px (Firefox 104.400), client 320 × 104, scroll width 1819;
- Coffee 288 × 96.375 px (Firefox 96.400), two lines.

So the case exercises a viewport change only. The same Coffee element keeps keyboard focus throughout, and **All situations** stays the only selection.

Screenshots: [RC1 Chromium at 480](height-resize/shots/rc1-chromium-decisive-320-200-480.png), [RC2 Chromium at 480](height-resize/shots/rc2-chromium-decisive-320-200-480.png), [RC1 Firefox at 480](height-resize/shots/rc1-firefox-decisive-320-200-480.png), [RC2 Firefox after the second shrink](height-resize/shots/rc2-firefox-decisive-320-200-480-again.png). These were opened and inspected: on RC1 the navigation covers “breaks” and the lower outline; on RC2 both lines and the full ring are above it.

## Lifecycle and interaction coverage

The same runner, per engine ([rc1.json](height-resize/rc1.json): 4/8 per engine; [rc2.json](height-resize/rc2.json): **8/8** per engine):

| Case | RC1 | RC2 |
|---|---|---|
| The decisive sequence above, including restore and second shrink | fail | pass |
| Ordinary text, 320 px wide, shrunk to 320 × 443 (outline would end 30 px under the bar) | fail: 30.375 / 30.400 px covered | pass |
| 200 % text, 390 px wide, shrunk to 390 × 747 | fail: 29.922 / 30.000 px covered | pass |
| Focus moved to Search, then shrunk: focus stays on Search, page and strip do not move | pass | pass |
| Traveling selected, focus on Search, strip scrolled by the wheel: the manual position (Chromium 132 px, Firefox 161.4 px) is kept | pass | pass |
| Resize together with Tab to the next chip: the new owner ends fully visible | pass | pass |
| Resize, then navigate Home at once: Home shown, page at the top, no errors | pass | pass |
| Burst of six resizes ending at 480: complete; Chromium 1 and Firefox 2 reveal scrolls, none in the following second | fail: 36.891 / 36.500 px covered | pass |

**Unit regressions.** Seven deterministic tests were added to `src/features/topics/revealFocusedChip.test.ts`. They were written first and run against the unchanged RC1 action: **3 failed, 7 passed** ([log](unit/rc1-before-fix.log)). After the fix: **10/10** ([log](unit/rc2-after-fix.log)). They:

- dispatch real `resize` events while sizes stay fixed (the observer is never notified);
- run only still-requested frames, or deliberately also canceled ones.

They cover:

- the reveal after a height-only change;
- a second reveal after restore and re-shrink;
- no reveal and no focus theft with Search focused;
- a kept manual scroll position for an unfocused selection;
- no reveal of, and no geometry reads from, a former owner when focus moves first;
- canceled work and a removed listener after destroy, with no reads of detached elements and no errors;
- a burst coalesced into one reveal without a follow-up loop.

**Existing coverage on RC2.**

- The RC1 focused runner (`docs/evidence/eng-v2-03-rc1/focused-chips.mjs`, copied with only its output folder changed) passes **7/7 scenarios with 157/157 visibility measurements per engine**, as on RC1: every chip at 320/390 px and 100/200 % text, Tab, Shift+Tab, Enter, Space, focused reflow, vertical and manual scrolling, focus ownership and unmount ([rc2.json](rc1-runner/rc2.json)).
- The unchanged implementation runner passes **12/12 scenarios per engine** ([results](implementation-browser/results.json)).

## Commands

The documented gates ran once as a set ([commands.json](commands/commands.json) and [logs](commands/logs/)):

| Check | Result |
|---|---|
| `npm run check` / `npm run check:v1` | 0 errors, 0 warnings (266 / 189 files) |
| `npm test` | 15/15 content and build tests; **345/345** v2 tests in 29 files (RC1: 338) |
| `npm run test:v1` | 68/68 |
| `npm run build`, `npm run build:site` | Pass |
| `npm run verify:content` | Pass: exact legacy content and order, v1 unchanged |
| `git -c core.whitespace=cr-at-eol diff --check`; new-file whitespace | Clean; 139 new text files, 0 problems (repeated after the final documentation: [final-checks.json](final-checks.json)) |

The unit log still contains the 18 existing Learn again Undo `lifecycle_double_unmount` warnings, as RC1's did. There are no new errors or unhandled rejections.

## Budgets

The cold-load method is unchanged: RC1's `budget.mjs`, copied with only its build pair (authenticated RC1 copy and RC2) and output changed. It uses fresh 390 × 844 contexts, intended fonts, network idle plus 500 ms, local gzip -9 except stored WOFF2, and response-body bytes without headers ([budget.json](budget.json)). The heaviest route is `#wordIndex`:

| Build / engine | Code | Fonts | Content | Other | Total |
|---|---:|---:|---:|---:|---:|
| RC1 / Chromium | 97,264 | 193,052 | 240,899 | 0 | 531,215 |
| RC1 / Firefox | 97,264 | 193,052 | 240,899 | 209 | 531,424 |
| RC2 / Chromium | 97,280 | 193,052 | 240,899 | 0 | 531,231 |
| **RC2 / Firefox** | **97,280** | **193,052** | **240,899** | **209** | **531,440** |
| Limits | 102,400 | 204,800 | — | — | 563,200 |

The RC1 figures reproduce Astra's exactly. RC2 adds **16 B** of compressed code; fonts and content are unchanged. The larger RC2 total is **531,440 B**, 31,760 B under the limit. These are local Windows measurements, not a CI or production run.

## RC2 delta and preservation

- **Built artifacts** ([artifacts.json](artifacts.json)). 31 of 33 files are byte-identical to RC1. Only `index.html` and the script differ (`index-BIsJEtZg.js` → `index-CggR75Uk.js`); the stylesheet `index-DFaGuSQ9.css` is the same file. Every group in RC1's protected-artifact record matches: manifest and all 14 packs, five built v1 files, three font notices, six font assets. So do its nine protected source files.
- **Source delta** ([preservation-after.json](preservation-after.json)). It contains exactly `src/features/topics/revealFocusedChip.ts`, `src/features/topics/revealFocusedChip.test.ts` and the appended handoff. The earlier handoff bytes are an exact prefix. Every other candidate entry is byte-identical, as are:
  - the main checkout;
  - the original review, the RC1 review (619 entries including ignored files) and the RC1 evidence;
  - the Git exclude file;
  - the RC1 build copy.

## Limitations

- **Layout viewport only.** Viewport-height changes are handled when the browser reports them as a window `resize`. Changes that alter only the visual viewport are not claimed or tested: pinch zoom, and on-screen keyboards or toolbars in browsers that do not resize the layout viewport.
- **Not verified:** Safari/WebKit, physical devices and touch hardware, assistive-technology output, audible speech, OS text-size settings, Linux CI and deployment.
- **Deferred.** The inherited Reset-dialog finding remains deferred, as classified by Astra; it was not changed or re-probed.

## Reproduction

From the worktree root, with its installed root/v1 dependencies and the isolated Playwright tooling resolved through `git rev-parse --git-common-dir` (as in the RC1 runners). Use fresh output locations to keep this evidence.

```powershell
node docs/evidence/eng-v2-03-rc2/prepare-runners.mjs
$env:RC2_PROBE_OUT = '<new-output>'; $env:RC2_PROBE_SITE = 'docs/evidence/eng-v2-03-rc2/local/rc1-site'   # then 'site-dist'
node docs/evidence/eng-v2-03-rc2/astra-probe/viewport-resize.mjs
node docs/evidence/eng-v2-03-rc2/height-resize.mjs docs/evidence/eng-v2-03-rc2/local/rc1-site <name>
node docs/evidence/eng-v2-03-rc2/height-resize.mjs site-dist <name>
$env:RC2_FOCUSED_OUT = '<new-output>'; node docs/evidence/eng-v2-03-rc2/rc1-runner/focused-chips.mjs site-dist <name>
$env:PLAYWRIGHT_BROWSERS_PATH = '<git-common-dir>/eng-v2-02b-release/browsers'
node docs/evidence/eng-v2-03/browser-check.mjs '<git-common-dir>/eng-v2-02b-release/tools/node_modules' site-dist <new-output>
node docs/evidence/eng-v2-03-rc2/budget.mjs
node docs/evidence/eng-v2-03/run-commands.mjs <new-output>
node docs/evidence/eng-v2-03-rc2/artifacts.mjs
node docs/evidence/eng-v2-03-rc2/summarize.mjs
node docs/evidence/eng-v2-03-rc2/preserve.mjs after
node docs/evidence/eng-v2-03-rc2/final-audit.mjs
```

Run builds from a working directory written with an upper-case drive letter (`C:\…`), so Svelte's scoped class names match CI. `preserve.mjs before` is one-shot and refuses to replace its capture. The unit fail-before log comes from running `src/features/topics/revealFocusedChip.test.ts` while the RC1 action (kept in `local/rc1-sources/`) was still in place, before the application edit.

`local/` is ignored. It holds the authenticated RC1 build, the RC1 copies of the changed files and the full before-inventory. Public evidence uses repository-relative paths and synthetic data only.

Nothing staged, committed, pushed, merged or deployed; no PR was created.
