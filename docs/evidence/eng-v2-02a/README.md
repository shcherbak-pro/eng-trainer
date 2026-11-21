# ENG-V2-02A implementation evidence

These are development checks for the uncommitted candidate, not an independent review or production deployment. See [the handoff](../../handoffs/ENG-V2-02A.md) for scope and reproduction commands.

| File | Purpose |
|---|---|
| `check.log`, `test.log` | Final v2 static check and 10 Node + 129 Vitest tests |
| `check-v1.log`, `test-v1.log` | Unchanged v1 static check and 68 tests |
| `build-site.log` | Required v2 build, v1 build, assembly, manifest and hashed-asset validation |
| `catalog-migration.json` | Direct comparison with the original release Git object |
| `browser-check.mjs` | Reproducible focused native-browser runner; uses the preserved RC1 support helper |
| `browser.log`, `browser-chromium.json`, `browser-firefox.json` | Final 4/4 scenario groups per browser, observations and errors |
| `artifact.json` | SHA-256 inventory of the tested combined production artifact |
| `candidate.json` | Git state and hashes of changed implementation/documentation inputs, excluding generated evidence |
| `environment.json`, `remote-main.txt`, `diff-check.log` | Local tool versions, final remote observation and whitespace check |
| `browser-initial.log`, `initial-*.png` | Preliminary browser harness whitespace-assertion failure; superseded by the final pass |
| `test-initial.log` | Preliminary exhaustive-search timeout under parallel v1/v2 load; superseded by the final pass with a scoped 20-second timeout |

Repository-local paths in logs are replaced with `<repo>`. New evidence was sanitized without modifying prior review evidence. All screenshots use isolated synthetic review state, and both browser suites ran locally against `site-dist/`.
