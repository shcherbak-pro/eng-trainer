# ENG-V2-02A — Implementation handoff

Date: 2026-11-21. Status: **implemented and locally validated; awaiting independent review**. Nothing is staged, committed, pushed, merged, or deployed.

## Baseline and authorization

- Repository: `shcherbak-pro/eng-trainer`. `git ls-remote origin refs/heads/main` and `git fetch origin main` verified the requested baseline, `c84ef30d80ffbaae4ac0f3aa0fb7fe6090b8067b`.
- Initial checkout: clean `feature/eng-v2-01-modular-foundation` at `3e595b5`. Its tree equaled the fetched main tree. No local work needed moving or stashing.
- Working branch: `feature/eng-v2-02a-content-packs`, created directly from `origin/main`. HEAD remains the baseline commit.
- The parent `AGENTS.md` describes web-school/Angular. This request explicitly authorizes eng-trainer's Svelte milestone. Its no-commit and required-build rules were followed. No repository-local/nested `AGENTS.md`, project bootstrap, or active memory-loader binding was found; workspace `.agents` and `.codex` were empty.
- The sibling framework workspace's routing metadata, project note and named eng-trainer memory pack were inspected read-only. They describe the pre-v2 `src/lib`/localStorage app and have no verified project loader binding. They were not activated as authoritative memory. Current source, README, ENG-V2-01 handoff and both Astra review reports supplied the verified architecture. No framework configuration or sibling repository was changed.
- The existing Actions workflow builds/tests on PRs and deploys from main. This handoff stops before integration. The user's requested independent review is still required; the checks below are implementation validation, not independent approval.

## Design and implementation

The original v2 `public/data/materials.json` is replaced with 11 authored thematic JSON packs in `content/packs/`. `content/catalog.json` keeps the course metadata and ordered navigation blocks. Pack version 1 has `id`, `title`, explicit `order`, and a `content` object containing the existing collection shapes. See [the complete format and authoring guide](../architecture/BUILT-IN-CONTENT.md).

The generator discovers packs automatically and fails on malformed shapes, unknown collection keys, duplicate pack orders/IDs, duplicate entry IDs, missing referenced phrases and blocks without content. Output is a deterministic central manifest plus content-addressed pack assets. Generated files are ignored and regenerated before dev/check/test/build. No dependencies or lockfiles changed.

The shared catalog loader fetches the manifest and **all** packs before returning a catalog. It validates metadata, collection counts, identities and relationships. Failure uses the existing error/Retry flow, with no partial results. No screen fetches packs independently, and no lazy-loading or search-engine change was introduced.

| Area | Changed files / responsibility |
|---|---|
| Authored data | `content/catalog.json`, 11 `content/packs/*.json`; removed only v2's original monolith |
| Shared content contract | `src/content/packTypes.ts`, `packFormat.js`, `builtIn.ts`; corrected word transcription type to include the 17 existing nulls |
| Build/publication | `scripts/content-build.mjs`, `generate-content.mjs`, `check-site.mjs`, npm lifecycle hooks and generated-file ignores |
| Validation | Build/format tests, loader/search tests, generated-content fixtures, updated existing dataset imports and App fetch stubs, one added persisted-state/retry regression |
| Audit | Frozen baseline fingerprints, Git-object migration verifier, focused native-browser runner and evidence |
| Documentation | README, changelog, format guide, this handoff |

`tsconfig.json` adds `noEmit` so static checking of the shared JavaScript validator does not attempt to emit over its input file. `catalog.ts`, `search.ts`, all feature production code, `state/`, `storage/`, the Actions workflow, dependency lockfiles, v1 source and all prior review evidence are unchanged.

## Exact preservation

| Collection | Before | After |
|---|---:|---:|
| Phrases | 566 | 566 |
| Word index | 566 | 566 |
| Irregular/contextual verbs | 339 | 339 |
| Blocks | 39 | 39 |
| Patterns | 7 | 7 |
| Ready answers | 6 | 6 |
| Drills | 15 | 15 |
| **Total** | **1,538** | **1,538** |

Full parsed-object equality against the baseline Git object proves all field values and collection order, not merely counts. Separate frozen hashes cover each collection, ordered IDs, metadata and all 566 `sourcePhraseId` relationships. Existing id-less patterns/answers/drills remain id-less. No duplicate text was collapsed. The 566 flashcards and 31 topic identities retain the ENG-V2-01-RC1 rules.

Database name/version/stores and saved progress keys are unchanged, so **no IndexedDB migration is needed**. Pack names do not become learning IDs. Cross-pack references are accepted after all packs load. Existing Focus, hidden state, Learn Passes and saved deck sequences are restored through the same services.

## Reproduction and results

