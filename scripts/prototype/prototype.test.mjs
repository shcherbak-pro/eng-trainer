import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { repoRoot } from '../site-config.mjs';
import { PINNED_LIST_FILE, hubUrl, isHubAddress, localModelDir, mismatch, readPinned, sha256 } from './model-files.mjs';
import { HOST, createPrototypeHandler, missingInputs, verifyLocalModel } from './server.mjs';

// The developer tools of the pronunciation prototype (ENG-V3-02, stage A): the pinned
// list as the scripts read it, and the local server. Small synthetic files in a temporary
// folder. No model is downloaded, and no host but this computer is contacted.

const COMMIT = 'a'.repeat(40);

async function tempRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'eng-trainer-prototype-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function write(root, files) {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
}

/** A root with a small pinned list, its model files and a local assembly. */
async function syntheticRoot(t, change = (pinned) => pinned) {
  const root = await tempRoot(t);
  const files = { 'config.json': Buffer.from('{"model_type":"moonshine"}'), 'onnx/encoder.onnx': Buffer.from('encoder bytes'), 'tokenizer.json': Buffer.from('{}') };
  const runtime = Buffer.from('runtime bytes');
  const pinned = change({
    version: `test-model-${COMMIT.slice(0, 12)}-ort-9.9.9`,
    model: {
      id: `test-model-${COMMIT.slice(0, 12)}`,
      name: 'Test model',
      repository: 'example-owner/example-model',
      revision: COMMIT,
      licence: 'MIT',
      files: Object.entries(files).map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: sha256(bytes) }))
    },
    runtime: { package: 'onnxruntime-web', version: '9.9.9', licence: 'MIT', file: { path: 'runtime.wasm', bytes: runtime.length, sha256: sha256(runtime) } }
  });
  await write(root, { [PINNED_LIST_FILE]: JSON.stringify(pinned) });
  return { root, files, pinned };
}

test('the committed list is valid, pins a full commit and one runtime file', () => {
  const pinned = readPinned();
  assert.match(pinned.model.revision, /^[0-9a-f]{40}$/);
  assert.equal(pinned.model.files.length, 5);
  assert.equal(pinned.model.files.reduce((sum, file) => sum + file.bytes, 0) + pinned.runtime.file.bytes, 46_792_602);
  assert.equal(localModelDir(pinned), `.local/models/${pinned.model.id}`);
  assert.equal(hubUrl(pinned, pinned.model.files[0]), `https://huggingface.co/onnx-community/moonshine-tiny-ONNX/resolve/${pinned.model.revision}/config.json`);
});

test('a moving revision, an unsafe path and a missing hash are refused before anything is downloaded or served', async (t) => {
  const refused = async (change, pattern) => {
    const { root } = await syntheticRoot(t, (pinned) => {
      change(pinned);
      return pinned;
    });
    assert.throws(() => readPinned(root), pattern);
    assert.throws(() => createPrototypeHandler({ root }), pattern);
  };
  // A branch, a tag or a shortened commit can come to mean other files.
  await refused((pinned) => { pinned.model.revision = 'main'; }, /must be a full commit identifier, not a branch or a tag/);
  await refused((pinned) => { pinned.model.revision = 'v1.0'; }, /must be a full commit identifier/);
  await refused((pinned) => { pinned.model.revision = COMMIT.slice(0, 12); }, /must be a full commit identifier/);
  await refused((pinned) => { pinned.model.files[0].path = '../outside.json'; }, /is not a plain relative path/);
  await refused((pinned) => { pinned.model.files[0].path = '/etc/passwd'; }, /is not a plain relative path/);
  await refused((pinned) => { pinned.model.files[0].path = 'a\\b.json'; }, /is not a plain relative path/);
  await refused((pinned) => { pinned.model.files[1].sha256 = 'abc'; }, /needs a SHA-256/);
  await refused((pinned) => { pinned.model.files[1].bytes = 0; }, /needs its exact size/);
  await refused((pinned) => { pinned.model.files.push({ ...pinned.model.files[0] }); }, /listed twice/);
  await refused((pinned) => { pinned.model.repository = 'https://example.net/model'; }, /must be "<owner>\/<name>"/);
  await refused((pinned) => { pinned.version = 'something-else'; }, /the version must be/);
  await refused((pinned) => { pinned.model.id = 'test-model'; }, /must end with the first 12 digits/);
});

test('a download is asked of the hub and its own storage only, over HTTPS', () => {
  for (const url of ['https://huggingface.co/x/y/resolve/abc/config.json', 'https://cdn-lfs.huggingface.co/file', 'https://cas-bridge.xethub.hf.co/file', 'https://cdn-lfs-us-1.hf.co/file']) assert.equal(isHubAddress(url), true, url);
  for (const url of [
    'http://huggingface.co/x', 'https://huggingface.co.example.net/x', 'https://example.net/huggingface.co', 'https://nothuggingface.co/x', 'https://hf.co.example.net/x',
    'https://user@huggingface.co/x', 'https://huggingface.co:8443/x', 'https://127.0.0.1/x', 'file:///etc/passwd', 'not an address'
  ]) assert.equal(isHubAddress(url), false, url);
});

