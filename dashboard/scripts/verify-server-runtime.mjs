import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {fork,spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
const root=path.resolve(import.meta.dirname,'..');
const delivery=JSON.parse(await fs.readFile(path.join(root,'../diagnostics/latest-server-delivery.json'),'utf8'));
const release=path.join(delivery.delivery,'runtime');
const dependencies=path.join(release,'node_modules');
await fs.symlink(path.join(root,'node_modules'),dependencies,process.platform==='win32'?'junction':'dir');
const state=path.join(root,'../diagnostics',`server-runtime-staging-${Date.now()}`);await fs.mkdir(state,{recursive:true});
const port=await new Promise(resolve=>{const probe=net.createServer();probe.listen(0,'127.0.0.1',()=>{const port=probe.address().port;probe.close(()=>resolve(port));});});
let child;let logs='';
const start=async()=>{
 child=fork(path.join(release,'scripts/run-server.mjs'),[],{execArgv:['--max-old-space-size=256'],env:{...process.env,AUTH_MODE:'local',SERVER_TEST_MODE:'1',DATA_DIR:state,PORT:String(port)},stdio:['ignore','pipe','pipe','ipc']});
 child.stdout.on('data',bytes=>{logs=(logs+bytes).slice(-4096);});child.stderr.on('data',bytes=>{logs=(logs+bytes).slice(-4096);});
 let healthy=false;
 for(let attempt=0;attempt<60;attempt++){
  if(child.exitCode!==null)throw new Error('Isolated runtime exited');
  healthy=await fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(1000)}).then(r=>r.status===200).catch(()=>false);
  if(healthy)break;await new Promise(r=>setTimeout(r,250));
 }
 assert(healthy,'runtime healthy after initializing all migrations');
};
const stop=async()=>{if(!child||child.exitCode!==null)return;const closing=new Promise(resolve=>child.once('exit',resolve));child.send('shutdown');await Promise.race([closing,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Runtime did not stop gracefully')),10000))]);};
try{
 await start();
 const mapping=path.join(state,'approved-test-mapping.json');await fs.writeFile(mapping,JSON.stringify([{jobNumber:'EEO00001',username:'测试管理员',role:'admin'}]));
 for(let i=0;i<2;i++){
  const result=spawnSync(process.execPath,['--max-old-space-size=128',path.join(release,'scripts/provision-workbench-users.mjs'),mapping],{env:{...process.env,DATA_DIR:state},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
 }
 const folder=path.join(state,'d1/miniflare-D1DatabaseObject');
 const files=(await fs.readdir(folder)).filter(f=>f.endsWith('.sqlite')&&f!=='metadata.sqlite');
 assert.equal(files.length,1);
 let db=new DatabaseSync(path.join(folder,files[0]));
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user_account').get().n,1);
 db.prepare("INSERT INTO eeo_snapshot(key,json) VALUES('persistence-test','{\"ok\":true}') ON CONFLICT(key) DO NOTHING").run();db.close();
 await stop();await start();
 db=new DatabaseSync(path.join(folder,files[0]));assert.equal(db.prepare("SELECT json FROM eeo_snapshot WHERE key='persistence-test'").get().json,'{"ok":true}');db.close();
 const report={healthy:true,allMigrations:true,explicitMappingIdempotent:true,persistenceAfterRestart:true,gracefulStop:true,linuxVerified:false,nodeMajor:process.versions.node.split('.')[0],testDataOnly:true,delivery:delivery.delivery};
 await fs.writeFile(path.join(root,'../diagnostics/server-runtime-acceptance.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{try{await stop();}finally{await fs.unlink(dependencies);}}
