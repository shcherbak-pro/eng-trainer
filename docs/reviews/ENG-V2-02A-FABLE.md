# ENG-V2-02A — Independent architecture and regression review (Fable)

Date: 2026-11-21. Reviewer: Fable (Claude Code). Developer under review: Astra.

**Verdict: `READY_FOR_PR`.** No mandatory corrections. Section 12 lists seven non-blocking findings, all low severity or informational.

The thematic packs reproduce the released content exactly, down to every record, key order and position. Search, flashcards, Focus, Learn Passes and saved IndexedDB state behave the same as the released ENG-V2-01 build. In native Chromium and Firefox, a released build and the candidate build given identical synthetic databases produced identical screens and identical database contents. Malformed, missing, or inconsistent content fails loudly at generation time and at runtime. It never produces a partial catalog and never writes to IndexedDB. v1 is untouched. The one measurable cost is startup time: one extra network round trip, about +0.22 s (+11%) on a moderately constrained HTTP/2 profile. That cost follows directly from the requested design of eager manifest-then-packs loading, and this review does not treat it as a blocker.

## 1. Exact candidate reviewed

| Item | Value |
|---|---|
| Repository | `shcherbak-pro/eng-trainer`, local checkout `<repo>` |
| Branch | `feature/eng-v2-02a-content-packs` |
| HEAD | `c84ef30d80ffbaae4ac0f3aa0fb7fe6090b8067b`, the verified baseline. `git ls-remote origin refs/heads/main` still returned this commit during the review. |
| Working tree | Uncommitted. Nothing staged. 11 tracked files modified, 1 tracked file deleted (`public/data/materials.json`), 43 untracked intended files (`content/`, scripts, tests, fixture, docs, Astra's evidence). |
| Fingerprint | SHA-256 of every non-ignored file (280 files), recorded before testing: [`candidate.sha256`](eng-v2-02a-fable/candidate.sha256). All 37 per-file hashes in Astra's [`candidate.json`](../evidence/eng-v2-02a/candidate.json) match this tree. |
| Unchanged by the review | After the review, the same 280 files were re-hashed and were byte-identical, and `git status` showed the same 55 entries. The only additions are this report and `docs/reviews/eng-v2-02a-fable/` (section 14). The required workspace `npm run build` rewrote only ignored outputs, and the regenerated `public/data` is byte-identical. Nothing was reset, cleaned, stashed, staged, committed, pushed, or merged. |

Instructions and memory: the parent `AGENTS.md` (web-school scope, no commits, run the build) was followed where it applies. The request explicitly authorizes eng-trainer work. eng-trainer has no repository-local `AGENTS.md`, and the reviewer's memory index has no eng-trainer binding. Astra's handoff reports the same for its own environment.

## 2. Method and environment

All installs, builds, tests and probes ran in **disposable copies** under `<review-copy>`:

- `candidate/`: a `git clone --no-hardlinks` of the local repository (for Git history, which `verify:content` needs), overlaid byte-for-byte with every non-ignored file of the working tree. Its 280-file fingerprint equals the candidate's.
- `baseline/`: a clone detached at `c84ef30` (LF checkout), built as the released reference.
- `hooks/` and `generator-probes/`: throwaway trees for destructive probes.

Dependencies came from the unchanged lockfiles via `npm ci`, using a disposable npm cache. Environment: Windows 11 `10.0.26200`, Node 24.18.0, npm 11.17.0, Vite 6.4.3, Vitest 3.2.7, Playwright 1.62.1, **Chromium 151.0.7922.34**, **Firefox 153.0**. Playwright and the browser binaries were reused read-only from the earlier review's disposable tooling folder (`<review-tools>`). No project dependency was added.

**Environment issue (not a candidate defect).** The first copy sat under the user's `%TEMP%`. That folder contains unrelated `package.json` and `tsconfig.json` files whose content is HTML. Vite's config loader walked up into them, so `npm test`, `npm run test:v1` and `npm run build:site` failed with `Unexpected "<" in JSON`. The RC1 review notes the same temp-folder files. I moved the copies to a folder with no such ancestors, cleared the generated outputs, confirmed the fingerprint again, and reran everything. The failed temp-folder logs are not included as evidence, following [SANITIZATION.md](SANITIZATION.md).

Independence: the content audit, generator probes and browser runner are my own code. The content audit does not import Astra's validator, generator, or frozen fixture. The search differential runs the **released** `catalog.ts`/`search.ts`/`flashcards.ts`, extracted from `c84ef30`, over the released monolith, and compares the result with the candidate's real loader reading the assembled artifact. From Astra's tooling I reused only the RC1 review's browser instrumentation helpers (`browser-support.mjs`), read-only.

## 3. Architecture findings

The design matches the milestone:

| Boundary | Verified |
|---|---|
| Authoring | `content/catalog.json` (meta and 39 ordered blocks) plus 11 `content/packs/*.json`. Outside `public/`. No generated file is tracked (`/public/data/manifest.json` and `/public/data/packs/` are ignored, and none are present in the candidate's untracked set). |
| Generation | `scripts/generate-content.mjs` → `content-build.mjs` → the pure shared validator `src/content/packFormat.js`. Everything is validated before anything is written. Output is the manifest plus `packs/<id>.<sha256-16>.json`. |
| Runtime loading | `src/content/builtIn.ts` is the **only** runtime `fetch` in `src/`. It fetches the manifest, then all packs concurrently, and validates them with the same shared module. Only then does it call the **unchanged** `createCatalog`. |
| Features | `catalog.ts`, `search.ts`, `shared/`, `state/`, `storage/`, all production files in `features/`, `App.svelte`, `AppShell.svelte`, `navigation.ts`, `index.html`, Vite configs, the workflow, both lockfiles and all of `v1/` show **no diff** against `c84ef30`. In `features/`, only one test changed (`flashcards.test.ts`, its data import). Production code changes are limited to `builtIn.ts` and one type widening (`WordIndexItem.transcription?: string \| null`, matching the 17 real nulls). |
| Persistence | `database.ts` (name `eng-trainer-v2`, version 1, four stores) and the progress/settings services are unchanged. Pack IDs and filenames appear nowhere in stored data. |

Coupling assessment:

- One validator serves both the build and the browser. This is the right choice: generation and runtime cannot disagree about the format. `scripts/` importing `src/content/packFormat.js` is acceptable because the module is pure JavaScript with no dependencies.
- Search and IndexedDB are unaware of packs. They receive the same `Materials` shape as before. No speculative abstraction was introduced.
- Tests read the generated `public/data` (via `src/test/content.ts`), so they depend on the `pretest` generation hook. This is intended: tests exercise what is published, and the frozen fixture separately pins the source to the release.
- Minor redundancy with no material effect: the runtime validates every pack twice (in the loader's `parsePack` and again in `assembleMaterials`), and the aggregate count check repeats a sum that `parseManifest` already checks.

No material architectural problem was found.

## 4. Content preservation

The [independent audit](eng-v2-02a-fable/content-audit.mjs) ([result](eng-v2-02a-fable/results/content-audit.json)) reads `c84ef30:public/data/materials.json` straight from the Git object (1,533,856 bytes, SHA-256 `d206ce32…`). It assembles the authored packs by ascending `order`, and separately reassembles the generated `public/data` and the assembled `site-dist/data` from their manifests. Every record is compared both as serialized JSON (which catches changes in key order) and by deep equality.

| Collection | Release | Source | Byte-identical records | Value or position diffs | Records without ID (before → after) |
|---|---:|---:|---:|---:|---|
| Phrases | 566 | 566 | 566 | 0 | 0 → 0 |
| Word index | 566 | 566 | 566 | 0 | 0 → 0 |
| Irregular/contextual verbs | 339 | 339 | 339 | 0 | 0 → 0 |
| Blocks | 39 | 39 | 39 | 0 | 0 → 0 |
| Patterns | 7 | 7 | 7 | 0 | 7 → 7 |
| Ready answers | 6 | 6 | 6 | 0 | 6 → 6 |
| Drills | 15 | 15 | 15 | 0 | 15 → 15 |
| **Total** | **1,538** | **1,538** | **1,538** | **0** | |

- `meta` is byte-identical. The catalog deep-equals the release for the authored source, the generated `public/data` and the published `site-dist/data` alike.
- Ordered ID lists are identical and unique. The field inventory (count of each field per collection) is identical. All 3,802 strings containing Cyrillic match exactly. No string changed Unicode normalization, and no duplicates were collapsed.
- **All 566 `sourcePhraseId` links are identical, in the same order.** Every target exists, and every phrase has exactly one linked word. All links happen to stay within one pack (0 cross-pack links today). Cross-pack links are supported because references are checked only after assembly; Astra's `content-build.test.mjs` covers moving a linked word into another pack.
- **The six RC1 duplicate-text pairs** are present as distinct IDs at their original positions, each with its own linked word. Each pair spans two packs: `phrase-005`/`hedging-005-from-my-perspective`, `phrase-013`/`advanced-linking-008-…`, and `phrase-084`/`advanced-linking-004-…` span `speaking-foundations`/`hedging-and-linking`; `presentation-phrase-085`/`-087`/`-088` and their partners span `presentations`/`hedging-and-linking`. No other equal-text groups exist.
- All 39 blocks have targets. There are 31 phrase categories and 31 word categories.
- The frozen fixture `src/test/fixtures/content-baseline.json` was computed from the release object, not from the new packs. The audit recomputes all of its hashes (meta, the seven collections, ordered IDs, links) from the Git blob, and all match (`frozenFixtureDerivedFromRelease`). The ordinary-test oracle therefore really pins the release.
- `npm run verify:content` passed ([log](eng-v2-02a-fable/logs/verify-content.log)). It parses the pinned Git object and uses `assert.deepStrictEqual` on the source and published catalogs. Note that `deepStrictEqual` ignores object key order, which is why my audit adds the byte-level comparison.

## 5. Generator

[47 of 47 adversarial probes](eng-v2-02a-fable/results/generator-probes.json) behaved as expected ([script](eng-v2-02a-fable/generator-probes.mjs), [log](eng-v2-02a-fable/logs/generator-probes.log)). Each probe runs the real generator CLI in its own throwaway tree, mutates the source, and reruns.

- **Deterministic.** Two independent trees and a rerun produce byte-identical manifests and pack names. CRLF, 4-space and minified source formatting produce identical output, because packs are reserialized with LF and no timestamp.
- **Rejected with exit 1, previous outputs untouched (29 cases):** duplicate phrase, verb, word or block IDs, including a word ID equal to a block ID; duplicate pack order; duplicate pack ID under another filename; filename ≠ ID; pack or catalog `schemaVersion` 2 or missing; unknown envelope key; misspelled collection; path-like or uppercase pack ID; negative or fractional order; empty pack or empty collections; missing required field; wrong field type; blank drill; dangling `sourcePhraseId`; block targeting an absent category or verb set; unsupported block type; invalid JSON; UTF-8 BOM; missing `catalog.json`.
- **Deleting any one of the 11 packs fails generation** through block-reference validation. Every pack is protected by at least one block.
- **Staleness:** editing one translation produces a new content-addressed pack, deletes the stale file, and leaves the other 10 packs byte-identical. Cleanup only ever deletes hash-named files.
- **Lifecycle hooks** ([script](eng-v2-02a-fable/hook-probes.sh), [log](eng-v2-02a-fable/logs/hook-probes.log)). With invalid source, `npm run build`, `npm test`, `npm run check` and `npm run dev` each exit 1 before running, and `dist/` and the manifest stay unchanged. With valid edited source, `npm run build` publishes the edit. The [dev probe](eng-v2-02a-fable/dev-probe.mjs) ([log](eng-v2-02a-fable/logs/dev-probe.log)) shows `npm run dev` regenerating before Vite starts and serving the manifest and all 11 packs byte-identical to the generated files under `/eng-trainer/data/`.
- **Documented `vite build` limitation, confirmed.** A direct `npx vite build` after a valid edit silently publishes the *previous* generated content, and `assemble` plus `check:site` still pass on that stale artifact (finding N3). CI runs `npm run check`, `npm test` and `npm run build`, all of which regenerate, so the documented and CI paths are reliable.
- An intentional content edit makes `npm test` fail on the frozen fingerprints. This is by design (finding N7).

## 6. Runtime loader

Unit-level behavior is covered by Astra's 10 loader tests. In native browsers (section 10) I injected 12 controlled faults into the assembled artifact. Each fault ran with a populated `eng-trainer-v2` database and was followed by a retry while the fault persisted, then a successful retry.

| Fault | Message shown (Chromium; Firefox identical except for network errors) | Pack requests issued |
|---|---|---:|
| Manifest 404 | `Failed to load /eng-trainer/data/manifest.json (HTTP 404)` | 0 |
| Manifest is HTML (200) | `Invalid JSON in /eng-trainer/data/manifest.json` | 0 |
| Manifest URL `../v1/data/materials.json` | `speaking-foundations.url must be a generated relative pack path` | **0** |
| Manifest count +1 | `manifest.phrases count mismatch (566 != 567)` | 0 |
| Pack 503 | `Failed to load /eng-trainer/data/packs/workplace-topics.….json (HTTP 503)` | 11 |
| Pack network abort | Chromium `Failed to fetch`; Firefox `NetworkError when attempting to fetch resource.` | 11 |
| Truncated pack JSON | `Invalid JSON in /eng-trainer/data/packs/workplace-topics.….json` | 11 |
| Another pack's body | `Unexpected pack metadata in packs/workplace-topics.….json` | 11 |
| One record removed | `workplace-topics.phrases count mismatch (119 != 120)` | 11 |
| Dangling link | `word-topic-teamwork-001-….sourcePhraseId points to missing phrase absent-phrase` | 11 |
| Duplicate ID across packs | `duplicate entry id phrase-001` | 11 |
| Last pack `schemaVersion` 2 | `pack.schemaVersion must be 1` | 11 |

In every case, in both browsers:

- the startup error screen was shown and no `.app-shell` appeared;
- the database deep-equalled the seed after the failure and after the failed retry, with **zero IndexedDB writes**;
- the successful retry fetched the manifest and all 11 packs again (12 requests), showed 566 phrases, left the database untouched, and found a verb from the last pack in search.

Repeated failing and successful loads never duplicated content. In a separate check, holding the last pack open for 1.5 s kept the app on "Loading training materials…", and the app shell appeared only after release. The last pack's verb was searchable immediately. All requests stayed under `/eng-trainer/data/`. The manifest is requested first, and each file exactly once. Served bytes equal the artifact.

Runtime checks cover structure, metadata, counts, IDs and references. They are not a cryptographic integrity check, as documented: a pack with altered text but the same counts would load. The build-time `check:site` does verify pack hashes.

## 7. Global search

**Differential test** ([spec](eng-v2-02a-fable/differential/search-differential.test.ts), [preparation](eng-v2-02a-fable/differential/prepare-differential.mjs), [result](eng-v2-02a-fable/results/search-differential.json), [log](eng-v2-02a-fable/logs/search-differential.log)):

- The **released** side is `catalog.ts`, `search.ts`, `text.ts` and `flashcards.ts` from `c84ef30` over the released monolith. The **candidate** side is the candidate's `loadBuiltInCatalog()` reading `site-dist/data` through a fetch stub, which also asserts `cache: 'no-store'` and exactly 12 requests.
- Queries: every distinct string leaf of every phrase, word, verb and block, including non-searchable fields. For each leaf, also its upper and lower case, a whitespace-padded copy, the 3-character prefix and suffix, a 4-character middle slice, every token in three casings, plus Ukrainian letters, punctuation, IDs, empty and whitespace-only queries.
- **57,078 unique queries × 4 searches = 228,312 comparisons. Ordered result IDs were identical every time.** Non-empty result sets per search: phrases 36,321, words 38,058, verbs 8,733, blocks 3,425.
- The first, middle and last entry of every collection in every searchable pack (51 probes across 10 packs) was found by an upper-cased query, with released ordering.
- `meta`, the priority-sorted visible blocks, all collections, `phraseCategories`, `wordCategories` and `verbSets` are strictly equal.

**Active filters in the UI.** The browser differential (section 8) applied category filters, hidden-entry filters, the show-hidden toggle, verb sets and queries on Phrases (10 cases), Words (5) and Verbs (9). Each case started from an identical seeded database. The rendered cards, learned/hidden flags and full page text were identical between the released and candidate builds in Chromium and Firefox.

Search does not depend on visited screens or on which packs loaded first. The catalog is not created until every pack has loaded.

## 8. Identity and IndexedDB

Synthetic seed for every store of `eng-trainer-v2`:

- **progress:** learned, hidden phrases/words/verbs and Focus items, including both members of the duplicate-text pairs; one pair member hidden only through its linked word;
- **learnPasses:** two passes, one selected, which excludes five blocks;
- **flashcardSessions:** a saved `all` order at index 3, and a topic deck;
- **settings:** dark theme, Focus as the start page, "all" page sizes, flashcard mode and topic.

I ran the [same scripted session](eng-v2-02a-fable/browser-review.mjs) (scenario `differential`) against the released build and the candidate build. Results in both Chromium and Firefox:

- **Zero writes at startup.** The database deep-equals the seed after load. The theme (dark) and start page (Focus) were restored, as asserted directly. Index with the selected Learn Pass, the Focus contents and the "all" page sizes rendered identically to the released build.
- **Duplicate-text identity:** "From my perspective" shows two cards, only `phrase-005` learned. Showing hidden phrases reveals exactly one hidden "To some extent" card. Hiding `word-advanced-linking-012-more-importantly` hides only its own card. The deck size of 562 (566 minus exactly 4 hidden identities) shows that its pair partner `presentation-phrase-087` was not hidden along with it.
- **Flashcards, checked against an independent oracle written from the RC1 rules:** progress 5 of 562, and the current card at saved index 3 is `advanced-linking-004-consequently`. "I know it" appended exactly that **phrase ID** to `learnedPhrases` (never a word ID) and saved the expected order and index. After a reload, the next card is `phrase-084`. The learned states of both "consequently" entries on Phrases match the released build.
- **Released vs candidate:** every captured screen state and the full database after startup, after the answer and at the end were **deep-equal** between the two builds.

Database name, version, stores and serialized contracts are unchanged (no source diff). The differential shows the same writes for the same interactions. No migration is required, and none was introduced.

## 9. v1 isolation

- `git diff c84ef30 -- v1` is empty, and there are no untracked v1 source files. v1's `materials.json` is CRLF in this Windows checkout (`i/lf w/crlf`, with a timestamp that predates this milestone's files). Normalized, it equals the release blob, and the parsed JSON is identical.
- `npm run check:v1`: 0 errors, 0 warnings (189 files). `npm run test:v1`: 3 files, 68 tests passed. The v1 build is part of `build:site`.
- In both browsers, `/eng-trainer/v1/` requested only `/eng-trainer/v1/…` paths, and exactly one data file, `v1/data/materials.json`. Its content equals the released v1 content. It opened **no** IndexedDB database. It restored a seeded `localStorage` state (learned `phrase-002`) through `getItem`.
- v2 in the same browser context opened only `eng-trainer-v2`, made no `localStorage` calls, requested nothing under `/v1/`, and left the v1 key intact.

## 10. Verification results

| Check | Result |
|---|---|
| `npm run check` | Generation ran first. svelte-check: 211 files, 0 errors, 0 warnings. |
| `npm test` | Generation ran first. `node --test`: 10/10. Vitest: 6 files, **129/129**. |
| `npm run check:v1` / `npm run test:v1` | 0 errors, 0 warnings / 3 files, **68/68** |
| `npm run build:site` | Passed. Includes `npm run build`, the v1 build, assembly, and `check:site` ("verified manifest and all 11 pack hashes, identities, counts and links"). |
| `npm run verify:content` | Passed (exact source and published match, 566 links, v1 unchanged) |
| `git -c core.whitespace=cr-at-eol diff --check` | Clean |
| `npm run build` in the developer workspace (required by `AGENTS.md`) | Passed. It writes only ignored outputs; the regenerated `public/data` (manifest and 11 packs) is byte-identical to what was there before. |
| Independent content audit | PASS: 1,538/1,538 byte-identical in source, `public/data` and `site-dist/data` |
| Search/catalog/flashcard differential | PASS: 228,312 comparisons, 0 mismatches; 566 cards, 31 topics, all topic decks identical |
| Generator probes / lifecycle hooks / dev probe | 47/47 / all as expected / PASS |
| Native browsers, [Chromium](eng-v2-02a-fable/browser/browser-chromium.json) and [Firefox](eng-v2-02a-fable/browser/browser-firefox.json) | `requests`, `differential`, `failures` (12 faults), `no-partial`, `v1`: **all PASS in both**. `performance`: Chromium. |
| Uncaught page errors | **None** in any scenario |
| Console errors | Only the deliberately injected HTTP 404/503 and `net::ERR_FAILED` responses in `failures` (Chromium) |

All runs used isolated contexts with synthetic data. The external Google Fonts stylesheet was stubbed with icon-sized glyph boxes, so results do not depend on third-party network access.

**Harness corrections during the review (not findings).** The first preliminary Chromium run had two harness errors. An empty font stub rendered icon ligatures as wide text, so one icon button overlapped "Show hidden phrases"; the fix was icon-sized glyph boxes. The recovery search also used a verb that my own seed had hidden; the fix was to probe a visible verb. Separately, a first complete run recorded v2 requests in the v1 request list, because the listener stayed attached across a later navigation. The v1 assertions had already run and were valid, and the list is now snapshotted. I also added the HTTP/2 measurement. The committed browser evidence comes from the final complete run. Earlier, a Vitest RPC heartbeat timeout came from my synchronous differential loop; the test itself had passed. The loop now yields periodically. The first dev probe did not recognise Vite's ready line, which contains ANSI colour codes; the server had started after regeneration and was stopped by the probe. The probe now strips the codes, and the rerun passed.

## 11. Performance

Chromium cold loads (cache disabled, gzip enabled like GitHub Pages, external font stubbed). Values are medians of 5 alternating runs per build; time is measured until the app shell renders.

| Transport | Profile | Released (1 data request) | Candidate (12 data requests) | Difference |
|---|---|---:|---:|---:|
| HTTP/2 | No throttling | 166 ms | 192 ms | +26 ms |
| HTTP/2 | **Moderate: 150 ms RTT, 1.6 Mbps down, 750 kbps up** | **2,060 ms** | **2,277 ms** | **+217 ms (+11%)** |
| HTTP/2 | High latency: 300 ms RTT, 5 Mbps down, 1 Mbps up | 1,547 ms | 1,911 ms | +364 ms (+24%) |
| HTTP/1.1 | No throttling | 143 ms | 191 ms | +48 ms |
| HTTP/1.1 | Moderate | 2,030 ms | 2,310 ms | +280 ms (+14%) |
| HTTP/1.1 | High latency | 1,543 ms | 2,032 ms | +489 ms (+32%) |

The throttled runs were stable: the spread within each set of five was 0.7–3.8%. Unthrottled local loads are noisy (individual runs range from 85 to 263 ms), so the unthrottled differences are within noise. Negotiated protocols were confirmed through `nextHopProtocol`. HTTP/2 used a throwaway self-signed certificate on a local TLS server.

- **Payload.** Released monolith: 1,533,856 bytes, 224,660 gzipped. Candidate manifest plus 11 packs: 1,610,203 bytes (+5.0%), 230,303 gzipped (+2.5%). Browser-measured transfer, including headers: 224,960 bytes released vs 233,903 bytes candidate.
- **Cause.** The packs cannot be requested until the manifest arrives, which adds one serial round trip. That matches the HTTP/2 differences: about one RTT plus a little transfer. Per-request overhead and runtime validation of every record are small: with no throttling, the median HTTP/2 difference is 26 ms, which is within noise. Over HTTP/1.1, the 11 packs also queue behind Chromium's six connections per host, which is why the HTTP/1.1 difference grows with latency. GitHub Pages uses HTTP/2, so the HTTP/2 rows are the production-relevant estimate.
- **Assessment.** A measurable but modest regression. Under the moderate profile, startup goes from about 2.06 s to about 2.28 s (+11%). It is inherent to the requested eager design. It is not a reason to demand lazy loading or a search index. Optional mitigations, if wanted later: preload `data/manifest.json` from `index.html`, or embed the generated manifest in the bundle at build time. Either removes the serial round trip. Not tested here: warm caches (all content uses `cache: 'no-store'`, as the released monolith did), Firefox timing, real mobile devices, and the real GitHub Pages CDN.

## 12. Confirmed defects and findings, by severity

No high- or medium-severity defect was found. **None of the following blocks integration.**

| # | Severity | Finding | Evidence |
|---|---|---|---|
| N1 | Low | **Some failures do not name the file.** A JSON syntax error or BOM during generation reports only a position (`SyntaxError: Expected double-quoted property name in JSON at position 167365 (line 4602 column 1)`), with no filename among 12 sources. At runtime, a pack failing the schema check before its ID is read shows `pack.schemaVersion must be 1` with no URL. A network failure shows the browser's bare `Failed to fetch` or `NetworkError…`, with no URL among 12 requests. Other messages are specific. Suggestion: wrap `JSON.parse` and `fetch` errors with the path or URL. | Generator probes; `failures` scenario |
| N2 | Low | **Startup gains about one round trip** (section 11): +0.22 s (+11%) moderate, +0.36 s (+24%) high-latency on HTTP/2. This is the expected cost of eager manifest → packs loading. | `performance` |
| N3 | Low (documented) | **A direct `vite build` or `vite` serves stale generated content, and `check:site` does not detect it**, because it checks only internal consistency, not freshness against `content/`. CI and the npm scripts are safe. Optional hardening: have `check:site` compare the published manifest with `buildContent('content')`. | `hook-probes.log` |
| N4 | Info | Only hash-named files are removed by cleanup, so any other stray file in the ignored `public/data/packs/` would be published by a local build. Source discovery is case-sensitive: a pack saved as `.JSON` is skipped. Today that is caught indirectly by block validation, but a future pack without a dedicated block could be dropped silently. Duplicate keys inside one JSON object resolve to the last value without error, which is inherent to `JSON.parse` and unchanged. | Generator probes |
| N5 | Low (test quality) | `builtIn.test.ts` failure cases assert only `.rejects.toThrow()`, so a mutation could pass for an unintended reason. For example, the `duplicate` case also breaks a word link. My browser runs show that each fault yields its specific message. Suggestion: `toThrow(/…/)`. | `src/content/builtIn.test.ts` |
| N6 | Info | Pack URLs are content-addressed but fetched with `cache: 'no-store'`, so every visit downloads about 230 KB gzipped. This is the same policy as the released monolith, so it is not a regression; it is a possible future optimization. | `src/content/builtIn.ts` |
| N7 | Info (forward-looking) | The frozen migration fingerprints make `npm test` fail on any content edit. This is correct for a preservation milestone. The next content-changing milestone must deliberately update or retire `content-baseline.json`, as the format guide says. | `hook-probes.log` |

## 13. Limitations and unverified areas

- No GitHub Actions run (Node 22 on Linux) and no hosted GitHub Pages deployment. Per the request, these are not blockers. CI's commands were reproduced locally on Node 24/Windows.
- Native checks covered Chromium and Firefox desktop only. WebKit/Safari, mobile devices, touch and swipe, audible speech, quota exhaustion and concurrent tabs were not exercised. Only the milestone-relevant flows were run, not the full 17-group RC1 suite. Unchanged feature code and identical data and catalogs limit the risk.
- Performance figures come from emulated throttling against a local server, not real networks or the Pages CDN.
- The flashcard "Learn again" and unlearn flows were not driven in the browser. They are unchanged code over identical cards; Astra's and RC1's tests cover them.
- The runtime does not verify pack hashes (documented). Content correctness at runtime relies on structure, counts and references.

## 14. Evidence and reproduction

Everything is under [`eng-v2-02a-fable/`](eng-v2-02a-fable/). Astra's evidence under `docs/evidence/eng-v2-02a/` was not modified. Copied logs have absolute local paths replaced with `<repo>`, `<review-copy>`, `<review-tools>` and `<home>` by [`collect-evidence.mjs`](eng-v2-02a-fable/collect-evidence.mjs).

| File | Purpose |
|---|---|
| `candidate.sha256` | 280-file pre-review fingerprint |
| `content-audit.mjs`, `results/content-audit.json` | Independent preservation audit |
| `differential/*`, `results/search-differential.json` | Released-vs-candidate catalog, search and flashcard differential |
| `generator-probes.mjs`, `results/generator-probes.json` | 47 generator CLI probes |
| `hook-probes.sh`, `dev-probe.mjs` | npm lifecycle and dev-server probes |
| `browser-review.mjs`, `browser/browser-{chromium,firefox}.json` | Native-browser scenarios and timings |
| `logs/*.log` | Command, probe and browser logs |

To reproduce, use a **disposable** clone of the candidate and a clone at `c84ef30`, each with `npm ci` and `npm --prefix v1 ci`, and run `npm run build:site` in both:

```bash
node docs/reviews/eng-v2-02a-fable/content-audit.mjs <copy> <copy>/public/data <copy>/site-dist/data --out audit.json
node docs/reviews/eng-v2-02a-fable/differential/prepare-differential.mjs <copy> && (cd <copy> && npx vitest run src/review-fable)
node docs/reviews/eng-v2-02a-fable/generator-probes.mjs <copy> <scratch-dir>
bash docs/reviews/eng-v2-02a-fable/hook-probes.sh <second-disposable-copy> hook.log
PLAYWRIGHT_BROWSERS_PATH=<browsers> REVIEW_TLS_DIR=<dir with throwaway key.pem/cert.pem> \
  node docs/reviews/eng-v2-02a-fable/browser-review.mjs <playwright-tools> <copy>/site-dist <baseline>/site-dist <evidence-dir>
```

`prepare-differential.mjs` and the probes modify the copy they are given. Never point them at the working tree.

## 15. Corrections required from Astra

**None are mandatory.** Optional follow-ups, in order of usefulness: N1 (name the file or URL in parse and network errors), N5 (assert expected error messages), N3 (freshness check in `check:site`), and N2/N6 (manifest preload or embedding, and caching immutable packs) if startup time becomes a concern.

## Verdict

**`READY_FOR_PR`.** The implementation satisfies ENG-V2-02A, and no mandatory findings remain. The candidate stays uncommitted for the next owner-controlled step.
