// Pure, shared validation: Node uses this during generation; the browser uses
// the same rules before exposing a complete catalog. No storage or I/O here.
/** @typedef {import('./types').Materials} Materials */
/** @typedef {import('./packTypes').BuiltInPack} BuiltInPack */
/** @typedef {import('./packTypes').ContentDescriptor} ContentDescriptor */
/** @typedef {import('./packTypes').ContentManifest} ContentManifest */
/** @typedef {import('./packTypes').ContentCounts} ContentCounts */
/** @typedef {import('./packTypes').PackContent} PackContent */

/**
 * `topics` (ENG-V2-03) is optional like every collection: a pack without it has no
 * learning topics. Its records only describe and group existing phrases and answers.
 * @type {(keyof PackContent)[]}
 */
export const CONTENT_KEYS = ['phrases', 'wordIndex', 'irregularVerbs', 'patterns', 'answers', 'drills', 'topics'];
const BLOCK_TYPES = ['phraseCategory', 'wordIndex', 'irregularVerbs', 'patterns', 'answers', 'practice', 'reversePractice'];
const PACK_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function require(condition, message) {
  if (!condition) throw new Error(`Invalid built-in content: ${message}`);
}

/** @param {unknown} value @param {string} at @returns {Record<string, unknown>} */
function object(value, at) {
  require(value !== null && typeof value === 'object' && !Array.isArray(value), `${at} must be an object`);
  return /** @type {Record<string, unknown>} */ (value);
}

/** @param {unknown} value @param {string} at @returns {unknown[]} */
function array(value, at) {
  require(Array.isArray(value), `${at} must be an array`);
  return value;
}

/** @param {unknown} value @param {string} at @param {boolean} [nonempty] */
function string(value, at, nonempty = false) {
  require(typeof value === 'string' && (!nonempty || value.trim().length > 0), `${at} must be a${nonempty ? ' nonempty' : ''} string`);
}

/** @param {Record<string, unknown>} value @param {string[]} allowed @param {string} at */
function keys(value, allowed, at) {
  for (const key of Object.keys(value)) require(allowed.includes(key), `${at}.${key} is unknown`);
}

/** @param {Record<string, unknown>} value @param {string[]} fields @param {string} at */
function strings(value, fields, at) {
  for (const field of fields) string(value[field], `${at}.${field}`);
}

/** @param {unknown} value @param {string} at */
function examples(value, at) {
  for (const [i, entry] of array(value, at).entries()) {
    const item = object(entry, `${at}[${i}]`);
    string(item.en, `${at}[${i}].en`, true);
    if (item.ua !== undefined) string(item.ua, `${at}[${i}].ua`);
  }
}

/** @param {Record<string, unknown>} value @param {string[]} fields @param {string} at */
function optionalText(value, fields, at) {
  for (const field of fields) if (value[field] !== undefined) string(value[field], `${at}.${field}`, true);
}

/** @param {unknown} value @param {string} at */
function topicSection(value, at) {
  const item = object(value, at);
  keys(item, ['id', 'title', 'group', 'pattern', 'use', 'note', 'questions', 'structure', 'items', 'answerId'], at);
  string(item.id, `${at}.id`, true);
  require(PACK_ID.test(/** @type {string} */ (item.id)), `${at}.id must be a lowercase slug`);
  string(item.title, `${at}.title`, true);
  optionalText(item, ['group', 'pattern', 'use', 'note', 'structure', 'answerId'], at);
  if (item.questions !== undefined) {
    for (const [i, entry] of array(item.questions, `${at}.questions`).entries()) {
      const question = object(entry, `${at}.questions[${i}]`);
      keys(question, ['en', 'ua'], `${at}.questions[${i}]`);
      string(question.en, `${at}.questions[${i}].en`, true);
      string(question.ua, `${at}.questions[${i}].ua`, true);
    }
  }
  const items = array(item.items, `${at}.items`);
  require(items.length > 0, `${at}.items is empty`);
  items.forEach((id, i) => string(id, `${at}.items[${i}]`, true));
}

