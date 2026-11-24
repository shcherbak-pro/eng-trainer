// The folders that this repository's scripts generate, and the only folders they may
// empty or delete (ENG-V3-01-RC1).
//
// Before a script removes a folder, it proves two things here:
//
//   1. The folder is on the list below, spelled exactly as written there. The list is
//      code. site.config.json has to agree with it and cannot add to it, so no
//      configuration value decides what is deleted.
//   2. On disk, every part of the path that exists is a real folder with exactly that
//      name, inside the repository. A file, a symbolic link, a Windows junction and a
//      folder under another spelling ("SRC" for "src" on a disk that ignores case) are
//      all refused.
//
// A refusal removes, creates and repairs nothing: the run stops and a person decides.
// Nothing in this module reads an environment variable or a command-line argument.
import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

/** Build of the stable product. Vite empties it before it writes. */
export const STABLE_BUILD_DIR = 'dist';
/** Build of the experimental product. Vite empties it before it writes. */
export const EXPERIMENTAL_BUILD_DIR = 'dist-v3';
/** Staged public folder of the experimental product. Rebuilt from nothing on every run. */
export const EXPERIMENTAL_PUBLIC_DIR = '.variant/experimental-v3/public';
/** The folder that is uploaded to GitHub Pages. Only the production assembly writes it. */
export const PRODUCTION_SITE_DIR = 'site-dist';
/** The local three-product assembly for browser checks. */
export const TEST_SITE_DIR = '.site-test';
/** Work area of the promotion rehearsal. */
export const REHEARSAL_WORK_DIR = '.rehearsal';
/** Work area of the negative checks. */
export const NEGATIVE_WORK_DIR = '.local/negative';

/**
 * Every generated folder and its one use. A caller names the uses it accepts, so the
 * staging step cannot empty a build folder and the assembly cannot empty a staged one.
 */
export const GENERATED_DIRS = Object.freeze({
  [STABLE_BUILD_DIR]: 'build',
  [EXPERIMENTAL_BUILD_DIR]: 'build',
  [EXPERIMENTAL_PUBLIC_DIR]: 'staged-public',
  [PRODUCTION_SITE_DIR]: 'site',
  [TEST_SITE_DIR]: 'site'
});

/** Work areas of the checks. The area and every folder below it is generated; its use is "work". */
export const WORK_AREAS = Object.freeze([REHEARSAL_WORK_DIR, NEGATIVE_WORK_DIR]);

/** A folder name below a work area: lower-case words joined by hyphens. No dot, no space, no "~". */
const WORK_SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The use of a generated folder. Throws when `dir` is not one. The comparison is exact
 * text: nothing is trimmed, lower-cased or normalized first, so no other spelling of a
 * listed folder, and no path that only leads to one, is accepted. It does not read the disk.
 */
export function generatedDirUse(dir) {
  if (typeof dir === 'string') {
    if (Object.hasOwn(GENERATED_DIRS, dir)) return GENERATED_DIRS[dir];
    for (const area of WORK_AREAS) {
      if (dir === area) return 'work';
      if (dir.startsWith(`${area}/`) && dir.slice(area.length + 1).split('/').every((segment) => WORK_SEGMENT.test(segment))) return 'work';
    }
  }
  const known = [...Object.keys(GENERATED_DIRS), ...WORK_AREAS.map((area) => `${area} and folders below it`)].join(', ');
  throw new Error(`${JSON.stringify(dir) ?? String(dir)} is not a generated folder of this repository, so no script may empty or delete it. The generated folders are: ${known}.`);
}

/**
 * Proves that `dir` (relative to `root`, with "/") may be emptied or deleted for one of the
 * accepted `uses`. Returns its absolute path and whether it exists. Throws otherwise, and
 * changes nothing in either case.
 *
 * On disk, each existing part of the path, from the repository folder down, must be a
 * real folder that its parent lists under exactly this name. Parts that do not exist yet
 * are fine: the caller creates them.
 */
