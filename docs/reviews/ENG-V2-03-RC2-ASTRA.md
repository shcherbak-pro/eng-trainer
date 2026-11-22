# ENG-V2-03-RC2 — Independent re-review

22 November 2026, Europe/Kyiv. Reviewer: Astra/Codex.

**READY_FOR_PR. F1-RC1 / P2 is CLOSED.** RC2 keeps the keyboard-focused Small Talk chip's complete label and outline visible after layout-viewport height changes in native Chromium and Firefox. The authenticated RC1 copy reproduces the exact obstruction; RC2 passes the unchanged oracle, including restoring height and shrinking again. Horizontal revelation, wrapping, focus eligibility and cleanup remain correct. No integration blocker was found.

**Candidate identity and verified delta**

| Item | Verified value |
|---|---|
| Worktree | `eng-trainer/.worktrees/eng-v2-03` |
| Branch | `feature/eng-v2-03-learning-topics` |
| Base and HEAD | `03f1267f1ef4287580227ce5db67615988c98177` |
| State at capture | Uncommitted and unstaged; 24 modified tracked files, 695 untracked files |
| RC1 substantive fingerprint | `01c6ec10666ed943fbb3804101637cd00458ed60a8caaf319586e84e44e7039c` |
| RC2 substantive fingerprint, same exclusions | `e862d40228c7338e07610c1c33fae1afdbcf2d07b25f80512aaf07db7bd88044` |
| Full changed/untracked fingerprint, excluding this review | `bc57c526c352e5174053fd19cb2bbd0d113eeb47288f569ed68fbfdc97738fa3` |

The before inventory includes hashes and Git-state flags for tracked and untracked implementation files, branch/HEAD/status, exact ignored snapshots and a binary-capable diff. See [scope.json](eng-v2-03-rc2-astra/scope.json) and [preservation-before.json](eng-v2-03-rc2-astra/preservation-before.json).

The **1,613** entries covered by the previous review become **1,935** solely through **155** later RC1-review public files and **167** new RC2 evidence files. Excluding those additions, the inventory contains the same 1,613 paths, with exactly three changed files:

| File | Verified RC2 change |
|---|---|
| `src/features/topics/revealFocusedChip.ts` | Adds `window.addEventListener('resize', schedule)`, removes that listener on destroy, and updates two comments |
| `src/features/topics/revealFocusedChip.test.ts` | Retains the original three tests and adds seven viewport-resize regressions |
| `docs/handoffs/ENG-V2-03.md` | Appends section 13; the preceding **38,402 bytes** remain an exact prefix |

Removing the two listener statements and comments produces the same action tokens as RC1. Reveal calculations, outward rounding, focus/connection guards, CSS, wrapping, horizontal clearance and every other application file are unchanged. [Final audit](eng-v2-03-rc2-astra/final-checks.json) verifies this comparison and the copied-runner adaptations.

**Authenticating the RC1 before build**

The retained copy at `docs/evidence/eng-v2-03-rc2/local/rc1-site/` was verified before use. The previous independent review recorded SHA-256 values for 29 protected artifacts and preserved the implementation record containing RC1's HTML hash, but did not retain full hashes for RC1's changed JS/CSS bundles. Matching compressed sizes alone would not close that provenance gap.

The reviewer therefore verified the retained 29 protected artifacts and HTML against those records, then built RC1 in this review's ignored local directory from **164 inputs**, each authenticated against the prior independent source inventory. All **28 rebuilt non-v1 files** matched the retained copy byte-for-byte; all **five v1 files** matched the prior recorded hashes. This authenticates all **33** retained files without altering or resetting the active worktree. The native comparisons use a new copy of that authenticated build.

[rc1-authentication.json](eng-v2-03-rc2-astra/rc1-authentication.json) records the verified inputs and complete artifact hashes; [the isolated build log](eng-v2-03-rc2-astra/rc1-authentication-build.log) records the supplementary build. This extra local build addressed the missing hash record, not a production-code defect.

**Exact before/after closure**

The original independent [viewport-resize.mjs](eng-v2-03-rc1-astra/viewport-resize.mjs) and its geometry oracle were copied unchanged except for served-build and output paths. Original scripts and evidence are preserved. Exact substitutions and SHA-256 values are in [runner-adaptations.json](eng-v2-03-rc2-astra/runner-adaptations.json).

