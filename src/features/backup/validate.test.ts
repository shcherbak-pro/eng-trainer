import { beforeEach, expect, it, vi } from 'vitest';
import { resetDatabase } from '../../test/database';
import { describeExperimental } from '../../test/product';
import { DATABASE_NAME, DATABASE_VERSION, META_STORE_NAME, STORE_NAMES } from '../../storage/database';
import { BACKUP_FORMAT, BACKUP_VERSION, DATABASE_SCHEMAS, LEGACY_KEYS, MAX_BACKUP_BYTES, PRODUCTS, backupFileName, canonicalJson, isIsoTime, sameJson, sectionDigest, sha256Hex } from './format';
import { SYNTHETIC_META, V1_STATE, V1_STATE_KEY, V1_THEME_KEY, asPairs, bytesOf, databaseNames, syntheticStores } from './testing';
import { checkSection, readBackup } from './validate';

/**
 * The backup format and its strict validation (ENG-V3-R1A). All data is made up.
 * A file is accepted as a whole or refused as a whole, and the reason names what is wrong.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
type Pairs = [string, unknown][];

/** Characters that are written as code here, so no tool can change them in this file. */
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

const V3 = 'experimental-v3';
const V2 = 'stable-v2';
const V1 = 'legacy-v1';

function sections(): Json {
  return {
    [V3]: { database: 'eng-trainer-v3', schemaVersion: 1, stores: asPairs({ ...syntheticStores(3), meta: SYNTHETIC_META }) },
    [V2]: { database: 'eng-trainer-v2', schemaVersion: 2, stores: asPairs(syntheticStores(2)) },
    [V1]: { storage: 'localStorage', records: { [V1_STATE_KEY]: V1_STATE, [V1_THEME_KEY]: 'dark' } }
  };
}

/** A complete, valid file. `edit` changes the sections before their digests are computed. */
async function validFile(edit?: (all: Json) => void): Promise<Json> {
  const all = sections();
  edit?.(all);
  const digests: Record<string, string> = {};
  for (const [product, section] of Object.entries(all)) digests[product] = await sha256Hex(canonicalJson(section));
  return { format: 'eng-trainer-backup', version: 1, exportedAt: '2026-11-25T14:03:22.123Z', exportedBy: { product: V3 }, sections: all, integrity: { algorithm: 'SHA-256', sections: digests } };
}

/** Sets or removes one record of a store, keeping the keys in ascending order. */
function setRecord(all: Json, product: string, store: string, key: string, value?: unknown): void {
  const pairs: Pairs = all[product].stores[store].filter(([existing]: [string, unknown]) => existing !== key);
  if (value !== undefined) pairs.push([key, value]);
  all[product].stores[store] = pairs.sort(([a], [b]) => (a < b ? -1 : 1));
}
const record = (all: Json, product: string, store: string, key: string): Json => all[product].stores[store].find(([existing]: [string, unknown]) => existing === key)[1];

async function refusal(content: unknown): Promise<{ code: string; message: string; product?: string }> {
  const error = await readBackup(bytesOf(content)).then(() => null, (reason: unknown) => reason);
  expect(error, 'the file was accepted').not.toBeNull();
  expect((error as Error).name).toBe('BackupError');
  return error as { code: string; message: string; product?: string };
}