export function assertGeneratedDir(root, dir, uses) {
  const use = generatedDirUse(dir);
  if (!uses.includes(use)) {
    throw new Error(`"${dir}" is a generated folder for "${use}". Here only ${uses.map((item) => `"${item}"`).join(' or ')} is accepted.`);
  }

  // Links above the repository are the machine's own business; everything below it is checked.
  const base = realpathSync.native(root);
  const refuse = (part, what) => {
    throw new Error(`The generated folder "${dir}" cannot be used: "${part}" ${what}. Nothing was removed or created. Look at it by hand: the scripts never repair this.`);
  };

  let current = base;
  let exists = true;
  for (const segment of dir.split('/')) {
    const next = join(current, segment);
    const part = relative(base, next).split(sep).join('/');
    let stats;
    try {
      stats = lstatSync(next);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      exists = false;
      break;
    }
    if (stats.isSymbolicLink()) refuse(part, 'is a symbolic link or a junction, not a real folder');
    if (!stats.isDirectory()) refuse(part, 'is a file, not a folder');
    // The disk answered for this name, but its parent lists no entry spelled this way.
    if (!readdirSync(current).includes(segment)) refuse(part, 'exists on disk under another spelling');
    current = next;
  }
  // The same question asked of the operating system: the path must resolve to itself.
  if (exists && realpathSync.native(current) !== current) refuse(dir, `resolves to "${realpathSync.native(current)}"`);

  return { path: join(base, ...dir.split('/')), exists };
}

/**
 * Deletes a generated folder with everything in it, after `assertGeneratedDir` accepted
 * it. Returns its absolute path, so the caller creates the folder again at the very place
 * that was checked. There is no `force` and no retry: an unexpected state stops the run.
 */
export async function removeGeneratedDir(root, dir, uses) {
  const { path, exists } = assertGeneratedDir(root, dir, uses);
  if (exists) await rm(path, { recursive: true });
  return path;
}

/**
 * Vite empties its output folder before it writes a build. `outDir` is the value Vite
 * resolved, whether it came from vite.config.ts, an inline option or the command line.
 * It is accepted only when it is a product build folder or lies in a work area.
 */
export function assertBuildOutDir(root, outDir) {
  const dir = relative(resolve(root), resolve(root, outDir)).split(sep).join('/');
  return assertGeneratedDir(root, dir, ['build', 'work']);
}

/**
 * A build of this repository has one destination: the folder `build.outDir`, emptied
 * before anything is written to it (ENG-V3-01-RC2). `config` is the configuration Vite
 * resolved from every source: vite.config.ts, an inline option of the JavaScript API and
 * the command line.
 *
 * Vite builds from `config.environments[name].build`. `config.build` is the set of
 * options that plugins and older code read. Every one of these sets is checked:
 *
 *   - `outDir` must be a product build folder or lie in a work area (see above).
 *   - `rollupOptions.output` must be absent. Vite empties every folder that an output
 *     names with `dir`, as an object or as a list, in place of `outDir`. These builds
 *     need no Rollup output option, so none is accepted: not `dir`, not `file`, and not
 *     a list in which one entry is harmless.
 *   - `emptyOutDir` must not be false. Vite then removes whatever lies inside the
 *     folder, a link included, before it writes a file there.
 *
 * Throws at the first set that fails. It reads the disk and changes nothing. This was
 * read against Vite 6.4.3 (getResolvedOutDirs and prepareOutDir); a Vite update has to
 * repeat that reading, and scripts/build-destinations.test.mjs fails until it is done.
 */
export function assertBuildDestinations(config) {
  const sets = [['build', config.build], ...Object.entries(config.environments).map(([name, environment]) => [`environments.${name}.build`, environment.build])];
  for (const [name, build] of sets) {
    const stopped = 'The build stopped before any folder was emptied.';
    if (build.rollupOptions?.output !== undefined) {
      throw new Error(`"${name}.rollupOptions.output" is set. A build of this repository accepts no Rollup output option: Vite empties every folder that such an option names, and "${name}.outDir" is the only destination. ${stopped}`);
    }
    if (build.emptyOutDir === false) {
      throw new Error(`"${name}.emptyOutDir" is false. A build of this repository always empties its output folder first, so that nothing left inside it, a link included, is written through. ${stopped}`);
    }
    assertBuildOutDir(config.root, build.outDir);
  }
}