From the repository root, use Node 22+ and installed root/v1 dependencies (`npm ci`, `npm run install:v1` on a fresh checkout):

```bash
npm run check
npm test
npm run check:v1
npm run test:v1
npm run build:site
npm run verify:content
git -c core.whitespace=cr-at-eol diff --check
```

Local environment: Windows, Node 24.18.0, npm 11.17.0, Vite 6.4.3. Evidence: [`docs/evidence/eng-v2-02a/`](../evidence/eng-v2-02a/).

| Check | Result |
|---|---|
| v2 static check | 0 errors, 0 warnings |
| Content/build tests | 10 passed |
| v2 Vitest | 6 files, 129 tests passed (all 118 existing tests retained, 11 added) |
| v1 static check | 0 errors, 0 warnings |
| v1 Vitest | 3 files, 68 tests passed |
| `npm run build:site` | Passed, including required `npm run build`, v1 build, assembly, and generated pack hash/reference checks |
| Git-object migration audit | Exact source/generated content and order match; 566 links preserved; v1 unchanged |
| Focused Chromium checks | 4/4 scenario groups passed |
| Focused Firefox checks | 4/4 scenario groups passed |

The complete search test compares ordered IDs with an independent field-by-field oracle for every unique searchable field across phrases, words, verbs and blocks, including Ukrainian text, examples, alternatives, categories, tags, uppercase queries, empty and absent queries. Frozen baseline equality establishes that those records are the released corpus. The loader test delays the final pack and reverses response timing to verify no partial catalog or order change.

During parallel v1/v2 evidence collection, the exhaustive search test exceeded Vitest's default five-second limit. Its timeout is now 20 seconds, with all assertions retained; the final v2 run passed and that test took about 2.7 seconds. The preliminary timeout log is retained separately. No global timeout or production code was changed for this adjustment.

Failure coverage includes missing/invalid JSON, unsupported versions, unsafe manifest paths, mismatched pack metadata/counts, duplicated identities, missing references, invalid blocks, corrupt output hashes and retry. An App regression seeds all four IndexedDB stores, fails one pack, verifies unchanged records, retries and reloads Focus with the same learned/hidden/favorite state.

The focused native runner serves the assembled production artifact using the unchanged prior review's static server/instrumentation helper. It checks:

1. Exact manifest plus 11 pack requests under v2's base path; HTTP bytes equal built files; immediate last-entry searches in each relevant pack; all ten screens render.
2. Existing native IndexedDB records restore without writes; Focus, hidden filters, explicit linked-word learning, independent duplicate phrase identity, saved deck order, Learn Pass data and reload remain consistent.
3. A missing pack with populated storage shows an error without a partial app or writes; Retry recovers the last-pack entry and preserves storage.
4. v1 loads only its own monolith and opens no v2 database.

Reproduce with Playwright installed in a separate tools directory and Chromium/Firefox binaries available:

```text
node docs/evidence/eng-v2-02a/browser-check.mjs <tools-directory> [evidence-directory]
```

Set `PLAYWRIGHT_BROWSERS_PATH` if needed. The runner uses isolated browser contexts, not user profiles. This run reused the prior review's existing tools without adding project dependencies. An initial harness assertion failed because rendered stat text contained a line break; whitespace normalization corrected it. The Words selector was also corrected to `.index-list` before the successful rerun. Application code did not change for those harness fixes. The preliminary log/screenshots are labeled separately from final results.

Final browsers: Chromium 151.0.7922.34 and Firefox 153.0, with no uncaught page errors. Recorded console messages are the intentional content HTTP 503 and Firefox interruptions of the existing external icon-font download during reload. The final remote recheck still reported `c84ef30d80ffbaae4ac0f3aa0fb7fe6090b8067b`.

## Review focus and limits

- Review ordering and explicit-ID preservation using `npm run verify:content`. It needs the pinned release Git object; ordinary tests use the small frozen fingerprints and work with shallow CI history.
- Review the generated-source boundary: authors edit only `content/`; `public/data` is generated. Restart dev after editing source packs. Direct `vite build` bypasses npm's generation hook; the documented and CI path is `npm run build`.
- The manifest produces 12 initial content requests instead of one. This is the requested eager all-pack iteration. Content-addressed filenames and schema/count checks handle missing/mixed deployment assets visibly; no offline support is claimed.
- The browser runner is focused on this milestone. The full prior 17-group review suite, WebKit/Safari, mobile devices, audible speech, physical quota exhaustion, concurrent tabs and a hosted deployment were not rerun. No Node 22/Linux Actions run was triggered.
- CSV/JSON user imports, user-collection storage and local pronunciation models are out of scope and absent.

The reviewer should inspect the uncommitted feature-branch working tree. Commit/push/PR/integration/deployment require the next authorized workflow step; none was performed here.