Fresh, nonpersistent contexts start at **320 × 844** on Small Talk with actual **200% text**. Eng Trainer Sans is loaded and chip text measures **28px**, versus 14px normally. Native Tab reaches All situations, followed by three Tabs to Coffee and lunch breaks. Changing only height to **480** leaves the same Coffee element focused and All situations selected.

The unchanged oracle evaluates readable characters and the full **2px outline plus 2px offset**, against clipping ancestors, viewport bounds and the fixed navigation. The accepted **0.75 CSS px** rounding tolerance is unchanged. No additional clearance requirement was imposed.

| Engine | RC1 after shrink | RC2 after shrink | RC2 outline bottom / navigation top |
|---|---|---|---:|
| Chromium 159.0.8154.6 | **36.891px obstructed**, word “breaks” clipped | Complete label and outline | 379.109 / 379.219px |
| Firefox 159.0 | **36.500px obstructed**, word “breaks” clipped | Complete label and outline | 379.200 / 379.200px |

The original probe exits **1 on RC1** and **0 on RC2**, with zero native page errors. Its small RC2 overall geometry differences, **0.375px / 0.400px**, come from the strip's integral client height versus fractional layout dimensions. They are already present before resizing and remain within the existing tolerance. They do not indicate continued navigation obstruction.

Results: [exact-probe-summary.json](eng-v2-03-rc2-astra/exact-probe-summary.json), [RC1 measurements](eng-v2-03-rc2-astra/exact-rc1/viewport-resize.json), and [RC2 measurements](eng-v2-03-rc2-astra/exact-rc2/viewport-resize.json).

The supplementary [height sequence](eng-v2-03-rc2-astra/height-sequence.mjs) uses that same oracle and performs **844 → 480 → 844 → 480** with no clicks, refocus, test-side scroll or reveal helper. Coffee retains the same DOM identity and keyboard focus throughout; All situations remains the only selection. Strip and chip dimensions do not change:

- Chromium: strip **320 × 104.375px**, Coffee **288 × 96.375px**.
- Firefox: strip **320 × 104.400px**, Coffee **288 × 96.400px**.
- Both: strip client size **320 × 104px**, scroll width **1,819px**, and two readable Coffee lines.

RC1 fails both shrinks. RC2 passes both. On RC2's first shrink, the page moves from 430px to 467px in Chromium and from 430.5px to 467px in Firefox. The later restore/re-shrink preserves the now-visible position without an unnecessary additional jump.

The two documented additional height cases also pass, including restore and second shrink:

| Case | RC1 obstruction, Chromium / Firefox | RC2 |
|---|---:|---|
| 320px wide, normal text, 844 → 443px high | 30.375 / 30.400px | Complete |
| 390px wide, 200% text, 844 → 747px high | 29.922 / 30.000px | Complete |

Per engine, this is **three before cases and three RC2 cases**, each with four geometry observations. All **12 RC2 observations per engine pass**, with no other assertion failures on either build. See [height-sequence.json](eng-v2-03-rc2-astra/height-sequence.json).

Representative screenshots were opened and inspected: [RC1 Chromium failure](eng-v2-03-rc2-astra/height-shots/rc1-chromium-320-200-shrink.png), [RC2 Chromium pass](eng-v2-03-rc2-astra/height-shots/rc2-chromium-320-200-shrink.png), [RC1 Firefox failure](eng-v2-03-rc2-astra/height-shots/rc1-firefox-320-200-shrink.png), [RC2 Firefox second shrink](eng-v2-03-rc2-astra/height-shots/rc2-firefox-320-200-second-shrink.png), [normal-text pass](eng-v2-03-rc2-astra/height-shots/rc2-firefox-320-100-shrink.png), and [390px enlarged-text pass](eng-v2-03-rc2-astra/height-shots/rc2-chromium-390-200-shrink.png).

**Event path, coalescing and cleanup**

