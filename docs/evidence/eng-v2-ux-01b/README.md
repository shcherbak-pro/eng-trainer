# ENG-V2-UX-01B — implementation evidence

| | |
|---|---|
| Date | 22 November 2026 |
| Scope | Concept B redesign of v2, import guidance and F3–F6, as described in the [handoff](../../handoffs/ENG-V2-UX-01B.md) |
| Baseline | HEAD `f14dd4e33de2dfcbd8b80e1b72dbfec4326823d3`, branch `feature/eng-v2-ux-01b-spoken-line` |
| Integration | None: nothing committed, staged, pushed or deployed |

This folder is new. Earlier evidence, reviews, release reports and the UX-01A design files are unchanged ([`preservation.json`](preservation.json)).

## Results

Final run: 21 November 2026, 23:53 UTC (22 November, local time).

| Check | Result |
|---|---|
| `npm run check` | 0 errors, 0 warnings (243 files) |
| `npm test` | 10/10 content and build tests; 247/247 Vitest tests in 18 files (54 new) |
| `npm run check:v1` / `npm run test:v1` | 0 errors, 0 warnings (189 files); 68/68 |
| `npm run build` / `npm run build:site` | Pass. JS 236.81 KB (78.25 KB gzip), CSS 41.64 KB (7.91 KB gzip), six self-hosted fonts, both licences, no Google Fonts references |
| `npm run verify:content` | Pass: exact built-in content and order, exact published content, 566 explicit links, v1 unchanged |
| `git -c core.whitespace=cr-at-eol diff --check` | Clean; the only output is Git's CRLF conversion warnings |
| Chromium 159.0.8154.6 | 16/16 scenarios |
| Firefox 159.0 | 16/16 scenarios |
| Page errors, console errors, failed requests | Only in deliberate failures: fonts refused; the 503 manifest (Chromium logs it to the console). Also the unchanged v1 page's Google Fonts request, refused by the runner. |
| Protected files | 101/101 unchanged |
| v1 build | Identical to the released artifact apart from Windows line endings; JS and CSS byte-identical; `git diff -- v1` empty |
| First-load budget | Pass (below) |

## Reproduction

From the repository root, with root and v1 dependencies installed (Node 24.18.0 and npm 11.17.0 were used):

```powershell
npm run check
npm test
npm run check:v1
npm run test:v1
npm run build
npm run build:site
npm run verify:content
git -c core.whitespace=cr-at-eol diff --check
```

The browser suite needs a Playwright installation with its Chromium and Firefox. This run reused, read-only, the isolated Playwright 1.65.1 runner and browsers kept from the ENG-V2-02B release (`.git/eng-v2-02b-release/`). Never point it at a personal browser profile.

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = '<isolated-browser-binaries>'
node docs/evidence/eng-v2-ux-01b/browser-check.mjs '<playwright-node_modules>' site-dist '<output-dir>'
```

How the runner works:
- It serves `site-dist` at `http://127.0.0.1:4179/eng-trainer/` with no single-page fallback.
- Each scenario gets a fresh, non-persistent browser context with reduced motion. Requests to any other host are refused and recorded.
- `ONLY=<scenario>,<scenario>` runs a subset.

`collect-evidence.mjs` rebuilds this folder (all but this README) from a run directory.

## What the browser run checks

Each scenario runs in both engines.

