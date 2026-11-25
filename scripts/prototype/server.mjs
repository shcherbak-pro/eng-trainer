// The local server of the pronunciation prototype (ENG-V3-02, stage A).
//
//   npm run prototype:serve            http://127.0.0.1:4173/eng-trainer/v3/#pronunciation
//
// It serves two things from this computer, to this computer only:
//
//   .site-test/                the local assembly of all three products (npm run assemble:test)
//   .local/models/<model id>/  the pinned model files (npm run prototype:model), at
//                              <site base>v3/models/<model id>/ and nowhere else
//
// It behaves like GitHub Pages where that matters for the checks: static files only, and
// no Content-Security-Policy, COOP or COEP response header. Whatever confines the page
// and its Worker therefore comes from the page itself.
//
// The model files exist only here. No build contains them, and the published site does
// not either. Open the address in a disposable browser profile with made-up data.
import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEST_SITE_DIR } from '../generated-dirs.mjs';
import { EXPERIMENTAL_PRODUCT, loadSiteConfig, repoRoot, routeOf, routeUrl } from '../site-config.mjs';
import { localModelDir, mismatch, readPinned } from './model-files.mjs';

export const DEFAULT_PORT = 4173;
/** This computer only. The server is never reachable from another machine. */
export const HOST = '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream'
};

/** `rest` below `base`, or null when it would leave it. */
function inside(base, rest) {
  const full = normalize(join(base, rest));
  return full === base || full.startsWith(base + sep) ? full : null;
}

/**
 * The request handler. `intercept` lets a test answer a request itself (to inject a
 * fault) or change a file's bytes on the way out; the plain server passes none.
 *
 *   intercept({ request, response, path, file }) -> true when it answered the request
 */
export function createPrototypeHandler({ root = repoRoot, siteDir = TEST_SITE_DIR, intercept } = {}) {
  const site = loadSiteConfig();
  const pinned = readPinned(root);
  const sitePath = join(root, ...siteDir.split('/'));
  const modelPath = join(root, ...localModelDir(pinned).split('/'));
  const modelMount = `${routeUrl(site, routeOf(site, EXPERIMENTAL_PRODUCT))}models/${pinned.model.id}/`;
  const modelFiles = new Set(pinned.model.files.map((file) => file.path));

  function resolve(path) {
    if (path.startsWith(modelMount)) {
      const name = path.slice(modelMount.length);
      // Only the pinned files are served from the model folder, by their exact names.
      return modelFiles.has(name) ? inside(modelPath, name) : null;
    }
    if (!path.startsWith(site.base)) return null;
    const rest = path.slice(site.base.length);
    const file = inside(sitePath, rest.endsWith('/') || rest === '' ? `${rest}index.html` : rest);
    return file && existsSync(file) && statSync(file).isFile() ? file : null;
  }

  return async function handle(request, response) {
    let path;
    try {
      path = decodeURIComponent(new URL(request.url, `http://${HOST}`).pathname);
    } catch {
      response.writeHead(400).end('bad request');
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const file = path.includes('\0') ? null : resolve(path);
    if (intercept && (await intercept({ request, response, path, file }))) return;
    if (!file || !existsSync(file)) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end(`Not found. The applications are below ${site.base}`);
      return;
    }
    // As GitHub Pages answers: a short cache lifetime, and no policy header of any kind.
    response.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Content-Length': statSync(file).size, 'Cache-Control': 'max-age=600' });
    if (request.method === 'HEAD') response.end();
    else createReadStream(file).pipe(response);
  };
}

/** What the prototype needs on disk, as a list of problems with the command that fixes each. */
export function missingInputs(root = repoRoot, siteDir = TEST_SITE_DIR) {
  const site = loadSiteConfig();
  const pinned = readPinned(root);
  const problems = [];
  const entry = join(root, ...siteDir.split('/'), ...routeOf(site, EXPERIMENTAL_PRODUCT).path.split('/'), 'index.html');
  if (!existsSync(entry)) problems.push(`The local assembly is missing (${siteDir}/). Run: npm run prototype:build`);
  for (const file of pinned.model.files) {
    const path = join(root, ...localModelDir(pinned).split('/'), ...file.path.split('/'));
    if (!existsSync(path)) problems.push(`The model file ${file.path} is missing. Run: npm run prototype:model`);
    else if (statSync(path).size !== file.bytes) problems.push(`The model file ${file.path} is not the pinned one. Run: npm run prototype:model`);
  }
  return problems;
}

/** Every local model file, checked against the pinned list byte for byte. Slow: it reads 32 MB. */
export function verifyLocalModel(root = repoRoot) {
  const pinned = readPinned(root);
  return pinned.model.files.map((file) => mismatch(file, readFileSync(join(root, ...localModelDir(pinned).split('/'), ...file.path.split('/'))))).filter(Boolean);
}

export function startPrototypeServer({ port = DEFAULT_PORT, ...options } = {}) {
  const server = createServer(createPrototypeHandler(options));
  return new Promise((resolveStart, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, () => resolveStart(server));
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  const port = Number(process.argv[2] ?? DEFAULT_PORT);
  try {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('The port must be a number from 1024 to 65535.');
    const problems = [...missingInputs()];
    if (!problems.length) problems.push(...verifyLocalModel().map((problem) => `${problem}. Run: npm run prototype:model`));
    if (problems.length) throw new Error(problems.join('\n'));
    await startPrototypeServer({ port });
    const site = loadSiteConfig();
    const address = `http://${HOST}:${port}${routeUrl(site, routeOf(site, EXPERIMENTAL_PRODUCT))}#pronunciation`;
    console.log(`Pronunciation prototype: ${address}`);
    console.log('Open it in a disposable browser profile, with made-up learning data only. For example:');
    console.log(`  chrome --user-data-dir=<a new, empty folder> ${address}`);
    console.log(`  firefox -profile <a new, empty folder> -no-remote ${address}`);
    console.log('Served to this computer only. Press Ctrl+C to stop.');
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
