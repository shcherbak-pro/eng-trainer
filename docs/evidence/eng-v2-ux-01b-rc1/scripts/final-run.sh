#!/usr/bin/env bash
# ENG-V2-UX-01B-RC1 final verification: required commands, review tests, font check and the four browser runs.
set -u
REPO=<repo>
HERE="$(cd "$(dirname "$0")" && pwd)"
HERE_W="$(cygpath -m "$HERE")"
LOGS="$HERE/final-logs"
BROWSERS="$REPO/.git/eng-v2-02b-release/browsers"
PWTOOLS="$REPO/.git/eng-v2-02b-release/tools/node_modules"
rm -rf "$LOGS" "$HERE/out-regression" "$HERE/out-astra" "$HERE/out-astra-font" "$HERE/out-rc1"
mkdir -p "$LOGS"
cd "$REPO" || exit 1

{
  echo "date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "node: $(node --version)"
  echo "npm: $(npm --version)"
  echo "git HEAD: $(git rev-parse HEAD)"
  echo "branch: $(git branch --show-current)"
  echo "python: $("$HERE/fontenv/Scripts/python.exe" --version 2>&1)"
  echo "font tools: $("$HERE/fontenv/Scripts/python.exe" -m pip freeze --disable-pip-version-check 2>/dev/null | tr '\n' ' ')"
} > "$LOGS/environment.txt"

run() {
  local name="$1"; shift
  echo "== $name" >&2
  "$@" > "$LOGS/$name.log" 2>&1
  echo "$name $?" >> "$LOGS/exit-codes.txt"
}

run check npm run check
run test npm test
run check-v1 npm run check:v1
run test-v1 npm run test:v1
run build npm run build
run build-site npm run build:site
run verify-content npm run verify:content
run diff-check git -c core.whitespace=cr-at-eol diff --check
run astra-independent-tests node node_modules/vitest/vitest.mjs run --config docs/reviews/eng-v2-ux-01b-astra/vitest.config.ts
run font-check "$HERE/fontenv/Scripts/python.exe" scripts/fonts/derive_eng_trainer_sans.py --check --input-dir "$HERE_W/fonts/originals" --output-dir src/assets/fonts --report "$HERE_W/font-check.json"

export PLAYWRIGHT_BROWSERS_PATH="$BROWSERS"
# 1. The existing UX-01B runner, unchanged.
run browser-regression node docs/evidence/eng-v2-ux-01b/browser-check.mjs "$PWTOOLS" "$(cygpath -m "$REPO/site-dist")" "$HERE_W/out-regression"
# 2. Astra's independent harness, unchanged, new output path.
REVIEW_OUT="$HERE_W/out-astra" run browser-astra node docs/reviews/eng-v2-ux-01b-astra/browser-independent.mjs
# 3. The same harness with only the family name of its glyph case adjusted (see font-adjustment.diff).
REVIEW_OUT="$HERE_W/out-astra-font" ONLY=long-content-reflow-and-glyphs run browser-astra-font-adjusted node "$HERE_W/astra-adjusted/browser-independent-font-adjusted.mjs"
# 4. The RC1 checks.
run browser-rc1 node "$HERE_W/rc1-browser-check.mjs" "$PWTOOLS" "$(cygpath -m "$REPO/site-dist")" "$HERE_W/out-rc1"
cat "$LOGS/exit-codes.txt"
