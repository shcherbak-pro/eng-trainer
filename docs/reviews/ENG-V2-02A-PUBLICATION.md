# ENG-V2-02A — Public evidence hygiene

Date: 2026-11-21. Scope: integration of the approved, uncommitted ENG-V2-02A candidate and Fable's independent review. This note does not revise the review's findings or verdict.

## Inspection

Before staging, all 280 files in [Fable's reviewed fingerprint](eng-v2-02a-fable/candidate.sha256) and the 37 entries in [Astra's implementation inventory](../evidence/eng-v2-02a/candidate.json) matched exactly. The complete tracked diff and intended untracked inventory were inspected, including the 11 authored packs, scripts, tests, reports and evidence.

The new evidence/review trees and their related reports were checked for absolute local paths, the local account name (including short-path variants), temporary-folder identifiers, credentials/private keys and unwanted generated/dependency/profile files. JSON evidence was parsed. Both PNGs were visually inspected: they show only the application with synthetic review state and no browser chrome, local paths or personal records.

Existing sanitation is sufficient: the evidence already uses `<repo>`, `<review-copy>`, `<review-tools>` and `<home>` placeholders. No additional redaction or deletion was needed. The generic short-path example in `collect-evidence.mjs` is a fabricated account name explaining sanitization, not a machine-specific path. Public repository/font/package URLs, relative source paths, synthetic database records, fault outcomes and performance timings remain useful evidence and are retained.

The independent report, its scripts, logs, JSON results and reviewed implementation files are unchanged in the working tree. Earlier reviews remain untouched. No private certificates, browser installations, profiles, temporary copies, caches or credentials are published.

## Hashes and line endings

[The publication hash mapping](eng-v2-02a-publication-hashes.json) relates each reviewed file's working-copy SHA-256 to the SHA-256 of its actual staged Git blob. It separately inventories the new Fable report/evidence, which was created after the 280-file candidate fingerprint.

Git's existing Windows checkout configuration normalizes text to LF when staging. The mapping labels each file as byte-identical or CRLF-to-LF only. Every difference is verified against that exact newline transformation; binary screenshots remain byte-identical. Historical inventories are retained as originally recorded and continue to describe the reviewed Windows working copies. No hashes were silently rewritten to make them appear to describe the published LF files.

There were **no content sanitization changes**, so no redaction hash mapping is necessary. The newline mapping accounts for publication hashes without changing any assertion, result, verdict, source value or behavior.

The full staged whitespace check flags existing captured-output whitespace in five raw logs (`test-initial.log`, `test-v1.log`, `test.log`, Fable's `hook-probes.log` and `search-differential.log`). Those logs are preserved as reviewed. The staged check excluding `*.log` passes; source, documentation, JSON and review scripts have no whitespace errors.

## Exclusions

- The authored source is `content/catalog.json` and `content/packs/*.json`.
- Generated `public/data/manifest.json` and `public/data/packs/` remain ignored and uncommitted.
- `node_modules/`, `v1/node_modules/`, `dist/`, `v1/dist/` and `site-dist/` remain excluded.
- The independent review scripts are retained; their disposable copies and browser tooling are not.
- Local integration tooling, request bodies and downloaded Actions logs use an ignored cache directory and are not part of the commits.

Review scope, limitations and deferred N1–N7 findings remain in [Fable's report](ENG-V2-02A-FABLE.md) and are explicitly carried forward in [the integration handoff](../handoffs/ENG-V2-02A-INTEGRATION.md).