Registration and removal both use **window**, **resize**, the same **schedule** function and default capture options. The scheduler reads `document.activeElement`; it does not treat the event object as a target. Existing eligibility checks run before scheduling, and the existing deferred guards revalidate destruction, connections, focus ownership and keyboard focus visibility.

The seven new implementation tests pass within the full suite. They cover unchanged element sizes, a second resize, outside focus, an unfocused selection, a former chip owner, destruction/removal and same-frame coalescing. The original three deferred-lifecycle tests also pass.

The new [native event-path workflow](eng-v2-03-rc2-astra/event-lifecycle.mjs) passes **19 assertions per engine**. These are assertions within one workflow per engine, not 19 distinct browser scenarios:

- Three explicit leave/return cycles each add exactly one action resize handler and restore the original empty listener set on departure. Across the entire workflow, all **five registrations** have matching removals; no handler remains active after final navigation Home.
- With Search focused and Traveling selected, native resize retains the manually wheel-adjusted strip positions: **281px in Chromium**, **251px in Firefox**. Page position, selection and outside focus are unchanged; the handler's invocation is observed.
- A real resize schedules work, then focus moves to Search before execution. Deliberately delivering all **four canceled callbacks** produces no old-target geometry reads, scroll changes or focus theft.
- Navigation Home before a queued resize callback executes cancels it and removes the listener. Forced late delivery plus a further native resize produces **zero detached-control geometry reads**, no late scrolling and no focus changes.
- Six native height changes settle with **one** corrective scroll in Chromium and **two** in Firefox. Both finish with complete visibility, and neither produces further movement during the following second. Multiple frames are allowed; exactly one scroll across the entire native series is not required.
- A separate synchronous burst of 20 resize events leaves **one live callback and 19 canceled callbacks**. Delivering the live callback with the chip already visible creates no extra page jump.

There are zero page errors or unhandled rejections. Held/canceled callback delivery and the synchronous event burst are labelled deterministic diagnostics. They are separate from ordinary native resize behavior. Detailed registration/removal records, positions and scroll calls are in [event-lifecycle.json](eng-v2-03-rc2-astra/event-lifecycle.json).

**Bounded regression verification**

The documented gates ran once as a set from the candidate worktree; `build:site` includes its normal nested builds. [Command records](eng-v2-03-rc2-astra/commands/commands.json) and logs contain the actual results.

| Verification | Result |
|---|---|
| `npm run check`; `npm run check:v1` | Each: 0 errors, 0 warnings |
| `npm test` | **15 content/build tests**, **345 v2 tests in 29 files**, all passed |
| `npm run test:v1` | **68 tests in 3 files**, all passed |
| `npm run build`; `npm run build:site` | Passed |
| `npm run verify:content` | Passed; exact legacy content/order match and v1 unchanged |
| Documented tracked/new-file whitespace checks | Passed; initial new-file gate covered 166 text files; final audit covers the later review additions |
| Existing independent suite | **24/24** passed |
| Original implementation browser runner | **12/12 scenarios per engine** |
| Established independent RC1 focused suite on RC2 | **9/9 scenarios; 126/126 visibility measurements per engine** |
| Exact height-only probe | RC1 fails as expected; RC2 passes in both engines |
| Full height sequences | **3/3 RC2 cases per engine**, including both additional heights |
| Targeted event-path workflow | **19/19 assertions per engine** |

The established focused suite preserves real Tab/Shift+Tab, Enter/Space, selection/search behavior, memory-only navigation/reload state, horizontal manual scrolling, focused text/width reflow and deferred ownership checks. All chips at 320/390 × 844 and 100%/200% text remain fully readable, including wrapped oversized labels. Its two unchanged original-build calibration cases still detect the pre-RC1 horizontal/outline defect. The implementation's overlapping 157-assertion suite was not additionally rerun.

The existing independent suite and focused runner use copies with only output/fixture paths and candidate labels adapted. All original assertions remain intact. Original evidence writers were not invoked against historical directories. See [runner-adaptations.json](eng-v2-03-rc2-astra/runner-adaptations.json), [independent.json](eng-v2-03-rc2-astra/independent.json), [focused.json](eng-v2-03-rc2-astra/focused.json), and [implementation-browser results](eng-v2-03-rc2-astra/implementation-browser/results.json).