test('a file is the pinned one only with the exact size and SHA-256', async (t) => {
  const { pinned, files } = await syntheticRoot(t);
  const file = pinned.model.files[1];
  assert.equal(mismatch(file, files[file.path]), null);
  assert.match(mismatch(file, Buffer.concat([files[file.path], Buffer.from('x')])), /has 14 bytes, the pinned file has 13/);
  assert.match(mismatch(file, Buffer.from('encoder BYTES')), /does not have the pinned SHA-256/);
});

/** Starts the handler on a free port of this computer. */
async function serve(t, options) {
  const server = createServer(createPrototypeHandler(options));
  await new Promise((resolve) => server.listen(0, HOST, resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://${HOST}:${server.address().port}`;
}

async function servedRoot(t) {
  const made = await syntheticRoot(t);
  const model = localModelDir(made.pinned);
  await write(made.root, {
    '.site-test/index.html': '<!doctype html><title>stable</title>',
    '.site-test/v1/index.html': '<!doctype html><title>v1</title>',
    '.site-test/v3/index.html': '<!doctype html><title>experimental</title>',
    '.site-test/v3/assets/app.js': 'console.log("app")',
    '.site-test/v3/assets/runtime.wasm': 'runtime bytes',
    [`${model}/config.json`]: made.files['config.json'],
    [`${model}/onnx/encoder.onnx`]: made.files['onnx/encoder.onnx'],
    [`${model}/tokenizer.json`]: made.files['tokenizer.json'],
    // In the model folder, but not on the list.
    [`${model}/notes.txt`]: 'not pinned',
    'package.json': '{"private":true}'
  });
  return made;
}

test('the server answers this computer only, with static files and no policy header', async (t) => {
  assert.equal(HOST, '127.0.0.1');
  const { root } = await servedRoot(t);
  const origin = await serve(t, { root });

  for (const [path, type, body] of [
    ['/eng-trainer/', 'text/html; charset=utf-8', '<!doctype html><title>stable</title>'],
    ['/eng-trainer/v1/', 'text/html; charset=utf-8', '<!doctype html><title>v1</title>'],
    ['/eng-trainer/v3/', 'text/html; charset=utf-8', '<!doctype html><title>experimental</title>'],
    ['/eng-trainer/v3/index.html', 'text/html; charset=utf-8', '<!doctype html><title>experimental</title>'],
    ['/eng-trainer/v3/assets/app.js', 'text/javascript; charset=utf-8', 'console.log("app")'],
    ['/eng-trainer/v3/assets/runtime.wasm', 'application/wasm', 'runtime bytes']
  ]) {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get('content-type'), type, path);
    assert.equal(await response.text(), body, path);
    assert.equal(response.headers.get('cache-control'), 'max-age=600');
    // Like GitHub Pages: nothing here confines a page or a Worker. That has to come from the page.
    for (const header of ['content-security-policy', 'content-security-policy-report-only', 'cross-origin-opener-policy', 'cross-origin-embedder-policy', 'cross-origin-resource-policy']) {
      assert.equal(response.headers.get(header), null, `${path} ${header}`);
    }
  }
});

test('the model is served below the experimental route, the pinned files only, byte for byte', async (t) => {
  const { root, pinned, files } = await servedRoot(t);
  const origin = await serve(t, { root });
  const mount = `${origin}/eng-trainer/v3/models/${pinned.model.id}/`;

  for (const file of pinned.model.files) {
    const response = await fetch(`${mount}${file.path}`);
    assert.equal(response.status, 200, file.path);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), files[file.path]);
    assert.equal(response.redirected, false);
  }
  for (const path of [
    `${mount}notes.txt`,
    `${mount}generation_config.json`,
    `${mount}`,
    `${origin}/eng-trainer/v3/models/`,
    `${origin}/eng-trainer/v3/models/other-model/config.json`,
    `${origin}/eng-trainer/models/${pinned.model.id}/config.json`,
    `${origin}/models/${pinned.model.id}/config.json`
  ]) {
    assert.equal((await fetch(path)).status, 404, path);
  }
});

