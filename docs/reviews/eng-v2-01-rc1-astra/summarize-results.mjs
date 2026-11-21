// Aggregate final, unchanged, and supplemental evidence without combining their counts.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
const root=resolve(process.argv[2]||'.'),out=join(root,'docs/reviews/eng-v2-01-rc1-astra');
const read=file=>JSON.parse(readFileSync(file,'utf8'));
const rows=[];
const groups=[
  ['Original Astra baseline','../eng-v2-01-astra/browser-',17,14],
  ['Fable RC1 unchanged suite (provided)','../eng-v2-01-rc1-fable/browser-',17,16],
  ['Astra RC1 unchanged suite','unchanged/browser-',17,16],
  ['Astra RC1 corrected complete suite','corrected-final/browser-',17,17],
  ['Fable supplement (provided)','../eng-v2-01-rc1-fable/identity-supplement-',3,3],
  ['Fable supplement (Astra rerun)','fable-supplement/identity-supplement-',3,3],
  ['Additional independent Astra scenarios','independent-final/independent-',4,4]
];
for(const [group,prefix,total,pass] of groups)for(const engine of ['chromium','firefox']) {
  const file=prefix+engine+'.json',data=read(join(out,file));
  assert.equal(data.results.length,total,`${group}: ${engine} scenario count`);
  const passed=data.results.filter(r=>r.status==='PASS').length;
  assert.equal(passed,pass,`${group}: ${engine} passing scenarios`);
  rows.push({group,engine,version:data.version,total,passed,failed:total-passed,evidence:file,failures:data.results.filter(r=>r.status!=='PASS').map(r=>({name:r.name,failure:r.failure||r.error})),pageErrors:data.results.flatMap(r=>(r.errors||[]).map(error=>({name:r.name,error}))),consoleErrors:data.results.flatMap(r=>(r.consoleErrors||[]).map(error=>({name:r.name,error}))),failedRequests:data.results.flatMap(r=>(r.failedRequests||[]).map(request=>({name:r.name,...request})))});
}
const unchanged=read(join(out,'unchanged/artifact.json')),artifact=read(join(out,'corrected-final/artifact.json'));
assert.deepEqual(unchanged,artifact,'Both full suites used the same production artifact bytes');
assert.equal(artifact.length,10);
const corpus=read(join(out,'corpus-audit.json'));
assert(corpus.topics.every(t=>t.oldCount===t.count),'All shipped topic totals are unchanged');
for(const row of rows.filter(r=>['Astra RC1 corrected complete suite','Fable supplement (Astra rerun)','Additional independent Astra scenarios'].includes(r.group))) {
  row.unexpectedConsoleErrors=row.consoleErrors.filter(({name,error})=>!(row.engine==='firefox'&&error.includes('downloadable font: download failed')&&error.includes('https://fonts.gstatic.com/'))&&!(name==='content-failure-retry'&&error.includes('503')));
  row.unexpectedFailedRequests=row.failedRequests.filter(r=>!r.url.startsWith('https://fonts.gstatic.com/'));
  assert.deepEqual(row.unexpectedConsoleErrors,[]);
  assert.deepEqual(row.unexpectedFailedRequests,[]);
}
for(const engine of ['chromium','firefox']) {
  const before=read(join(out,`unchanged/browser-${engine}.json`)).results;
  const after=read(join(out,`corrected-final/browser-${engine}.json`)).results;
  assert.deepEqual(before.map(r=>r.name),after.map(r=>r.name));
  assert.deepEqual(before.filter(r=>r.status==='FAIL').map(r=>r.name),['distinct-entry-identities-with-similar-display-text']);
  assert(after.every(r=>r.errors.length===0));
}
const result={date:new Date().toISOString(),status:'PASS',candidate:read(join(out,'candidate.json')).candidate,rows,artifactFiles:artifact.length,allTopicTotalsUnchanged:true,topics:corpus.topics.length};
writeFileSync(join(out,'verification-summary.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({...result,rows:rows.map(({failures,pageErrors,consoleErrors,failedRequests,...r})=>({...r,pageErrorCount:pageErrors.length,consoleErrorCount:consoleErrors.length,failedRequestCount:failedRequests.length}))},null,2));
