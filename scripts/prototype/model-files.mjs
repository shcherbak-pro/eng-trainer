// The pinned files of the speech recognizer, for the developer tools (ENG-V3-02, stage A).
//
// The list itself is src/features/pronunciation/models/pinned-files.json, the same file
// the application compiles in. These tools download the model to a local, ignored folder
// and serve it to the prototype. They are never part of a build or of the published site.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../site-config.mjs';

export const PINNED_LIST_FILE = 'src/features/pronunciation/models/pinned-files.json';
/** Downloaded model files live here. `.local/` is ignored by Git. */
export const LOCAL_MODELS_DIR = '.local/models';
export const MODEL_HUB = 'https://huggingface.co';

const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const SAFE_PATH = /^[a-z0-9_]+(?:[.-][a-z0-9_]+)*(?:\/[a-z0-9_]+(?:[.-][a-z0-9_]+)*)*$/;
const REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Reads and checks the pinned list. The rules are those of src/features/pronunciation/models/pinned.ts. */
export function readPinned(root = repoRoot) {
  const pinned = JSON.parse(readFileSync(join(root, PINNED_LIST_FILE), 'utf8'));
  const fail = (message) => {
    throw new Error(`${PINNED_LIST_FILE}: ${message}`);
  };
  const { model, runtime } = pinned;
  if (!REPOSITORY.test(model?.repository ?? '')) fail('the model repository must be "<owner>/<name>"');
  // A branch or tag name can move to other files. Only a full commit identifier is accepted.
  if (!COMMIT.test(model.revision ?? '')) fail('the model revision must be a full commit identifier, not a branch or a tag');
  if (typeof model.id !== 'string' || !model.id.endsWith(`-${model.revision.slice(0, 12)}`)) fail('the model id must end with the first 12 digits of its revision');
  if (pinned.version !== `${model.id}-ort-${runtime?.version}`) fail('the version must be "<model id>-ort-<runtime version>"');
  for (const file of [...(model.files ?? []), runtime.file]) {
    if (!SAFE_PATH.test(file?.path ?? '')) fail(`"${file?.path}" is not a plain relative path`);
    if (!Number.isInteger(file.bytes) || file.bytes <= 0) fail(`"${file.path}" needs its exact size in bytes`);
    if (!SHA256.test(file.sha256 ?? '')) fail(`"${file.path}" needs a SHA-256 of 64 lower-case hex digits`);
  }
  if (!model.files.length) fail('the model has no files');
  if (new Set(model.files.map((file) => file.path)).size !== model.files.length) fail('a model file is listed twice');
  return pinned;
}

/** The local folder of the downloaded model, relative to the repository, with "/". */
export const localModelDir = (pinned) => `${LOCAL_MODELS_DIR}/${pinned.model.id}`;

/** The one address a model file is downloaded from: the hub, at the pinned commit. */
export const hubUrl = (pinned, file) => `${MODEL_HUB}/${pinned.model.repository}/resolve/${pinned.model.revision}/${file.path}`;

/**
 * Whether a download may be requested from this address: HTTPS, on the hub or on one of
 * its own storage hosts. The hub answers a file request with a redirect to its storage;
 * a redirect to any other host is not followed.
 */
export function isHubAddress(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === 'https:' && parsed.username === '' && parsed.port === '' && /^(?:(?:[a-z0-9-]+\.)*huggingface\.co|(?:[a-z0-9-]+\.)+hf\.co)$/.test(parsed.hostname);
}

/** Why `bytes` is not the pinned file, or null when it is. */
export function mismatch(file, bytes) {
  if (bytes.length !== file.bytes) return `${file.path} has ${bytes.length} bytes, the pinned file has ${file.bytes}`;
  if (sha256(bytes) !== file.sha256) return `${file.path} does not have the pinned SHA-256`;
  return null;
}
