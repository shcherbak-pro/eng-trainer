// Copies the differential test into a DISPOSABLE candidate copy, together with
// the released modules and monolith extracted from the pinned release commit.
// Never run this against the developer's working tree.
//
// Usage: node prepare-differential.mjs <disposable-candidate-root>
// Then:  (cd <root> && REVIEW_OUT=... npx vitest run src/review-fable)
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASELINE = 'c84ef30d80ffbaae4ac0f3aa0fb7fe6090b8067b';
const root = resolve(process.argv[2]);
const here = dirname(fileURLToPath(import.meta.url));
if (!existsSync(join(root, '.git'))) throw new Error(`${root} is not a disposable Git clone`);
const target = join(root, 'src', 'review-fable');
const files = {
  'baseline/content/catalog.ts': 'src/content/catalog.ts',
  'baseline/content/search.ts': 'src/content/search.ts',
  'baseline/content/types.ts': 'src/content/types.ts',
  'baseline/shared/text.ts': 'src/shared/text.ts',
  'baseline/features/flashcards/flashcards.ts': 'src/features/flashcards/flashcards.ts',
  'baseline/features/flashcards/types.ts': 'src/features/flashcards/types.ts',
  'baseline/materials.json': 'public/data/materials.json'
};
for (const [to, from] of Object.entries(files)) {
  const path = join(target, to);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, execFileSync('git', ['show', `${BASELINE}:${from}`], { cwd: root, maxBuffer: 64 << 20 }));
}
copyFileSync(join(here, 'search-differential.test.ts'), join(target, 'search-differential.test.ts'));
console.log(`Prepared ${Object.keys(files).length} released files and the differential test in ${target}`);
