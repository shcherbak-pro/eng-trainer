// The Content-Security-Policy of the experimental product's entry page (ENG-V3-02, stage A).
//
// One place holds the text. vite.config.ts writes it into the built page, and the product
// gates (scripts/product-gates.mjs) compare the built page with it.
//
// What each part is for:
//
//   default-src 'self'        everything not named below comes from this origin only
//   script-src                this origin's scripts, the one inline theme script by its
//                             hash, and WebAssembly ('wasm-unsafe-eval') for the recognizer
//   worker-src blob:          a Worker may be started from a blob: address only. Such a
//                             Worker inherits this policy. A Worker loaded from an
//                             address would not, so it is not allowed at all.
//   connect-src 'self'        fetch, XMLHttpRequest, WebSocket and EventSource reach this
//                             origin only, on the page and in the recognizer's Worker
//   style-src 'unsafe-inline' the application sets style attributes
//   media-src, object-src, frame-src 'none', form-action 'none', base-uri 'self'
//
// A policy in a meta element cannot set frame-ancestors, a sandbox or a report address.
import { createHash } from 'node:crypto';

/** The hash source of every inline script of a page, in the order they appear. */
export function inlineScriptHashes(html) {
  const hashes = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (/\bsrc\s*=/.test(match[1]) || match[2].trim() === '') continue;
    hashes.push(`'sha256-${createHash('sha256').update(match[2], 'utf8').digest('base64')}'`);
  }
  return hashes;
}

/** The policy text. `scriptHashes` are the hash sources of the page's inline scripts. */
export function pagePolicy(scriptHashes) {
  return [
    "default-src 'self'",
    `script-src 'self' ${[...scriptHashes, "'wasm-unsafe-eval'"].join(' ')}`,
    'worker-src blob:',
    "connect-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "media-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'self'",
    "form-action 'none'"
  ].join('; ');
}

/** The policy that a built page declares in its meta element, or null. */
export function declaredPolicy(html) {
  const match = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"\s*\/?>/.exec(html);
  return match ? match[1] : null;
}