/** A learning topic only refers to content; its references are checked after assembly. @param {unknown} value @param {string} at */
function topic(value, at) {
  const item = object(value, at);
  keys(item, ['id', 'title', 'blockId', 'description', 'note', 'usageNote', 'filter', 'sections'], at);
  for (const field of ['id', 'title', 'blockId', 'description']) string(item[field], `${at}.${field}`, true);
  require(PACK_ID.test(/** @type {string} */ (item.id)), `${at}.id must be a lowercase slug`);
  optionalText(item, ['note', 'usageNote'], at);
  if (item.filter !== undefined) {
    const filter = object(item.filter, `${at}.filter`);
    keys(filter, ['label', 'all'], `${at}.filter`);
    string(filter.label, `${at}.filter.label`, true);
    string(filter.all, `${at}.filter.all`, true);
  }
  const sections = array(item.sections, `${at}.sections`);
  require(sections.length > 0, `${at}.sections is empty`);
  sections.forEach((entry, i) => topicSection(entry, `${at}.sections[${i}]`));
}

/** @param {unknown} value @param {string} kind @param {string} at */
function record(value, kind, at) {
  if (kind === 'drills') return string(value, at, true);
  if (kind === 'topics') return topic(value, at);
  const item = object(value, at);
  if (['blocks', 'phrases', 'wordIndex', 'irregularVerbs'].includes(kind)) string(item.id, `${at}.id`, true);
  if (kind === 'phrases') strings(item, ['category', 'phrase', 'translation'], at);
  if (kind === 'wordIndex') {
    strings(item, ['term', 'category', 'meaning', 'pronunciation'], at);
    examples(item.examples, `${at}.examples`);
    if (item.sourcePhraseId !== undefined) string(item.sourcePhraseId, `${at}.sourcePhraseId`, true);
  }
  if (kind === 'irregularVerbs') {
    strings(item, ['group', 'base', 'pastSimple', 'pastParticiple', 'translation', 'transcription'], at);
    examples(item.examples, `${at}.examples`);
  }
  if (kind === 'patterns') strings(item, ['title', 'formula', 'use', 'example', 'translation'], at);
  if (kind === 'answers') strings(item, ['topic', 'question', 'answer', 'translation'], at);
  if (kind === 'blocks') {
    strings(item, ['title', 'description'], at);
    require(BLOCK_TYPES.includes(/** @type {string} */ (item.type)), `${at}.type is unsupported`);
    if (item.type === 'phraseCategory') string(item.category, `${at}.category`, true);
  }
  for (const field of ['id', 'example', 'transcription', 'section', 'level', 'tag', 'verbSet', 'category', 'icon', 'label']) {
    // Seventeen legacy word entries explicitly have no transcription.
    if (kind === 'wordIndex' && field === 'transcription' && item[field] === null) continue;
    if (item[field] !== undefined) string(item[field], `${at}.${field}`);
  }
  for (const field of ['sequence', 'priority', 'itemsCount']) {
    if (item[field] !== undefined) require(typeof item[field] === 'number' && Number.isFinite(item[field]), `${at}.${field} must be finite`);
  }
  if (item.examples !== undefined) examples(item.examples, `${at}.examples`);
  if (item.commonAlternatives !== undefined) {
    const alternatives = item.commonAlternatives;
    require(typeof alternatives === 'string' || (Array.isArray(alternatives) && alternatives.every((entry) => typeof entry === 'string')), `${at}.commonAlternatives must be text or a text array`);
  }
}

/** @param {unknown} value @returns {ContentDescriptor} */
export function parseDescriptor(value) {
  const descriptor = object(value, 'descriptor');
  keys(descriptor, ['schemaVersion', 'meta', 'blocks'], 'descriptor');
  require(descriptor.schemaVersion === 1, 'descriptor.schemaVersion must be 1');
  const meta = object(descriptor.meta, 'meta');
  strings(meta, ['title', 'subtitle', 'version', 'language', 'updated', 'goal'], 'meta');
  if (meta.updatedFeature !== undefined) string(meta.updatedFeature, 'meta.updatedFeature');
  for (const [i, block] of array(descriptor.blocks, 'blocks').entries()) record(block, 'blocks', `blocks[${i}]`);
  return /** @type {ContentDescriptor} */ (value);
}

