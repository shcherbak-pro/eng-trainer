// Browser acceptance test of the pronunciation prototype (ENG-V3-02, stage A).
//
// It runs the built experimental product in a real browser, on a server that sends no
// policy header, as GitHub Pages does. Every browser profile is new and disposable, and
// all learning data in it is made up by this script.
//
//   npm run prototype:build
//   npm run prototype:model
//   node scripts/acceptance/pronunciation.mjs <chromium|firefox> --audio <clip.wav> --expect "<the words in the clip>" [--out <result.json>]
//
// The clip is synthetic speech: 16 kHz, mono, 16-bit WAV, one phrase of 3 to 6 seconds
// (scripts/acceptance/make-speech.ps1 makes one with a Windows voice).
//
// Playwright is not a dependency of this repository. Name an installed copy:
//   PROBE_PLAYWRIGHT=<folder of a "playwright" package>   and, if needed, PLAYWRIGHT_BROWSERS_PATH
//
// Parts:
//   A  network boundary of the page and of the recognizer's Worker
//   B  the installer under injected faults
//   C  install, record, read the text, with the network cut; retry; reload; delete the model
//   D  release of the microphone on stop, cancel, hidden page and leaving the screen
//   E  the other screens and the stable product load no speech code
//   F  waits that are ended (permission, audio device, recorder script) and a Worker that fails
//
// It exits with 1 when a check fails. It changes no tracked file and no build.
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, resolve } from 'node:path';
import { declaredPolicy, inlineScriptHashes, pagePolicy } from '../pronunciation-policy.mjs';
import { readPinned } from '../prototype/model-files.mjs';
import { HOST, createPrototypeHandler, missingInputs, verifyLocalModel } from '../prototype/server.mjs';

// ---- Arguments -----------------------------------------------------------------------

const [engine, ...rest] = process.argv.slice(2);
const option = (name) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined);
const audioFile = option('--audio');
const expectedWords = option('--expect');
const outFile = option('--out');
if (!['chromium', 'firefox'].includes(engine) || !audioFile || !expectedWords || !process.env.PROBE_PLAYWRIGHT) {
  console.error('Usage: PROBE_PLAYWRIGHT=<playwright package> node scripts/acceptance/pronunciation.mjs <chromium|firefox> --audio <clip.wav> --expect "<words>" [--out <result.json>]');
  process.exit(2);
}
const problems = [...missingInputs(), ...verifyLocalModel()];
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(2);
}

const playwright = createRequire(import.meta.url)(process.env.PROBE_PLAYWRIGHT);
const pinned = readPinned();
const clip = readFileSync(resolve(audioFile));
const clipSeconds = (clip.length - 44) / 2 / 16000;
const words = (text) => text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim().split(/\s+/).join(' ');

// ---- Results --------------------------------------------------------------------------

const checks = [];
function check(id, title, pass, detail = '') {
  checks.push({ id, title, pass: Boolean(pass), detail: String(detail).slice(0, 600) });
  console.log(`${pass ? 'pass' : 'FAIL'}  ${id}  ${title}${pass ? '' : `\n        ${String(detail).slice(0, 600)}`}`);
}
const notRun = [];

// ---- Servers --------------------------------------------------------------------------

const BASE = '/eng-trainer/v3/';
const MODEL_MOUNT = `${BASE}models/${pinned.model.id}/`;
const WORKER_FILE = /^\/eng-trainer\/v3\/assets\/recognizer\.worker-[\w-]+\.js$/;
const SPEECH_FILE = /recognizer\.worker-|pcm-collector\.worklet-|PronunciationPage-|\.wasm$|\/models\//;

/** What the application's server was asked for, in order. */
const appLog = [];
/** What the second origin, which the application must never reach, was asked for. */
const forbiddenLog = [];
/** The fault the server injects, if any: { file, kind }. */
let fault = null;
/** Whether the Worker file is served with the boundary probe around it. */
let probeWorker = false;
/** Whether the Worker file is served with a fault after it: it throws when it is asked to recognize. */
let workerFault = false;
let forbiddenOrigin = '';

/**
 * The probe that the test server puts around the real Worker file. The first line runs
 * before the Worker's own first statement, which takes the network interfaces away, and
 * keeps the browser's own ones. The rest runs after the Worker module and tries each of
 * them against the forbidden origin. So it tests what the browser enforces, not what the
 * application's own lock-down does, and then it tests the lock-down as well.
 */
const probeBefore = 'const __pristine = { fetch: self.fetch.bind(self), XMLHttpRequest: self.XMLHttpRequest, WebSocket: self.WebSocket, EventSource: self.EventSource, Worker: self.Worker };\n';
const probeAfter = (forbidden, own) => `
;(async () => {
  const attempt = async (run) => { try { return { reached: true, detail: String(await run()).slice(0, 80) }; } catch (error) { return { reached: false, detail: String(error && error.message || error).slice(0, 160) }; } };
  const xhr = (url) => new Promise((resolve, reject) => { const r = new __pristine.XMLHttpRequest(); r.open('GET', url); r.onload = () => resolve('status ' + r.status); r.onerror = () => reject(new Error('xhr error')); r.send(); });
  const socket = (url) => new Promise((resolve, reject) => { const s = new __pristine.WebSocket(url); s.onopen = () => resolve('open'); s.onerror = () => reject(new Error('websocket error')); setTimeout(() => reject(new Error('websocket timeout')), 1500); });
  const events = (url) => new Promise((resolve, reject) => { if (!__pristine.EventSource) { reject(new Error('EventSource is not defined in this Worker')); return; } const s = new __pristine.EventSource(url); s.onopen = () => { s.close(); resolve('open'); }; s.onerror = () => { s.close(); reject(new Error('eventsource error')); }; setTimeout(() => { s.close(); reject(new Error('eventsource timeout')); }, 1500); });
  const nested = () => new Promise((resolve, reject) => { let w; try { w = new __pristine.Worker(${JSON.stringify(own)} + '/eng-trainer/v3/assets/nested-probe.js', { type: 'module' }); } catch (error) { reject(error); return; } w.onmessage = () => resolve('nested Worker ran'); w.onerror = () => reject(new Error('nested Worker refused')); setTimeout(() => reject(new Error('nested Worker: no answer')), 1500); });
  const F = ${JSON.stringify(forbidden)};
  const result = {
    location: self.location.href.slice(0, 5),
    browser: {
      fetch: await attempt(async () => 'status ' + (await __pristine.fetch(F + '/worker-fetch')).status),
      xhr: await attempt(() => xhr(F + '/worker-xhr')),
      websocket: await attempt(() => socket(F.replace('http', 'ws') + '/worker-websocket')),
      eventsource: await attempt(() => events(F + '/worker-eventsource')),
      import: await attempt(async () => JSON.stringify(await import(F + '/worker-module.js'))),
      nestedWorker: await attempt(nested)
    },
    ownOrigin: await attempt(async () => 'status ' + (await __pristine.fetch(${JSON.stringify(own)} + '/eng-trainer/v3/index.html')).status),
    lockdown: {
      fetch: await attempt(() => self.fetch(${JSON.stringify(own)} + '/eng-trainer/v3/index.html')),
      xhr: await attempt(() => new self.XMLHttpRequest()),
      websocket: await attempt(() => new self.WebSocket(F.replace('http', 'ws'))),
      eventsource: await attempt(() => new self.EventSource(F)),
      importScripts: await attempt(() => self.importScripts(F + '/x.js'))
    }
  };
  new BroadcastChannel('acceptance-probe').postMessage(result);
})();
`;

