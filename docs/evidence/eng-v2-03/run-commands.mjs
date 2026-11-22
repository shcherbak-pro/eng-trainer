// ENG-V2-03: runs the repository's documented checks from the repository root and writes
// one log per command (ANSI color removed, machine paths replaced) and commands.json.
// Usage, from the repository root: node docs/evidence/eng-v2-03/run-commands.mjs <output-dir>
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sanitize } from './sanitize.mjs';

const outDir = process.argv[2];
mkdirSync(join(outDir, 'logs'), { recursive: true });

const COMMANDS = [
  ['check', 'npm run check'],
  ['test', 'npm test'],
  ['check-v1', 'npm run check:v1'],
  ['test-v1', 'npm run test:v1'],
  ['build', 'npm run build'],
  ['build-site', 'npm run build:site'],
  ['verify-content', 'npm run verify:content'],
  ['diff-check', 'git -c core.whitespace=cr-at-eol diff --check']
];

const summary = [];
for (const [name, command] of COMMANDS) {
  const started = Date.now();
  const result = spawnSync(command, { shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' } });
  const output = sanitize(`${result.stdout ?? ''}${result.stderr ?? ''}`).replace(/\u001b\[[0-9;]*m/g, '');
  writeFileSync(join(outDir, 'logs', `${name}.log`), `$ ${command}\n${output}\n[exit ${result.status}]\n`);
  const lines = output.split(/\r?\n/);
  const pick = (pattern) => lines.filter((line) => pattern.test(line)).map((line) => line.trim());
  summary.push({
    name,
    command,
    exitCode: result.status,
    seconds: Math.round((Date.now() - started) / 100) / 10,
    highlights: [...pick(/COMPLETED \d+ FILES|ℹ (tests|pass|fail)|Test Files|Tests {2}|passed|failed|Generated \d+ built-in packs|built in|check passed|v2 content:|v2 fonts:|exactContentAndOrderMatch|v1Unchanged/)].slice(0, 14)
  });
  console.log(name, result.status);
}

// `git diff --check` covers tracked files only. New files get the same checks here, without
// staging anything: trailing whitespace, a space before a tab in the indent, and conflict markers.
const listed = spawnSync('git', ['ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
const textFiles = listed.filter((path) => /\.(svelte|ts|js|mjs|cjs|json|md|css|html|txt)$/.test(path));
const problems = [];
for (const path of textFiles) {
  readFileSync(path, 'utf8').split('\n').forEach((line, index) => {
    const text = line.replace(/\r$/, '');
    if (/[ \t]$/.test(text)) problems.push(`${path}:${index + 1}: trailing whitespace`);
    if (/^\t* +\t/.test(text)) problems.push(`${path}:${index + 1}: space before tab in indent`);
    if (/^(<<<<<<<|>>>>>>>)( |$)|^=======$/.test(text)) problems.push(`${path}:${index + 1}: conflict marker`);
  });
}
writeFileSync(join(outDir, 'logs', 'new-files-whitespace.log'), `New text files checked: ${textFiles.length}\n${problems.join('\n')}\n[problems ${problems.length}]\n`);
summary.push({ name: 'new-files-whitespace', command: '(built-in check of untracked text files)', exitCode: problems.length ? 1 : 0, seconds: 0, highlights: [`${textFiles.length} files, ${problems.length} problems`] });
console.log('new-files-whitespace', problems.length);
writeFileSync(join(outDir, 'commands.json'), `${JSON.stringify({ platform: process.platform, node: process.version, commands: summary }, null, 2)}\n`);
