# ENG-V2-03 publication audit

22 November 2026, Europe/Kyiv. This record packages the independently approved RC2 candidate for a pull request against `main`. The historical reports remain unchanged, including their statements about the state at the time of each review. The final approval is [READY_FOR_PR; F1-RC1 / P2 closed](ENG-V2-03-RC2-ASTRA.md).

## Candidate authentication

The feature worktree started on `feature/eng-v2-03-learning-topics`, with HEAD and fetched `origin/main` both at `03f1267f1ef4287580227ce5db67615988c98177`. The configured origin is `https://github.com/shcherbak-pro/eng-trainer`. The matching-branch PR search returned no existing PR.

- Approved substantive fingerprint: `e862d40228c7338e07610c1c33fae1afdbcf2d07b25f80512aaf07db7bd88044`.
- Full changed/untracked fingerprint before the final review, excluding that review: `bc57c526c352e5174053fd19cb2bbd0d113eeb47288f569ed68fbfdc97738fa3`.
- All 1,935 earlier candidate entries matched the final independent preservation record. The final report and its 192 public evidence files add 193 separately authenticated entries, giving 2,128 candidate files before publication work.
- The intended reviewed delta is 912 files: 24 modified tracked files and 888 untracked files. Git-state flags are used only to authenticate this starting state; committed verification uses paths and stored content hashes.

[Starting authentication](eng-v2-03-publication/starting-candidate.json) records these checks and the final reviewer additions. [Reviewed inventory](eng-v2-03-publication/reviewed-inventory.json) lists every intended reviewed path, its working-byte SHA-256, expected Git-blob identity, stored-byte SHA-256 and commit assignment.

## Intended and excluded files

| Group | Reviewed files |
|---|---:|
| Application, content, scripts, fixtures and tests | 43 |
| Architecture, complete handoff, three independent reports | 5 |
| Original / RC1 / RC2 implementation evidence | 49 / 137 / 167 |
| Original / RC1 / RC2 independent review evidence | 165 / 154 / 192 |
| Total reviewed files | 912 |

The 43 implementation files contain the complete feature and both accepted corrections together. No historical source version was recreated. The 869 documentation files include public scripts, logs, measurements, synthetic exports, frozen reference fixtures and 605 screenshots, including labelled expected-failure evidence.

This audit and 11 files under `eng-v2-03-publication/` add 12 publication records: **924 changed files total**, split into **43 implementation files and 881 documentation files**. [Publication inventory](eng-v2-03-publication/publication-inventory.json) explicitly lists every path and its commit. It deliberately omits hashes of its own output; the reviewed inventory carries all 912 reviewed hashes. A separate ignored receipt hashes every final staged/committed file, including the audit and manifest, to avoid a self-referential hash.

Every new path was checked against the reviewed inventory, allowed source/evidence roots, file types and excluded artifact classes. The public selection contains no dependency directories, generated content, `dist/`, `v1/dist/`, `site-dist/`, private snapshots, reconstructed source trees, authentication builds, preserved before-build copies, browser installations/profiles, temporary tools, caches or downloads. Ignored `local/`, `runtime/`, `candidate-snapshot/` and `candidate.patch` inputs remain excluded. Nothing is force-added. The main checkout's 92 unrelated untracked release/evidence/font files are excluded and preserved.

## Hygiene and documentation references

[Hygiene results](eng-v2-03-publication/hygiene.json) classify the scan, JSON checks and repository documentation links. No credentials, signed URLs, owner identity, email addresses, environment dumps or persistent-browser-profile data were found in the reviewed public selection. No publication sanitization of reviewed material was needed, so there are no sensitive originals or sanitation deltas to publish.

The deliberately broad path scan produced 432 false positives: 270 repository `features/home/` fragments, 150 HTTP/file URL fragments, four already-redacted drive examples, six escaped newlines in test output, and two test-regexp fragments. All were classified individually. Public URLs are local test servers, official content references, Svelte warning documentation or the synthetic `example.com` fixture. Token terminology, synthetic malformed imports, expected error logs and SHA hashes are evidence, not credentials. All 605 PNG files have valid chunk bounds and no text/EXIF metadata; their independently reviewed synthetic screenshots are unchanged.

The initial audit parsed all 95 selected JSON files; the final publication pass parses all 101. The 137 links in the changed/new candidate Markdown resolve, including both heading fragments. The broader check covered 42 repository Markdown files and 516 local links, including reference-style targets, with three inherited exceptions in `docs/evidence/eng-v2-ux-01b-rc1/before-after/reviewed-originals/src/assets/fonts/README.md`: `../../../public/fonts/OFL-Literata.txt`, `../../../public/fonts/OFL-SourceSans3.txt`, and `../../styles/fonts.css`. They already exist at the reviewed base and are preserved. This audit adds nine resolving links, giving 525 local links across 43 repository Markdown files and 146 resolving links within the intended publication delta. The final hygiene pass covers all 924 intended files.

