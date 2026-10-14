import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { Miniflare } from 'miniflare';
import { snapshotParts, sendSync } from './eeo-sync-client.mjs';
import { validateOverview, assertFresh } from '../lib/eeo-sync-protocol.ts';
const root=path.resolve(import.meta.dirname,'..');
const source=JSON.parse(await fs.readFile(path.join(root,'app/data/snapshot.json'),'utf8'));
const parts=snapshotParts(source);
const hash=s=>createHash('sha256').update(s).digest('hex');
const manifest=parts.map(p=>({key:p.key,hash:hash(p.json)}));
const batchId=hash(JSON.stringify(manifest));
assert.throws(()=>snapshotParts({...source,customers:source.customers.map(c=>({...c,rawResponse:{teacher:'sensitive'}}))}));
assert.throws(()=>assertFresh(validateOverview(JSON.parse(parts[0].json)),{...source,asOf:'2099-01-01 00:00:00'}));
assert.throws(()=>assertFresh(validateOverview(JSON.parse(parts[0].json)),{...source,sourceMetadata:{crm:{dataAsOf:'2099-01-01 00:00'}}}));
const delivery=JSON.parse(await fs.readFile(path.join(root,'../diagnostics/latest-server-delivery.json'),'utf8'));
const release=path.join(delivery.delivery,'runtime');
const main=path.join(release,'dist/server/index.js');
const config=JSON.parse(await fs.readFile(path.join(release,'dist/server/wrangler.json'),'utf8'));
const token=randomBytes(32).toString('hex'); // Test only, memory only; never printed or persisted.
const entries=await fs.readdir(path.dirname(main),{recursive:true,withFileTypes:true});
const modules=[main,...entries.filter(e=>e.isFile()&&/\.m?js$/.test(e.name)).map(e=>path.join(e.parentPath,e.name)).filter(f=>f!==main)].map(file=>({type:'ESModule',path:file,contents:readFileSync(file,'utf8')}));
const runtime=new Miniflare({name:config.name,modulesRoot:path.dirname(main),modules,compatibilityDate:config.compatibility_date,compatibilityFlags:config.compatibility_flags,d1Databases:{DB:'sync-test'},bindings:{EEO_SYNC_TOKEN:token},assets:{directory:path.join(release,'dist/client'),routerConfig:{has_user_worker:true}},d1Persist:false});
const report={tests:[],parts:parts.length,maxPartBytes:Math.max(...parts.map(p=>Buffer.byteLength(p.json))),isolatedDatabase:true};
try {
  const db=await runtime.getD1Database('DB');
  for(const file of ['0000_tricky_gertrude_yorkes.sql','0001_data_refresh.sql','0002_live_eeo_snapshot.sql']){
    const sql=await fs.readFile(path.join(root,'drizzle',file),'utf8');
    for(const statement of sql.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();
  }
  const call=(body,auth=token)=>runtime.dispatchFetch('https://sync-test.invalid/api/eeo-sync',{method:'POST',headers:{authorization:`Bearer ${auth}`,'content-type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await call({action:'begin',batchId,manifest},'wrong')).status,401);report.tests.push('wrong token rejected');
  assert.equal((await call({action:'begin',batchId,manifest})).status,200);
  assert.equal((await call({action:'part',batchId,...parts[0]})).status,200);
  assert.equal((await call({action:'commit',batchId})).status,400);
  assert.equal(await db.prepare("SELECT json FROM eeo_snapshot WHERE key='overview'").first(),null);report.tests.push('incomplete batch preserves active snapshot');
  assert.equal((await call({action:'part',batchId,...parts[1],json:'[]'})).status,400);report.tests.push('corrupt chunk rejected');
  assert.equal((await call({action:'part',batchId,key:parts[1].key,json:'x'.repeat(300_000)})).status,400);report.tests.push('oversize rejected');
  for(const part of parts.slice(1)){const response=await call({action:'part',batchId,...part});assert.equal(response.status,200,part.key);}
  assert.equal((await call({action:'commit',batchId})).status,200);
  const saved=JSON.parse((await db.prepare("SELECT json FROM eeo_snapshot WHERE key='overview'").first()).json);
  assert.equal(saved.asOf,source.asOf);assert.equal(saved.customers.length,source.customers.length);
  assert.equal(saved.baselines.paidAmount,source.baselines.paidAmount);
  assert.deepEqual(saved.customers.map(c=>c.consultantJobNumber),source.customers.map(c=>c.consultantJobNumber));
  report.tests.push('all customer employee identities persist through online sync');
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM eeo_sync_part').first()).n,0);report.tests.push('full publication atomic and staging released');
  assert.equal((await call({action:'commit',batchId})).status,200);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM source_run WHERE source='eeo'").first()).n,1);report.tests.push('repeated commit idempotent');
  // A new batch with older EEO time must not change any active daily rows.
  const oldParts=parts.map(p=>({...p}));const old=JSON.parse(oldParts[0].json);old.asOf='2026-01-01 00:00:00';oldParts[0].json=JSON.stringify(old);
  const oldManifest=oldParts.map(p=>({key:p.key,hash:hash(p.json)})),oldId=hash(JSON.stringify(oldManifest));
  assert.equal((await call({action:'begin',batchId:oldId,manifest:oldManifest})).status,200);
  for(const part of oldParts)assert.equal((await call({action:'part',batchId:oldId,...part})).status,200);
  assert.equal((await call({action:'commit',batchId:oldId})).status,400);
  assert.equal((await db.prepare("SELECT json FROM eeo_snapshot WHERE key='overview'").first()).json,JSON.stringify(saved));report.tests.push('older batch refused without overwrite');
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM eeo_sync_part').first()).n,0);report.tests.push('rejected publication staging released');
  await db.prepare("INSERT INTO source_run(source,trigger,status,data_as_of) VALUES('crm','upload','success','2099-01-01 10:00')").run();
  const clashParts=parts.map(p=>({...p}));const clash=JSON.parse(clashParts[0].json);clash.version='crm-conflict-test';clashParts[0].json=JSON.stringify(clash);
  const clashManifest=clashParts.map(p=>({key:p.key,hash:hash(p.json)})),clashId=hash(JSON.stringify(clashManifest));
  assert.equal((await call({action:'begin',batchId:clashId,manifest:clashManifest})).status,200);
  for(const part of clashParts)assert.equal((await call({action:'part',batchId:clashId,...part})).status,200);
  assert.equal((await call({action:'commit',batchId:clashId})).status,400);
  assert.equal((await db.prepare("SELECT json FROM eeo_snapshot WHERE key='overview'").first()).json,JSON.stringify(saved));report.tests.push('newer online CRM import blocks old local snapshot');
  assert.equal((await call({action:'failure',batchId:hash('failure-test'),code:'LOGIN_REQUIRED'})).status,200);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM source_run WHERE status='failed'").first()).n,1);report.tests.push('login failure recorded separately');
  const endpoint=new URL('/api/eeo-sync',await runtime.ready).href;
  assert.equal((await sendSync({url:endpoint,token},{action:'begin',batchId,manifest})).complete,true);report.tests.push('real client HTTP transport and bounded response');
  report.tests.push('strict summary schema excludes raw sensitive objects','older CRM refused');
  await fs.writeFile(path.join(root,'../diagnostics/eeo-online-sync-verification.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
} finally {await runtime.dispose();}