/** @param {unknown} value @returns {BuiltInPack} */
export function parsePack(value) {
  const pack = object(value, 'pack');
  keys(pack, ['schemaVersion', 'id', 'title', 'order', 'content'], 'pack');
  require(pack.schemaVersion === 1, 'pack.schemaVersion must be 1');
  string(pack.id, 'pack.id', true);
  require(PACK_ID.test(/** @type {string} */ (pack.id)), 'pack.id must be a lowercase slug');
  string(pack.title, `${pack.id}.title`, true);
  require(Number.isSafeInteger(pack.order) && /** @type {number} */ (pack.order) >= 0, `${pack.id}.order must be a nonnegative integer`);
  const content = object(pack.content, `${pack.id}.content`);
  keys(content, CONTENT_KEYS, `${pack.id}.content`);
  let size = 0;
  for (const key of CONTENT_KEYS) {
    if (content[key] === undefined) continue;
    const items = array(content[key], `${pack.id}.${key}`);
    size += items.length;
    items.forEach((item, i) => record(item, key, `${pack.id}.${key}[${i}]`));
  }
  require(size > 0, `${pack.id} is empty`);
  return /** @type {BuiltInPack} */ (value);
}

/** @param {Partial<PackContent>} content @returns {ContentCounts} */
export function countContent(content) {
  return /** @type {ContentCounts} */ (Object.fromEntries(CONTENT_KEYS.map((key) => [key, content[key]?.length ?? 0])));
}

/** @param {unknown} value @param {string} at @returns {ContentCounts} */
function counts(value, at) {
  const result = object(value, at);
  keys(result, CONTENT_KEYS, at);
  for (const key of CONTENT_KEYS) require(Number.isSafeInteger(result[key]) && /** @type {number} */ (result[key]) >= 0, `${at}.${key} must be a nonnegative integer`);
  return /** @type {ContentCounts} */ (result);
}

/** @param {ContentCounts} actual @param {ContentCounts} expected @param {string} at */
export function assertCounts(actual, expected, at) {
  for (const key of CONTENT_KEYS) require(actual[key] === expected[key], `${at}.${key} count mismatch (${actual[key]} != ${expected[key]})`);
}

/** @param {unknown} value @returns {ContentManifest} */
export function parseManifest(value) {
  const manifest = object(value, 'manifest');
  keys(manifest, ['schemaVersion', 'meta', 'blocks', 'counts', 'packs'], 'manifest');
  parseDescriptor({ schemaVersion: manifest.schemaVersion, meta: manifest.meta, blocks: manifest.blocks });
  const totals = counts(manifest.counts, 'manifest.counts');
  const entries = array(manifest.packs, 'manifest.packs');
  require(entries.length > 0, 'manifest.packs is empty');
  const ids = new Set();
  const sum = countContent({});
  let lastOrder = -1;
  for (const value of entries) {
    const entry = object(value, 'manifest pack');
    keys(entry, ['id', 'title', 'order', 'url', 'counts'], 'manifest pack');
    string(entry.id, 'manifest pack.id', true);
    const id = /** @type {string} */ (entry.id);
    require(PACK_ID.test(id) && !ids.has(id), `invalid or duplicate pack id ${id}`);
    ids.add(id);
    string(entry.title, `${id}.title`, true);
    require(Number.isSafeInteger(entry.order) && /** @type {number} */ (entry.order) > lastOrder, `${id}.order must be unique and ascending`);
    lastOrder = /** @type {number} */ (entry.order);
    string(entry.url, `${id}.url`, true);
    require(new RegExp(`^packs/${id}\\.[a-f0-9]{16}\\.json$`).test(/** @type {string} */ (entry.url)), `${id}.url must be a generated relative pack path`);
    const inventory = counts(entry.counts, `${id}.counts`);
    require(CONTENT_KEYS.some((key) => inventory[key] > 0), `${id} is empty`);
    for (const key of CONTENT_KEYS) sum[key] += inventory[key];
  }
  assertCounts(sum, totals, 'manifest');
  return /** @type {ContentManifest} */ (value);
}

