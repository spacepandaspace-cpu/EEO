import 'server-only';
import { env } from 'cloudflare:workers';
import source from '@/app/data/snapshot.json';
import { readLimitedBody } from '@/lib/bounded-request';
import { manifestSchema, dailySchema, validateOverview, assertFresh, sha256 } from '@/lib/eeo-sync-protocol';

type Batch = { id:string; manifest:string; status:string; created_at:string };
async function authorized(request: Request) {
  const token = env.EEO_SYNC_TOKEN;
  if (!token || token.length < 32 || token.length > 200 || /\s/.test(token)) return false;
  const supplied = request.headers.get('authorization') || '';
  if (supplied.length > 300) return false;
  const [a,b] = await Promise.all([sha256(supplied),sha256(`Bearer ${token}`)]);
  let different = 0;
  for(let i=0;i<a.length;i++) different |= a.charCodeAt(i)^b.charCodeAt(i);
  return different===0;
}
async function tables() {
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS eeo_snapshot (key TEXT PRIMARY KEY, json TEXT NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS eeo_sync_batch (id TEXT PRIMARY KEY, manifest TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS eeo_sync_one_upload ON eeo_sync_batch(status) WHERE status='uploading'"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS eeo_sync_part (batch_id TEXT NOT NULL, key TEXT NOT NULL, hash TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY(batch_id,key))"),
  ]);
}
export async function GET(request: Request) {
  if (!await authorized(request)) return Response.json({error:'同步认证失败或未配置'}, {status:401});
  await tables();
  const batches = await env.DB.prepare("SELECT id,status,created_at FROM eeo_sync_batch ORDER BY created_at DESC LIMIT 5").all();
  return Response.json({ batches:batches.results },{headers:{'Cache-Control':'no-store'}});
}
export async function POST(request: Request) {
  if (!await authorized(request)) return Response.json({error:'同步认证失败或未配置'}, {status:401});
  let rejectedBatch: string | undefined;
  try {
    await tables();
    const body = JSON.parse(new TextDecoder().decode(await readLimitedBody(request, 280_000))) as {action:string; batchId:string; manifest?:unknown; key?:string; json?:string; code?:string};
    if (!/^[a-f0-9]{64}$/.test(body.batchId)) throw new Error('批次ID无效');
    if (body.action==='failure') {
      const message = body.code==='LOGIN_REQUIRED' ? '本地EEOS登录失效，需要在采集电脑手动登录；线上有效数据保留。' : '本地采集或同步未完成；线上有效数据保留，请检查采集电脑。';
      await env.DB.prepare("INSERT INTO source_run(source,trigger,status,error_message,summary_json,finished_at) VALUES('eeo','scheduled','failed',?,'{\"origin\":\"local_collector\"}',CURRENT_TIMESTAMP)").bind(message).run();
      return Response.json({recorded:true});
    }
    if (body.action==='begin') {
      const manifest=manifestSchema.parse(body.manifest);
      if (new Set(manifest.map(p=>p.key)).size!==manifest.length || !manifest.some(p=>p.key==='overview') || await sha256(JSON.stringify(manifest))!==body.batchId) throw new Error('分块清单无效');
      await env.DB.batch([
        env.DB.prepare("DELETE FROM eeo_sync_part WHERE batch_id IN (SELECT id FROM eeo_sync_batch WHERE created_at < datetime('now','-1 hour'))"),
        env.DB.prepare("DELETE FROM eeo_sync_batch WHERE created_at < datetime('now','-1 hour') AND status!='complete'"),
        env.DB.prepare("DELETE FROM eeo_sync_batch WHERE status='complete' AND created_at < datetime('now','-7 days')"),
      ]);
      const existing=await env.DB.prepare('SELECT status FROM eeo_sync_batch WHERE id=?').bind(body.batchId).first<{status:string}>();
      if(existing?.status==='complete') return Response.json({complete:true});
      const other=await env.DB.prepare("SELECT id FROM eeo_sync_batch WHERE status='uploading' AND id!=? LIMIT 1").bind(body.batchId).first();
      if(other) return Response.json({error:'已有上传批次，稍后重试'}, {status:409});
      await env.DB.prepare("INSERT INTO eeo_sync_batch(id,manifest,status) VALUES(?,?,'uploading') ON CONFLICT(id) DO UPDATE SET status='uploading'").bind(body.batchId,JSON.stringify(manifest)).run();
      return Response.json({ready:true});
    }
    const batch=await env.DB.prepare('SELECT * FROM eeo_sync_batch WHERE id=?').bind(body.batchId).first<Batch>();
    if(!batch) throw new Error('批次不存在或已过期');
    if(batch.status==='complete') return Response.json({complete:true});
    if(batch.status!=='uploading' || Date.parse(`${batch.created_at.replace(' ','T')}Z`)<Date.now()-3600_000) throw new Error('批次不可写或已过期');
    const manifest=manifestSchema.parse(JSON.parse(batch.manifest));
    if(body.action==='part') {
      const part=manifest.find(p=>p.key===body.key);
      if(!part || typeof body.json!=='string' || new TextEncoder().encode(body.json).length>(part.key==='overview'?250_000:100_000) || await sha256(body.json)!==part.hash) throw new Error('分块校验失败或超过内存预算');
      const value=JSON.parse(body.json);
      if(part.key==='overview') {
        const overview=validateOverview(value);
        if(overview.customers.length!==manifest.length-1 || overview.customers.some(c=>!manifest.some(p=>p.key===`daily:${c.uid}`))) throw new Error('客户分块不完整');
      } else {
        const daily=dailySchema.parse(value);
        if(daily.some(row=>`daily:${row.uid}`!==part.key) || new Set(daily.map(r=>r.date)).size!==daily.length) throw new Error('逐日分块客户或日期不一致');
      }
      await env.DB.prepare('INSERT OR REPLACE INTO eeo_sync_part(batch_id,key,hash,json) VALUES(?,?,?,?)').bind(batch.id,part.key,part.hash,body.json).run();
      return Response.json({accepted:true});
    }
    if(body.action==='commit') {
      const count=await env.DB.prepare('SELECT COUNT(*) AS n FROM eeo_sync_part WHERE batch_id=?').bind(batch.id).first<{n:number}>();
      if(count?.n!==manifest.length) throw new Error('尚未收到完整批次，保留旧数据');
      rejectedBatch=batch.id;
      const staged=await env.DB.prepare("SELECT json FROM eeo_sync_part WHERE batch_id=? AND key='overview'").bind(batch.id).first<{json:string}>();
      const before=await env.DB.prepare("SELECT json FROM eeo_snapshot WHERE key='overview'").first<{json:string}>();
      const incoming=validateOverview(JSON.parse(staged!.json));
      assertFresh(incoming,before?JSON.parse(before.json):source);
      const latestCrm=await env.DB.prepare("SELECT data_as_of AS date FROM source_run WHERE source='crm' AND status IN ('success','success_with_warnings') AND data_as_of IS NOT NULL ORDER BY data_as_of DESC LIMIT 1").first<{date:string}>();
      if(latestCrm && latestCrm.date>incoming.sourceMetadata.crm.dataAsOf) throw new Error('线上CRM导入更新，拒绝旧订单覆盖');
      // D1 batch is one transaction. CAS prevents a concurrent CRM import or
      // another publisher from being overwritten between validation and commit.
      const publication = [
        env.DB.prepare("UPDATE eeo_sync_batch SET status='publishing' WHERE id=? AND status='uploading' AND COALESCE((SELECT json FROM eeo_snapshot WHERE key='overview'),'')=? AND NOT EXISTS(SELECT 1 FROM source_run WHERE source='crm' AND status IN ('success','success_with_warnings') AND data_as_of>?)").bind(batch.id,before?.json||'',incoming.sourceMetadata.crm.dataAsOf),
        env.DB.prepare("DELETE FROM eeo_snapshot WHERE key LIKE 'daily:%' AND EXISTS(SELECT 1 FROM eeo_sync_batch WHERE id=? AND status='publishing')").bind(batch.id),
        env.DB.prepare("INSERT OR REPLACE INTO eeo_snapshot(key,json) SELECT key,json FROM eeo_sync_part WHERE batch_id=? AND EXISTS(SELECT 1 FROM eeo_sync_batch WHERE id=? AND status='publishing')").bind(batch.id,batch.id),
        env.DB.prepare("INSERT INTO source_run(source,trigger,status,data_as_of,row_count,file_hash,summary_json,finished_at) SELECT 'eeo','scheduled','success_with_warnings',?,?,?,'{\"origin\":\"local_collector\",\"message\":\"本地汇总已完整同步；未提供的逐日指标保留空缺\"}',CURRENT_TIMESTAMP WHERE EXISTS(SELECT 1 FROM eeo_sync_batch WHERE id=? AND status='publishing')").bind(incoming.asOf,incoming.customers.length,batch.id,batch.id),
      ];
      const priorCrm = (before ? JSON.parse(before.json) : source).sourceMetadata?.crm?.dataAsOf || '';
      if(incoming.sourceMetadata.crm.dataAsOf > priorCrm) publication.push(
        env.DB.prepare("INSERT INTO source_run(source,trigger,status,data_as_of,row_count,file_hash,summary_json,finished_at) SELECT 'crm','upload','success',?,?,?,'{\"origin\":\"local_summary\",\"message\":\"本机已核对CRM汇总同步，原始订单文件未上传\"}',CURRENT_TIMESTAMP WHERE EXISTS(SELECT 1 FROM eeo_sync_batch WHERE id=? AND status='publishing')").bind(incoming.sourceMetadata.crm.dataAsOf,incoming.customers.reduce((n,c)=>n+c.paymentCount,0),batch.id,batch.id)
      );
      publication.push(
        env.DB.prepare("UPDATE eeo_sync_batch SET status='complete' WHERE id=? AND status='publishing'").bind(batch.id),
        env.DB.prepare("DELETE FROM eeo_sync_part WHERE batch_id=? AND EXISTS(SELECT 1 FROM eeo_sync_batch WHERE id=? AND status='complete')").bind(batch.id,batch.id),
      );
      await env.DB.batch(publication);
      const done=await env.DB.prepare('SELECT status FROM eeo_sync_batch WHERE id=?').bind(batch.id).first<{status:string}>();
      if(done?.status!=='complete') throw new Error('线上数据发生并发更新，请核对后重试');
      return Response.json({complete:true,asOf:incoming.asOf});
    }
    throw new Error('不支持的同步操作');
  } catch {
    if(rejectedBatch) await env.DB.batch([
      env.DB.prepare("UPDATE eeo_sync_batch SET status='failed' WHERE id=? AND status='uploading'").bind(rejectedBatch),
      env.DB.prepare("DELETE FROM eeo_sync_part WHERE batch_id=? AND EXISTS(SELECT 1 FROM eeo_sync_batch WHERE id=? AND status='failed')").bind(rejectedBatch,rejectedBatch),
    ]).catch(()=>{});
    return Response.json({error:'同步校验失败；请核对批次完整性、字段、时间及CRM来源。有效数据未覆盖。'}, {status:400});
  }
}
