# Products and routes (ENG-V3-01, ENG-V3-02 stage A, ENG-V3-R1A)

One source tree builds two applications, and the site still contains the frozen v1. This document describes how a build learns which product it is, where each product is published, and which gates keep the released site unchanged.

It describes what ENG-V3-01 implemented, and what ENG-V3-02 stage A and ENG-V3-R1A changed in the builds and gates. The speech feature itself is described in [Pronunciation prototype](PRONUNCIATION-PROTOTYPE.md), and backup and recovery in [Backup and recovery](BACKUP-AND-RECOVERY.md). The design and its reasons are in the ENG-V3-00 architecture plan and its two reviews. Those documents, and the implementation handoff of ENG-V3-01 with its evidence, are local records of the owner and are not part of this repository.

## Two separate ideas

- A **product** is what an application is: its database, its features and its content.
- A **route** is where a product is published inside the GitHub Pages site.

| Product | Built from | Route today | Published | Browser storage | Pronunciation capability | Backup screen |
|---|---|---|---|---|---|---|
| `stable-v2` | `src/` | `/eng-trainer/` | yes | IndexedDB `eng-trainer-v2`, version 2, six stores | off | no |
| `legacy-v1` | `v1/` (frozen project) | `/eng-trainer/v1/` | yes | `localStorage`, two records | — | — |
| `experimental-v3` | `src/` | `/eng-trainer/v3/` | **no** | IndexedDB `eng-trainer-v3`, version 1, the same six stores plus `meta`; a model cache `eng-trainer-v3-models` only after a download on the local prototype server | on: a prototype screen | yes |

Product identity, database name and content never depend on `location.pathname`. Moving a product to another route changes addresses and nothing else.

`experimental-v3` differs from `stable-v2` on screen in two places:

- the **Pronunciation** screen: a prototype that records a phrase and shows what a speech recognizer in the browser heard ([Pronunciation prototype](PRONUNCIATION-PROTOTYPE.md)). No build contains a speech model.
- the **Backup** screen: one backup file with the saved data of all three products, and the recovery of each product from such a file ([Backup and recovery](BACKUP-AND-RECOVERY.md)).

The product contains no scoring, migration or content change.

## Configuration

[`site.config.json`](../../site.config.json) names the products and the routes. [`scripts/site-config.mjs`](../../scripts/site-config.mjs) is its only reader. The build, the assembly and every check use that reader, and an invalid file stops the run.

The reader fails closed on:

