# Built-in content packs (ENG-V2-02A)

The authored source for v2 is `content/`. Nothing in v2 imports or fetches v1 content. Pack format version 1 changes the delivery format, not learning identities or the IndexedDB schema.

## Source format

`content/catalog.json` contains `{ "schemaVersion": 1, "meta": ..., "blocks": [...] }`. `meta` and the 39 navigation blocks retain their released values and order. Blocks stay together because their ordering, categories and IDs are also used by saved Learn Passes.

Each direct child JSON file of `content/packs/` has this envelope:

```json
{
  "schemaVersion": 1,
  "id": "example-topic",
  "title": "Example topic",
  "order": 120,
  "content": {
    "phrases": [
      {
        "id": "example-phrase-001",
        "category": "Example topic",
        "phrase": "An example phrase",
        "translation": "Приклад фрази"
      }
    ],
    "wordIndex": [
      {
        "id": "example-word-001",
        "sourcePhraseId": "example-phrase-001",
        "term": "An example phrase",
        "category": "Example topic",
        "meaning": "Приклад фрази",
        "pronunciation": "",
        "examples": []
      }
    ]
  }
}
```

The filename must equal `<id>.json`; the ID is a lowercase slug. `order` is a unique nonnegative integer. Packs are merged in ascending order, and entries keep their array order within each collection. Neither filename order, network completion order, category sorting, nor the optional entry `sequence` field sets this order. The current gaps of ten allow later packs to be inserted deliberately.

Allowed collections are `phrases`, `wordIndex`, `irregularVerbs`, `patterns`, `answers`, and `drills`. Unused collections may be omitted; empty packs and unknown collection/envelope keys are rejected. Entry fields remain those in `src/content/types.ts`. Existing patterns, answers and drill strings have no IDs, so this migration does not invent any. The 17 explicit null word transcriptions are preserved and accepted by the corrected word type.

## Identity and relationships

- Keep existing entry IDs when moving content between packs. Pack IDs and filenames are never progress keys.
- Block, phrase, word, verb and optional pattern IDs must be globally unique. Equal display text is allowed and does not merge identities.
- `sourcePhraseId` is optional for an independent word. If supplied, it must identify a phrase in the complete catalog. Cross-pack references are supported and checked after assembly. Never infer a link from equal text.
- A linked word still belongs to its phrase's flashcard; an unlinked word has its own card ID. Built-in dangling links fail validation. The generic flashcard builder's fallback for synthetic/unlinked content remains unchanged.
- Navigation blocks must target content that exists. Category blocks need that category, verb-set blocks need that set, and exercise/index blocks need the corresponding collection.
- For source preservation in this milestone, exact fingerprints also cover all record values, IDs, references and order. `src/test/fixtures/content-baseline.json` is a frozen audit fixture, never a generated output. A future content-changing milestone must explicitly review which baseline assertions it updates or retires.

## Current packs

| Pack | Order | Phrases | Words | Verbs | Other |
|---|---:|---:|---:|---:|---|
| speaking-foundations | 10 | 89 | 89 | — | Initial speaking, workplace and grammar categories |
| presentations | 20 | 90 | 90 | — | |
| agent-framework | 30 | 81 | 81 | — | |
| hedging-and-linking | 40 | 24 | 24 | — | |
| personal-topics | 50 | 45 | 45 | — | |
| workplace-topics | 60 | 120 | 120 | — | |
| ai-certification | 70 | 117 | 117 | — | |
| speaking-practice | 80 | — | — | — | 7 patterns, 6 answers, 15 drills |
| essential-100 | 90 | — | — | 100 | |
| logical-200 | 100 | — | — | 200 | |
| ai-certification-verbs-contextual | 110 | — | — | 39 | |

Total: 1,538 records/items, including 39 blocks, with 566 explicit word-to-phrase links and 566 flashcards across the same 31 topics.

## Generation and delivery

`scripts/content-build.mjs` discovers and validates all source packs using the pure shared validator in `src/content/packFormat.js`. `scripts/generate-content.mjs` writes:

```text
public/data/manifest.json
public/data/packs/<id>.<first-16-hex-of-SHA256>.json
```

The manifest contains format version, course metadata, ordered blocks, aggregate collection counts, and each pack's ID/title/order/relative URL/counts. Pack filenames hash deterministic UTF-8 JSON bytes, with LF endings and no timestamp. Identical sources generate identical assets. The generator validates everything before writing, then removes only obsolete generated hash-named pack files from its own output directory. Source files live outside `public/`.

Use the npm scripts: generation is an npm lifecycle hook before `dev`, `check`, `test`, and `build`. A direct `vite build` bypasses that hook; the repository and CI build contract is `npm run build`. Restart dev after changing authored JSON to regenerate assets. No new dependency or watcher service is needed.

`loadBuiltInCatalog()` fetches the manifest under the app's Vite base URL, then every pack concurrently with `cache: 'no-store'`. It checks schemas, pack metadata/counts, aggregate counts, IDs and references before creating the unchanged `ContentCatalog`. It accepts only generated relative pack URLs. The structural build check also verifies pack byte hashes. Runtime schema/count validation is not a cryptographic integrity check.

No partial catalog is returned. A missing or malformed pack uses the existing startup error screen, and **Try again** reloads the manifest and every pack. Hash filenames prevent a changed pack from reusing a prior URL; unavailable deployment assets produce a visible error. There is no offline cache, lazy loading, or new search engine.

## Compatibility and verification

The exact `Materials` shape reaches the existing catalog, features, flashcard logic and state services. Database `eng-trainer-v2`, version 1, its four stores and stored keys are unchanged. No progress repair, migration, or startup content write to IndexedDB is introduced. Saved Focus entries, Learn Pass block IDs, hidden IDs and flashcard order still refer to the same entries.

```bash
npm run check
npm test
npm run verify:content
npm run build:site
```

`verify:content` requires release commit `c84ef30d80ffbaae4ac0f3aa0fb7fe6090b8067b` in local Git history. It reads that commit's original v2 JSON, compares complete source/generated records and order, and checks v1 source preservation. Ordinary tests use frozen fingerprints, so they also work in CI's shallow checkout.

The combined site check understands v2's manifest/packs and v1's unchanged `data/materials.json`. The existing Actions workflow still builds both and publishes only from main. User collection import/storage and pronunciation models remain future work.
