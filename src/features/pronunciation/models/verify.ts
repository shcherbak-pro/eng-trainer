import type { PinnedFile } from './pinned';

/** The bytes are not the pinned file: wrong size or wrong SHA-256. Such bytes are never cached or used. */
export class IntegrityError extends Error {
  constructor(
    readonly file: string,
    detail: string
  ) {
    super(`${file}: ${detail}`);
    this.name = 'IntegrityError';
  }
}

export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Resolves only when `bytes` is exactly the pinned file. The size is compared first: it is cheap. */
export async function assertPinned(file: PinnedFile, bytes: ArrayBuffer | Uint8Array): Promise<void> {
  if (bytes.byteLength !== file.bytes) throw new IntegrityError(file.id, `has ${bytes.byteLength} bytes, the pinned file has ${file.bytes}`);
  const found = await sha256Hex(bytes);
  if (found !== file.sha256) throw new IntegrityError(file.id, 'does not have the pinned SHA-256');
}
