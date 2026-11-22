// Collects the ENG-V2-UX-01B evidence into docs/evidence/eng-v2-ux-01b/.
// Usage: node collect-evidence.mjs <repo> <run-dir> <before-fingerprints.sha256>
// <run-dir> holds final-logs/, out-final/ and browser-check.mjs from the final run.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

const [, , repo, run, beforeList] = process.argv;
const out = join(repo, 'docs', 'evidence', 'eng-v2-ux-01b');
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const posix = (path) => path.split(sep).join('/');
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]));
const git = (...args) => execFileSync('git', ['--no-optional-locks', ...args], { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const writeJson = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

// Regenerates everything except the hand-written README.md.
mkdirSync(out, { recursive: true });
for (const name of readdirSync(out)) if (name !== 'README.md') rmSync(join(out, name), { recursive: true, force: true });

// ------------------------------------------------------------ sanitizing
// Machine-specific paths become placeholders, terminal colour codes are removed.
const userHome = process.env.USERPROFILE ?? 'C:\\Users\\unknown';
const userName = userHome.split(/[\\/]/).pop();
/** Every spelling of a Windows path that tools print: back or forward slashes, either drive case, Git Bash, JSON-escaped. */
function pathForms(path) {
  const forward = path.replace(/\\/g, '/').replace(/^\/([a-zA-Z])\//, (match, drive) => `${drive}:/`);
  const drive = forward[0];
  const rest = forward.slice(1);
  const forms = [];
  for (const letter of [drive.toUpperCase(), drive.toLowerCase()]) {
    const slash = `${letter}${rest}`;
    const back = slash.replace(/\//g, '\\');
    forms.push(slash, back, back.replace(/\\/g, '\\\\'));
  }
  forms.push(`/${drive.toLowerCase()}${rest.slice(1)}`);
  return [...new Set(forms)];
}
const replacements = [
  ...pathForms(run).map((form) => [form, '<run>']),
  ...pathForms(repo).map((form) => [form, '<repo>']),
  ...pathForms(userHome).map((form) => [form, '<user-home>']),
  [userName, '<user>']
].sort((a, b) => b[0].length - a[0].length);
function sanitize(text) {
  let result = text.replace(/\u001b\[[0-9;]*m/g, '');
  // Windows short (8.3) user folder names, such as the one in the temporary directory.
  result = result.replace(/([\\/]Users[\\/]+)[^\\/\s"']+~\d+/gi, '$1<user>');
  for (const [from, to] of replacements) result = result.split(from).join(to);
  // Temporary directories that include the session id.
  result = result.replace(/[A-Za-z]:[\\/][^\s"']*?[\\/]Temp[\\/]claude[\\/][^\s"']*/g, '<run>');
  return result;
}

const sanitization = [];
function publishText(source, target) {
  const raw = readFileSync(source);
  const published = sanitize(raw.toString('utf8'));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, published);
  sanitization.push({ path: posix(relative(out, target)), rawSha256: sha256(raw), publishedSha256: sha256(Buffer.from(published, 'utf8')) });
}

// ------------------------------------------------------------ logs and runner
for (const name of readdirSync(join(run, 'final-logs'))) publishText(join(run, 'final-logs', name), join(out, 'logs', name));
publishText(join(run, 'browser-check.mjs'), join(out, 'browser-check.mjs'));
publishText(join(run, 'collect-evidence.mjs'), join(out, 'collect-evidence.mjs'));

// ------------------------------------------------------------ browser results
const results = JSON.parse(readFileSync(join(run, 'out-final', 'results.json'), 'utf8'));
publishText(join(run, 'out-final', 'results.json'), join(out, 'browser', 'results.json'));
for (const name of readdirSync(join(run, 'out-final', 'aria'))) publishText(join(run, 'out-final', 'aria', name), join(out, 'browser', 'aria', name));

const PUBLISHED_SHOTS = [
  // Paired with the UX-01A "before" screenshots.
  'chromium-phone-light-phrases', 'chromium-phone-light-index', 'chromium-desktop-light-phrases', 'chromium-phone-flashcards-front',
  'chromium-desktop-flashcards-front', 'chromium-phone-collections-review', 'chromium-phone-blocked-wait', 'chromium-phone-collections-conflict',
  'chromium-phone-content-error', 'chromium-phone-fonts-slow', 'chromium-narrow-light-irregularVerbs', 'chromium-phone-light-wordIndex',
  'chromium-phone-keyboard-focus', 'chromium-phone-dark-phrases',
  // New screens and states.
  'chromium-phone-light-collections', 'chromium-phone-collections-help', 'chromium-phone-collections-error', 'chromium-phone-collections-remove-dialog',
  'chromium-phone-more-sheet', 'chromium-phone-light-settings', 'chromium-phone-light-favorites', 'chromium-phone-flashcards-back',
  'chromium-phone-fonts-failed', 'chromium-narrow-text200-settings', 'chromium-narrow-dark-phrases', 'chromium-desktop-reset-dialog',
  'chromium-desktop-unhide-dialog', 'chromium-desktop-hide-undo-toast', 'chromium-desktop-dark-wordIndex',
  // Firefox.
  'firefox-phone-light-phrases', 'firefox-phone-flashcards-front', 'firefox-desktop-dark-flashcards', 'firefox-phone-collections-error',
  'firefox-phone-blocked-continue'
];
const shotsDir = join(run, 'out-final', 'shots');
const captured = readdirSync(shotsDir).filter((name) => name.endsWith('.png')).sort();
mkdirSync(join(out, 'screenshots'), { recursive: true });
for (const name of PUBLISHED_SHOTS) {
  const file = `${name}.png`;
  if (!captured.includes(file)) throw new Error(`Missing screenshot ${file}`);
  copyFileSync(join(shotsDir, file), join(out, 'screenshots', file));
}
writeJson(join(out, 'browser', 'screenshots.json'), {
  note: 'Every screenshot of the final run. Only the files marked published are in screenshots/; rerun browser-check.mjs to recreate the others.',
  files: captured.map((file) => ({ file, published: PUBLISHED_SHOTS.includes(file.replace(/\.png$/, '')), bytes: statSync(join(shotsDir, file)).size, sha256: sha256(readFileSync(join(shotsDir, file))) }))
});

// ------------------------------------------------------------ tested build and first-load budget
const site = join(repo, 'site-dist');
const siteFiles = walk(site).map((file) => ({ path: posix(relative(site, file)), file })).sort((a, b) => a.path.localeCompare(b.path));
writeJson(join(out, 'artifact.json'), siteFiles.map(({ path, file }) => ({ path, bytes: statSync(file).size, sha256: sha256(readFileSync(file)) })));

const v2 = siteFiles.filter(({ path }) => !path.startsWith('v1/'));
const gz = (file) => gzipSync(readFileSync(file), { level: 9 }).length;
const sum = (items, size) => items.reduce((total, item) => total + size(item.file), 0);
const pick = (pattern) => v2.filter(({ path }) => pattern.test(path));
const html = pick(/^index\.html$/);
const css = pick(/^assets\/.*\.css$/);
const js = pick(/^assets\/.*\.js$/);
const fonts = pick(/\.woff2$/);
const content = pick(/^data\//);
const appGzip = sum(html, gz) + sum(css, gz) + sum(js, gz);
const routes = Object.fromEntries(
  Object.entries(results.measurements ?? {})
    .filter(([key]) => key.startsWith('firstLoad-'))
    .map(([key, value]) => {
      const fontBytes = value.fonts.reduce((total, name) => total + statSync(fonts.find((font) => font.path.endsWith(name)).file).size, 0);
      return [key.replace('firstLoad-', '#'), { requests: value.requests, hosts: value.hosts, fonts: value.fonts, fontBytes, gzipEstimateBytes: value.gzipEstimateBytes }];
    })
);
const BUDGET = { appCodeGzip: 100 * 1024, firstScreenFonts: 200 * 1024, totalGzip: 550 * 1024, thirdPartyRequests: 0 };
const worst = Object.values(routes).reduce((acc, route) => ({ fontBytes: Math.max(acc.fontBytes, route.fontBytes), total: Math.max(acc.total, route.gzipEstimateBytes), hosts: [...new Set([...acc.hosts, ...route.hosts])] }), { fontBytes: 0, total: 0, hosts: [] });
writeJson(join(out, 'first-load.json'), {
  definition: 'Cold cache, one route per fresh context, 390 x 844, until the network is idle. Sizes are gzip -9 of the built files (fonts: WOFF2 as served). The local server sends uncompressed files; GitHub Pages compresses text.',
  budget: BUDGET,
  result: {
    appCodeGzip: appGzip,
    worstFirstScreenFonts: worst.fontBytes,
    worstTotalGzip: worst.total,
    hosts: worst.hosts,
    pass: appGzip <= BUDGET.appCodeGzip && worst.fontBytes <= BUDGET.firstScreenFonts && worst.total <= BUDGET.totalGzip && worst.hosts.length === 1
  },
  parts: {
    htmlGzip: sum(html, gz),
    cssGzip: sum(css, gz),
    jsGzip: sum(js, gz),
    cssRaw: sum(css, (file) => statSync(file).size),
    jsRaw: sum(js, (file) => statSync(file).size),
    allFontFiles: fonts.map(({ path, file }) => ({ path, bytes: statSync(file).size })),
    contentGzip: sum(content, gz),
    contentRaw: sum(content, (file) => statSync(file).size)
  },
  routes,
  before: {
    source: 'docs/design/ENG-V2-UX-01A.md §1.10 (production, 21 November 2026)',
    iconFontBytes: 3132808,
    note: 'The icon font was 91 % of the first-load bytes; the app JavaScript was 59 KB, CSS 8 KB, manifest and packs 241 KB as transferred.'
  }
});

// ------------------------------------------------------------ v1 preservation
const released = join(repo, '.git', 'eng-v2-02b-release', 'artifact', 'v1');
const noCr = (file) => (/\.(js|css|png|woff2)$/.test(file) ? readFileSync(file) : Buffer.from(readFileSync(file, 'utf8').replace(/\r/g, ''), 'utf8'));
const v1 = walk(released).map((file) => posix(relative(released, file))).sort().map((path) => {
  const current = join(site, 'v1', path);
  return {
    path,
    byteIdentical: existsSync(current) && sha256(readFileSync(current)) === sha256(readFileSync(join(released, path))),
    identicalIgnoringCarriageReturns: existsSync(current) && sha256(noCr(current)) === sha256(noCr(join(released, path)))
  };
});
writeJson(join(out, 'v1-preservation.json'), {
  comparedWith: 'The released ENG-V2-02B artifact (v1/ folder), kept locally under .git/eng-v2-02b-release/artifact/v1',
  note: 'This Windows checkout converts text files to CRLF (core.autocrlf=true); the release was built with LF. Built JavaScript and CSS must be byte-identical.',
  files: v1,
  currentFiles: walk(join(site, 'v1')).length,
  sourceDiffLines: git('diff', '--', 'v1').split('\n').filter(Boolean).length,
  pass: v1.every((item) => item.identicalIgnoringCarriageReturns) && v1.filter((item) => /\.(js|css)$/.test(item.path)).every((item) => item.byteIdentical) && walk(join(site, 'v1')).length === v1.length
});

// ------------------------------------------------------------ protected files and candidate scope
const protectedList = readFileSync(beforeList, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => {
  const match = /^([0-9a-f]{64}) [ *]?(.+)$/.exec(line);
  if (!match) throw new Error(`Unreadable fingerprint line: ${line}`);
  return { hash: match[1], path: match[2] };
});
const protectedResults = protectedList.map(({ path, hash }) => ({ path, unchanged: existsSync(join(repo, path)) && sha256(readFileSync(join(repo, path))) === hash }));
writeJson(join(out, 'preservation.json'), {
  note: 'Untracked files that existed before ENG-V2-UX-01B started (ENG-V2-02A/02B release evidence and the ENG-V2-UX-01A design proposal), fingerprinted at the start.',
  files: protectedResults.length,
  unchanged: protectedResults.filter((item) => item.unchanged).length,
  changed: protectedResults.filter((item) => !item.unchanged).map((item) => item.path)
});

const status = git('status', '--porcelain=v1', '--untracked-files=all', '--branch');
writeFileSync(join(out, 'git-status.txt'), `${git('rev-parse', 'HEAD').trim()}\n${status}`);
const protectedPaths = new Set(protectedList.map((item) => item.path));
const lines = status.split('\n').filter((line) => line && !line.startsWith('##'));
const candidate = lines
  .map((line) => ({ state: line.slice(0, 2).trim(), path: line.slice(3) }))
  .filter(({ path }) => !protectedPaths.has(path) && !path.startsWith('docs/evidence/eng-v2-ux-01b/'))
  .map(({ state, path }) => ({ state, path, ...(existsSync(join(repo, path)) ? { sha256: sha256(readFileSync(join(repo, path))) } : {}) }));
writeJson(join(out, 'candidate.json'), {
  baseline: git('rev-parse', 'HEAD').trim(),
  branch: git('branch', '--show-current').trim(),
  note: 'Every change of this milestone: M modified, D deleted, ?? new. Protected pre-existing files and this evidence folder are excluded. Nothing is staged.',
  staged: git('diff', '--cached', '--name-only').split('\n').filter(Boolean),
  files: candidate
});

writeJson(join(out, 'sanitization.json'), {
  policy: 'New ENG-V2-UX-01B logs, runner and results only: local repository, user and temporary paths are replaced with <repo>, <user-home>, <user> and <run>; terminal colour codes are removed. Screenshots and accessibility snapshots contain synthetic or built-in data only.',
  files: sanitization
});

console.log(JSON.stringify({ out: posix(relative(repo, out)), screenshots: PUBLISHED_SHOTS.length, captured: captured.length, protected: `${protectedResults.filter((i) => i.unchanged).length}/${protectedResults.length}`, candidate: candidate.length, v1: v1.length }, null, 1));
