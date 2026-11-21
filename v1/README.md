# English Trainer v1 (preserved)

This folder is an independent copy of the application as it was before the v2
refactoring started (repository commit `45564ca`, tree identical to `90d7941`).

It is a complete project: its own source, vocabulary data, static assets,
`package.json`, `package-lock.json` and build configuration. It does not import
anything from the v2 application in the repository root, and v2 does not import
anything from here.

## Differences from the baseline

- `vite.config.ts`: `base` is `/eng-trainer/v1/` so the app works under the
  `/v1/` sub-path of the combined GitHub Pages site.
- `package.json` / `package-lock.json`: the package name is
  `english-assessment-trainer-v1`.

Nothing else was changed. v1 keeps its `localStorage` persistence
(`englishAssessmentTrainer.svelteState.v1`, `englishAssessmentTrainer.theme.v1`).

## Commands

Run these inside `v1/`:

```bash
npm ci          # install
npm run dev     # http://localhost:5173/eng-trainer/v1/
npm run check   # svelte-check
npm test        # vitest
npm run build   # output: v1/dist/
```

The repository root has shortcuts (`npm run build:v1`, `npm run check:v1`,
`npm run test:v1`) and the script that assembles both apps into `site-dist/`.