The native probe's expected RC1 exit 1 is deliberate before-case evidence. Existing error-path scenarios deliberately fail selected requests. The unit log contains nine `lifecycle_double_unmount` warning occurrences from the same inherited Learn again Undo tests, also nine in the prior independent log. The implementation's aggregate warning count is not used as a regression criterion. The wrapper's Node subprocess deprecation warning is tooling output. No new application failure was found.

The first final-hygiene attempt checked the report's link to its own output before creating that output. The reviewer corrected that check's ordering; final hygiene passes. This was a review-harness issue.

**Refreshed budgets and artifact preservation**

The established method remains fresh 390 × 844 contexts, intended fonts loaded, network idle plus 500ms, local gzip level 9 except stored WOFF2, and browser response-body bytes excluding headers. Five routes were measured in each engine; `#wordIndex` is heaviest.

| Build / engine | Code | Fonts | Content | Other | Total |
|---|---:|---:|---:|---:|---:|
| RC1 / Chromium | 97,264 | 193,052 | 240,899 | 0 | 531,215 |
| RC1 / Firefox | 97,264 | 193,052 | 240,899 | 209 | 531,424 |
| RC2 / Chromium | 97,280 | 193,052 | 240,899 | 0 | 531,231 |
| **RC2 / Firefox** | **97,280** | **193,052** | **240,899** | **209** | **531,440** |
| Limits | 102,400 | 204,800 | — | — | 563,200 |

The larger measured total is **531,440 B**, leaving **31,760 B**. Code increases by 16 compressed bytes; content and fonts do not change. All routes pass. [budget.json](eng-v2-03-rc2-astra/budget.json) contains complete measurements.

Against the authenticated RC1 artifact inventory, **31 of 33 built files are byte-identical**. Only entry HTML and the script bundle differ. The renamed script is counted as one changed artifact, with a removed/added path in the delta. CSS remains `assets/index-DFaGuSQ9.css`, byte-identical. Manifest, all 14 packs, v1 outputs, font assets/notices and the favicon are preserved. Both full artifact inventories and the delta are recorded in [artifacts.json](eng-v2-03-rc2-astra/artifacts.json) and [RC1 authentication](eng-v2-03-rc2-astra/rc1-authentication.json).

**Preservation and limits**

[Final preservation](eng-v2-03-rc2-astra/preservation-after.json) proves equality with the capture for all **1,935 candidate files** and all **1,332 main-checkout files**, including its **92 pre-existing untracked files**. Main's branch/HEAD and staged state are unchanged. Original review files including ignored copies (**506**), RC1 review (**619**), original implementation evidence (**49**), RC1 evidence (**286**) and RC2 evidence (**204**) are byte-identical; Git exclusions are unchanged.

Authored content, topic metadata, IDs, frozen content fingerprints, Home calculations, storage/import/export, flashcard logic, dependency manifests, workflows, v1 and existing release evidence are unchanged. Preservation supports retaining the earlier exhaustive audits; no separate editorial, schema, statistics or search audit campaign was repeated. The inherited Reset-dialog finding remains deferred: this delta does not demonstrate an effect on it, and its special expected-rejection probe was not rerun.

Actual tooling: Windows, Node **24.18.0**, npm **11.17.0**, Git **2.54.0.windows.1**, Playwright **1.65.1**, Vite **6.4.3**, Svelte **5.57.0**, Vitest **3.2.7**. Existing isolated browsers/tools were resolved through `git --git-common-dir`. Contexts were nonpersistent, with synthetic state and local assets only; no owner browser profile was used.

Approval covers layout-viewport changes delivered through window resize. VisualViewport-only changes, pinch zoom, on-screen keyboards that do not resize the layout viewport, Safari/WebKit, physical devices/touch, assistive-technology output and audible speech remain declared limitations. No Linux CI or production deployment run is established. Uppercase-drive build reproduction is local Windows evidence; the evidence README's wording about matching CI does not establish a CI result.

Only this report and `docs/reviews/eng-v2-03-rc2-astra/` were added by the reviewer. Exact local copies and the authentication build remain ignored; public evidence is sanitized. Nothing was staged, committed, pushed, merged or deployed; no PR was created.
