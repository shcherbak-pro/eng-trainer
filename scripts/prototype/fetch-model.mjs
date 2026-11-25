// Downloads the pinned speech model to a local folder for the prototype (ENG-V3-02, stage A).
//
//   npm run prototype:model
//
// - It contacts one host, the Hugging Face Hub, from this computer, and asks only for the
//   pinned files at the pinned commit. A browser never contacts that host: the prototype
//   server serves the files from this folder.
// - A file is kept only when its size and SHA-256 match the pinned list. Anything else
//   stops the run, and the file is not written.
// - A redirect is followed only to the hub's own storage hosts.
// - The folder (.local/models/) is ignored by Git. Nothing here reaches a build or the
//   published site.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { repoRoot } from '../site-config.mjs';
import { hubUrl, isHubAddress, localModelDir, mismatch, readPinned } from './model-files.mjs';

const MAX_REDIRECTS = 4;

async function download(url) {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const { hostname } = new URL(current);
    if (!isHubAddress(current)) throw new Error(`refused: ${hostname} is not a host of the model hub`);
    const response = await fetch(current, { redirect: 'manual' });
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get('location');
      if (!next) throw new Error(`a redirect without a destination, from ${hostname}`);
      current = new URL(next, current).href;
      continue;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${hostname}`);
    return Buffer.from(await response.arrayBuffer());
  }
  throw new Error('too many redirects');
}

try {
  const pinned = readPinned();
  const target = join(repoRoot, ...localModelDir(pinned).split('/'));
  console.log(`${pinned.model.name}: ${pinned.model.repository} at ${pinned.model.revision} (${pinned.model.licence})`);
  console.log(`Folder: ${localModelDir(pinned)}/`);

  for (const file of pinned.model.files) {
    const path = join(target, ...file.path.split('/'));
    if (existsSync(path)) {
      const problem = mismatch(file, readFileSync(path));
      if (!problem) {
        console.log(`  kept        ${file.path} (${file.bytes} bytes, verified)`);
        continue;
      }
      console.log(`  replacing   ${file.path}: ${problem}`);
      rmSync(path);
    }
    const bytes = await download(hubUrl(pinned, file));
    const problem = mismatch(file, bytes);
    if (problem) throw new Error(`${problem}. The file was not written.`);
    mkdirSync(dirname(path), { recursive: true });
    // Written under another name first, so an interrupted run leaves no file with the final name.
    writeFileSync(`${path}.part`, bytes);
    renameSync(`${path}.part`, path);
    console.log(`  downloaded  ${file.path} (${file.bytes} bytes, verified)`);
  }
  console.log('The model is complete. Serve it with: npm run prototype:serve');
} catch (error) {
  console.error(`The model was not completed: ${error.message}`);
  process.exit(1);
}