test('nothing outside the two folders is served: no parent folder, no other path, no other method', async (t) => {
  const { root, pinned } = await servedRoot(t);
  const origin = await serve(t, { root });
  const model = `/eng-trainer/v3/models/${pinned.model.id}`;

  // A raw request, because a client would tidy these addresses before it sends them.
  const raw = (path, method = 'GET') => new Promise((resolve, reject) => {
    const { hostname, port } = new URL(origin);
    import('node:http').then(({ request }) => {
      const sent = request({ hostname, port, path, method }, (response) => {
        let body = '';
        response.on('data', (chunk) => { body += chunk; });
        response.on('end', () => resolve({ status: response.statusCode, body }));
      });
      sent.on('error', reject);
      sent.end();
    });
  });

  for (const path of [
    '/', '/package.json', '/eng-trainer', '/other/', '/eng-trainer/../package.json', '/eng-trainer/%2e%2e/package.json', '/eng-trainer/v3/..%2f..%2fpackage.json',
    '/eng-trainer/v3/%2e%2e/%2e%2e/package.json', `${model}/../../../../package.json`, `${model}/%2e%2e/%2e%2e/%2e%2e/%2e%2e/package.json`, `${model}/..%5c..%5cpackage.json`,
    '/eng-trainer/v3/assets/', '/eng-trainer/v3/missing.js', '/eng-trainer/%00', '/eng-trainer/%E0%A4%A'
  ]) {
    const answer = await raw(path);
    assert.ok(answer.status === 404 || answer.status === 400, `${path} answered ${answer.status}`);
    assert.doesNotMatch(answer.body, /"private"/, path);
  }
  assert.equal((await raw('/eng-trainer/v3/', 'POST')).status, 405);
  assert.equal((await raw(`${model}/config.json`, 'PUT')).status, 405);
  assert.equal((await raw(`${model}/config.json`, 'DELETE')).status, 405);
  const head = await fetch(`${origin}/eng-trainer/v3/assets/app.js`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), '18');
});

test('a test may answer a request itself, to inject a fault', async (t) => {
  const { root, pinned } = await servedRoot(t);
  const seen = [];
  const origin = await serve(t, {
    root,
    intercept: ({ response, path, file }) => {
      seen.push([path, Boolean(file)]);
      if (!path.endsWith('/tokenizer.json')) return false;
      response.writeHead(503).end('injected');
      return true;
    }
  });
  const mount = `${origin}/eng-trainer/v3/models/${pinned.model.id}/`;
  assert.equal((await fetch(`${mount}tokenizer.json`)).status, 503);
  assert.equal((await fetch(`${mount}config.json`)).status, 200);
  assert.equal((await fetch(`${mount}absent.json`)).status, 404);
  assert.deepEqual(seen.map(([path, found]) => [path.split('/').pop(), found]), [['tokenizer.json', true], ['config.json', true], ['absent.json', false]]);
});

test('the server names what is missing before it starts, and checks the local model against the list', async (t) => {
  const { root, pinned, files } = await syntheticRoot(t);
  assert.deepEqual(missingInputs(root), [
    'The local assembly is missing (.site-test/). Run: npm run prototype:build',
    'The model file config.json is missing. Run: npm run prototype:model',
    'The model file onnx/encoder.onnx is missing. Run: npm run prototype:model',
    'The model file tokenizer.json is missing. Run: npm run prototype:model'
  ]);

  const model = localModelDir(pinned);
  await write(root, {
    '.site-test/v3/index.html': 'experimental',
    [`${model}/config.json`]: files['config.json'],
    [`${model}/onnx/encoder.onnx`]: Buffer.from('ENCODER bytes'),
    [`${model}/tokenizer.json`]: Buffer.from('{} ')
  });
  // A file of another size is noticed at once; the same size with other bytes when the model is verified.
  assert.deepEqual(missingInputs(root), ['The model file tokenizer.json is not the pinned one. Run: npm run prototype:model']);
  await write(root, { [`${model}/tokenizer.json`]: files['tokenizer.json'] });
  assert.deepEqual(missingInputs(root), []);
  assert.deepEqual(verifyLocalModel(root), ['onnx/encoder.onnx does not have the pinned SHA-256']);
  await write(root, { [`${model}/onnx/encoder.onnx`]: files['onnx/encoder.onnx'] });
  assert.deepEqual(verifyLocalModel(root), []);
});

test('the model folder is ignored by Git, and no script puts a model into a build', async () => {
  const ignore = await readFile(join(repoRoot, '.gitignore'), 'utf8');
  assert.match(ignore, /^\.local\/$/m);
  const pkg = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['prototype:model'], 'node scripts/prototype/fetch-model.mjs');
  assert.equal(pkg.scripts['prototype:serve'], 'node scripts/prototype/server.mjs');
  // The build, the assembly and the checks never run the model tools.
  for (const [name, command] of Object.entries(pkg.scripts)) {
    if (!name.startsWith('prototype:')) assert.doesNotMatch(command, /prototype:|prototype\/(?:fetch-model|server)\.mjs/, name);
  }
  const workflow = await readFile(join(repoRoot, '.github', 'workflows', 'deploy.yml'), 'utf8');
  assert.doesNotMatch(workflow, /prototype|huggingface|\.local/);
});
