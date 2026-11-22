# Built-in content packs (ENG-V2-02A)

The authored source for v2 is `content/`. Nothing in v2 imports or fetches v1 content. Pack format version 1 changes the delivery format, not learning identities or the IndexedDB schema.

## Source format

`content/catalog.json` contains `{ "schemaVersion": 1, "meta": ..., "blocks": [...] }`. `meta` and the 39 released navigation blocks retain their values and order; ENG-V2-03 appended three topic blocks after them. Blocks stay together because their ordering, categories and IDs are also used by saved Learn Passes.

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

Allowed collections are `phrases`, `wordIndex`, `irregularVerbs`, `patterns`, `answers`, `drills` and, since ENG-V2-03, the optional `topics` (see [Learning topics](#learning-topics-eng-v2-03)). Unused collections may be omitted; empty packs and unknown collection/envelope keys are rejected. Entry fields remain those in `src/content/types.ts`. Existing patterns, answers and drill strings have no IDs, so this migration does not invent any. The 17 explicit null word transcriptions are preserved and accepted by the corrected word type. An answer may carry an optional `id` (needed only when a learning topic refers to it) and an optional English `label`, shown with the answer.

## Identity and relationships

- Keep existing entry IDs when moving content between packs. Pack IDs and filenames are never progress keys.
- Block, phrase, word, verb and optional pattern and answer IDs must be globally unique. Equal display text is allowed and does not merge identities.
- `sourcePhraseId` is optional for an independent word. If supplied, it must identify a phrase in the complete catalog. Cross-pack references are supported and checked after assembly. Never infer a link from equal text.
- A linked word still belongs to its phrase's flashcard; an unlinked word has its own card ID. Built-in dangling links fail validation. The generic flashcard builder's fallback for synthetic/unlinked content remains unchanged.
- Navigation blocks must target content that exists. Category blocks need that category, verb-set blocks need that set, and exercise/index blocks need the corresponding collection.
- For source preservation in this milestone, exact fingerprints also cover all record values, IDs, references and order. `src/test/fixtures/content-baseline.json` is a frozen audit fixture, never a generated output. A future content-changing milestone must explicitly review which baseline assertions it updates or retires.
- ENG-V2-03 retired none of them. They now apply to the **legacy projection**: the catalog without the three topic packs and their three blocks (`src/test/legacyProjection.js`), in catalog order. Records are removed by identity, never by text, so a changed, moved or added released record still fails. `src/test/fixtures/legacy-pack-urls.json` additionally freezes the eleven released pack URLs; as the URL contains the content hash, an unchanged URL means an unchanged file.

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
| conditionals | 120 | 18 | — | — | 1 learning topic |
| small-talk | 130 | 36 | — | — | 1 learning topic |
| interview-english | 140 | 18 | — | — | 6 answers, 1 learning topic |

Released total (ENG-V2-02A to ENG-V2-UX-01B): 1,538 records/items, including 39 blocks, with 566 explicit word-to-phrase links and 566 flashcards across 31 topics.

Since ENG-V2-03: 1,622 records/items in 14 packs — 42 blocks, 638 phrases, 566 words, 339 verbs, 7 patterns, 12 answers, 15 drills and 3 learning topics — with the same 566 explicit links and 638 flashcards across 34 topics. The additions are 3 blocks, 72 phrases, 6 answers and 3 topic records; nothing released changed.

## Learning topics (ENG-V2-03)

A learning topic gives a phrase category a richer screen without new identities. The pack keeps the practice items as ordinary phrases; the topic record only describes and groups them:

```json
{
  "id": "small-talk",
  "title": "Small Talk",
  "blockId": "topic-small-talk",
  "description": "Start a conversation, keep it going and finish politely. …",
  "filter": { "label": "Situations", "all": "All situations" },
  "sections": [
    { "id": "meeting-new-people", "title": "Meeting new people", "items": ["small-talk-meet-01", "…"] }
  ]
}
```

- `id` is a slug and the address `#topic/<id>`. `title` is the phrase category of its practice items, so the topic is also a deck in the flashcard topic selector.
- Optional topic fields: `note` (shown with the description), `usageNote` (shown after the subsections) and `filter` (the subsections become filter chips). Optional subsection fields: `group`, `pattern`, `use`, `note`, `structure`, `questions` (`{ en, ua }`) and `answerId`.
- Only the phrases listed in `items` are learnable. Rules, notes, questions and model answers are supporting material and never cards. The listed phrases carry the subsection `id` as their `tag` and its title as their `section`, which the Phrases screen already groups by.
- Validation after assembly: unique topic IDs and titles; the block exists, is a phrase-category block for the topic title and opens only this topic; each listed phrase exists, belongs to the topic's category and is listed once; every phrase of that category is listed; each `answerId` exists. Unknown keys are rejected.
- Packs, topics and subsections stay separate: a pack is a file, a topic is what learners see, a subsection is a key inside one topic.

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

`verify:content` requires release commit `c84ef30d80ffbaae4ac0f3aa0fb7fe6090b8067b` in local Git history. It reads that commit's original v2 JSON, compares the complete source and generated legacy projections (records and order) with it, and checks v1 source preservation. It also prints the full-catalog totals and the ENG-V2-03 additions. Ordinary tests use frozen fingerprints, so they also work in CI's shallow checkout.

The combined site check understands v2's manifest/packs and v1's unchanged `data/materials.json`. The existing Actions workflow still builds both and publishes only from main. User collection import/storage and pronunciation models remain future work.
