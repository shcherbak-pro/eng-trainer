param([Parameter(Mandatory=$true)][string]$Suite)
$ErrorActionPreference = 'Stop'
$env:PLAYWRIGHT_BROWSERS_PATH = (Resolve-Path '.git/eng-v2-02b-release/browsers').Path
$env:ONLY = $null
$evidenceRoot = 'docs/reviews/eng-v2-ux-01b-rc1-astra'
$playwrightModules = (Resolve-Path '.git/eng-v2-02b-release/tools/node_modules').Path
$siteDirectory = (Resolve-Path 'site-dist').Path
switch ($Suite) {
  'original' {
    $env:REVIEW_OUT = "$evidenceRoot/browser-original"
    node docs/reviews/eng-v2-ux-01b-astra/browser-independent.mjs
  }
  'adjusted' {
    $env:REVIEW_OUT = "$evidenceRoot/browser-adjusted"
    node "$evidenceRoot/browser-adjusted.mjs"
  }
  'regression' {
    node docs/evidence/eng-v2-ux-01b/browser-check.mjs $playwrightModules $siteDirectory "$evidenceRoot/browser-regression"
  }
  'rc1' {
    node docs/evidence/eng-v2-ux-01b-rc1/scripts/rc1-browser-check.mjs $playwrightModules $siteDirectory "$evidenceRoot/browser-rc1"
  }
  'focused' {
    $env:REVIEW_OUT = "$evidenceRoot/browser-focused"
    node "$evidenceRoot/browser-focused.mjs"
  }
  default { throw "Unknown suite: $Suite" }
}
exit $LASTEXITCODE
