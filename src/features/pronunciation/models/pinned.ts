import pinned from './pinned-files.json';

/**
 * The files of the speech recognizer, pinned by size and SHA-256 (ENG-V3-02, stage A).
 *
 * pinned-files.json is the committed list. Nothing outside it is downloaded, cached or
 * loaded, and a file is used only after its bytes matched its entry. The model revision
 * is a full commit identifier: a branch or tag name can move, so it is refused here.
 *
 * The same JSON file is read by the Node scripts (scripts/prototype/), so the browser
 * and the developer tools cannot disagree about a hash.
 */
export type PinnedFile = {
  /** Identity inside an installation, for example "model/config.json". Also the end of its cache key. */
  id: string;
  kind: 'model' | 'runtime';
  /** Path below the model folder, or the runtime's file name. */
  path: string;
  bytes: number;
  sha256: string;
};

const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
/** Lower-case path segments joined by "/": no "..", no leading "/", no backslash, no query. */
const SAFE_PATH = /^[a-z0-9_]+(?:[.-][a-z0-9_]+)*(?:\/[a-z0-9_]+(?:[.-][a-z0-9_]+)*)*$/;
const SAFE_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

function fail(message: string): never {
  throw new Error(`pinned-files.json: ${message}`);
}

function checkedFile(kind: PinnedFile['kind'], file: { path: string; bytes: number; sha256: string }): PinnedFile {
  if (!SAFE_PATH.test(file.path)) fail(`"${file.path}" is not a plain relative path`);
  if (!Number.isInteger(file.bytes) || file.bytes <= 0) fail(`"${file.path}" needs its exact size in bytes`);
  if (!SHA256.test(file.sha256)) fail(`"${file.path}" needs a SHA-256 of 64 lower-case hex digits`);
  return { id: `${kind}/${file.path}`, kind, path: file.path, bytes: file.bytes, sha256: file.sha256 };
}

if (!COMMIT.test(pinned.model.revision)) fail('the model revision must be a full commit identifier, not a branch or a tag');
if (!SAFE_ID.test(pinned.model.id) || !pinned.model.id.endsWith(`-${pinned.model.revision.slice(0, 12)}`)) fail('the model id must end with the first 12 digits of its revision');
if (pinned.version !== `${pinned.model.id}-ort-${pinned.runtime.version}`) fail('the version must be "<model id>-ort-<runtime version>"');

/** Names one installation: the model revision together with the runtime version. */
export const MODEL_VERSION: string = pinned.version;

export const MODEL = {
  id: pinned.model.id,
  name: pinned.model.name,
  repository: pinned.model.repository,
  revision: pinned.model.revision,
  licence: pinned.model.licence
} as const;

export const RUNTIME = {
  package: pinned.runtime.package,
  version: pinned.runtime.version,
  licence: pinned.runtime.licence
} as const;

/** Every file of an installation, small files first, so a server without the model is noticed at once. */
export const PINNED_FILES: readonly PinnedFile[] = Object.freeze([
  ...pinned.model.files.map((file) => checkedFile('model', file)),
  checkedFile('runtime', pinned.runtime.file)
]);

if (new Set(PINNED_FILES.map((file) => file.id)).size !== PINNED_FILES.length) fail('a file is listed twice');

/** The exact size of the download, as the consent text states it. */
export const TOTAL_BYTES: number = PINNED_FILES.reduce((sum, file) => sum + file.bytes, 0);

/** One installation: its name and its files. The application has exactly one, `PINNED`. */
export type PinnedSet = { readonly version: string; readonly files: readonly PinnedFile[] };

export const PINNED: PinnedSet = Object.freeze({ version: MODEL_VERSION, files: PINNED_FILES });

export function pinnedFile(id: string): PinnedFile {
  const file = PINNED_FILES.find((item) => item.id === id);
  if (!file) throw new Error(`"${id}" is not a pinned file`);
  return file;
}