function intercept({ request, response, path, file }) {
  appLog.push({ path, at: Date.now() });
  if (path === `${BASE}assets/nested-probe.js`) {
    response.writeHead(200, { 'Content-Type': 'text/javascript' }).end("self.postMessage('ran');");
    return true;
  }
  if (probeWorker && WORKER_FILE.test(path) && file) {
    const body = Buffer.from(probeBefore + readFileSync(file, 'utf8') + probeAfter(forbiddenOrigin, `http://${request.headers.host}`));
    response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' }).end(body);
    return true;
  }
  if (workerFault && WORKER_FILE.test(path) && file) {
    // The real Worker file, and after it a listener that throws an uncaught error as soon as a
    // recording arrives, while the Worker's own listener starts to recognize it. The page sees
    // that as the Worker's "error" event.
    const injected = "\n;self.addEventListener('message', (event) => { if (event.data && event.data.type === 'transcribe') throw new Error('injected Worker failure'); });\n";
    const body = Buffer.from(readFileSync(file, 'utf8') + injected);
    response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' }).end(body);
    return true;
  }
  if (!fault || path !== `${MODEL_MOUNT}${fault.file}` || !file) return false;
  const bytes = readFileSync(file);
  if (fault.kind === 'missing') {
    response.writeHead(404).end('not found');
  } else if (fault.kind === 'wrong-hash') {
    // The same size, one changed byte.
    bytes[Math.floor(bytes.length / 2)] ^= 0x01;
    response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': bytes.length }).end(bytes);
  } else if (fault.kind === 'redirect') {
    response.writeHead(302, { Location: `${forbiddenOrigin}/redirected/${fault.file}` }).end();
  } else if (fault.kind === 'interrupt') {
    // A third of the file, then the connection is cut.
    response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': bytes.length });
    response.write(bytes.subarray(0, Math.floor(bytes.length / 3)), () => response.destroy());
  } else if (fault.kind === 'stall') {
    // The beginning of the file, then nothing more until the test moves on.
    response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': bytes.length });
    response.write(bytes.subarray(0, 4096));
  }
  return true;
}

const listen = (server) => new Promise((done) => server.listen(0, HOST, () => done(`http://${HOST}:${server.address().port}`)));
const appServer = createServer(createPrototypeHandler({ intercept }));
const forbiddenServer = createServer((request, response) => {
  forbiddenLog.push({ method: request.method, url: request.url });
  // Permissive answers: when the browser still fails, the page policy is the reason.
  response.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Content-Type': request.url.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' });
  response.end(request.url.endsWith('.js') ? 'export const reached = true;' : 'reached');
});
forbiddenServer.on('upgrade', (request, socket) => {
  forbiddenLog.push({ method: 'UPGRADE', url: request.url });
  socket.destroy();
});
const origin = await listen(appServer);
forbiddenOrigin = await listen(forbiddenServer);
const pageUrl = `${origin}${BASE}#pronunciation`;

// ---- Browser --------------------------------------------------------------------------

/** A synthetic microphone for Firefox: the clip, played into a stream. Chromium plays the file itself. */
const syntheticMicrophone = `(() => {
  const clip = Uint8Array.from(atob(${JSON.stringify(clip.toString('base64'))}), (c) => c.charCodeAt(0));
  const view = new DataView(clip.buffer);
  const samples = new Float32Array((clip.length - 44) / 2);
  for (let i = 0; i < samples.length; i += 1) samples[i] = view.getInt16(44 + i * 2, true) / 32768;
  const Context = window.AudioContext;
  navigator.mediaDevices.getUserMedia = async () => {
    const context = new Context();
    const buffer = context.createBuffer(1, samples.length, 16000);
    buffer.copyToChannel(samples, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    const destination = context.createMediaStreamDestination();
    source.connect(destination);
    source.start();
    return destination.stream;
  };
})();`;

/**
 * Counts microphone requests and keeps the tracks and audio contexts, so their release can be
 * read. Part F can also hold back two steps of the browser, as a browser may leave them
 * pending: the start of the audio device ("resume") and the recorder's script ("module").
 */
const instrumentation = `(() => {
  window.__gate = () => { let open; const promise = new Promise((resolve) => { open = resolve; }); return { promise, open }; };
  window.__hold = { resume: null, module: null };
  const addModule = AudioWorklet.prototype.addModule;
  AudioWorklet.prototype.addModule = async function (...args) {
    const held = window.__hold.module;
    if (held) await held.promise;
    return addModule.apply(this, args);
  };
  window.__microphoneRequests = 0;
  window.__tracks = [];
  window.__contexts = [];
  const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (constraints) => {
    window.__microphoneRequests += 1;
    const stream = await real(constraints);
    window.__tracks.push(...stream.getTracks());
    return stream;
  };
  const Real = window.AudioContext;
  window.AudioContext = class extends Real {
    constructor(options) {
      super(options);
      if (options && options.sampleRate === 16000) window.__contexts.push(this);
    }
    async resume() {
      const held = window.__hold.resume;
      if (held) await held.promise;
      return super.resume();
    }
  };
  window.__violations = [];
  document.addEventListener('securitypolicyviolation', (event) => window.__violations.push({ directive: event.effectiveDirective, blocked: event.blockedURI }));
})();`;

