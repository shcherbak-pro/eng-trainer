// ENG-V2-02A Fable review — `npm run dev` probe in a DISPOSABLE copy.
// Starts the documented dev command, waits for Vite, fetches the manifest and
// every pack under /eng-trainer/data/, compares them with the generated files,
// then stops the server (process tree).
// Usage: node dev-probe.mjs <disposable-copy> [port]
import { spawn, execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(process.argv[2]);
const port = Number(process.argv[3] ?? 5179);
const child = spawn(`npm run dev -- --port ${port} --strictPort`, { cwd: root, shell: true });
let output = '';
// Vite colours its banner; strip ANSI escapes before matching.
const append = (chunk) => { output += String(chunk).replace(/\x1b\[[0-9;]*m/g, ''); };
child.stdout.on('data', append);
child.stderr.on('data', append);
const stop = () => {
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGTERM');
  } catch { /* already stopped */ }
};
const result = { generatedBeforeStart: false, manifest: null, packsMatched: 0, packs: 0 };
try {
  const deadline = Date.now() + 60_000;
  while (!/Local:\s+http/.test(output)) {
    if (Date.now() > deadline || child.exitCode !== null) throw new Error(`dev server did not start:\n${output}`);
    await new Promise((done) => setTimeout(done, 250));
  }
  result.generatedBeforeStart = output.indexOf('Generated 11 built-in packs') >= 0 && output.indexOf('Generated 11 built-in packs') < output.indexOf('Local:');
  const base = `http://localhost:${port}/eng-trainer/data/`;
  const manifestText = await (await fetch(`${base}manifest.json`)).text();
  const manifest = JSON.parse(manifestText);
  result.manifest = manifestText === await readFile(join(root, 'public/data/manifest.json'), 'utf8');
  result.packs = manifest.packs.length;
  for (const entry of manifest.packs) {
    const served = await (await fetch(`${base}${entry.url}`)).text();
    if (served === await readFile(join(root, 'public/data', entry.url), 'utf8')) result.packsMatched++;
  }
  const page = await (await fetch(`http://localhost:${port}/eng-trainer/`)).text();
  result.indexServed = page.includes('<div id="app"') || page.includes('id="app"');
} finally {
  stop();
}
console.log(JSON.stringify(result));
process.exit(result.generatedBeforeStart && result.manifest && result.packs === 11 && result.packsMatched === 11 ? 0 : 1);
