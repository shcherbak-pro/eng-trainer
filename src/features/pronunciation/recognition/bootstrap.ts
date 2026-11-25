/**
 * Starts the recognizer's Worker so that the page's Content-Security-Policy governs it
 * (ENG-V3-02, stage A).
 *
 * A Worker that is loaded from an address has the policy of that address's response.
 * GitHub Pages sends no policy header, so such a Worker would have none and could reach
 * any host. A Worker started from a `blob:` address inherits the policy of the page
 * that created it, including `connect-src 'self'`.
 *
 * The blob holds one statement: a dynamic import of the real Worker module from this
 * application's own origin. A dynamic import is a script request, which the inherited
 * `script-src 'self'` allows. A static import would be a worker request, and allowing
 * that would also allow Workers loaded from an address, which are not confined. The
 * page's policy therefore says `worker-src blob:` and nothing else.
 *
 * This is the only place that creates a Worker. Chromium and Firefox apply the policy
 * in this arrangement (see docs/architecture/PRONUNCIATION-PROTOTYPE.md). For a browser
 * where that is not shown, no such claim is made.
 */
export type RecognizerWorker = Pick<Worker, 'postMessage' | 'terminate' | 'addEventListener' | 'removeEventListener'>;

/** Whether this browser can start a Worker from a blob: address at all. */
export function canStartWorker(): boolean {
  return typeof Worker !== 'undefined' && typeof Blob !== 'undefined' && typeof URL.createObjectURL === 'function';
}

/** How long the blob's address is kept. The Worker fetches it right after it is created. */
const RELEASE_AFTER_MS = 10_000;

export function bootstrapSource(moduleUrl: string): string {
  const absolute = JSON.stringify(new URL(moduleUrl, globalThis.location.href).href);
  return `import(${absolute}).catch((error) => self.postMessage({ type: 'bootstrap-failed', message: String(error) }));`;
}

export function startRecognizerWorker(moduleUrl: string): RecognizerWorker {
  const address = URL.createObjectURL(new Blob([bootstrapSource(moduleUrl)], { type: 'text/javascript' }));
  const worker = new Worker(address, { type: 'module', name: 'eng-trainer-recognizer' });
  setTimeout(() => URL.revokeObjectURL(address), RELEASE_AFTER_MS);
  return worker;
}
