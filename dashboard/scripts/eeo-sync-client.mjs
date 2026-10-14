import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { dailySchema, validateOverview } from '../lib/eeo-sync-protocol.ts';
import { openStore } from './local-eeo-store.mjs';
import { applyConsultantIdentities } from './consultant-identities.mjs';
const root=path.resolve(import.meta.dirname,'..');
const hash=value=>createHash('sha256').update(value).digest('hex');
export async function syncConfig() {
  const file=path.join(root,'.eeo-sync.local.json');
  let settings={};
  try {
    if((await fs.stat(file)).size>4096) throw new Error('同步配置超过预算');
    settings=JSON.parse(await fs.readFile(file,'utf8'));
  } catch(error) {if(error.code!=='ENOENT') throw error;}
  // Explicit migration pause overrides stale shell environment variables too.
  if(settings.enabled===false)return null;
  const url=process.env.EEO_SYNC_URL || settings.url;
  const token=process.env.EEO_SYNC_TOKEN || settings.token;
  if(!url&&!token) return null;
  if(!url||!token||token.length<32||token.length>200) throw new Error('同步地址或密钥未配置完整');
  const target=new URL(url);
  if(target.username||target.password||target.search||target.hash) throw new Error('同步地址不得包含凭据或查询参数');
  if(target.protocol!=='https:' && !(process.env.EEO_SYNC_TEST_HTTP==='1' && target.protocol==='http:' && ['127.0.0.1','localhost'].includes(target.hostname))) throw new Error('线上同步必须使用HTTPS');
  return {url:new URL('/api/eeo-sync',target.origin).href,token};
}
export async function sendSync(config,body) {
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),20_000);
  try {
    const response=await fetch(config.url,{method:'POST',redirect:'error',signal:controller.signal,headers:{authorization:`Bearer ${config.token}`,'content-type':'application/json'},body:JSON.stringify(body)});
    // Error pages and proxy responses are bounded too; never log response data.
    const reader=response.body?.getReader();let size=0;const chunks=[];
    if(reader) try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>4096)throw new Error('同步响应超过预算');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    if(!response.ok) throw new Error(`线上同步失败 HTTP ${response.status}；本地有效数据保留`);
    return JSON.parse(new TextDecoder().decode(bytes));
  } finally {clearTimeout(timer);}
}
export function snapshotParts(snapshot) {
  applyConsultantIdentities(snapshot);
  const {customerDaily,customerAliases,...rest}=snapshot;
  void customerAliases;
  // Keep the existing server protocol: missing usage is carried by reasons and
  // followupAction, rather than introducing an unknown field to older servers.
  rest.customers=rest.customers.map(customer=>{
    const {usageDataPending,...summary}=customer;void usageDataPending;return summary;
  });
  validateOverview({...rest,customerDaily:[],customerAliases:[]});
  const parts=[{key:'overview',json:JSON.stringify({...rest,customerDaily:[],customerAliases:[]})}];
  for(const customer of snapshot.customers){
    const rows=customerDaily.filter(row=>row.uid===customer.uid).slice(-365);
    dailySchema.parse(rows);
    parts.push({key:`daily:${customer.uid}`,json:JSON.stringify(rows)});
  }
  for(const part of parts) if(Buffer.byteLength(part.json)>(part.key==='overview'?250_000:100_000))throw new Error('同步分块超过内存预算');
  return parts;
}
export async function syncSnapshot() {
  const config=await syncConfig();
  const statusFile=path.join(root,'.eeo-sync-status.json');
  if(!config){await fs.writeFile(statusFile,JSON.stringify({status:'not_configured',at:new Date().toISOString()}));console.log('本地更新完成；线上同步地址/密钥尚未配置，未上传。');return {configured:false};}
  const lock=path.join(root,'.eeo-sync.lock');let locked=false;
  try {
    try {const pid=Number(await fs.readFile(lock,'utf8'));try{process.kill(pid,0);throw new Error('已有同步任务运行');}catch(error){if(error.code!=='ESRCH')throw error;}await fs.unlink(lock);}catch(error){if(error.code!=='ENOENT')throw error;}
    await fs.writeFile(lock,String(process.pid),{flag:'wx'});locked=true;
    const file=path.join(root,'app/data/snapshot.json');
    if((await fs.stat(file)).size>8*1024*1024)throw new Error('快照超过8MB预算');
    const snapshot=JSON.parse(await fs.readFile(file,'utf8'));
    const db=openStore(root);
    try {
      const crm=db.prepare("SELECT data_as_of FROM source_run WHERE source='crm' AND status IN ('success','success_with_warnings') AND data_as_of IS NOT NULL ORDER BY data_as_of DESC LIMIT 1").get();
      if(crm && crm.data_as_of>(snapshot.sourceMetadata?.crm?.dataAsOf||'')) throw new Error('CRM订单导入更新但分析快照尚未刷新，禁止同步旧订单汇总');
    } finally {db.close();}
    const parts=snapshotParts(snapshot);
    const manifest=parts.map(part=>({key:part.key,hash:hash(part.json)}));
    const batchId=hash(JSON.stringify(manifest));
    await fs.writeFile(statusFile,JSON.stringify({status:'uploading',batchId,asOf:snapshot.asOf,at:new Date().toISOString()}));
    const start=await sendSync(config,{action:'begin',batchId,manifest});
    if(!start.complete){
      const deadline=Date.now()+5*60_000;
      for(const part of parts){if(Date.now()>deadline)throw new Error('同步超过5分钟总预算');await sendSync(config,{action:'part',batchId,...part});}
      const result=await sendSync(config,{action:'commit',batchId});
      if(!result.complete)throw new Error('线上未确认完整同步');
    }
    await fs.writeFile(statusFile,JSON.stringify({status:'success',batchId,asOf:snapshot.asOf,at:new Date().toISOString()}));
    console.log(`线上已确认完整同步：${snapshot.asOf}，${snapshot.customers.length}个客户汇总。`);
    return {configured:true,complete:true};
  } catch(error){
    if(locked)await fs.writeFile(statusFile,JSON.stringify({status:'failed',at:new Date().toISOString(),message:'同步失败；本地数据保留，请检查网络、配置或线上批次。'}));
    throw error;
  } finally {if(locked)await fs.unlink(lock).catch(()=>{});}
}
export async function reportFailure(code) {
  const config=await syncConfig();if(!config)return;
  await sendSync(config,{action:'failure',batchId:hash(`failure:${new Date().toISOString()}`),code:code==='LOGIN_REQUIRED'?'LOGIN_REQUIRED':'LOCAL_FAILED'});
}