beforeEach(() => {
  resetDatabase();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describeExperimental('backup format: identities and canonical text', () => {
  it('names the format, its version and the three products with their storage and schema', () => {
    expect([BACKUP_FORMAT, BACKUP_VERSION]).toEqual(['eng-trainer-backup', 1]);
    expect([...PRODUCTS]).toEqual(['experimental-v3', 'stable-v2', 'legacy-v1']);
    expect(DATABASE_SCHEMAS['stable-v2']).toEqual({ database: 'eng-trainer-v2', schemaVersion: 2, stores: ['progress', 'learnPasses', 'flashcardSessions', 'settings', 'userCollections', 'userEntries'] });
    expect(DATABASE_SCHEMAS['experimental-v3']).toEqual({ database: 'eng-trainer-v3', schemaVersion: 1, stores: ['progress', 'learnPasses', 'flashcardSessions', 'settings', 'userCollections', 'userEntries', 'meta'] });
    expect([...LEGACY_KEYS]).toEqual(['englishAssessmentTrainer.svelteState.v1', 'englishAssessmentTrainer.theme.v1']);
  });

  it('describes the experimental section exactly as this build opens its own database', () => {
    expect(DATABASE_SCHEMAS['experimental-v3'].database).toBe(DATABASE_NAME);
    expect(DATABASE_SCHEMAS['experimental-v3'].schemaVersion).toBe(DATABASE_VERSION);
    expect(DATABASE_SCHEMAS['experimental-v3'].stores).toEqual([...STORE_NAMES, META_STORE_NAME]);
  });

  it('gives one text to one value: member order does not matter, list order does', () => {
    expect(canonicalJson({ b: [1, 'two', null, true], a: { d: 1.5, c: '' } })).toBe('{"a":{"c":"","d":1.5},"b":[1,"two",null,true]}');
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
    expect(canonicalJson(`line\nbreak "quoted" ${LINE_SEPARATOR}`)).toBe(JSON.stringify(`line\nbreak "quoted" ${LINE_SEPARATOR}`));
    expect(sameJson({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(sameJson({ a: 1 }, { a: 1, b: undefined })).toBe(false);
  });

  it('refuses every value that JSON cannot hold exactly, instead of changing it', () => {
    const sparse = [1, 2, 3];
    delete sparse[1];
    for (const value of [undefined, Number.NaN, Number.POSITIVE_INFINITY, -0, new Date(0), new Map(), new Uint8Array(2), () => 1, 10n, Symbol('x'), { a: undefined }, sparse, { [Symbol('s')]: 1 }]) {
      expect(() => canonicalJson(value), String(value)).toThrow(/JSON cannot hold|missing item/);
    }
  });

  it('computes SHA-256 as lower-case hexadecimal, and a section digest over the canonical text', async () => {
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const section = sections()[V1];
    expect(await sectionDigest(section)).toBe(await sha256Hex(canonicalJson(section)));
    expect(await sectionDigest({ storage: 'localStorage', records: { [V1_THEME_KEY]: 'dark', [V1_STATE_KEY]: V1_STATE } })).toBe(await sectionDigest(section));
  });

  it('says so when the page cannot compute a digest, instead of skipping the check', async () => {
    vi.stubGlobal('crypto', {});
    await expect(sha256Hex('abc')).rejects.toMatchObject({ code: 'unavailable' });
    vi.unstubAllGlobals();
  });

  it('accepts only the time form that the application writes, and names the file after it', () => {
    expect(isIsoTime('2026-11-25T14:03:22.123Z')).toBe(true);
    for (const value of ['2026-11-25', '2026-11-25T14:03:22Z', 'yesterday', '', 5, null, '2026-13-45T00:00:00.000Z']) expect(isIsoTime(value), String(value)).toBe(false);
    expect(backupFileName('2026-11-25T14:03:22.123Z')).toBe('eng-trainer-backup-20261125-140322.json');
  });
});

describeExperimental('backup validation: a complete file', () => {
  it('accepts a file with all three sections and returns it unchanged', async () => {
    const file = await validFile();
    const read = await readBackup(bytesOf(file));
    expect(read).toEqual(file);
    expect(Object.keys(read.sections)).toEqual([V3, V2, V1]);
  });

  it('accepts a file with one section only, a pretty-printed file and a byte order mark', async () => {
    for (const keep of [V3, V2, V1]) {
      const file = await validFile((all) => {
        for (const product of Object.keys(all)) if (product !== keep) delete all[product];
      });
      expect(Object.keys((await readBackup(bytesOf(file))).sections)).toEqual([keep]);
    }
    const file = await validFile();
    expect(await readBackup(bytesOf(`${BYTE_ORDER_MARK}${JSON.stringify(file, null, 2)}\n`))).toEqual(file);
  });

  it('accepts sections without learning data: empty stores, and one record of the first version', async () => {
    const file = await validFile((all) => {
      for (const store of STORE_NAMES) {
        all[V3].stores[store] = [];
        all[V2].stores[store] = [];
      }
      delete all[V1].records[V1_STATE_KEY];
    });
    expect((await readBackup(bytesOf(file))).sections[V1]?.records).toEqual({ [V1_THEME_KEY]: 'dark' });
  });

  it('needs nothing from the browser: no database, no saved record and no earlier export', async () => {
    const open = vi.spyOn(indexedDB, 'open');
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    await readBackup(bytesOf(await validFile()));
    expect(open).not.toHaveBeenCalled();
    expect(getItem).not.toHaveBeenCalled();
    expect(await databaseNames()).toEqual([]);
    expect(window.localStorage.length).toBe(0);
  });

  it('keeps a selected Learn pass that no longer exists as it is, because the application stores it so', async () => {
    const file = await validFile((all) => setRecord(all, V3, 'progress', 'selectedLearnPassId', 'pass-that-was-deleted-in-another-tab'));
    expect((await readBackup(bytesOf(file))).sections[V3]?.stores.progress).toContainEqual(['selectedLearnPassId', 'pass-that-was-deleted-in-another-tab']);
  });
});

describeExperimental('backup validation: files that are not a backup, or not a complete one', () => {
  it('refuses a file from its size alone, an empty file, other bytes, other text and other JSON', async () => {
    expect(await readBackup(new Uint8Array(MAX_BACKUP_BYTES + 1)).then(() => null, (error: { code: string }) => error.code)).toBe('too-large');
    expect((await refusal('')).code).toBe('empty');
    expect(await readBackup(new Uint8Array([0xff, 0xfe, 0x00, 0x41])).then(() => null, (error: { code: string }) => error.code)).toBe('not-utf8');
    expect((await refusal('english,translation\nhello,привіт\n')).code).toBe('not-json');
    // `bytesOf` takes text as it is, so the JSON text of a string is written out here.
    for (const value of [[], null, 42, '"text"', {}, { format: 'something-else', version: 1 }]) expect((await refusal(value)).code, JSON.stringify(value)).toBe('not-a-backup');
    const vocabulary = await refusal({ format: 'eng-trainer-vocabulary', version: 1, collection: {}, entries: [] });
    expect(vocabulary.code).toBe('not-a-backup');
    expect(vocabulary.message).toContain('import it on the Collections screen');
  });

  it('refuses a file that was cut short at any place', async () => {
    const text = JSON.stringify(await validFile(), null, 2);
    for (const length of [1, 20, Math.floor(text.length / 3), Math.floor(text.length / 2), text.length - 2]) {
      expect((await refusal(text.slice(0, length))).code, `cut at ${length}`).toBe('not-json');
    }
  });

  it('refuses another format version, and says when the file comes from a newer application', async () => {
    const newer = await refusal({ ...(await validFile()), version: 2, extraMemberOfVersion2: true });
    expect(newer.code).toBe('unsupported-version');
    expect(newer.message).toContain('made by a newer version');
    for (const version of [0, '1', null, 1.5]) expect((await refusal({ ...(await validFile()), version })).code, String(version)).toBe('unsupported-version');
  });

  it('refuses an unknown or a missing member at every level of the structure', async () => {
    const cases: [string, (file: Json) => void, RegExp][] = [
      ['unknown top-level member', (file) => { file.note = 'hello'; }, /unknown: note/],
      ['missing exportedAt', (file) => { delete file.exportedAt; }, /missing: exportedAt/],
      ['exportedAt is not a time', (file) => { file.exportedAt = 'yesterday'; }, /exportedAt is not a time/],
      ['unknown member of exportedBy', (file) => { file.exportedBy.build = 'x'; }, /exportedBy must have exactly/],
      ['another writer', (file) => { file.exportedBy.product = 'stable-v2'; }, /Only "experimental-v3" writes backups/],
      ['no section', (file) => { file.sections = {}; file.integrity.sections = {}; }, /holds no section/],
      ['sections is a list', (file) => { file.sections = []; }, /sections is not an object/],
      ['unknown product', (file) => { file.sections['other-v9'] = file.sections[V2]; file.integrity.sections['other-v9'] = file.integrity.sections[V2]; }, /"other-v9", which is not a product/],
      ['another digest algorithm', (file) => { file.integrity.algorithm = 'MD5'; }, /digest algorithm/],
      ['a section without a digest', (file) => { delete file.integrity.sections[V2]; }, /integrity\.sections must have exactly/],
      ['a digest without a section', (file) => { delete file.sections[V1]; }, /integrity\.sections must have exactly/],
      ['a digest that is not SHA-256', (file) => { file.integrity.sections[V3] = 'ABC'; }, /is not a SHA-256 value/],
      ['unknown member of a section', (file) => { file.sections[V2].note = 1; }, /The section "stable-v2" must have exactly/],
      ['another database name', (file) => { file.sections[V2].database = 'eng-trainer-v3'; }, /names the storage "eng-trainer-v3", not "eng-trainer-v2"/],
      ['a missing store', (file) => { delete file.sections[V2].stores.userEntries; }, /missing: userEntries/],
      ['an unknown store', (file) => { file.sections[V2].stores.meta = []; }, /unknown: meta/],
      ['the experimental section without meta', (file) => { delete file.sections[V3].stores.meta; }, /missing: meta/],
      ['a store that is an object', (file) => { file.sections[V3].stores.settings = { theme: 'dark' }; }, /the store "settings" is not a list/],
      ['a pair with three items', (file) => { file.sections[V3].stores.settings[0].push('x'); }, /not a pair of a key and a value/],
      ['a key that is not text', (file) => { file.sections[V3].stores.settings[0][0] = 7; }, /not a pair of a key and a value/],
      ['an empty key', (file) => { file.sections[V3].stores.settings[0][0] = ''; }, /not a pair of a key and a value/],
      ['a repeated key', (file) => { file.sections[V3].stores.settings.splice(1, 0, [...file.sections[V3].stores.settings[0]]); }, /not in ascending order, or one is repeated/],
      ['keys out of order', (file) => { file.sections[V3].stores.settings.reverse(); }, /not in ascending order/],
      ['unknown member of the first version', (file) => { file.sections[V1].origin = 'x'; }, /The section "legacy-v1" must have exactly/],
      ['another storage of the first version', (file) => { file.sections[V1].storage = 'sessionStorage'; }, /names the storage "sessionStorage"/],
      ['an unknown record of the first version', (file) => { file.sections[V1].records['other.key'] = 'x'; }, /"other\.key" is not a record of the previous version/],
      ['a record of the first version that is not text', (file) => { file.sections[V1].records[V1_STATE_KEY] = { learnedPhrases: [] }; }, /is not text/],
      ['no record of the first version', (file) => { file.sections[V1].records = {}; }, /holds no record/]
    ];
    for (const [name, edit, pattern] of cases) {
      const file = await validFile();
      edit(file);
      const error = await refusal(file);
      expect(error.code, name).toBe('malformed');
      expect(error.message, name).toMatch(pattern);
    }
  });

  it('refuses a storage schema it does not know, older or newer, and a section with pronunciation records', async () => {
    for (const [product, version] of [[V2, 1], [V2, 3], [V3, 2], [V3, '1']] as const) {
      const file = await validFile((all) => { all[product].schemaVersion = version; });
      const error = await refusal(file);
      expect(error.code, `${product} ${version}`).toBe('unsupported-version');
      expect(error.product).toBe(product);
    }
    const reserved = await refusal(await validFile((all) => { all[V3].pronunciation = { attempts: [], hints: [] }; }));
    expect(reserved.code).toBe('unsupported-version');
    expect(reserved.message).toContain('holds pronunciation records');
    expect(reserved.message).toContain('does not leave them out');
  });
});

describeExperimental('backup validation: integrity of each section', () => {
  it('refuses a file in which one value was changed after it was made, and names the section', async () => {
    const edits: [string, (file: Json) => void][] = [
      [V3, (file) => { record(file.sections, V3, 'progress', 'learnedPhrases').push('phrase-added-later'); }],
      [V3, (file) => { file.sections[V3].stores.meta[0][1] = '2020-01-01T00:00:00.000Z'; }],
      [V2, (file) => { record(file.sections, V2, 'settings', 'theme'); setRecord(file.sections, V2, 'settings', 'theme', 'light'); }],
      [V2, (file) => { file.sections[V2].stores.userEntries.pop(); }],
      [V1, (file) => { file.sections[V1].records[V1_THEME_KEY] = 'light'; }],
      [V1, (file) => { file.sections[V1].records[V1_STATE_KEY] = V1_STATE.replace('phrase-101', 'phrase-999'); }]
    ];
    for (const [product, edit] of edits) {
      const file = await validFile();
      edit(file);
      const error = await refusal(file);
      expect(error.code).toBe('integrity');
      expect(error.product).toBe(product);
      expect(error.message).toContain(`The section "${product}" does not match its digest`);
    }
  });

  it('refuses one changed character anywhere in the text of a section', async () => {
    const text = JSON.stringify(await validFile());
    const start = text.indexOf('"sections"');
    const end = text.indexOf('"integrity"');
    let refused = 0;
    // Every 97th character of the sections: a letter becomes another letter, a digit another digit.
    for (let index = start + 20; index < end; index += 97) {
      const char = text[index];
      const other = /[a-y]/.test(char) ? String.fromCharCode(char.charCodeAt(0) + 1) : /[0-8]/.test(char) ? String(Number(char) + 1) : null;
      if (!other) continue;
      const error = await readBackup(bytesOf(text.slice(0, index) + other + text.slice(index + 1))).then(() => null, (reason: { code: string }) => reason);
      expect(error, `the change at ${index} (${char} to ${other}) was accepted`).not.toBeNull();
      refused += 1;
    }
    expect(refused).toBeGreaterThan(40);
  });

  it('swapping the digests of two sections is refused', async () => {
    const file = await validFile();
    [file.integrity.sections[V2], file.integrity.sections[V3]] = [file.integrity.sections[V3], file.integrity.sections[V2]];
    expect((await refusal(file)).code).toBe('integrity');
  });
});

describeExperimental('backup validation: every record, with a digest that matches', () => {
  const entryKey = (all: Json, product: string, index: number): string => all[product].stores.userEntries[index][0];
  const collectionKey = (all: Json, product: string): string => all[product].stores.userCollections[0][0];

  const cases: [string, (all: Json) => void, RegExp][] = [
    ['an unknown progress record', (all) => setRecord(all, V3, 'progress', 'learnedVerbs', []), /progress: "learnedVerbs" is not a record of this store/],
    ['a learned list that is not a list', (all) => setRecord(all, V3, 'progress', 'learnedPhrases', 'phrase-301'), /progress: "learnedPhrases" is not a list/],
    ['a learned list with a repeated identity', (all) => setRecord(all, V3, 'progress', 'learnedPhrases', ['phrase-301', 'phrase-301']), /progress: "learnedPhrases"/],
    ['a learned list with a number in it', (all) => setRecord(all, V2, 'progress', 'hiddenWords', ['word-204', 7]), /progress: "hiddenWords"/],
    ['a learned list with an empty identity', (all) => setRecord(all, V2, 'progress', 'favoriteBlocks', ['']), /progress: "favoriteBlocks"/],
    ['a selected Learn pass that is not text', (all) => setRecord(all, V3, 'progress', 'selectedLearnPassId', 5), /selected Learn pass is not a name/],
    ['a Learn pass under another key', (all) => setRecord(all, V3, 'learnPasses', 'pass-other', record(all, V3, 'learnPasses', 'pass-synthetic-3')), /the Learn pass "pass-other"/],
    ['a Learn pass without a description', (all) => { delete record(all, V3, 'learnPasses', 'pass-synthetic-3').description; }, /the Learn pass "pass-synthetic-3" is incomplete/],
    ['a Learn pass without its dates', (all) => { delete record(all, V2, 'learnPasses', 'pass-synthetic-2').createdAt; }, /the Learn pass "pass-synthetic-2"/],
    ['a Learn pass with an unknown member', (all) => { record(all, V3, 'learnPasses', 'pass-synthetic-3').owner = 'x'; }, /the Learn pass "pass-synthetic-3"/],
    ['a Learn pass with a name that reading would trim', (all) => { record(all, V3, 'learnPasses', 'pass-synthetic-3').name = ' padded '; }, /the Learn pass "pass-synthetic-3"/],
    ['a Learn pass that is text', (all) => setRecord(all, V3, 'learnPasses', 'pass-synthetic-3', 'a pass'), /the Learn pass "pass-synthetic-3"/],
    ['a deck position outside its sequence', (all) => { record(all, V3, 'flashcardSessions', 'all').index = 3; }, /the deck "all" is not a review sequence with a valid position/],
    ['a deck position that is not a whole number', (all) => { record(all, V3, 'flashcardSessions', 'all').index = 1.5; }, /the deck "all"/],
    ['a deck with a repeated card', (all) => { record(all, V2, 'flashcardSessions', 'all').order.push('phrase-207'); }, /the deck "all"/],
    ['a deck with an unknown member', (all) => { record(all, V2, 'flashcardSessions', 'all').shuffled = true; }, /the deck "all"/],
    ['a deck that is a list', (all) => setRecord(all, V2, 'flashcardSessions', 'all', ['phrase-207']), /the deck "all"/],
    ['an unknown preference', (all) => setRecord(all, V3, 'settings', 'telemetry', true), /settings: "telemetry" is not a preference/],
    ['a preference with a value of the wrong kind', (all) => setRecord(all, V3, 'settings', 'theme', 'purple'), /settings: "theme" has a value that the application does not accept/],
    ['a preference with a number as text', (all) => setRecord(all, V2, 'settings', 'speechRepeatCount', '20'), /settings: "speechRepeatCount"/],
    ['a preference that is null', (all) => setRecord(all, V2, 'settings', 'showHiddenWords', null), /settings: "showHiddenWords"/],
    ['a collection under another key', (all) => { all[V3].stores.userCollections[0][0] = 'user:99999999-0000-4000-8000-000000000000'; }, /collections: /],
    ['a collection without its import information', (all) => { delete record(all, V3, 'userCollections', collectionKey(all, V3)).lastImport; }, /collections: A saved collection has invalid import information/],
    ['a collection with an unknown member', (all) => { record(all, V3, 'userCollections', collectionKey(all, V3)).owner = 'x'; }, /has a missing or unknown member/],
    ['import information with an unknown member', (all) => { record(all, V3, 'userCollections', collectionKey(all, V3)).lastImport.source = 'x'; }, /has a missing or unknown member/],
    ['a collection with a name that reading would trim', (all) => { record(all, V2, 'userCollections', collectionKey(all, V2)).name = '  padded  '; }, /a name or description that reading would change/],
    ['a collection without entries', (all) => { all[V2].stores.userEntries = []; }, /collections: A saved collection has invalid entry positions or size/],
    ['an entry of a collection that is not in the backup', (all) => { all[V3].stores.userCollections = []; }, /collections: A saved vocabulary entry has an invalid collection/],
    ['an entry with an unknown member', (all) => { record(all, V3, 'userEntries', entryKey(all, V3, 0)).note = 'x'; }, /collections: Entry contains an unsupported field/],
    ['an entry without a translation', (all) => { record(all, V3, 'userEntries', entryKey(all, V3, 0)).translation = ''; }, /collections: Translation is required/],
    ['an entry with text that reading would trim', (all) => { record(all, V3, 'userEntries', entryKey(all, V3, 0)).english = 'a made-up phrase  '; }, /userEntries: the entry .* has a form that reading would change/],
    ['an entry without its topic member', (all) => { delete record(all, V2, 'userEntries', entryKey(all, V2, 1)).topic; }, /has a form that reading would change/],
    ['two entries at one position', (all) => { record(all, V2, 'userEntries', entryKey(all, V2, 1)).position = 0; }, /collections: A saved collection has invalid entry positions/],
    ['a word linked to a phrase that is missing', (all) => { all[V3].stores.userEntries.shift(); record(all, V3, 'userEntries', entryKey(all, V3, 0)).position = 0; }, /collections: Word .* links to a missing phrase/],
    ['meta without the creation time', (all) => setRecord(all, V3, 'meta', 'createdAt'), /meta: expected exactly the records/],
    ['meta with an unknown record', (all) => setRecord(all, V3, 'meta', 'lastBackupAt', '2026-11-25T14:03:22.123Z'), /meta: expected exactly the records/],
    ['meta with another schema', (all) => setRecord(all, V3, 'meta', 'schema', 2), /meta: the recorded schema is not the schema of the section/],
    ['meta with a creation time that is not a time', (all) => setRecord(all, V3, 'meta', 'createdAt', 'long ago'), /meta: the creation time is not a time/],
    ['a state of the first version that is not JSON', (all) => { all[V1].records[V1_STATE_KEY] = '{"learnedPhrases":['; }, /is not JSON text/],
    ['a state of the first version that is a list', (all) => { all[V1].records[V1_STATE_KEY] = '[]'; }, /is not a JSON object/],
    ['a theme of the first version that it never writes', (all) => { all[V1].records[V1_THEME_KEY] = 'sepia'; }, /is not one of its three themes/]
  ];

  it.each(cases)('refuses %s', async (_name, edit, pattern) => {
    const error = await refusal(await validFile(edit));
    expect(error.code).toBe('invalid-record');
    expect(error.message).toMatch(pattern);
    expect([V3, V2, V1]).toContain(error.product);
  });

  it('applies the same checks to one section, as the export does before it makes a file', async () => {
    const all = sections();
    for (const product of [V3, V2, V1] as const) expect(checkSection(product, all[product])).toBe(all[product]);
    setRecord(all, V2, 'settings', 'theme', 'purple');
    expect(() => checkSection(V2, all[V2])).toThrow(/settings: "theme"/);
    // A section is never judged by the rules of another product.
    expect(() => checkSection(V3, sections()[V2])).toThrow(/names the storage "eng-trainer-v2", not "eng-trainer-v3"/);
    expect(() => checkSection(V2, sections()[V3])).toThrow(/names the storage "eng-trainer-v3", not "eng-trainer-v2"/);
  });
});