/** @param {ContentDescriptor} descriptor @param {BuiltInPack[]} packs @returns {Materials} */
export function assembleMaterials(descriptor, packs) {
  parseDescriptor({ schemaVersion: descriptor.schemaVersion, meta: descriptor.meta, blocks: descriptor.blocks });
  const parsed = packs.map(parsePack).sort((a, b) => a.order - b.order);
  require(parsed.length > 0, 'no packs');
  require(new Set(parsed.map((pack) => pack.id)).size === parsed.length, 'duplicate pack id');
  require(new Set(parsed.map((pack) => pack.order)).size === parsed.length, 'duplicate pack order');
  const materials = /** @type {Materials} */ ({ meta: descriptor.meta, blocks: descriptor.blocks });
  for (const key of CONTENT_KEYS) {
    // All arrays for a given key have the same entry type.
    Object.assign(materials, { [key]: parsed.flatMap((pack) => /** @type {unknown[]} */ (pack.content[key] ?? [])) });
  }
  const ids = new Set();
  for (const key of ['blocks', 'phrases', 'wordIndex', 'irregularVerbs', 'patterns', 'answers']) {
    for (const item of /** @type {{id?: string}[]} */ (materials[/** @type {keyof Materials} */ (key)])) {
      if (item.id === undefined) continue;
      require(!ids.has(item.id), `duplicate entry id ${item.id}`);
      ids.add(item.id);
    }
  }
  const phraseIds = new Set(materials.phrases.map((item) => item.id));
  for (const word of materials.wordIndex) {
    require(word.sourcePhraseId === undefined || phraseIds.has(word.sourcePhraseId), `${word.id}.sourcePhraseId points to missing phrase ${word.sourcePhraseId}`);
  }
  for (const block of materials.blocks) {
    if (block.type === 'phraseCategory') require(materials.phrases.some((item) => item.category === block.category), `${block.id} has no phrases in ${block.category}`);
    if (block.type === 'irregularVerbs') require(materials.irregularVerbs.some((item) => !block.verbSet || item.verbSet === block.verbSet), `${block.id} has no verbs in ${block.verbSet ?? 'the catalog'}`);
    if (block.type === 'wordIndex') require(materials.wordIndex.length > 0, `${block.id} has no words`);
    if (block.type === 'reversePractice') require(materials.phrases.length > 0 || materials.wordIndex.length > 0, `${block.id} has no reverse practice content`);
    if (block.type === 'patterns') require(materials.patterns.length > 0, `${block.id} has no patterns`);
    if (block.type === 'answers') require(materials.answers.length > 0, `${block.id} has no answers`);
    if (block.type === 'practice') require(materials.drills.length > 0, `${block.id} has no drills`);
  }
  validateTopics(materials);
  return materials;
}

/**
 * Every reference of a learning topic is explicit and checked: its block, each listed
 * phrase and model answer. A topic lists every phrase of its category exactly once, so
 * the topic's flashcard deck and its practice rows are the same cards.
 * @param {Materials} materials
 */
function validateTopics(materials) {
  const topics = materials.topics ?? [];
  const phraseById = new Map(materials.phrases.map((item) => [item.id, item]));
  const answerIds = new Set(materials.answers.map((item) => item.id).filter((id) => id !== undefined));
  const topicIds = new Set(), titles = new Set(), blockIds = new Set();
  for (const item of topics) {
    require(!topicIds.has(item.id), `duplicate topic id ${item.id}`);
    require(!titles.has(item.title), `duplicate topic title ${item.title}`);
    require(!blockIds.has(item.blockId), `${item.id}: block ${item.blockId} already opens another topic`);
    topicIds.add(item.id);
    titles.add(item.title);
    blockIds.add(item.blockId);
    const block = materials.blocks.find((entry) => entry.id === item.blockId);
    require(block !== undefined, `${item.id}.blockId points to missing block ${item.blockId}`);
    require(block.type === 'phraseCategory' && block.category === item.title, `${item.id}: block ${item.blockId} must be the phrase category ${item.title}`);
    const sectionIds = new Set(), listed = new Set();
    for (const section of item.sections) {
      require(!sectionIds.has(section.id), `${item.id}: duplicate section id ${section.id}`);
      sectionIds.add(section.id);
      for (const id of section.items) {
        const phrase = phraseById.get(id);
        require(phrase !== undefined, `${item.id}.${section.id} lists missing phrase ${id}`);
        require(phrase.category === item.title, `${item.id}.${section.id}: phrase ${id} belongs to ${phrase.category}`);
        require(!listed.has(id), `${item.id}: phrase ${id} is listed twice`);
        listed.add(id);
      }
      require(section.answerId === undefined || answerIds.has(section.answerId), `${item.id}.${section.id}.answerId points to missing answer ${section.answerId}`);
    }
    for (const phrase of materials.phrases) {
      require(phrase.category !== item.title || listed.has(phrase.id), `${item.id} does not list its phrase ${phrase.id}`);
    }
  }
}
