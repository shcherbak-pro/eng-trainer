/**
 * Where the prototype may download a speech model (ENG-V3-02, stage A).
 *
 * Until the Data Safety Gate has passed, no model cache may be created in a browser
 * profile that can hold real learning data. Three things keep it that way:
 *
 * 1. The experimental product is not published (site.config.json).
 * 2. Its build contains no model file. Only the local prototype server adds them.
 * 3. This check: the download is offered only on a page of this computer's own
 *    loopback address, where the prototype server runs.
 *
 * The application cannot tell a disposable browser profile from a personal one. Using a
 * disposable profile is the tester's part; the screen says so.
 */
export function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}
