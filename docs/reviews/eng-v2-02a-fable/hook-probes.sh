#!/usr/bin/env bash
# ENG-V2-02A Fable review — npm lifecycle-hook probes.
# Runs ONLY in a disposable full copy of the candidate (with node_modules).
# Usage: bash hook-probes.sh <disposable-copy> <log-file>
set -u
copy="$1"; log="$2"
cd "$copy" || exit 2
: > "$log"
say() { printf '%s\n' "$*" | tee -a "$log"; }
h() { sha256sum "$1" 2>/dev/null | cut -c1-16; }
pack=content/packs/presentations.json
orig="$copy/.presentations.orig"
cp "$pack" "$orig"

say "== clean npm run build"
npm run build >> "$log" 2>&1; say "exit $?"
before_dist=$(h dist/index.html); before_manifest=$(h public/data/manifest.json)
say "dist/index.html=$before_dist manifest=$before_manifest"

say "== invalid source (duplicate phrase id across packs)"
node -e '
const fs=require("fs");const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
p.content.phrases[0].id="phrase-001";fs.writeFileSync(process.argv[1],JSON.stringify(p,null,2)+"\n");' "$pack"
for cmd in "run build" "test" "run check"; do
  npm $cmd >> "$log" 2>&1; ec=$?
  say "npm $cmd -> exit $ec; dist unchanged=$([ "$(h dist/index.html)" = "$before_dist" ] && echo yes || echo no); manifest unchanged=$([ "$(h public/data/manifest.json)" = "$before_manifest" ] && echo yes || echo no)"
done
timeout 60 npm run dev -- --port 5999 --strictPort >> "$log" 2>&1; ec=$?
say "npm run dev -> exit $ec (124 would mean the dev server started)"

say "== valid content edit, then DIRECT vite build (bypasses the generation hook)"
cp "$orig" "$pack"
node -e '
const fs=require("fs");const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
p.content.phrases[0].translation="FABLE-REVIEW-MARKER";fs.writeFileSync(process.argv[1],JSON.stringify(p,null,2)+"\n");' "$pack"
npx vite build >> "$log" 2>&1; say "npx vite build -> exit $?"
say "marker in dist/data: $(grep -rl FABLE-REVIEW-MARKER dist/data | wc -l) file(s) (0 = stale content published)"
npm run build:v1 >> "$log" 2>&1 && npm run assemble >> "$log" 2>&1 && npm run check:site >> "$log" 2>&1; say "assemble + check:site on the stale build -> exit $?"
npm run build >> "$log" 2>&1; say "npm run build -> exit $?; marker in dist/data: $(grep -rl FABLE-REVIEW-MARKER dist/data | wc -l) file(s)"
npm test >> "$log" 2>&1; ec=$?
say "npm test with an intentional content edit -> exit $ec (frozen migration fingerprints)"
grep -a -E "not ok|✖" "$log" | head -5 | tee -a "$log"

say "== restore"
cp "$orig" "$pack" && rm -f "$orig"
npm run build >> "$log" 2>&1; say "restored npm run build -> exit $?; manifest restored=$([ "$(h public/data/manifest.json)" = "$before_manifest" ] && echo yes || echo no)"
