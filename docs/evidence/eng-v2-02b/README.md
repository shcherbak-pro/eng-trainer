# ENG-V2-02B validation evidence

Candidate validation by Astra; this is not an independent approval. The implementation and all new files are uncommitted. See [the handoff](../../handoffs/ENG-V2-02B.md) and [format/storage contracts](../../architecture/USER-COLLECTIONS.md).

From the repository root, with Node 22+ and root/v1 dependencies installed:

```text
npm run check
npm test
npm run check:v1
npm run test:v1
npm run build:site
npm run verify:content
git -c core.whitespace=cr-at-eol diff --check
```

For the targeted native checks, use an external tools directory containing `node_modules/playwright`. Set `PLAYWRIGHT_BROWSERS_PATH` if its Chromium and Firefox binaries are stored separately:

```text
node docs/evidence/eng-v2-02b/browser-check.mjs <playwright-tools> <output-dir>
```

The runner serves `site-dist` locally, creates disposable contexts, seeds synthetic version-1 data, imports synthetic files, drives the actual UI, downloads native JSON, and injects native transaction/quota failures. No owner storage, production app, server upload or account is used. The exported JSON files and screenshots are synthetic fixtures. Fonts are not stubbed.

Final logs are under `logs/`; browser results, exports and screenshots are under `browser/`. Absolute workspace paths and local usernames in copied logs are replaced with `<repo>`/`<home>`. `artifact.json` fingerprints the 21 combined build files. `candidate.json` fingerprints modified/new candidate files and records the unchanged pre-existing release evidence. `git-status.txt` lists the complete unstaged/untracked working tree.

Initial development failures and corrections are explained in the handoff. Published result JSON and logs represent the final successful runs.
