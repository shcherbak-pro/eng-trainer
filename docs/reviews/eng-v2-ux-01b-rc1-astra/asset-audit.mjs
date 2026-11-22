import {readFileSync,readdirSync,writeFileSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {brotliDecompressSync} from 'node:zlib';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
const out='docs/reviews/eng-v2-ux-01b-rc1-astra';
const hash=b=>createHash('sha256').update(b).digest('hex');
const tags='cmap head hhea hmtx maxp name OS/2 post cvt_ fpgm glyf loca prep CFF_ VORG EBDT EBLC gasp hdmx kern LTSH PCLT VDMX vhea vmtx BASE GDEF GPOS GSUB EBSC JSTF MATH CBDT CBLC COLR CPAL SVG_ sbix acnt avar bdat bloc bsln cvar fdsc feat fmtx fvar gvar hsty just lcar mort morx opbd prop trak Zapf Silf Glat Gloc Feat Sill'.split(' ').map(t=>t.replaceAll('_',' '));
function metadata(b){
 let i=48,offset=0;const tables={};const base128=()=>{let n=0;for(let x=0;x<5;x++){const c=b[i++];n=n*128+(c&127);if(!(c&128))return n;}throw Error('bad base128');};
 for(let t=0;t<b.readUInt16BE(12);t++){const flags=b[i++];const index=flags&63;const tag=index===63?b.toString('ascii',i,(i+=4)):tags[index];const length=base128();const transformed=['glyf','loca'].includes(tag)?(flags>>6)!==3:(flags>>6)!==0;const size=transformed?base128():length;tables[tag]={offset,length:size,transformed};offset+=size;}
 const data=brotliDecompressSync(b.subarray(i,i+b.readUInt32BE(20)));const table=tag=>{const t=tables[tag];return t?data.subarray(t.offset,t.offset+t.length):null;};const n=table('name'),names={};
 for(let x=0;x<n.readUInt16BE(2);x++){const at=6+x*12,platform=n.readUInt16BE(at),id=n.readUInt16BE(at+6),len=n.readUInt16BE(at+8),start=n.readUInt16BE(4)+n.readUInt16BE(at+10);let bytes=Buffer.from(n.subarray(start,start+len));const value=platform===0||platform===3?bytes.swap16().toString('utf16le'):bytes.toString('latin1');if([0,1,2,3,4,5,6,7,8,9,11,13,14,16,17].includes(id))names[id]=value;}
 const cmap=table('cmap'),supported=new Set();for(let c=0;c<cmap.readUInt16BE(2);c++){const a=cmap.readUInt32BE(4+c*8+4),format=cmap.readUInt16BE(a);if(format===12){const groups=cmap.readUInt32BE(a+12);for(let g=0;g<groups;g++){const at=a+16+g*12,start=cmap.readUInt32BE(at),end=cmap.readUInt32BE(at+4);for(let cp=start;cp<=end;cp++)supported.add(cp);}}if(format===4){const count=cmap.readUInt16BE(a+6)/2;for(let s=0;s<count;s++){const end=cmap.readUInt16BE(a+14+s*2),start=cmap.readUInt16BE(a+16+count*2+s*2);for(let cp=start;cp<=end&&cp<65535;cp++)supported.add(cp);}}}
 const f=table('fvar'),axes=[];if(f){for(let a=0;a<f.readUInt16BE(8);a++){const p=f.readUInt16BE(4)+a*f.readUInt16BE(10);axes.push({tag:f.toString('ascii',p,p+4),min:f.readInt32BE(p+4)/65536,default:f.readInt32BE(p+8)/65536,max:f.readInt32BE(p+12)/65536});}}
 return {names,axes,codepoints:supported.size,representativeCoverage:Object.fromEntries([...new Set('EnglishУкраїнськаіїєґІЇЄҐʼɪəˈːʊðɑæʃɔɜʌɡˌŋʒθ')].map(c=>[c,supported.has(c.codePointAt(0))]))};
}
const fontDir='src/assets/fonts',assetDir='site-dist/assets';const built=readdirSync(assetDir).map(p=>({path:p,sha256:hash(readFileSync(join(assetDir,p)))}));
const fonts=readdirSync(fontDir).filter(p=>p.endsWith('.woff2')).map(path=>{const bytes=readFileSync(join(fontDir,path)),sha256=hash(bytes);return {path,bytes:bytes.length,sha256,builtMatches:built.filter(b=>b.sha256===sha256).map(b=>b.path),...metadata(bytes)};});
const v1=readdirSync('site-dist/v1',{recursive:true}).filter(p=>statSync(join('site-dist/v1',p)).isFile()).map(path=>{const current=readFileSync(join('site-dist/v1',path)),previous=readFileSync(join('.git/eng-v2-02b-release/artifact/v1',path));const text=['.html','.json','.svg'].some(e=>path.endsWith(e));return {path:path.replaceAll('\\','/'),currentHash:hash(current),releaseHash:hash(previous),byteIdentical:current.equals(previous),...(text?{onlyCRLF:current.toString('utf8').replaceAll('\r\n','\n')===previous.toString('utf8'),currentCRLF:(current.toString('utf8').match(/\r\n/g)||[]).length,releaseCRLF:(previous.toString('utf8').match(/\r\n/g)||[]).length}:{})};});
const before=JSON.parse(readFileSync(out+'/candidate-before.json','utf8'));const protectedFiles=before.files.filter(f=>f.path.startsWith('docs/design/')||f.path.startsWith('docs/releases/'));
const report={fonts,v1,protectedFiles:{count:protectedFiles.length,changed:protectedFiles.filter(f=>hash(readFileSync(f.path))!==f.sha256)},v1SourceDiff:execFileSync('git',['diff','--name-only','HEAD','--','v1'],{encoding:'utf8'}).trim(),liveReferences:[]};
// Only the three differing text files are examined. No normalization is applied to JS/CSS or binary assets.
for(const item of report.v1.filter(f=>!f.byteIdentical)){
 const current=readFileSync(join('site-dist/v1',item.path),'utf8'),release=readFileSync(join('.git/eng-v2-02b-release/artifact/v1',item.path),'utf8');
 item.CRCRLF=(current.match(/\r\r\n/g)||[]).length;
 item.onlyLineEndingCarriageReturns=current.split('\n').map(line=>line.replace(/\r+$/,'')).join('\n')===release;
 item.linesWithRepeatedCR=current.split('\n').flatMap((line,i)=>/\r\r$/.test(line)?[i+1]:[]);
}
report.artifact=readdirSync('site-dist',{recursive:true}).filter(p=>statSync(join('site-dist',p)).isFile()).map(path=>({path:path.replaceAll('\\','/'),bytes:statSync(join('site-dist',path)).size,sha256:hash(readFileSync(join('site-dist',path)))}));
if(process.argv.includes('--references')){
 const url='https://fonts.googleapis.com/css2?family=Literata:ital,opsz,wght@0,7..72,400..700;1,7..72,400..700&family=Source+Sans+3:wght@400..700&display=swap';
 try{const response=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'}});const css=await response.text();writeFileSync(out+'/google-fonts-reference.css',css);const urls=[...new Set([...css.matchAll(/url\((https:[^)]+)\)/g)].map(m=>m[1]))];for(const source of urls){const r=await fetch(source),bytes=Buffer.from(await r.arrayBuffer()),sha256=hash(bytes);report.liveReferences.push({source,status:r.status,bytes:bytes.length,sha256,localMatches:fonts.filter(f=>f.sha256===sha256).map(f=>f.path)});}report.referenceCSS={url,status:response.status,sha256:hash(css)};}catch(e){report.referenceError=String(e);}
}
writeFileSync(out+'/asset-audit.json',JSON.stringify(report,null,2)+'\n');console.log({fonts:fonts.map(f=>({file:f.path,version:f.names[5],built:f.builtMatches})),v1,protected:report.protectedFiles,referenceMatches:report.liveReferences.filter(r=>r.localMatches.length).map(r=>({source:r.source,files:r.localMatches})),error:report.referenceError});