Historical reproduction commands and prose intentionally name ignored local snapshots, retained before-build sites, `runtime/baseline/dist`, generated build outputs and isolated browser tools resolved through the common Git directory. These are local reproduction inputs, not promised public attachments. Their preserved local copies were checked; they are not added merely to satisfy those references. Public evidence remains sufficient to inspect the recorded results. External reference content is unchanged; this integration checks link syntax and repository targets, not remote website availability.

## Stored-byte transformations and preservation

Existing `core.autocrlf=true` normalizes **32 reviewed files** from CRLF to LF in Git. [Newline mappings](eng-v2-03-publication/newline-mappings.json) records every affected path, before/after SHA-256, byte count and Git blob ID. For each file, the Git-filtered blob equals either the original bytes or precisely those bytes with CRLF replaced by LF. There are no other content transformations, and Git configuration is unchanged. Working copies retain their original reviewed bytes. The remaining 880 reviewed files have byte-identical stored content.

[Preservation](eng-v2-03-publication/preservation.json) checks all 2,128 candidate files and all 1,332 main-checkout files, including all 92 pre-existing untracked files. Main remains on its original branch and HEAD with an empty index. All six historical evidence trees, including ignored copies, and existing Git exclusions match their starting hashes. v1, authored content and identities, frozen content fingerprints, Home calculations, storage/import/export, flashcard behavior, dependencies and workflow are preserved. Only normal ignored active build outputs are regenerated.

## Integration validation and commits

[Integration results](eng-v2-03-publication/integration.json) and [logs](eng-v2-03-publication/logs/) record successful local Windows commands with Node 24.18.0 and npm 11.17.0:

- `npm run build`.
- `npm run build:site`, including both production builds, assembly and the combined-site check of assets, fonts, manifest, all 14 pack hashes, identities, counts and links.
- `npm run verify:content`: exact released-content/order and generated-content agreement; v1 unchanged.

The approved browser review remains applicable because application/content bytes are unchanged. Its 15 content/build tests, 345 v2 tests, 68 v1 tests and independent native browser results remain historical local evidence. Actual PR CI is verified separately after pushing the final head; it is not inferred from these results. Inherited Learn again Undo warnings and the deferred Reset-dialog issue are unchanged.

The staged implementation passes `git diff --cached --check`. The strict documentation check reports only `new blank line at EOF` at line 11 in two original review logs: `docs/reviews/eng-v2-03-astra/reset-race-original-schedule.log` and `docs/reviews/eng-v2-03-astra/reset-race.log`. Their reviewed bytes are preserved. Strict whitespace checks pass for every other path; for these two logs, all checks except `blank-at-eof` pass. This narrow, documented exception avoids rewriting historical evidence. The same checks and exceptions apply to the combined committed diff; no Git configuration is changed.

Two logical commits are required, with explicit inventory paths and staged diff/content/whitespace checks before each commit:

1. `feat: add learning topics and home progress overview` — 43 files. The complete implementation includes RC1/RC2 corrections.
2. `docs: add ENG-V2-03 handoff and review evidence` — 881 files, including this audit.

The implementation commit is `48c422df5e14b0c0f245153ca7363871e861af37` (43 changed files; staged blobs and whitespace verified). Both full commit SHAs, actual changed-file counts, final combined-tree verification and actual Actions run are recorded in the PR description and final publication receipt. The documentation commit cannot embed its own SHA or a later CI result without creating a different commit. No extra commit is manufactured for those receipts.

Publication uses a normal upstream push and one PR against `main`. The PR remains open and unmerged with auto-merge off. The existing PR workflow must execute installation/checks/tests/builds for both applications, assembly and site/content checks, while skipping Pages configuration/upload and deployment. Verification records the actual OS/Node versions and distinguishes the PR head from the tested synthetic merge revision. No production workflow dispatch or deployment is part of this task.

## Accepted limits

The independent approval covers layout-viewport changes delivered through window resize. VisualViewport-only changes, pinch zoom, keyboards that do not resize the layout viewport, Safari/WebKit, physical-device touch, assistive-technology output and audible speech remain unverified. The inherited Reset-dialog deferred-focus issue remains deferred. Linux PR CI is established only by the later actual run; production deployment is outside this publication task.
