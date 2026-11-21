# ENG-V2-02A — Integration scope and deferred follow-ups

Date: 2026-11-21. This integration packages the independently reviewed candidate for a pull request to `main`. Merge and production deployment remain owner-controlled.

## Reviewed candidate

- Baseline: `c84ef30d80ffbaae4ac0f3aa0fb7fe6090b8067b`.
- Feature branch: `feature/eng-v2-02a-content-packs`.
- [Fable's independent review](../reviews/ENG-V2-02A-FABLE.md): **READY_FOR_PR**, no mandatory findings.
- Before any staging, all **280** hashes in Fable's `candidate.sha256` and all **37** entries in the implementation's `candidate.json` matched the working tree. The intended untracked files are part of the candidate, not disposable files.
- The [implementation handoff](ENG-V2-02A.md) and [pack format](../architecture/BUILT-IN-CONTENT.md) describe the reviewed behavior. Those historical documents and the independent report are preserved.
- Integration adds documentation and the publication hash mapping. It does not change application behavior, content, validators, test assertions, dependency lockfiles, the workflow, or v1.

The implementation and its coupled tests are grouped into one feature commit because replacing the monolith also changes the existing test fixtures and npm test entrypoint. Documentation, evidence and the independent review form a second commit. Actual commit IDs, the PR link and GitHub Actions outcome are recorded on the PR and in the integration delivery report.

## Deferred findings

All seven items below remain non-blocking and are explicitly deferred. They are not fixes included in this integration.

| ID | Severity | Future follow-up |
|---|---|---|
| N1 | Low | Add source filenames or URLs to generation parse errors, runtime schema failures and network errors. |
| N2 | Low | Evaluate startup improvements if needed, retaining complete catalog/search behavior. Fable measured 2,060 → 2,277 ms (+217 ms, +11%) on a moderate emulated HTTP/2 profile and +364 ms (+24%) on the high-latency profile. These are local emulations, not production CDN measurements. |
| N3 | Low, documented | Protect direct `vite` / `vite build` usage against stale generated content, for example by comparing the published manifest against authored content in `check:site`. The supported npm/CI commands already regenerate. |
| N4 | Informational | Consider stray non-hash files in generated output, case-sensitive `.json` discovery, and duplicate JSON object keys when evolving authoring validation. |
| N5 | Low, test quality | Make negative loader tests assert the intended error message as well as rejection. |
| N6 | Informational | Evaluate caching immutable pack URLs; current `cache: 'no-store'` matches the released application's policy. |
| N7 | Informational | Deliberately update or retire preservation fingerprints in a future content-changing milestone. |

CSV/JSON vocabulary import/export and IndexedDB user collections remain ENG-V2-02B/future scope. A local pronunciation model remains a later milestone. None is introduced here.

## Evidence and publication

The [publication hygiene note](../reviews/ENG-V2-02A-PUBLICATION.md) records evidence inspection and explains the working-copy-to-Git hash mapping. Authored packs, scripts, source/tests and reproducible review evidence are included. Generated `public/data/manifest.json`, `public/data/packs/`, both dependency trees, build output, disposable workspaces, browser profiles and local authentication are excluded.

The existing PR workflow must run on GitHub, check/test both applications, regenerate all 11 packs, build both applications and assemble/check the combined site. For a PR, Pages configuration/upload and the deployment job must be skipped. An open PR with passing checks does not authorize merge or release.
