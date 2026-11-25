/**
 * Takes the network interfaces away from the recognizer's Worker (ENG-V3-02, stage A).
 *
 * The Worker needs no network: its files come from the model cache, and samples and
 * text travel by message. This module is the Worker's first import, so it runs before
 * the runtime library and before the Worker's own code. After it, `fetch`,
 * `XMLHttpRequest`, `WebSocket`, `EventSource`, `WebTransport` and `importScripts`
 * throw, also for the library.
 *
 * This is a second boundary, written in JavaScript: it stops code that uses these names
 * after this module ran. It cannot stop a dynamic `import()`, which is syntax. The
 * browser-enforced boundary is the page policy that the Worker inherits (bootstrap.ts).
 */
export const BLOCKED_INTERFACES = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'WebTransport', 'importScripts'] as const;

export function lockDownNetwork(scope: object): void {
  for (const name of BLOCKED_INTERFACES) {
    // A function that also fails as a constructor: `new WebSocket(...)` throws the same error.
    const blocked = function blockedNetworkInterface(): never {
      throw new Error(`The recognizer Worker makes no network request: "${name}" is not available.`);
    };
    Object.defineProperty(scope, name, { value: blocked, writable: false, configurable: false, enumerable: false });
  }
}

// Only a Worker is locked down: importing this file on a page or in a test changes nothing.
const scope = globalThis as { WorkerGlobalScope?: unknown };
if (typeof scope.WorkerGlobalScope !== 'undefined') lockDownNetwork(globalThis);