| Scenario | Checks |
|---|---|
| `layout-{phone,narrow,desktop}-{light,dark}` | 390 × 844, 320 × 640 and 1440 × 900, in both themes, on all twelve screens. On every screen: no horizontal overflow, one `h1` inside `main`, no Google Fonts link, no stretched icon button, and no target under 44 × 44 px. On the phone, first study content within 250 px on the ten study screens. Light-phone accessibility snapshots. |
| `flashcard-answers-reachable` | The answer buttons end above the tab bar on a phone, and inside the window on desktop, front and back. |
| `reflow-large-text-and-font-fallbacks` | 200 % root text at 320 px on Phrases, Collections, Flashcards and Settings: no overflow, tab bar labels inside their columns, and space kept free that is at least the bar height. Fonts delayed by 5 s and fonts refused: text shown, no overflow. |
| `keyboard-and-focus` | The skip link. No focus under the tab bar on Phrases (60 Tab presses) or on six more screens (50 each). The first entry reached within 20 presses. The focus ring. Hide by keyboard moves focus to the next entry, and Undo returns it. The More sheet opens with the button state and closes with Escape back to More. |
| `reduced-motion` | Transitions are cut to 0.01 ms, and the next card appears at once. |
| `collections-import-journey` | The example, Copy (the page's clipboard is replaced; the system clipboard is never touched) and the template file are identical, with a byte-order mark. Help writes nothing. A missing column by keyboard: error summary focused, input cleared. Preview focus, and no write before confirming. Import and export with the `Мої-слова-YYYY-MM-DD.json` name. Reimport of the export: nothing changes. A rename conflict from a second tab, with **Reload page** and no storage advice. Remove: Cancel keeps everything; confirming removes it. |
| `blocked-upgrade-wait` / `blocked-upgrade-continue` | A version-1 connection held in another tab: guidance stays through two **Check again**. Closing that tab lets the app open by itself. Or **Continue without saving** keeps saving off after the tab closes, and no change is written. |
| `safeguards` | Hide restores only what it removed (learned and Focus), and the entry returns in place. **Unhide all**: Cancel changes nothing; confirming applies. **Reset learning progress…**: focus on Cancel, Escape changes nothing, confirming clears. |
| `content-error-screen` | The manifest answers 503: plain wording, then **Try again** succeeds once the manifest is back. |
| `v1-isolation` | v1 loads and creates no v2 database. |
| Measurements (Chromium) | Cold first loads of `#index`, `#phrases` and `#wordIndex`. Theme start-up with a saved Dark theme, a light system theme and 4× CPU slowdown, six reloads. |

Undersized targets are also checked in the More sheet, the Undo message, the Unhide all, Reset and Remove dialogs, the import help and error, and the blocked and content-error screens.

## Measurements

**First study content on a 390 × 844 phone** (top of the first entry or card; both engines identical). The before row is the UX-01A production audit (§1.2 of the proposal).

| | Phrases | Words | Verbs | Patterns | Answers | Flashcards | Reverse practice | Speaking prompts | Focus list | Collections |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Before | 1,117 px | 1,474 px | 1,233 px | — | — | — | — | — | 883 px | 1,057 px |
| After | 236 px | 236 px | 236 px | 161 px | 137 px | 232 px | 136 px | 72 px | 60 px | 60 px |

With the fonts refused, the fallback fonts put the first phrase at 264 px in Chromium and 236 px in Firefox.

**Flashcard answers.** The buttons end at 624 px on the phone (the tab bar starts at 779 px) and at 618 px on a 1440 × 900 desktop. Before, the desktop answers were below the fold.

**First load** (cold cache; see [`first-load.json`](first-load.json) for the definition):

| | Budget | Result |
|---|---|---|
| App code: HTML + CSS + JS, gzip | ≤ 100 KiB | 86,700 B (648 + 7,865 + 78,187) |
| Fonts on a first screen | ≤ 200 KiB | 133,040 B on Home and Phrases; 193,128 B on Words, with the IPA subset |
| Total, gzip estimate | ≤ 550 KiB | 450,043 B (Home, Phrases); 510,131 B (Words) |
| Hosts other than the site | 0 | 0 |

The built-in content is unchanged: 230,303 B gzip. Before, the measured production first load was about 3.4 MB, 3,132,808 B of it the Material Symbols font.

**Theme start-up** (saved Dark, light system, 4× CPU, six reloads):

| Event | Time |
|---|---|
| First paint (the loader) | 44–128 ms |
| Dark theme applied | 159–308 ms |
| Study screens shown | 409–625 ms |

In every run, the study screens appeared after the theme, and transitions were switched on only then. A light loader frame of roughly 90–200 ms remains (see the handoff's limitations).

**Large text.** At 200 % text and 320 px, the tab bar grows to 101 px. The page keeps 133 px free and the focus scroll padding is 117 px. There is no horizontal overflow on the four screens checked.

**Keyboard.** From the skip link, the first entry control is the 11th (Chromium) or 12th (Firefox) Tab stop. The focus ring is a solid 2 px `#2c5bd6`.

## Inventory

| Path | Contents |
|---|---|
| `logs/` | The final run of every command above, the browser run, exit codes and the environment |
| `browser/results.json` | Every scenario, its measurements and the scenario-tagged error log |
| `browser/aria/` | Accessibility-tree snapshots of the phone screens (machine output, not a screen reader test) |
| `browser/screenshots.json` | Every screenshot of the final run, with its hash and whether it is published |
| `screenshots/` | The 34 published screenshots: pairs with the UX-01A “before” set, new states, and Firefox |
| `first-load.json` | The first-load budget, the measured routes and the size of each part |
| `artifact.json` | SHA-256 of every file of the tested `site-dist` |
| `v1-preservation.json` | The built v1 compared with the released ENG-V2-02B artifact |
| `preservation.json` | The 101 protected files that existed before this milestone |
| `candidate.json` | Every changed, deleted and new file of this milestone, with hashes; nothing is staged |
| `git-status.txt` | The complete working tree status |
| `sanitization.json` | Raw and published hashes of each sanitized text file |
| `browser-check.mjs`, `collect-evidence.mjs` | The runner and the collector |

## Hygiene

- **Data.** All data is synthetic: an imported collection “Мої слова” with two invented entries, plus the built-in material. The owner's browser profile and learning data were never opened.
- **Sanitizing.** Logs, results and scripts have local repository, user and temporary paths replaced with `<repo>`, `<user-home>`, `<user>` and `<run>`, and terminal colour codes removed.
- **Unpublished screenshots.** They stay in the local run directory. `browser/screenshots.json` records their hashes, and the runner can recreate them.
- **Expected log entries.** The only entries come from deliberate failures (fonts refused, the 503 manifest) and from the unchanged v1 page asking for Google Fonts, which the runner refused.
