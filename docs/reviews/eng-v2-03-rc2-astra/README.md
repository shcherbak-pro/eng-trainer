# ENG-V2-03-RC2 independent review evidence

[Review report](../ENG-V2-03-RC2-ASTRA.md): **READY_FOR_PR**, F1-RC1 / P2 closed.

| Evidence | Purpose |
|---|---|
| `scope.json`, `preservation-before.json`, `preservation-after.json` | Candidate identity, exact three-file delta, historical/main preservation |
| `rc1-authentication.json`, `rc1-authentication-build.log` | Retained RC1 authenticated against prior hashes and an isolated build of hashed source inputs |
| `artifacts.json` | Full RC2 artifact hashes; 31/33 outputs unchanged |
| `runner-adaptations.json` | Exact historical-runner path/label substitutions and SHA-256 values |
| `exact-probe/`, `exact-rc1/`, `exact-rc2/` | Original independent height probe and oracle; RC1 exits 1, RC2 exits 0 |
| `exact-probe-summary.json` | Exact failure-before / pass-after measurements in both engines |
| `height-sequence.mjs`, `height-sequence.json`, `height-shots/` | Restore/re-shrink, focus/selection/unchanged dimensions, two documented additional heights |
| `event-lifecycle.mjs`, `event-lifecycle.json` | Native listener tracking, manual-scroll/outside-focus preservation, stale callbacks, unmount and burst checks |
| `focused.mjs`, `browser-support.mjs`, `focused.json`, `shots/` | Established independent suite; 9 RC2 scenarios and 126 geometry assertions per engine |
| `commands/`, `independent.json`, `implementation-browser/` | Fresh documented gates, 24-test suite, 12 browser scenarios per engine |
| `budget.mjs`, `budget.json`, `tools.json` | Established transfer method and actual tool versions |
| `final-checks.json` | Static delta, runner integrity, results, hashes, whitespace/privacy/link checks |

Commands used from the candidate worktree, with installed dependencies and existing isolated browser tooling:

```powershell
node docs/reviews/eng-v2-03-rc2-astra/preserve.mjs before
node docs/reviews/eng-v2-03-rc2-astra/authenticate-artifacts.mjs before
node docs/reviews/eng-v2-03-rc2-astra/prepare-runners.mjs
node docs/reviews/eng-v2-03-rc2-astra/run.mjs gates
node docs/reviews/eng-v2-03-rc2-astra/authenticate-artifacts.mjs after
node docs/reviews/eng-v2-03-rc2-astra/run.mjs independent
node docs/reviews/eng-v2-03-rc2-astra/run.mjs browser
node docs/reviews/eng-v2-03-rc2-astra/run.mjs focused
node docs/reviews/eng-v2-03-rc2-astra/run-exact-probe.mjs
node docs/reviews/eng-v2-03-rc2-astra/height-sequence.mjs
node docs/reviews/eng-v2-03-rc2-astra/run.mjs budget
node docs/reviews/eng-v2-03-rc2-astra/event-lifecycle.mjs
node docs/reviews/eng-v2-03-rc2-astra/preserve.mjs after
node docs/reviews/eng-v2-03-rc2-astra/final-audit.mjs
```

Use a fresh output directory for future review; do not overwrite these records. Initial preservation and authentication refuse to replace their captures. Historical runners and evidence were preserved. The exact probe copies only change served-build/output paths; original screenshot names still contain `rc1` inside both clearly labelled result directories.

The prior review had no full retained SHA-256 record for its changed RC1 JS/CSS bundles. Authentication therefore used the earlier protected-artifact/HTML hashes plus a byte-exact isolated rebuild from 164 previously hashed inputs. All 33 retained RC1 files authenticated. The active worktree was never reset or reconstructed.

The full height sequence reaches All situations with native Tab and advances exactly three times to Coffee. It then changes only height, restores and shrinks again, without test-side scroll, click or refocus. The original 0.75 CSS px clipping tolerance is unchanged. The oracle function itself is unchanged; the copy only redirects output.

Counts distinguish scenarios and assertions. Per engine: the implementation runner has 12 scenarios; the established independent focused suite has 9 RC2 scenarios and 126 geometry observations; the full height sequence has 3 RC2 cases with 4 observations each; the event-path workflow has 19 assertions. Expected failures of RC1 and the original pre-RC1 calibration build are separate before-case evidence.

The event-path workflow explicitly labels held/canceled-frame delivery and synchronous synthetic resize bursts. Native multi-frame bursts allow legitimate multiple corrections; final visibility, absence of duplicate handlers and stable position after settlement determine success.

`local/` is ignored. It contains exact candidate snapshots, the authenticated RC1 build, its isolated source build and temporary malformed fixtures. Public logs contain repository-relative paths and synthetic data. No commit, PR, merge or deployment is part of this review.
