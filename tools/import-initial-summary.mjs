import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const hash=value=>createHash('sha256').update(value).digest('hex');

export function buildBatch(snapshot) {
  const {customerDaily,customerAliases,...overview}=snapshot;
  void customerAliases;
  if(!Array.isArray(overview.customers)||overview.customers.length<1||overview.customers.length>200||!Array.isArray(customerDaily))throw new Error('Invalid snapshot');
  const ids=overview.customers.map(c=>c.uid);
  if(ids.some(id=>!/^\d{1,20}$/.test(id))||new Set(ids).size!==ids.length)throw new Error('Invalid customer IDs');
  const parts=[{key:'overview',json:JSON.stringify({...overview,customerDaily:[],customerAliases:[]})}];
  for(const id of ids)parts.push({key:`daily:${id}`,json:JSON.stringify(customerDaily.filter(r=>r.uid===id).slice(-365))});
  for(const part of parts)if(Buffer.byteLength(part.json)>(part.key==='overview'?250000:100000))throw new Error('Part exceeds budget');
  const manifest=parts.map(p=>({key:p.key,hash:hash(p.json)}));
  return {parts,manifest,batchId:hash(JSON.stringify(manifest))};
}

export async function importSummary({file,origin,token,expectedHash,allowLoopback=false,transport=fetch}) {
  const url=new URL(origin);
  if(url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new Error('Use a bare origin');
  if(url.protocol!=='https:'&&!(allowLoopback&&url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw new Error('HTTPS required');
  if(typeof token!=='string'||token.length<32||token.length>200||/\s/.test(token))throw new Error('Invalid sync secret');
  if(!/^[a-f0-9]{64}$/.test(expectedHash))throw new Error('Expected SHA256 required');
  if((await fs.stat(file)).size>8*1024*1024)throw new Error('Input exceeds budget');
  const bytes=await fs.readFile(file);
  if(hash(bytes)!==expectedHash)throw new Error('File hash mismatch');
  const snapshot=JSON.parse(bytes.toString('utf8'));
  const batch=buildBatch(snapshot);
  const endpoint=new URL('/api/eeo-sync',url);
  const deadline=Date.now()+300000;
  async function send(data) {
    const body=JSON.stringify(data);
    if(Buffer.byteLength(body)>280000||Date.now()>=deadline)throw new Error('Request budget exceeded');
    const response=await transport(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(Math.min(20000,deadline-Date.now())),headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body});
    const reader=response.body?.getReader();let length=0;const chunks=[];
    try {
      if(reader)while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>4096)throw new Error('Response exceeds budget');chunks.push(value);}
    } finally {if(reader){await reader.cancel().catch(()=>{});reader.releaseLock();}}
    if(!response.ok)throw new Error('Server rejected batch');
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  const start=await send({action:'begin',batchId:batch.batchId,manifest:batch.manifest});
  if(start.complete!==true){
    for(const part of batch.parts)await send({action:'part',batchId:batch.batchId,...part});
    if((await send({action:'commit',batchId:batch.batchId})).complete!==true)throw new Error('Publication not confirmed');
  }
  return {complete:true,batchId:batch.batchId,customers:snapshot.customers.length,parts:batch.parts.length,eeoAsOf:snapshot.asOf,crmAsOf:snapshot.sourceMetadata?.crm?.dataAsOf};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try {
    const result=await importSummary({file:process.argv[2],origin:process.env.EEO_SYNC_URL,token:process.env.EEO_SYNC_TOKEN,expectedHash:process.argv[3],allowLoopback:process.env.ALLOW_LOOPBACK_SYNC==='1'});
    console.log(JSON.stringify(result));
  } catch {
    console.error('Initial import failed. Check file SHA256, HTTPS origin, runtime secret and server batch status. Existing data remains protected; repeat the same command after correction.');
    process.exitCode=1;
  }
}
