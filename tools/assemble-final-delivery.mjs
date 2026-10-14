import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const base=path.resolve(import.meta.dirname,'..');
const baseline=path.join(base,'交付包/teaching-risk-20261009T045358');
const delivery=path.join(base,'交付包/正式上线交付_2026-10-09');
const code=path.join(delivery,'代码与说明');
const data=path.join(delivery,'业务数据_单独交付');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const manifest=JSON.parse(await fs.readFile(path.join(baseline,'MANIFEST.json'),'utf8'));
for(const item of manifest.artifacts){
  const folder=item.file==='initial-summary.json'?data:code;
  const bytes=await fs.readFile(path.join(folder,item.file));
  assert.equal(hash(bytes),item.sha256);
  assert.equal(bytes.length,item.bytes);
}
async function files(folder){const found=[];for(const entry of await fs.readdir(folder,{withFileTypes:true})){const target=path.join(folder,entry.name);if(entry.isDirectory())found.push(...await files(target));else found.push(target);}return found;}
const entries=[];
for(const file of await files(code)){
  if(path.basename(file)==='DELIVERY-CHECKSUMS.json')continue;
  assert(!/^(initial-summary|approved-mapping)\.json$|\.xlsx$|\.env$|\.sqlite$|\.db$/.test(path.basename(file)));
  const bytes=await fs.readFile(file);entries.push({file:path.relative(code,file).replaceAll('\\','/'),bytes:bytes.length,sha256:hash(bytes)});
}
await fs.writeFile(path.join(code,'DELIVERY-CHECKSUMS.json'),JSON.stringify({canonicalRelease:'teaching-risk-20261009T045358',originalArchivesUnchanged:true,authMode:'workbench',revokeMode:'ttl',tokenMaxSeconds:1800,files:entries},null,2));
const privateFiles=[];
for(const file of await files(data)){if(path.basename(file)==='DATA-CHECKSUMS.json')continue;const bytes=await fs.readFile(file);privateFiles.push({file:path.relative(data,file).replaceAll('\\','/'),bytes:bytes.length,sha256:hash(bytes)});}
const mappingFile=path.join(data,'approved-mapping.json');
let approved=false;
try {const mapping=JSON.parse(await fs.readFile(mappingFile,'utf8'));approved=Array.isArray(mapping)&&mapping.filter(r=>r.role==='admin').length===1;}catch(error){if(error.code!=='ENOENT')throw error;}
await fs.writeFile(path.join(data,'DATA-CHECKSUMS.json'),JSON.stringify({containsRealBusinessData:true,authorizationReady:approved,files:privateFiles},null,2));
console.log(JSON.stringify({originalArchivesUnchanged:true,codeFileCount:entries.length,authorizationReady:approved,dataFiles:privateFiles.map(f=>f.file)}));