async function launch({ speech = true, grantMicrophone = true } = {}) {
  if (engine === 'chromium') {
    const args = ['--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${resolve(audioFile)}%noloop`];
    // The permission question is answered with "allow". Without this switch, this headless
    // browser cannot ask at all and fails the request.
    if (grantMicrophone) args.push('--use-fake-ui-for-media-stream');
    return { browser: await playwright.chromium.launch({ args }), injectedSpeech: false };
  }
  // Firefox: its built-in test device gives a tone. For speech, the clip is played into a stream instead.
  // "permissions.default.microphone": 2 means the microphone is refused without a question.
  const firefoxUserPrefs = { 'media.navigator.streams.fake': true, 'media.navigator.permission.disabled': grantMicrophone, 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0, ...(grantMicrophone ? {} : { 'permissions.default.microphone': 2 }) };
  const browser = await playwright.firefox.launch({ firefoxUserPrefs });
  return { browser, injectedSpeech: speech };
}

/** A new, empty browser profile with one page. Everything in it is thrown away with the context. */
async function newProfile(browser, { injectedSpeech = false } = {}) {
  const context = await browser.newContext();
  const requests = [];
  context.on('request', (request) => requests.push(request.url()));
  if (injectedSpeech) await context.addInitScript(syntheticMicrophone);
  await context.addInitScript(instrumentation);
  const page = await context.newPage();
  const consoleLines = [];
  page.on('console', (message) => consoleLines.push(`${message.type()}: ${message.text()}`.slice(0, 300)));
  page.on('pageerror', (error) => consoleLines.push(`pageerror: ${String(error).slice(0, 300)}`));
  return { context, page, requests, consoleLines };
}

const SCREEN = '[data-experimental-feature="pronunciation-prototype"]';
const phase = (page) => page.getAttribute(SCREEN, 'data-phase');
/** Waits for a phase of the screen. When it does not come, the error says what the screen shows instead. */
async function waitPhase(page, name, timeout = 30000) {
  try {
    await page.waitForSelector(`${SCREEN}[data-phase="${name}"]`, { timeout });
  } catch (error) {
    const seen = await page.evaluate(() => ({
      phase: document.querySelector('[data-experimental-feature]')?.getAttribute('data-phase') ?? 'the screen is not shown',
      model: (document.querySelector('[data-model-state]')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      notice: (document.querySelector('.notice--error')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      contexts: (window.__contexts ?? []).map((context) => context.state),
      tracks: (window.__tracks ?? []).map((track) => track.readyState)
    })).catch(() => ({ phase: 'the page did not answer' }));
    const asked = appLog.slice(-8).map((entry) => entry.path.split('/').pop());
    throw new Error(`The screen did not reach "${name}" in ${timeout / 1000} s. It shows: ${JSON.stringify(seen)}. Workers: ${page.workers().length}. Last requests: ${asked.join(', ')}. (${String(error).split('\n')[0]})`);
  }
}
const textOf = async (page, selector) => ((await page.textContent(selector).catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();
const modelRequests = (from = 0) => appLog.slice(from).map((entry) => entry.path).filter((path) => path.startsWith(MODEL_MOUNT)).map((path) => path.slice(MODEL_MOUNT.length));

async function openScreen(page) {
  await page.goto(pageUrl);
  await page.waitForSelector(`${SCREEN}:not([data-phase="checking"])`, { timeout: 30000 });
}

async function install(page) {
  await page.click('[data-action="install-model"]');
  await waitPhase(page, 'ready', 180000);
}

/** The state of the model cache, read in the page. */
const cacheState = (page) => page.evaluate(async () => {
  const names = await caches.keys();
  const entries = {};
  for (const name of names) entries[name] = (await (await caches.open(name)).keys()).map((request) => new URL(request.url).pathname).sort();
  return { names, entries };
});

/** Every store of a database, or null when the database does not exist. Opens without a version, so it creates nothing. */
const snapshotDatabase = (page, name) => page.evaluate(async (databaseName) => {
  if (!(await indexedDB.databases()).some((db) => db.name === databaseName)) return null;
  const db = await new Promise((resolveOpen, reject) => { const request = indexedDB.open(databaseName); request.onsuccess = () => resolveOpen(request.result); request.onerror = () => reject(request.error); });
  const stores = {};
  for (const store of [...db.objectStoreNames].sort()) {
    const transaction = db.transaction(store, 'readonly');
    const read = (request) => new Promise((resolveRead, reject) => { request.onsuccess = () => resolveRead(request.result); request.onerror = () => reject(request.error); });
    const keys = await read(transaction.objectStore(store).getAllKeys());
    const values = await read(transaction.objectStore(store).getAll());
    stores[store] = keys.map((key, index) => [String(key), values[index]]);
  }
  const version = db.version;
  db.close();
  return JSON.stringify({ version, stores });
}, name);
const localStorageState = (page) => page.evaluate(() => JSON.stringify(Object.entries(localStorage).sort()));
const digest = (text) => (text === null ? 'absent' : createHash('sha256').update(text).digest('hex').slice(0, 16));

/** Records for `seconds`, stops, and returns the outcome. */
async function recordOnce(page, seconds) {
  await page.click('[data-action="record"]');
  await waitPhase(page, 'recording', 20000);
  await page.waitForTimeout(seconds * 1000);
  await page.click('[data-action="stop"]');
  await waitPhase(page, 'ready', 60000);
  return { kind: await page.getAttribute('[data-outcome]', 'data-outcome'), text: await textOf(page, '[data-heard-text]'), reason: await textOf(page, '[data-unable-reason]') };
}
const recordSeconds = Math.min(18, Math.ceil(clipSeconds) + 1);
const released = (page) => page.evaluate(() => ({ tracks: window.__tracks.map((track) => track.readyState), contexts: window.__contexts.map((context) => context.state), requests: window.__microphoneRequests }));

// ---- A: the network boundary ----------------------------------------------------------

async function partBoundary() {
  const { browser } = await launch();
  const { context, page, requests, consoleLines } = await newProfile(browser);
  probeWorker = true;
  const forbiddenBefore = forbiddenLog.length;
  try {
    const response = await page.goto(pageUrl);
    await page.waitForSelector(`${SCREEN}:not([data-phase="checking"])`);
    const headers = response.headers();
    const policyHeaders = ['content-security-policy', 'content-security-policy-report-only', 'cross-origin-opener-policy', 'cross-origin-embedder-policy'].filter((name) => name in headers);
    check('A1', 'The server sends no policy header with the page, as GitHub Pages does not', policyHeaders.length === 0, policyHeaders.join(', '));

    const html = await (await context.request.get(`${origin}${BASE}`)).text();
    const declared = declaredPolicy(html);
    check('A2', 'The page declares the committed policy, with the hash of its inline script', declared === pagePolicy(inlineScriptHashes(html)), declared);
    check('A3', 'That policy allows a Worker from a blob: address only, and connections to this origin only', /(?:^|; )worker-src blob:(?:;|$)/.test(declared ?? '') && /(?:^|; )connect-src 'self'(?:;|$)/.test(declared ?? ''), declared);

    // The page itself: a request to another origin, and a Worker loaded from an address.
    const pageProbe = await page.evaluate(async ({ forbidden, base }) => {
      const attempt = async (run) => { try { return { reached: true, detail: String(await run()) }; } catch (error) { return { reached: false, detail: String(error.message ?? error).slice(0, 120) }; } };
      const workerFile = performance.getEntriesByType('resource').map((entry) => entry.name).find((name) => /index-[\w-]+\.js$/.test(name)) ?? `${base}assets/missing.js`;
      const urlWorker = await new Promise((done) => {
        let worker;
        try { worker = new Worker(workerFile, { type: 'module' }); } catch (error) { done({ reached: false, detail: String(error.message ?? error).slice(0, 120) }); return; }
        worker.onmessage = () => done({ reached: true, detail: 'a Worker from an address ran' });
        worker.onerror = () => done({ reached: false, detail: 'error event' });
        setTimeout(() => done({ reached: false, detail: 'no answer' }), 1500);
      });
      return { fetch: await attempt(async () => (await fetch(`${forbidden}/page-fetch`)).status), urlWorker };
    }, { forbidden: forbiddenOrigin, base: `${origin}${BASE}` });
    check('A4', 'On the page, a request to another origin is refused', !pageProbe.fetch.reached, JSON.stringify(pageProbe.fetch));
    check('A5', 'On the page, a Worker loaded from an address is refused', !pageProbe.urlWorker.reached, JSON.stringify(pageProbe.urlWorker));
    const violations = await page.evaluate(() => window.__violations);
    check('A6', 'The browser reports both refusals as violations of the page policy', violations.some((item) => item.directive === 'connect-src') && violations.some((item) => item.directive === 'worker-src'), JSON.stringify(violations));

    // The Worker: started by the application's own bootstrap when the model is prepared.
    const probe = page.evaluate(() => new Promise((done) => {
      const channel = new BroadcastChannel('acceptance-probe');
      channel.onmessage = (event) => done(event.data);
      setTimeout(() => done(null), 120000);
    }));
    const workerFilesBefore = appLog.filter((entry) => WORKER_FILE.test(entry.path)).length;
    await install(page);
    const result = await probe;
    check('A7', 'The recognizer\'s Worker was started by the application and answered the probe', result !== null && appLog.filter((entry) => WORKER_FILE.test(entry.path)).length === workerFilesBefore + 1, result === null ? 'no answer from the Worker' : '');
    if (result) {
      check('A8', 'The Worker runs from a blob: address', result.location === 'blob:', result.location);
      check('A9', 'In the Worker, the same request works for the application\'s own origin (the probe itself works)', result.ownOrigin.reached && result.ownOrigin.detail === 'status 200', JSON.stringify(result.ownOrigin));
      for (const [id, name, title] of [['A10', 'fetch', 'fetch'], ['A11', 'xhr', 'XMLHttpRequest'], ['A12', 'websocket', 'WebSocket'], ['A13', 'eventsource', 'EventSource'], ['A14', 'import', 'a dynamic import()']]) {
        check(id, `In the Worker, the browser refuses ${title} to another origin`, !result.browser[name].reached, JSON.stringify(result.browser[name]));
      }
      check('A15', 'In the Worker, a nested Worker loaded from an address is refused', !result.browser.nestedWorker.reached, JSON.stringify(result.browser.nestedWorker));
      const locked = Object.entries(result.lockdown);
      check('A16', 'The Worker\'s own lock-down has taken fetch, XMLHttpRequest, WebSocket, EventSource and importScripts away', locked.every(([, outcome]) => !outcome.reached && outcome.detail.includes('The recognizer Worker makes no network request')), JSON.stringify(result.lockdown));
    }
    await page.waitForTimeout(500);
    const reached = forbiddenLog.slice(forbiddenBefore);
    check('A17', 'The other origin received nothing: no request of the page or of the Worker arrived there', reached.length === 0, JSON.stringify(reached));
    check('A18', 'The model still loaded and the screen is ready, with the probe around the Worker', (await phase(page)) === 'ready', await phase(page));
    const registrations = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length);
    check('A19', 'No service worker is registered', registrations === 0, registrations);
    const outside = requests.filter((url) => /^(?:https?|wss?):/.test(url) && new URL(url).hostname !== HOST);
    check('A20', 'The browser context asked no host outside this computer', outside.length === 0, JSON.stringify(outside));
    return { console: consoleLines.filter((line) => !/Content.Security.Policy|blocked|Refused|violates|Failed to load resource|can.t establish a connection/i.test(line)) };
  } finally {
    probeWorker = false;
    await browser.close();
  }
}

// ---- B: the installer under injected faults -------------------------------------------

async function partFaults() {
  const { browser } = await launch();
  const notInstalled = async (page) => {
    const state = await cacheState(page);
    const entries = Object.values(state.entries).flat();
    return { ok: (await phase(page)) === 'no-model' && entries.length === 0 && (await page.$('[data-action="load-model"]')) === null, detail: `${await phase(page)}; cache entries: ${entries.length}` };
  };
  const cases = [
    ['B1', 'a file with a wrong SHA-256 (one changed byte, same size)', { file: 'tokenizer.json', kind: 'wrong-hash' }, /not the expected one and was discarded/],
    ['B2', 'a file answered with a redirect to another origin', { file: 'onnx/encoder_model_quantized.onnx', kind: 'redirect' }, /The download was refused/],
    ['B3', 'a server without the model', { file: 'config.json', kind: 'missing' }, /does not provide the speech model files/],
    ['B4', 'a download that is cut in the middle of a file', { file: 'onnx/decoder_model_merged_quantized.onnx', kind: 'interrupt' }, /The download failed and nothing was installed/]
  ];
  try {
    for (const [id, title, injected, notice] of cases) {
      const { context, page } = await newProfile(browser);
      const from = appLog.length;
      const forbiddenBefore = forbiddenLog.length;
      fault = injected;
      await openScreen(page);
      await page.click('[data-action="install-model"]');
      await page.waitForSelector(`${SCREEN}[data-phase="no-model"] .notice--error`, { timeout: 60000 }).catch(() => undefined);
      const shown = await textOf(page, '.notice--error');
      const state = await notInstalled(page);
      check(id, `Refused: ${title}. Nothing is installed`, notice.test(shown) && state.ok, `${shown} | ${state.detail}`);
      const workerStarted = appLog.slice(from).some((entry) => WORKER_FILE.test(entry.path));
      check(`${id}a`, '  and the recognizer was not started', !workerStarted, '');
      if (injected.kind === 'redirect') check(`${id}b`, '  and the redirect was not followed: the other origin received nothing', forbiddenLog.length === forbiddenBefore, JSON.stringify(forbiddenLog.slice(forbiddenBefore)));
      if (injected.kind === 'missing') check(`${id}b`, '  and after one refusal no other address was asked', modelRequests(from).length === 1, modelRequests(from).join(', '));
      if (injected.kind === 'interrupt') {
        // A restart in the middle of an installation: still an honest "download needed".
        fault = null;
        await page.reload();
        await page.waitForSelector(`${SCREEN}:not([data-phase="checking"])`);
        const after = await notInstalled(page);
        check(`${id}b`, '  and after a reload the state is still "no model", not a half-installed one', after.ok && (await page.$('[data-action="install-model"]')) !== null, after.detail);
      }
      fault = null;
      await context.close();
    }

    // Cancelled by the learner while a file is still arriving.
    {
      const { context, page } = await newProfile(browser);
      fault = { file: 'onnx/decoder_model_merged_quantized.onnx', kind: 'stall' };
      await openScreen(page);
      await page.click('[data-action="install-model"]');
      await page.waitForFunction((mount) => performance.getEntriesByType('resource').some((entry) => entry.name.includes(`${mount}onnx/encoder_model_quantized.onnx`)), MODEL_MOUNT, { timeout: 60000 });
      await page.waitForTimeout(500);
      const during = await cacheState(page);
      await page.click('[data-action="cancel-install"]');
      await waitPhase(page, 'no-model');
      const state = await notInstalled(page);
      const staged = Object.values(during.entries).flat().length;
      check('B5', 'Cancelled during the download: nothing is installed, and the files stored so far are removed', state.ok && staged > 0 && (await page.$('.notice--error')) === null, `${state.detail}; stored before the cancel: ${staged}`);

      // A restart while files are stored but the installation is not complete.
      await page.click('[data-action="install-model"]');
      let partial = [];
      for (let waited = 0; waited < 60000 && partial.length < 4; waited += 250) {
        await page.waitForTimeout(250);
        partial = Object.values((await cacheState(page)).entries).flat();
      }
      fault = null;
      await page.reload();
      await page.waitForSelector(`${SCREEN}:not([data-phase="checking"])`);
      const offered = (await phase(page)) === 'no-model' && (await page.$('[data-action="install-model"]')) !== null && (await page.$('[data-action="load-model"]')) === null;
      check('B6', 'Files of an unfinished installation are not an installation: after a reload the download is offered again', offered && partial.length >= 4 && !partial.some((path) => path.endsWith('/complete.json')), `${await phase(page)}; partial entries: ${partial.length}`);

      const from = appLog.length;
      await install(page);
      const asked = modelRequests(from);
      const complete = Object.values((await cacheState(page)).entries).flat();
      check('B7', 'The next attempt downloads every pinned file again, each once, and completes', asked.slice().sort().join() === pinned.model.files.map((file) => file.path).sort().join() && complete.length === pinned.model.files.length + 2, `asked: ${asked.join(', ')}; entries: ${complete.length}`);
      await context.close();
    }
  } finally {
    fault = null;
    await browser.close();
  }
}

// ---- C: install, record, read the text ------------------------------------------------

async function partFlow() {
  const { browser, injectedSpeech } = await launch();
  const { context, page, requests, consoleLines } = await newProfile(browser, { injectedSpeech });
  try {
    // Made-up data of the other two versions, on the same origin.
    await page.goto(`${origin}/eng-trainer/#phrases`);
    await page.waitForSelector('.phrase-card button[aria-label="Mark as learned"]');
    await page.click('.phrase-card button[aria-label="Mark as learned"]');
    await page.evaluate(() => {
      localStorage.setItem('englishAssessmentTrainer.svelteState.v1', '{"learnedPhrases":["phrase-001"],"hiddenPhrases":["phrase-002"]}');
      localStorage.setItem('englishAssessmentTrainer.theme.v1', 'dark');
    });
    await page.waitForTimeout(800);
    // Made-up progress in the experimental product.
    await page.goto(`${origin}${BASE}#phrases`);
    await page.waitForSelector('.phrase-card button[aria-label="Mark as learned"]');
    await page.click('.phrase-card button[aria-label="Mark as learned"]');
    await page.waitForTimeout(800);

    const fromOpen = appLog.length;
    await page.click('.side-nav nav a[href="#pronunciation"]');
    await page.waitForSelector(`${SCREEN}[data-phase="no-model"]`);
    // The application saves the open screen as the last one. The snapshot is taken after that.
    await page.waitForTimeout(800);
    const snapshot = async () => ({ v2: await snapshotDatabase(page, 'eng-trainer-v2'), v3: await snapshotDatabase(page, 'eng-trainer-v3'), local: await localStorageState(page) });
    const changed = (now) => ['v2', 'v3', 'local'].filter((key) => now[key] !== before[key]).map((key) => `${key} changed (${digest(before[key])} -> ${digest(now[key])})`).join(', ') || `unchanged: v2 ${digest(now.v2)}, v3 ${digest(now.v3)}, local ${digest(now.local)}`;
    const before = await snapshot();
    check('C1', 'Made-up learning data of all three versions is in place before the model is touched', before.v2 !== null && before.v3 !== null && before.v3.includes('learnedPhrases') && before.v2.includes('learnedPhrases') && before.local.includes('svelteState.v1'), `v2 ${digest(before.v2)}, v3 ${digest(before.v3)}, local ${digest(before.local)}`);
    check('C2', 'Opening the screen downloads no model file and asks for no microphone', modelRequests(fromOpen).length === 0 && (await released(page)).requests === 0, modelRequests(fromOpen).join(', '));
    const consent = await textOf(page, '[data-model-state]');
    const total = pinned.model.files.reduce((sum, file) => sum + file.bytes, 0) + pinned.runtime.file.bytes;
    check('C3', 'Before the download the screen states its exact size', consent.includes(`${total.toLocaleString('en-US')} bytes`), consent);

    const fromInstall = appLog.length;
    await install(page);
    const asked = modelRequests(fromInstall);
    check('C4', 'The installation asks for the pinned model files, each once, from this origin, and for nothing else there', asked.join() === pinned.model.files.map((file) => file.path).join(), asked.join(', '));
    const cache = await cacheState(page);
    const expectedEntries = [...pinned.model.files.map((file) => `model/${file.path}`), `runtime/${pinned.runtime.file.path}`, 'complete.json'].map((id) => `/eng-trainer/model-cache/${pinned.version}/${id}`).sort();
    check('C5', 'The model cache is this product\'s own, and holds the pinned files and the marker', cache.names.join() === 'eng-trainer-v3-models' && cache.entries['eng-trainer-v3-models'].join() === expectedEntries.join(), JSON.stringify(cache));
    check('C6', 'Installing and loading asked for no microphone', (await released(page)).requests === 0, '');

    // The network is cut. From here to the text nothing may be requested, and nothing can be.
    await context.setOffline(true);
    const appMark = appLog.length;
    const forbiddenMark = forbiddenLog.length;
    const requestMark = requests.length;
    const first = await recordOnce(page, recordSeconds);
    check('C7', `With the network cut, a recording gives the recognizer's text for the clip ("${expectedWords}")`, first.kind === 'heard' && words(first.text) === words(expectedWords), `${first.kind}: "${first.text}" ${first.reason}`);
    check('C8', 'From the record click to the text: no request of any kind, to any origin', appLog.length === appMark && forbiddenLog.length === forbiddenMark && requests.length === requestMark, JSON.stringify({ app: appLog.slice(appMark).map((entry) => entry.path), other: forbiddenLog.slice(forbiddenMark), context: requests.slice(requestMark) }));
    check('C9', 'The microphone was asked for once, by the click on Record', (await released(page)).requests === 1, JSON.stringify(await released(page)));
    check('C10', 'The result is worded as what the recognizer heard, with no score', /^The recognizer heard: /.test(await textOf(page, '[data-outcome]')) && !/score:|\d+\s?%|grade|correct answer|well done/i.test(await textOf(page, '[data-outcome]')), await textOf(page, '[data-outcome]'));

    const second = await recordOnce(page, recordSeconds);
    check('C11', 'Retry: "Record again" gives a new result, still with the network cut', second.kind === 'heard' && words(second.text) === words(expectedWords) && requests.length === requestMark && appLog.length === appMark, `${second.kind}: "${second.text}" ${second.reason}`);
    const afterRecording = await snapshot();
    check('C12', 'Recording stored nothing: the learning data of all three versions is unchanged, and nothing is marked as learned', afterRecording.v2 === before.v2 && afterRecording.v3 === before.v3 && afterRecording.local === before.local, changed(afterRecording));
    await context.setOffline(false);

    // A new visit: the model is on the device and is loaded without a download.
    const fromReload = appLog.length;
    await page.reload();
    await page.waitForSelector(`${SCREEN}[data-phase="no-model"]`);
    check('C13', 'After a reload the model is found in the browser and is not loaded by itself', (await page.$('[data-action="load-model"]')) !== null && (await page.$('[data-action="install-model"]')) === null, await textOf(page, '[data-model-state]'));
    await page.click('[data-action="load-model"]');
    await waitPhase(page, 'ready', 120000);
    check('C14', 'Loading the installed model downloads no model file', modelRequests(fromReload).length === 0, modelRequests(fromReload).join(', '));
    const third = await recordOnce(page, recordSeconds);
    check('C15', 'A recording works after the reload', third.kind === 'heard' && words(third.text) === words(expectedWords), `${third.kind}: "${third.text}" ${third.reason}`);

    await page.click('[data-action="delete-model"]');
    await page.waitForSelector(`${SCREEN}[data-phase="no-model"] [data-action="install-model"]`);
    const afterDelete = { cache: await cacheState(page), ...(await snapshot()) };
    check('C16', '"Delete downloaded model" removes the model cache', afterDelete.cache.names.length === 0, JSON.stringify(afterDelete.cache));
    check('C17', 'and leaves the learning data of all three versions exactly as it was', afterDelete.v2 === before.v2 && afterDelete.v3 === before.v3 && afterDelete.local === before.local, changed(afterDelete));
    const databases = await page.evaluate(async () => (await indexedDB.databases()).map((db) => `${db.name}@${db.version}`).sort());
    check('C18', 'The origin holds the two learning databases and no other', databases.join() === 'eng-trainer-v2@2,eng-trainer-v3@1', databases.join());
    const registrations = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length);
    check('C19', 'No service worker is registered', registrations === 0, registrations);
    const foreign = requests.filter((url) => !url.startsWith(origin) && !url.startsWith('blob:') && !url.startsWith('data:'));
    check('C20', 'In the whole run the browser context made no request to another host', foreign.length === 0, JSON.stringify(foreign));
    const errors = consoleLines.filter((line) => /^(error|pageerror)/.test(line));
    check('C21', 'The browser console shows no error', errors.length === 0, errors.join(' | '));
    return { transcripts: [first.text, second.text, third.text], injectedSpeech };
  } finally {
    await context.setOffline(false).catch(() => undefined);
    await browser.close();
  }
}

// ---- D: release of the microphone -----------------------------------------------------

async function partLifecycle() {
  // The browser's own test device and the real microphone request, in both browsers.
  const { browser } = await launch({ speech: false });
  const { page } = await newProfile(browser);
  try {
    await openScreen(page);
    await install(page);
    const startRecording = async () => {
      await page.click('[data-action="record"]');
      await waitPhase(page, 'recording', 20000);
      await page.waitForTimeout(1200);
    };
    const allEnded = (state) => state.tracks.length > 0 && state.tracks.every((track) => track === 'ended');

    await startRecording();
    const during = await released(page);
    check('D1', 'While recording, the microphone track is live and the recorder\'s audio context runs', during.tracks.at(-1) === 'live' && during.contexts.at(-1) === 'running', JSON.stringify(during));
    await page.click('[data-action="stop"]');
    await waitPhase(page, 'ready', 60000);
    let state = await released(page);
    check('D2', 'Stop: the track has ended and the audio context is paused', allEnded(state) && state.contexts.at(-1) === 'suspended', JSON.stringify(state));

    await startRecording();
    await page.click('[data-action="cancel"]');
    await waitPhase(page, 'ready');
    state = await released(page);
    check('D3', 'Cancel while recording: the track has ended, and there is no result', allEnded(state) && (await page.getAttribute('[data-outcome]', 'data-outcome')) === 'none', JSON.stringify(state));

    // Cancel while the recognizer works: the result that still arrives is dropped.
    await startRecording();
    await page.waitForTimeout(1500);
    const cancelled = await page.evaluate(() => new Promise((done) => {
      const screen = document.querySelector('[data-experimental-feature]');
      const observer = new MutationObserver(() => {
        if (screen.getAttribute('data-phase') !== 'recognizing') return;
        const cancel = screen.querySelector('[data-action="cancel"]');
        if (!cancel) return;
        observer.disconnect();
        cancel.click();
        done(true);
      });
      observer.observe(screen, { attributes: true, subtree: true, childList: true });
      screen.querySelector('[data-action="stop"]').click();
      setTimeout(() => { observer.disconnect(); done(false); }, 5000);
    }));
    await waitPhase(page, 'ready');
    await page.waitForTimeout(2500);
    if (cancelled) check('D4', 'Cancel while recognizing: a result that arrives later is not shown', (await page.getAttribute('[data-outcome]', 'data-outcome')) === 'none' && (await phase(page)) === 'ready', await textOf(page, '[data-outcome]'));
    else notRun.push('D4: the recognizer answered before Cancel could be chosen. The unit tests cover the late result.');

    await startRecording();
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitPhase(page, 'ready');
    state = await released(page);
    check('D5', 'A hidden page ends the recording: the track has ended, and the screen says why', allEnded(state) && /page was hidden/.test(await textOf(page, '[data-unable-reason]')), `${JSON.stringify(state)} ${await textOf(page, '[data-unable-reason]')}`);
    await page.evaluate(() => { delete document.visibilityState; });

    await startRecording();
    const workersBefore = page.workers().length;
    await page.click('.side-nav nav a[href="#phrases"]');
    await page.waitForSelector('.phrase-card');
    await page.waitForTimeout(800);
    state = await released(page);
    check('D6', 'Leaving the screen while recording: the track has ended and the audio context is closed', allEnded(state) && state.contexts.every((context) => context === 'closed'), JSON.stringify(state));
    check('D7', 'Leaving the screen ends the recognizer\'s Worker, which frees the model', workersBefore === 1 && page.workers().length === 0, `Workers before: ${workersBefore}, after: ${page.workers().length}`);
    check('D8', 'Each recording asked for the microphone once, and nothing else did', state.requests === 5, `requests: ${state.requests}`);
  } finally {
    await browser.close();
  }

  // A microphone that the browser does not give. Firefox refuses the permission. This headless
  // Chromium cannot ask for it and fails the request instead, which is the other failure path.
  const denied = await launch({ grantMicrophone: false, speech: false });
  try {
    const { page } = await newProfile(denied.browser);
    await openScreen(page);
    await install(page);
    await page.click('[data-action="record"]');
    await page.waitForSelector('[data-unable-reason]', { timeout: 30000 }).catch(() => undefined);
    const state = await released(page);
    const reason = await textOf(page, '[data-unable-reason]');
    const expected = engine === 'firefox' ? /^The microphone was not allowed\. Allow it for this page in the browser, then record again\.$/ : /^The recording could not be started: /;
    check('D9', engine === 'firefox' ? 'A refused microphone permission: the screen says so, nothing records, and Record is offered again' : 'A microphone request that fails: the screen says so, nothing records, and Record is offered again', expected.test(reason) && (await phase(page)) === 'ready' && state.tracks.length === 0 && (await page.$('[data-action="record"]')) !== null, `${reason} ${JSON.stringify(state)}`);
    if (engine !== 'firefox') notRun.push('A refused permission question: this headless Chromium fails the microphone request ("Not supported") instead of refusing it. D9 checks that failure path here; Firefox checks the refusal.');
  } finally {
    await denied.browser.close();
  }
}

// ---- E: the rest of the application ---------------------------------------------------

async function partOtherScreens() {
  const { browser } = await launch();
  const { page } = await newProfile(browser);
  try {
    let from = appLog.length;
    await page.goto(`${origin}${BASE}`);
    await page.waitForSelector('.app-shell');
    for (const screen of ['phrases', 'flashcards', 'settings']) {
      await page.click(`.side-nav nav a[href="#${screen}"]`);
      await page.waitForTimeout(300);
    }
    const speech = appLog.slice(from).map((entry) => entry.path).filter((path) => SPEECH_FILE.test(path));
    check('E1', 'The other screens of the experimental product load no speech file and ask for no microphone', speech.length === 0 && (await released(page)).requests === 0 && page.workers().length === 0, speech.join(', '));

    from = appLog.length;
    const response = await page.goto(`${origin}/eng-trainer/#pronunciation`);
    await page.waitForSelector('.app-shell');
    await page.waitForTimeout(500);
    const stableHtml = await response.text();
    const asked = appLog.slice(from).map((entry) => entry.path);
    check('E2', 'The stable product has no Pronunciation screen: the address shows Home, and nothing of the experimental product is requested', (await textOf(page, 'main h1')) === 'Home' && (await page.$('[data-experimental-feature]')) === null && !asked.some((path) => path.startsWith(BASE) || SPEECH_FILE.test(path)), asked.filter((path) => path.startsWith(BASE)).join(', '));
    check('E3', 'The stable page declares no policy of its own, as released, and starts no Worker', declaredPolicy(stableHtml) === null && page.workers().length === 0 && (await released(page)).requests === 0, '');
  } finally {
    await browser.close();
  }
}

// ---- F: waits that are ended, and a Worker that fails (ENG-V3-02A-RC1) -----------------

async function partPendingAndFailure() {
  // The real microphone request in both browsers. A step of the browser is held back by the
  // test and released later, as a browser may leave it pending.
  const { browser } = await launch({ speech: false });
  const { page } = await newProfile(browser);
  const hold = (step) => page.evaluate((name) => { window.__hold[name] = window.__gate(); }, step);
  const letGo = (step) => page.evaluate((name) => { window.__hold[name]?.open(); window.__hold[name] = null; }, step);
  const hidden = () => page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    delete document.visibilityState;
  });
  /** Clicks Record and waits until the browser has handed a live microphone over. */
  const startHeld = async (tracksBefore) => {
    await page.click('[data-action="record"]');
    await page.waitForFunction((count) => window.__tracks.length > count && window.__tracks[window.__tracks.length - 1].readyState === 'live', tracksBefore, { timeout: 20000 });
    return phase(page);
  };
  try {
    await openScreen(page);
    await install(page);

    // The audio device does not answer: the recorder holds a live microphone and waits.
    await hold('resume');
    let waiting = await startHeld(0);
    await page.click('[data-action="cancel"]');
    let state = await released(page);
    check('F1', 'Cancel while the audio device is starting: the microphone track has ended at once, and the screen is ready', waiting === 'starting' && state.tracks.join() === 'ended' && (await phase(page)) === 'ready', `${waiting}; ${JSON.stringify(state)}`);
    await letGo('resume');
    await page.waitForTimeout(700);
    state = await released(page);
    check('F2', 'When the audio device answers afterwards, nothing records and the audio context is paused again', state.contexts.join() === 'suspended' && (await phase(page)) === 'ready' && (await page.getAttribute('[data-outcome]', 'data-outcome')) === 'none', JSON.stringify(state));

    await hold('resume');
    waiting = await startHeld(1);
    await hidden();
    state = await released(page);
    check('F3', 'A hidden page while the audio device is starting: the track has ended at once, and the screen says why', waiting === 'starting' && state.tracks.join() === 'ended,ended' && /page was hidden/.test(await textOf(page, '[data-unable-reason]')), `${waiting}; ${JSON.stringify(state)} ${await textOf(page, '[data-unable-reason]')}`);
    await letGo('resume');
    await page.waitForTimeout(700);

    await page.click('[data-action="record"]');
    await waitPhase(page, 'recording', 20000);
    await page.waitForTimeout(1500);
    await page.click('[data-action="stop"]');
    await waitPhase(page, 'ready', 60000);
    state = await released(page);
    check('F4', 'Retry: the next recording runs normally and gives its result', state.tracks.join() === 'ended,ended,ended' && state.contexts.join() === 'suspended' && (await page.getAttribute('[data-outcome]', 'data-outcome')) !== 'none', `${JSON.stringify(state)} outcome: ${await page.getAttribute('[data-outcome]', 'data-outcome')}`);

    // The recorder's script does not arrive: the model is loaded, the recorder waits.
    const contextsBefore = (await released(page)).contexts.length;
    await page.reload();
    await page.waitForSelector(`${SCREEN}[data-phase="no-model"] [data-action="load-model"]`);
    await hold('module');
    await page.click('[data-action="load-model"]');
    await page.waitForFunction(() => window.__contexts.length === 1 && document.querySelector('[data-experimental-feature]').getAttribute('data-phase') === 'loading', null, { timeout: 120000 });
    // Until the Worker has loaded the model, Cancel would end that instead of the recorder's wait.
    for (let waited = 0; waited < 120000 && page.workers().length !== 1; waited += 250) await page.waitForTimeout(250);
    await page.waitForTimeout(3000);
    const before = { phase: await phase(page), context: (await released(page)).contexts.join(), workers: page.workers().length };
    await page.click('[data-action="cancel-install"]');
    await waitPhase(page, 'no-model', 15000);
    await page.waitForTimeout(300);
    state = await released(page);
    check('F5', 'Cancel while the recorder\'s script loads: the screen is not ready, the audio context is closed and the Worker is ended', before.phase === 'loading' && before.context !== 'closed' && state.contexts.join() === 'closed' && page.workers().length === 0 && (await page.$('[data-action="load-model"]')) !== null && (await page.$('.notice--error')) === null, `before: ${JSON.stringify(before)}; after: ${JSON.stringify(state)}, Workers ${page.workers().length}`);
    await letGo('module');
    await page.waitForTimeout(700);
    state = await released(page);
    check('F6', 'When the script arrives afterwards, the context stays closed and the screen stays as it is', state.contexts.join() === 'closed' && (await phase(page)) === 'no-model' && state.requests === 0, JSON.stringify(state));

    await page.click('[data-action="load-model"]');
    await waitPhase(page, 'ready', 120000);
    state = await released(page);
    check('F7', 'Loading again after the cancel works, with a new audio context', state.contexts.join() === 'closed,suspended' && page.workers().length === 1, `${JSON.stringify(state)}, Workers ${page.workers().length}; contexts before the reload: ${contextsBefore}`);

    await page.reload();
    await page.waitForSelector(`${SCREEN}[data-phase="no-model"] [data-action="load-model"]`);
    await hold('module');
    await page.click('[data-action="load-model"]');
    await page.waitForFunction(() => window.__contexts.length === 1, null, { timeout: 120000 });
    await page.waitForTimeout(500);
    await page.click('.side-nav nav a[href="#phrases"]');
    await page.waitForSelector('.phrase-card');
    const atLeaving = (await released(page)).contexts.join();
    await letGo('module');
    await page.waitForTimeout(700);
    state = await released(page);
    check('F8', 'Leaving the screen while the recorder\'s script loads closes the audio context, and the late script cannot keep it', atLeaving === 'closed' && state.contexts.join() === 'closed' && page.workers().length === 0, `at leaving: ${atLeaving}; later: ${JSON.stringify(state)}, Workers ${page.workers().length}`);

  } finally {
    await browser.close();
  }

  // A Worker that throws while it recognizes. The test server puts the fault after the real
  // Worker file. A new profile: one that has loaded the Worker before would use its own copy.
  const second = await launch({ speech: false });
  try {
    const { page } = await newProfile(second.browser);
    await openScreen(page);
    workerFault = true;
    await install(page);
    workerFault = false;
    await page.click('[data-action="record"]');
    await waitPhase(page, 'recording', 20000);
    await page.waitForTimeout(recordSeconds * 1000);
    await page.click('[data-action="stop"]');
    await page.waitForSelector(`${SCREEN}[data-phase="no-model"] .notice--error`, { timeout: 60000 }).catch(() => undefined);
    const notice = await textOf(page, '.notice--error');
    check('F9', 'A Worker that fails while it recognizes: the attempt ends, and the screen says why and offers to load the model again', (await phase(page)) === 'no-model' && /The recognizer stopped, so the speech model has to be loaded again/.test(notice) && (await page.$('[data-action="load-model"]')) !== null, `${await phase(page)}: ${notice}`);
    const after = await released(page);
    check('F10', 'The failed Worker is ended, and the microphone is released', page.workers().length === 0 && after.tracks.length === 1 && after.tracks[0] === 'ended', `Workers ${page.workers().length}; ${JSON.stringify(after)}`);

    await page.click('[data-action="load-model"]');
    await waitPhase(page, 'ready', 120000);
    const again = await recordOnce(page, recordSeconds);
    const expected = engine === 'chromium' ? again.kind === 'heard' && words(again.text) === words(expectedWords) : again.kind === 'heard';
    check('F11', 'Loading again starts a new Worker, and the next recording gives the recognizer\'s text', expected && page.workers().length === 1, `${again.kind}: "${again.text}" ${again.reason}; Workers ${page.workers().length}`);
  } finally {
    workerFault = false;
    await second.browser.close();
  }
}

// ---- Run ------------------------------------------------------------------------------

const started = new Date();
let failure = null;
const notes = {};
try {
  const probe = await launch();
  notes.browser = { engine, version: probe.browser.version() };
  await probe.browser.close();
  console.log(`\n${engine} ${notes.browser.version}, clip ${basename(audioFile)} (${clipSeconds.toFixed(2)} s)\n`);
  console.log('A  Network boundary of the page and of the recognizer\'s Worker');
  notes.boundary = await partBoundary();
  console.log('\nB  The installer under injected faults');
  await partFaults();
  console.log('\nC  Install, record, read the text');
  notes.flow = await partFlow();
  console.log('\nD  Release of the microphone');
  await partLifecycle();
  console.log('\nE  The rest of the application');
  await partOtherScreens();
  console.log('\nF  Waits that are ended, and a Worker that fails');
  await partPendingAndFailure();
} catch (error) {
  failure = String(error?.stack ?? error).split('\n').slice(0, 4).join(' | ');
  console.error(`\nThe run stopped: ${failure}`);
} finally {
  appServer.close();
  forbiddenServer.close();
}

const failed = checks.filter((item) => !item.pass);
const result = {
  milestone: 'ENG-V3-02 stage A',
  what: 'Browser acceptance test of the pronunciation prototype, in disposable profiles with made-up data',
  startedUtc: started.toISOString(),
  browser: notes.browser,
  server: 'Static files from this computer. No Content-Security-Policy, COOP or COEP response header.',
  model: { id: pinned.model.id, repository: pinned.model.repository, revision: pinned.model.revision, runtime: `${pinned.runtime.package} ${pinned.runtime.version}` },
  clip: { file: basename(audioFile), bytes: clip.length, sha256: createHash('sha256').update(clip).digest('hex'), seconds: Number(clipSeconds.toFixed(2)), expected: expectedWords, microphone: notes.flow?.injectedSpeech ? 'the clip played into a stream by the test (the real request is used in part D)' : 'the browser\'s test device plays the clip' },
  transcripts: notes.flow?.transcripts ?? [],
  checks,
  notRun,
  stopped: failure,
  summary: { checks: checks.length, passed: checks.length - failed.length, failed: failed.length }
};
if (outFile) writeFileSync(resolve(outFile), `${JSON.stringify(result, null, 2)}\n`);
console.log(`\n${checks.length - failed.length} of ${checks.length} checks passed${notRun.length ? `, ${notRun.length} not run` : ''}.`);
for (const line of notRun) console.log(`not run: ${line}`);
process.exit(failed.length || failure ? 1 : 0);
