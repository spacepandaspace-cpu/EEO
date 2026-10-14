import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fork } from 'node:child_process';

import { randomBytes, createHmac, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { SqliteDatabase, migrate } from './node-sqlite.mjs';
const root=path.resolve(import.meta.dirname,'..');
const state=path.join(root,'../diagnostics',`node-test-${Date.now()}`);
await fs.mkdir(state,{recursive:true});
const secret=randomBytes(32).toString('hex'),machine=randomBytes(32).toString('hex');
const port=3317;
const environment={...process.env,PORT:String(port),DATA_DIR:state,AUTH_MODE:'workbench',WORKBENCH_SECRET:secret,WORKBENCH_REVOKE_MODE:'ttl',WORKBENCH_LOGIN_URL:'https://workbench.invalid/',WORKBENCH_LOGOUT_URL:'https://workbench.invalid/logout',EEO_SYNC_TOKEN:machine};
const db=new DatabaseSync(path.join(state,'teaching-risk.sqlite'));migrate(db,root);
db.exec('PRAGMA busy_timeout=5000; CREATE TABLE rollback_test(n INTEGER UNIQUE)');
const adapter=new SqliteDatabase(db);
await assert.rejects(adapter.batch([adapter.prepare('INSERT INTO rollback_test VALUES(1)'),adapter.prepare('INSERT INTO rollback_test VALUES(1)')]));
assert.equal(db.prepare('SELECT COUNT(*) n FROM rollback_test').get().n,0);
db.exec("INSERT INTO user_account(id,username,role,consultant_name,password_salt,password_hash) VALUES(1,'测试顾问','consultant','测试顾问','',''),(2,'测试管理','admin',NULL,'',''); INSERT INTO external_identity(job_number,user_id) VALUES('EEO90001',1),('EEO90002',2)");
const snapshot=JSON.parse(await fs.readFile(path.join(root,'app/data/snapshot.json'),'utf8'));
const customer=(uid,job)=>({uid,customerName:'测试机构',consultant:'测试顾问',consultantJobNumber:job,analyzedLessons:1,postLaunchLessons:1,paymentTotal:0,paymentCount:0,used:true,trial:true,claim:true,paid:false,reasons:[],priority:'常规',score:0});
Object.assign(snapshot,{asOf:'2026-10-14 00:00:00',customers:[customer('1','EEO90001'),customer('2','EEO90002')],consultants:['测试顾问'],sourceMetadata:{eeo:{dataAsOf:'2026-10-14',capturedAt:'2026-10-14T00:00:00.000Z',dailyReconciled:true},crm:{dataAsOf:'2026-10-14 00:00:00'}},baselines:{...snapshot.baselines,customerCount:2,totalLessons:2,postLaunchLessons:2}});
db.prepare("INSERT INTO eeo_snapshot VALUES('overview',?)").run(JSON.stringify(snapshot));
const logs=[];const child=fork(path.join(root,'scripts/run-server.mjs'),[],{cwd:root,env:environment,execArgv:['--max-old-space-size=256'],silent:true});
child.stdout.on('data',data=>logs.push(String(data)));child.stderr.on('data',data=>logs.push(String(data)));
const origin=`http://127.0.0.1:${port}`;
const request=(route,options={})=>fetch(origin+route,{...options,redirect:'manual',signal:AbortSignal.timeout(10000)});
const checks=['SQLite batch rollback'];const samples=[];
const sign=claims=>{const a=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),b=Buffer.from(JSON.stringify(claims)).toString('base64url');return `${a}.${b}.${createHmac('sha256',secret).update(`${a}.${b}`).digest('base64url')}`;};
const now=Math.floor(Date.now()/1000),claims={iss:'sales-workbench',aud:'ai-risk-dashboard',iat:now,exp:now+1200,job_number:'EEO90001',enabled:1};
async function stop(target){if(target.exitCode!==null)return;const done=new Promise(resolve=>target.once('exit',resolve));target.send('shutdown');await Promise.race([done,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Process did not exit')),8000).unref())]);}
try {
 let ready=false;for(let i=0;i<60;i++){if(child.exitCode!==null)throw new Error(logs.join(''));try{if((await request('/api/health')).status===200){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,250));}assert(ready,'startup timed out');
 assert.equal((await request('/')).status,200);assert.equal((await request('/api/eeo-sync')).status,401);checks.push('homepage 200; health 200; unauthenticated machine sync 401');
 const login=await request('/?sso_token='+sign(claims));assert.equal(login.status,302);assert.equal(login.headers.get('location'),'/');const cookie=login.headers.get('set-cookie').split(';')[0];assert(login.headers.get('set-cookie').includes('HttpOnly'));assert(login.headers.get('set-cookie').includes('Secure'));
 const user=(route,options={})=>request(route,{...options,headers:{cookie,...options.headers}});
 assert.equal((await (await user('/api/auth/status')).json()).user.jobNumber,'EEO90001');
 assert.deepEqual((await (await user('/api/dashboard')).json()).customers.map(c=>c.uid),['1']);
 assert.equal((await user('/api/dashboard?uid=2')).status,403);assert.equal((await user('/api/customer-logs?uid=2')).status,403);assert.equal((await user('/api/dashboard?uid=1')).status,200);checks.push('SSO exchange; job-number customer isolation');
 for(const job of ['EEO99999'])assert.equal((await request('/api/auth/workbench?sso_token='+sign({...claims,job_number:job}))).headers.get('set-cookie'),null);
 for(const change of [{exp:now-1},{enabled:0},{exp:now+3600},{aud:'other'}])assert.equal((await request('/api/auth/workbench?sso_token='+sign({...claims,...change}))).headers.get('set-cookie'),null);
 checks.push('unknown, expired, disabled, wrong audience, over-30-minute tokens rejected');
 assert.equal((await user('/api/auth/login',{method:'POST'})).status,410);assert.equal((await user('/api/consultant-accounts',{method:'POST'})).status,410);
 const hash=s=>createHash('sha256').update(s).digest('hex');
 const parts=[{key:'overview',json:JSON.stringify(snapshot)},{key:'daily:1',json:'[]'},{key:'daily:2',json:'[]'}];const manifest=parts.map(p=>({key:p.key,hash:hash(p.json)}));const batchId=hash(JSON.stringify(manifest));
 const sync=async body=>{const r=await request('/api/eeo-sync',{method:'POST',headers:{authorization:`Bearer ${machine}`,'content-type':'application/json'},body:JSON.stringify(body)});const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));return data;};
 await sync({action:'begin',batchId,manifest});for(const part of parts)await sync({action:'part',batchId,...part});await sync({action:'commit',batchId});assert.equal((await sync({action:'begin',batchId,manifest})).complete,true);checks.push('chunked publication and duplicate batch idempotency');
 const before=db.prepare("SELECT json FROM eeo_snapshot WHERE key='overview'").get().json;
 const badParts=[{key:'overview',json:JSON.stringify({...snapshot,asOf:'2026-10-13 00:00:00'})},...parts.slice(1)];const badManifest=badParts.map(p=>({key:p.key,hash:hash(p.json)})),badId=hash(JSON.stringify(badManifest));await sync({action:'begin',batchId:badId,manifest:badManifest});for(const p of badParts)await sync({action:'part',batchId:badId,...p});const rejected=await request('/api/eeo-sync',{method:'POST',headers:{authorization:`Bearer ${machine}`,'content-type':'application/json'},body:JSON.stringify({action:'commit',batchId:badId})});assert.notEqual(rejected.status,200);assert.equal(db.prepare("SELECT json FROM eeo_snapshot WHERE key='overview'").get().json,before);checks.push('failed stale publication preserves valid snapshot');
 const second=fork(path.join(root,'scripts/run-server.mjs'),[],{cwd:root,env:environment,execArgv:['--max-old-space-size=256'],silent:true});second.stdout.resume();second.stderr.resume();const secondCode=await new Promise(resolve=>second.once('exit',resolve));assert.notEqual(secondCode,0);assert.equal((await request('/api/health')).status,200);checks.push('duplicate start rejected; original process remains healthy');

 for(let i=0;i<7;i++){
  await user('/api/dashboard');
  const rss=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{child.off('message',handler);reject(new Error('Memory sampling timed out'));},5000);const handler=data=>{if(data.type==='memory'){clearTimeout(timeout);child.off('message',handler);resolve(data.rss);}};child.on('message',handler);child.send('memory');});
  samples.push({seconds:i*10,rssMB:Math.round(rss/1024/1024*10)/10});assert(rss<512*1024*1024,'RSS exceeds budget');if(i<6)await new Promise(resolve=>setTimeout(resolve,10000));
 }
 assert(samples.at(-1).rssMB-samples[1].rssMB<40,'RSS has unexplained growth');checks.push('60-second RSS observation under 512 MB');
 await user('/api/auth/logout',{method:'POST'});assert.equal((await (await user('/api/auth/status')).json()).authenticated,false);checks.push('logout revokes local session');
 await stop(child);await assert.rejects(fs.access(path.join(state,'server.lock')));checks.push('shutdown releases server lock');
 const report={checks,samples,linuxVerified:process.platform==='linux',realWorkbenchVerified:false,privateDataUsed:false};await fs.writeFile(path.join(state,'acceptance.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){console.error(logs.slice(-5).join(''));throw error;}finally{await stop(child).catch(()=>child.kill());db.close();}
