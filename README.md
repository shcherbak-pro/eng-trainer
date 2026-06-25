# English Assessment Trainer — Svelte Migration

This is the migrated version of the English Assessment Trainer app.

Stack:

- Svelte
- TypeScript
- Vite
- Static JSON materials
- LocalStorage progress state
- Responsive layout for iPhone and desktop

## Why Svelte

The previous vanilla JS prototype worked, but the app now has enough features that a component-based structure is cleaner:

- learning block index
- phrase cards
- word index
- reverse practice
- irregular verbs
- focus list
- hidden items
- local progress state
- mobile navigation

## Project structure

```text
public/
  data/
    materials.json
src/
  lib/
    components/
    pages/
    stores/
    types/
    utils/
  App.svelte
  app.css
  main.ts
index.html
vite.config.ts
package.json
```

## Local development

```bash
npm install
npm run dev
```

Open the URL printed by Vite.

## Build

```bash
npm run build
npm run preview
```

## GitHub Pages

The project uses `base: './'` in `vite.config.ts`, so the built app can work under a GitHub Pages repository path.

Typical deployment flow:

```bash
npm install
npm run build
```

Then deploy the `dist/` folder to GitHub Pages.

## Materials

Training materials are stored in one file:

```text
public/data/materials.json
```

There is no `materials.js` fallback and no Python sync script anymore. For GitHub Pages, JSON loading through `fetch()` is the correct approach.

## LocalStorage

The app stores user progress in LocalStorage:

- active page
- filters and search queries
- learned phrases
- hidden phrases / words / irregular verbs
- focus list
- current random prompt

LocalStorage key:

```text
englishAssessmentTrainer.svelteState.v1
```


## Windows npm install note

This package intentionally does **not** include `package-lock.json` because an earlier generated lock file contained environment-specific internal tarball URLs. Run:

```powershell
npm.cmd install
npm.cmd run dev
```

The project includes `.npmrc` with:

```text
registry=https://registry.npmjs.org/
```

If you still see requests to an internal registry, delete `package-lock.json` and `node_modules`, then reinstall:

```powershell
rmdir /s /q node_modules
del package-lock.json
npm.cmd cache clean --force
npm.cmd install
```


## Svelte 5 mount API note

This version uses the Svelte 5 `mount(App, { target })` API in `src/main.ts`. Do not use `new App(...)` with Svelte 5.