- an unknown product, an unknown key, a missing product or a missing route;
- two routes at one path, or two routes for one product;
- a route path that is not `""` or one lower-case segment with a trailing `/`;
- a route named like a folder every build writes (`assets/`, `data/`, `fonts/`);
- a product folder (`outDir`, `publicDir`) that is not exactly the folder fixed for that product, see [Generated folders](#generated-folders);
- a generated product folder that is, on disk, a file, a link, or a folder under another spelling;
- a changed identity of the stable product: its database and absent pronunciation capability are fixed in the reader;
- a moved v1: the frozen project is compiled for `v1/`;
- a `publish` value that is not `true` or `false`;
- a site without a published product at its root.

### The publish flag

Each route has a committed `publish` flag. It is the only switch that adds a product to the site.

- Every GitHub Pages deployment replaces the whole site. A product is published only by being part of the one assembled artifact.
- [`scripts/assemble-site.mjs`](../../scripts/assemble-site.mjs) copies published routes only. It takes no argument and reads no environment variable. The workflow has no inputs.
- `experimental-v3` is committed with `"publish": false`. A test pins that value. Publishing it needs a new, owner-approved change of the file and of that test.
- A published path is public, linked or not. The `noindex` marker of the experimental entry page only asks search engines not to list it. It is not access control.

## How a build learns its product

`vite.config.ts` reads the product from `ENG_PRODUCT`. Without it, the build is `stable-v2`, exactly as before. Use the npm scripts: they set the variable in a way that works in every shell.

The product reaches the code as compile-time constants ([`src/product.d.ts`](../../src/product.d.ts)):

| Constant | `stable-v2` | `experimental-v3` | Used by |
|---|---|---|---|
| `__ENG_PRODUCT__` | `"stable-v2"` | `"experimental-v3"` | the database schema |
| `__ENG_DATABASE__` | `"eng-trainer-v2"` | `"eng-trainer-v3"` | the database name |
| `__ENG_PRONUNCIATION__` | `false` | `true` | the navigation and the lazily loaded Pronunciation screen |
| `__ENG_BACKUP__` | `false` | `true` | the navigation and the lazily loaded Backup screen, and the hold on changes that a recovery takes in the state services, the collections and the shell ([Backup and recovery](BACKUP-AND-RECOVERY.md#the-handover)). It follows from the product and is not in `site.config.json` |
| `__SITE_BASE__` | `"/eng-trainer/"` | `"/eng-trainer/"` | links to v1 |
| `__ENG_VERSION_LINKS__` | other published routes | other published routes | the Pronunciation screen only |

Vite replaces each name with its value. Code behind a constant that is `false` is removed from that product's build, together with everything only it reaches. That is how the stable build stays free of experimental code: it does not contain the Pronunciation screen or the Backup screen, a request for either, or the name `eng-trainer-v3`.

### Rules for a condition on a constant

The stable build must stay byte-identical to the released one. Four rules keep it so, and the released-site lock fails when one is broken:

1. **Use the bare constant** in the condition, for example `if (__ENG_PRONUNCIATION__)`. Do not copy it into a variable or an object first. Give the condition a statement of its own: `if (__ENG_BACKUP__ && held) return;`, not one more operand in a condition that the stable product uses.
2. **Never put the condition inside a `try` block.** The bundler keeps everything inside a `try` block, also a branch that can never run. The experimental database schema is selected just before the `try` block of the upgrade handler for this reason.
3. **In a Svelte template, add the experimental branch last** in its `{#if}` chain, with no comment or text of its own. A branch in the middle renumbers the released branches.
4. **Add no import between shared modules for experimental code.** The bundler orders the modules of a build by their imports, also by an import of which the stable build uses nothing. One new import from the collections to the state services moved a whole module in the stable build (ENG-V3-R1A-RC3). More names on an import that exists are safe.

A test also checks rules 2 and 3 in the sources, that shared code reaches each experimental-only folder, `src/features/pronunciation/` and `src/features/backup/`, through exactly one guarded dynamic import, and for the hold on changes rules 1 and 4.

### Experimental-only sources

The constant removes the feature's code from the stable build. It does not stop the bundler from reading the guarded module first, and a module can emit files while it is read: the recognizer's Worker, the recording worklet and the WebAssembly runtime. Such files would land in the stable build folder although nothing refers to them.

A build of any product but `experimental-v3` therefore gets an empty module in place of every import that leads into `src/features/pronunciation/` or `src/features/backup/` (the plugin `eng-trainer:without-experimental-sources` in `vite.config.ts`). It applies to builds only: tests import the feature's modules directly, for either product.

Both controls are checked from the outside. The released-site lock fails on any extra file, and `check:negative` builds the stable product without the guard, without the exclusion, and without both, for each of the two screens.

## Addresses

| Use | Source | `stable-v2` | `experimental-v3` |
|---|---|---|---|
| Scripts, stylesheets, fonts | Vite `base` | `/eng-trainer/assets/` | `/eng-trainer/v3/assets/` |
| Built-in content | `import.meta.env.BASE_URL` | `/eng-trainer/data/` | `/eng-trainer/v3/data/` |
| Brand link | `import.meta.env.BASE_URL` | `/eng-trainer/#index` | `/eng-trainer/v3/#index` |
| Link to v1 (shell and Settings) | `__SITE_BASE__` | `/eng-trainer/v1/` | `/eng-trainer/v1/` |
| Screens and topics | the `#hash` | unchanged | unchanged |

The two links to v1 used the product base before ENG-V3-01. From a product below the site base they would have pointed to `/eng-trainer/v3/v1/`.

## Storage

- `stable-v2` keeps `eng-trainer-v2`, version 2, with exactly its six stores and the released migrations.
- `experimental-v3` creates `eng-trainer-v3`, a new lineage at version 1: the six shared stores and `meta`. The six stores have the same record contracts, so the shared state services work unchanged.
- `meta` holds two records written once, in the transaction that creates the database: `schema` (1) and `createdAt`. It is not learning state. `readAll()` and the state services never see it.
- At start-up and while learning, a build opens only its own database. `stable-v2` never reaches `localStorage`.
- `experimental-v3` reaches the other two products on its Backup screen only (ENG-V3-R1A). It reads `eng-trainer-v2` and the two `localStorage` records of v1 when the learner asks for a backup file, and for the preview of a recovery. It writes them in one case: the learner selected a backup file, saw the preview and confirmed the recovery of that product, and the product holds no learning data. It never creates, upgrades or deletes that database, and never removes or clears a `localStorage` record. See [Backup and recovery](BACKUP-AND-RECOVERY.md#product-boundaries).

Two database names on one origin separate the data logically. They are not a security boundary, and they give no separate durability: browser storage of one origin shares one quota and one eviction exposure. A backup file is the only copy outside the browser. See the [open gates](#open-gates-for-later-milestones).

## Content

- `stable-v2`: `content/catalog.json` and `content/packs/` are generated into `public/data/`, as before.
- `experimental-v3`: the same released sources plus [`content/v3/overlay.json`](../../content/v3/overlay.json), generated into the product's own staged public folder, `.variant/experimental-v3/public/`. That folder is rebuilt from nothing on every run.
- The overlay must be empty in ENG-V3-01: no blocks, no changes, no other file in `content/v3/`. Anything else stops the build. The experimental catalog is therefore the released one, byte for byte.
- The overlay names the manifest it was written for. If the released sources ever build another manifest, the experimental build stops.

Details of the pack format are in [Built-in content packs](BUILT-IN-CONTENT.md).

## Builds and assemblies

```text
npm run build       stable-v2        -> dist/
npm run build:v1    legacy-v1        -> v1/dist/
npm run build:v3    experimental-v3  -> dist-v3/

npm run assemble        published routes -> site-dist/     the Pages artifact: v2 and v1 only
npm run assemble:test   every route      -> .site-test/    local checks only, never uploaded
```

The assembly empties its target first, and it refuses, before it deletes anything:

- a missing build;
- a build that contains a folder or file named like any configured route, published or not;
- a route that is not in the configuration, or two products at one path;
- a target that is not an assembly folder, see the next section.

## Generated folders

Scripts and builds empty the folders they write. A wrong folder name would therefore delete sources. ENG-V3-01-RC1 closed that for the configuration file and ENG-V3-01-RC2 for the build options: **no configuration value decides which folder is emptied or deleted.**

[`scripts/generated-dirs.mjs`](../../scripts/generated-dirs.mjs) lists every generated folder and its one use. The list is code.

| Folder | Use | Emptied or deleted by |
|---|---|---|
| `dist` | build of `stable-v2` | Vite, before it writes the build |
| `dist-v3` | build of `experimental-v3` | Vite, before it writes the build |
| `.variant/experimental-v3/public` | staged public folder of `experimental-v3` | content generation, on every run |
| `site-dist` | production assembly | `npm run assemble` |
| `.site-test` | test assembly | `npm run assemble:test` |
| `.rehearsal` and folders below it | work area | `npm run rehearse:promotion` |
| `.local/negative` and folders below it | work area | `npm run check:negative` |

Everything else is never removed by a script. That includes `src/`, `content/`, `scripts/`, `docs/`, the stable `public/` (a source folder), the frozen `v1/` with its own `v1/dist`, and every file at the top of the repository. Other folders in `.local/` are not touched either.

The rule has two halves, and both must hold.

1. **The name is exact.** `site.config.json` must state, for each product, exactly the folder that the code fixes for it. The comparison is plain text. Nothing is trimmed, lower-cased or normalized first, so `SRC`, `Dist`, `./dist-v3`, `dist-v3/../src` and `index.html` are all errors, on every operating system. A folder name below a work area is lower-case words joined by hyphens.
2. **The folder is real.** On disk, each part of the path that exists must be a real folder that its parent lists under exactly this name, inside the repository. A file, a symbolic link, a Windows junction or a folder under another spelling is refused. Parts that do not exist yet are fine.

Where the rule is applied:

| Moment | Check |
|---|---|
| Any script or build reads the configuration | Half 1 for every product folder, then half 2 for `dist`, `dist-v3` and the staged public folder. |
| Content generation is about to delete the staged folder | Both halves again, immediately before the removal. The folder that is deleted is the constant from the list, not the configured value; the two must be equal. |
| An assembly is about to empty its target | Both halves. Only an assembly folder or a work-area folder is accepted. |
| A check is about to delete its work area | Both halves. |
| Vite is about to build | Both halves for every output folder that Vite resolved, also when it came from an inline option or `--outDir`. Only a build folder or a work-area folder is accepted, and nothing else may name a folder: see [What a Vite build may write](#what-a-vite-build-may-write). |

A refusal removes, creates and repairs nothing. The run stops with a message that names the folder, and a person decides. There is one recursive removal in the scripts, in `removeGeneratedDir`; it uses no `force`, and a test fails if another script gains one.

Route promotion changes addresses only. It gives no product another folder.

Limits of this rule:

- The check and the removal are two steps. A process that replaces a folder by a link between them is not detected.
- Vite empties `dist` and `dist-v3` itself. The check runs when Vite has resolved its configuration, before it empties or writes an output folder.
- A link inside a generated folder is removed as a link. What it leads to is not touched. Tests pin this behaviour of Node.js and of Vite.
- The frozen v1 project empties its own `v1/dist` with its own build. That folder is fixed in the v1 project, not read from `site.config.json`.

### What a Vite build may write

A build has one destination: the folder `build.outDir`, emptied before anything is written to it.

Checking `outDir` alone was not enough, for two reasons:

- Vite also empties every folder that a Rollup output option names with `dir`, in place of `outDir`. ENG-V3-01-RC2 closed that with rules 2 and 3 below.
- Vite keeps an entry named `.git` when it empties an output folder. A manifest or assets option could write into that entry, and through it if it is a link. ENG-V3-01-RC3 closed that with rules 4 to 6.

The check is `assertBuildDestinations` in [`scripts/generated-dirs.mjs`](../../scripts/generated-dirs.mjs). A build-only plugin in `vite.config.ts` calls it when Vite has resolved its configuration (`configResolved`). At that moment the options from every source are merged: `vite.config.ts`, an inline option of the JavaScript API and the command line. Vite has not yet emptied or written an output folder.

It checks every set of build options that Vite holds: `build`, and `environments.<name>.build` for each environment. For each set:

1. `outDir` must be a build folder or a work-area folder from the list, and real on disk (both halves above).
2. `rollupOptions.output` must be absent. No Rollup output option is accepted: not `dir`, not `file`, not a list in which one entry is harmless, and not an option that looks unrelated. The builds of this repository need none. If one is needed later, extend the check on purpose with a list of accepted keys.
3. `emptyOutDir` must not be `false`. Vite then removes whatever lies in the folder, a link included, before it writes a file there.
4. `assetsDir` must be `assets`. The scripts, stylesheets and fonts of a build go to `assets/` below its output folder and nowhere else.
5. `manifest` and `ssrManifest` must be `false`. A build writes no manifest, so no option names a file for one.
6. The output folder must hold no entry named `.git`: no folder, no file and no link, in any letter case. It is the one entry that Vite does not remove. The refusal leaves the entry, and whatever a link leads to, exactly as it is.

Rules 3 and 6 together mean that the output folder is empty when the build starts to write. Every path below it is then one that the build creates itself, so a name that lies inside the folder as text lies inside it on disk too.

Other Rollup options, such as `rollupOptions.treeshake` or `rollupOptions.external`, are not restricted.

What this covers, and what it does not:

- It was read and tested against **Vite 6.4.3** with **Rollup 4.63.1**, the versions in `package-lock.json`. A test pins both numbers. After an update, read `getResolvedOutDirs`, `prepareOutDir` and `emptyDir` in Vite again, run the tests, then change the numbers.
- Other file names inside a build, for example the name of a chunk, come from Rollup and are not checked here. Rollup 4.63.1 refuses a name that leads out of the output folder. It judges the text of the name only, which is enough once the folder is empty (rules 3 and 6). A test pins this behaviour.
- Folder names are resolved from Vite's `root`, as Vite resolves them. The products and the checks build with the repository as `root`.
- Vite loads `vite.config.ts` before the check can run. For that it writes a temporary module into `node_modules/.vite-temp/` and removes it. The check does not prevent that write, or a write that a plugin makes by itself.
- A plugin or a program that changes the resolved options after the check, or a build that does not use this `vite.config.ts`, is not covered.

## Gates on the released site

[`scripts/check-products.mjs`](../../scripts/check-products.mjs) is the last command of the repository that runs before the Pages artifact is uploaded. Only the `Configure GitHub Pages` action stands between it and the upload. Any failure stops the job there.

| Gate | What it checks |
|---|---|
| Released-site lock | `site-dist/` is exactly the 33 released files: same paths, sizes and SHA-256. Nothing extra, nothing missing, nothing changed, hidden files included. |
| Unpublished routes | No file exists at the path of a route with `"publish": false`. |
| Stable chunks | Exactly one script and one stylesheet, and the entry page names exactly those. |
| Stable tokens | No speech, model, Worker or remote-runtime token, no key-value storage (`localStorage`, `sessionStorage`, the names of v1's records), and no trace of the experimental product. |
| Stable content | The released manifest and all 14 packs. |
| Experimental content | The same, while the overlay is empty. |
| Experimental build | Its own database and base path, and `noindex`. The entry script holds no speech, model or Worker code: the feature is in lazily loaded files. The page declares exactly the committed Content-Security-Policy, once, before its first script. One file starts a Worker, and nothing names a service worker. The microphone is asked for in the Pronunciation screen only. No file names a model hub, a public script host or any host that was not looked at. The WebAssembly runtime is the pinned file, once. No model file is in the build. |
| Experimental backup | The Backup screen is one lazily loaded file, and the recovery writer is one more, which only the first names and loads. Only those two name the stable database, v1's records or `localStorage`, and each reaches `localStorage` in one place. The Backup screen's file holds no call that writes a key-value record, creates no object store, opens a database without a version and starts exactly one read-write transaction. The writer holds exactly one call that writes a key-value record and one read-write transaction, requests no database itself and creates no object store. No file of the build removes a key-value record or deletes a database. Neither of the two files makes a request or holds speech, model or Worker code. |

[`scripts/check-negative.mjs`](../../scripts/check-negative.mjs) proves that the gates can fail. It breaks disposable copies on purpose: one changed byte, an extra file, a hidden file, a missing file, the unpublished product copied into the site, colliding routes, a product folder that is not the product's own, a build into a folder that the repository does not generate, a build with a Rollup output option, six stable builds in which an experimental screen or its files are reachable, fourteen faults in a copy of the experimental build (a missing or weakened page policy, a changed inline script, a model file, a changed or second runtime binary, another host, a service worker, a second place that starts a Worker, and speech code outside the lazy screen), and thirty-two faults of the backup gate: the stable database or v1's records named outside the Backup screen and its recovery writer, a key-value write outside the writer or a second one inside it, a removal, a second access to the key-value storage, a database deletion, a created object store, a database opened with a version, a second read-write transaction, a request, a second dynamic import, the Backup screen in the entry script, a missing or second writer, a writer that another file or the entry page loads, and a Backup screen that is missing or no longer reads the stable database. Each case passes only when the right gate refuses it.

### The released-site lock

[`scripts/locks/released-site.files.json`](../../scripts/locks/released-site.files.json) lists every file of the site that ENG-V2-03 released: 28 files of v2 and 5 of v1.

- **Where it comes from.** The file list, sizes and hashes are those of the Pages artifact that the release workflow built on Linux for commit `498705a`. They are not taken from a local build.
- **Line endings.** The repository has no `.gitattributes`. A checkout with CRLF line endings builds eight files that differ from the release by carriage returns only. Such a build fails the lock, with a message that says why. CI builds from LF files.
- **Governance.**
  - Work on `experimental-v3` must pass the lock unchanged.
  - The lock is not updated to make a change pass.
  - A real change of `stable-v2` is a separate stable release with its own scope and review. Only that release replaces the lock.
  - The v1 part of the lock is frozen.
- A test pins a digest of the file list, so an edit of the lock is always a visible, deliberate change.

[`src/test/fixtures/released-catalog-v2.lock.json`](../../src/test/fixtures/released-catalog-v2.lock.json) is the same idea for content: the released manifest and its 14 packs.

## Tests

The shared suite runs once per product, one run after the other:

```text
npm test            stable-v2
npm run test:v3     experimental-v3
```

- Shared tests take addresses and the database name from the product under test ([`src/test/product.ts`](../../src/test/product.ts)).
- The exact values of each product are pinned as literals in [`src/product.contract.test.ts`](../../src/product.contract.test.ts).
- Tests of the stable upgrade path (database version 1 to 2, and a tab that still holds version 1) run for `stable-v2` only. The experimental database starts at version 1 and has no older version.
- The script tests run with `npm test`. Those for generated folders ([`scripts/safe-destinations.test.mjs`](../../scripts/safe-destinations.test.mjs), [`scripts/generated-dirs.test.mjs`](../../scripts/generated-dirs.test.mjs)) work in disposable copies in the system's temporary folder and never touch the repository. [`scripts/build-destinations.test.mjs`](../../scripts/build-destinations.test.mjs) runs real Vite builds, so its copies are complete copies of the application under `.local/`, where Node finds the installed packages. It takes between one and two minutes.
- Some tests are close to their time limit. Two suites on one machine at the same time can fail them.

## Promotion

Promotion is a change of the route list, not of the sources:

```text
today:     stable-v2 at ""          legacy-v1 at "v1/"   experimental-v3 at "v3/" (not published)
promoted:  experimental-v3 at ""    legacy-v1 at "v1/"   stable-v2 at "v2/"
```

`npm run rehearse:promotion` builds both arrangements into `.rehearsal/`, which Git ignores. It does not edit `site.config.json`, publish anything or replace a route.

- **Promoted.** Each product keeps its identity and database. The archived v2 gets a new entry page, script and stylesheet, because addresses are compiled in; its fonts, licences, icon and content stay byte-identical. v1 stays byte-identical.
- **Rollback.** The committed arrangement, rebuilt, is the released site again: all 33 files exact.
- A route change never moves data. Both databases stay where they are.

Open for the real promotion, a later milestone: an approved archive lock for v2 under `v2/`, what happens to old `/eng-trainer/v3/` addresses, and whether the promoted product keeps `noindex`.

## Open gates for later milestones

ENG-V3-02 stage A is a prototype for disposable browser profiles with made-up data. It contains no capacity check, no feedback, no history, no migration and no ledger. Three controls were named before it started:

- **R1: durability for the whole origin (the Data Safety Gate). Open.** Browser storage of one origin shares one quota and one eviction exposure, so a separate database name protects nothing. Before any large model cache is used on a real profile, there must be a validated full backup, a recovery path that the user can actually use for v1, v2 and v3, and safe handling of capacity, eviction and downloads. Stage A has the atomic installer that this gate builds on, and keeps the model away from real profiles.
  - **R1-A, backup and recovery: implemented** ([Backup and recovery](BACKUP-AND-RECOVERY.md)). A validated backup of all three products exists, and each product can be recovered from it into its own storage, where that holds no learning data.
  - **R1-B, capacity, the model cache and persistence: not started.**
- **R2: network boundary. Implemented for stage A, for Chromium and Firefox.** The Worker bootstrap, the page policy and the installer are tested on hosting without policy headers ([Pronunciation prototype](PRONUNCIATION-PROTOTYPE.md#network-boundary)). Recognition stays in the browser, and there is no cloud fallback. Safari and phones are not shown.
- **R3: revisions of spoken targets. The contract is implemented** (`src/features/pronunciation/spokenTarget.js`, with its regression cases). Nothing uses a revision yet: there is no feedback, no attempt history and no content patch.

Before stage B of V3-02, the first memory and latency checks on real devices must pass on disposable profiles. An agreed device list alone is not enough.

Publishing `/v3/` remains a separate decision of the owner and a separate, reviewed change.
