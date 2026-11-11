# Changelog

## 2026-11-11

### Added

- Added a **Flashcards** page for learning words and phrases with swipeable, flippable cards.
- Added two decks: **All Vocabulary** and **By Topic** (dataset categories). The learned status is shared between them.
- Added three ways to answer: swipe, buttons, and keyboard (left and right arrows, Enter or Space to flip).
- Added a list of learned vocabulary with **Learn again**, and **Reset progress** for the selected deck with confirmation.
- Added flashcard progress to the saved browser state. Existing learned, hidden, Focus List, and Learn Pass data is kept.
- Added a focused test suite. Run it with `npm test`.

### Changed

- Phrases and their mirrored Word Index entries are shown as one flashcard, so no item appears twice.
- The hero shows only the page title on the Flashcards page, and is hidden there on phones, so the card fits on the first screen.
- The mobile navigation has a **Flashcards** entry and uses four columns on phones.

## 2026-06-29

### Fixed

- Improved toolbar layout on **Phrases** and **Word Index** pages.
- Stacked **Search** and **Category** controls vertically and placed listening controls beside them to avoid overlap.

### Added

- Added a new **200 Irregular Verbs — Logical Groups** learning block.
- Grouped the new irregular verbs by form-changing patterns instead of alphabetical order:
  - all three forms are the same;
  - 2nd and 3rd forms match;
  - 3rd form ends with `-en`;
  - `i → a → u` vowel change;
  - mixed / three-form patterns.
- Added `verbSet` support so different irregular-verb blocks can exist as separate learning tracks.
- Added a short functional guide to `README.md`.
- Added `CHANGELOG.md` as a maintained project history file.

### Changed

- The Irregular Verbs page now supports switching between available verb sets.
- The daily learning card uses irregular verbs from the active Learn Pass context.
