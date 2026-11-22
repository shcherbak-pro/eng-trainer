// Replaces machine-specific paths and the account name in published evidence text.
import { homedir, userInfo } from 'node:os';

const user = userInfo().username;
const home = homedir();
const repoRoot = process.cwd();

function variants(path) {
  const forward = path.replace(/\\/g, '/');
  const drive = /^([A-Za-z]):/.exec(forward)?.[1];
  const forms = new Set([path, forward, path.replace(/\\/g, '\\\\')]);
  if (drive) {
    for (const letter of [drive.toLowerCase(), drive.toUpperCase()]) {
      forms.add(`${letter}${path.slice(1)}`);
      forms.add(`${letter}${forward.slice(1)}`);
      forms.add(`${letter}${path.replace(/\\/g, '\\\\').slice(1)}`);
      forms.add(`/${letter.toLowerCase()}${forward.slice(2)}`);
    }
    forms.add(`file:///${forward}`);
  }
  return [...forms].sort((a, b) => b.length - a.length);
}

/** Longest first, so the repository path wins over the home folder that contains it. */
const REPLACEMENTS = [
  ...variants(repoRoot).map((form) => [form, '<repo>']),
  ...variants(home).map((form) => [form, '<user-home>'])
];

export function sanitize(text) {
  let out = text;
  for (const [from, to] of REPLACEMENTS) out = out.split(from).join(to);
  // Short (8.3) temp paths and any remaining mention of the account name.
  out = out.replace(/[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"']+~\d/g, '<user-home>');
  if (user.length > 2) out = out.split(user).join('<user>');
  return out;
}
