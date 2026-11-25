import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { declaredPolicy, inlineScriptHashes, pagePolicy } from './pronunciation-policy.mjs';
import { repoRoot } from './site-config.mjs';

// The Content-Security-Policy of the experimental entry page (ENG-V3-02, stage A).
// The built page is compared with it by the product gates; these tests pin the text itself.

const HASH = "'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='";

test('the policy allows this origin only: no other host for requests, scripts, styles, fonts or images', () => {
  const directives = Object.fromEntries(pagePolicy([HASH]).split('; ').map((directive) => [directive.split(' ')[0], directive.split(' ').slice(1)]));
  assert.deepEqual(Object.keys(directives), ['default-src', 'script-src', 'worker-src', 'connect-src', 'style-src', 'img-src', 'font-src', 'media-src', 'object-src', 'frame-src', 'base-uri', 'form-action']);
  assert.deepEqual(directives['default-src'], ["'self'"]);
  assert.deepEqual(directives['connect-src'], ["'self'"]);
  assert.deepEqual(directives['script-src'], ["'self'", HASH, "'wasm-unsafe-eval'"]);
  assert.deepEqual(directives['style-src'], ["'self'", "'unsafe-inline'"]);
  assert.deepEqual(directives['img-src'], ["'self'", 'data:']);
  assert.deepEqual(directives['font-src'], ["'self'"]);
  for (const name of ['media-src', 'object-src', 'frame-src', 'form-action']) assert.deepEqual(directives[name], ["'none'"]);
  // No source with a host, a wildcard or a scheme that reaches the network.
  assert.doesNotMatch(pagePolicy([HASH]), /https?:|wss?:|\*|\/\/|'unsafe-eval'|'strict-dynamic'/);
  assert.doesNotMatch(directives['script-src'].join(' '), /'unsafe-inline'|blob:|data:/);
});

test('a Worker may be started from a blob: address only, so every Worker inherits this policy', () => {
  // "worker-src 'self'" would allow a Worker loaded from an address. Such a Worker has the policy
  // of its own response, and a static host sends none: it could reach any host.
  assert.match(`; ${pagePolicy([])};`, /; worker-src blob:;/);
});

test('inline scripts are allowed by hash, in page order; scripts with an address and empty ones need none', () => {
  const first = '\n      (() => { document.documentElement.dataset.theme = "dark"; })();\n    ';
  const second = 'console.log("second")';
  const html = `<head><script>${first}</script><script type="module" crossorigin src="/eng-trainer/v3/assets/index-abc.js"></script><script>  </script><script type="text/plain">${second}</script></head>`;
  const hash = (text) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;
  assert.deepEqual(inlineScriptHashes(html), [hash(first), hash(second)]);
  assert.deepEqual(inlineScriptHashes('<head><script type="module" src="/a.js"></script></head>'), []);
  // One changed character is another hash.
  assert.notEqual(inlineScriptHashes(html.replace('"dark"', '"dark" '))[0], hash(first));
});

test('the declared policy is read from the meta element, and its absence is noticed', () => {
  const policy = pagePolicy([HASH]);
  assert.equal(declaredPolicy(`<head><meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" /></head>`), policy);
  assert.equal(declaredPolicy('<head><meta charset="UTF-8" /></head>'), null);
});

test('the application page has exactly one inline script: the one that sets the theme', async () => {
  const html = await readFile(join(repoRoot, 'index.html'), 'utf8');
  assert.equal(inlineScriptHashes(html).length, 1);
  assert.match(html, /<script>\s*\/\/ Applies the system theme before the app starts\./);
  // The source page declares no policy itself: the stable build must stay as released.
  assert.equal(declaredPolicy(html), null);
});

test('only the experimental build gets the policy, and only when it is built', async () => {
  const config = await readFile(join(repoRoot, 'vite.config.ts'), 'utf8');
  assert.match(config, /product\.id === EXPERIMENTAL_PRODUCT \? \[experimentalEntryPage\(\), experimentalPagePolicy\(\)\] : \[withoutExperimentalSources\(\)\]/);
  assert.match(config, /name: 'eng-trainer:experimental-page-policy',\s+apply: 'build',/);
  assert.match(config, /name: 'eng-trainer:without-experimental-sources',\s+apply: 'build',/);
});
