import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Miniflare} from 'miniflare';
import {runtimeBindings} from './runtime-bindings.mjs';
const exec=promisify(execFile);
const root=path.resolve(import.meta.dirname,'..');
const port=Number(process.env.PORT||3002);
const dataDir=process.env.DATA_DIR;
if(!dataDir||!path.isAbsolute(dataDir)||path.resolve(dataDir)===root||path.resolve(dataDir).startsWith(root+path.sep))throw new Error('DATA_DIR must be absolute and outside the release directory');
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid PORT');
if(process.env.AUTH_MODE!=='workbench'&&process.env.SERVER_TEST_MODE!=='1')throw new Error('Production server requires AUTH_MODE=workbench');
const bindings=runtimeBindings();
await fs.mkdir(dataDir,{recursive:true});
const lock=path.join(dataDir,'server.lock');let locked=false,runtime,monitor,closing=false;
async function close(code=0){if(closing)return;closing=true;clearInterval(monitor);try{await runtime?.dispose();}finally{if(locked)await fs.unlink(lock).catch(()=>{});process.exitCode=code;}}
process.once('SIGTERM',()=>void close());process.once('SIGINT',()=>void close());
process.on('message',message=>{if(message==='shutdown')void close();});
process.once('disconnect',()=>void close());
try {
  try{const pid=Number(await fs.readFile(lock,'utf8'));if(!Number.isSafeInteger(pid)||pid<=0)throw new Error('Invalid server lock');try{process.kill(pid,0);throw new Error('Server already running');}catch(error){if(error.code!=='ESRCH')throw error;}await fs.unlink(lock);}catch(error){if(error.code!=='ENOENT')throw error;}
  await fs.writeFile(lock,String(process.pid),{flag:'wx'});locked=true;
  await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',()=>reject(new Error('Port already occupied')));probe.listen(port,'127.0.0.1',()=>probe.close(resolve));});
  const serverDir=path.join(root,'dist/server');const main=path.join(serverDir,'index.js');
  const clientEntries=await fs.readdir(path.join(root,'dist/client'),{recursive:true,withFileTypes:true});
  if(!clientEntries.some(entry=>entry.isFile()&&entry.name.endsWith('.js'))||!clientEntries.some(entry=>entry.isFile()&&entry.name.endsWith('.css')))throw new Error('Browser JS/CSS build missing; refusing incomplete release');
  const config=JSON.parse(await fs.readFile(path.join(serverDir,'wrangler.json'),'utf8'));
  const entries=await fs.readdir(serverDir,{recursive:true,withFileTypes:true});
  const files=[main,...entries.filter(e=>e.isFile()&&/\.m?js$/.test(e.name)).map(e=>path.join(e.parentPath,e.name)).filter(f=>f!==main)];
  const modules=await Promise.all(files.map(async file=>({type:'ESModule',path:file,contents:await fs.readFile(file,'utf8')})));
  modules.unshift({type:'ESModule',path:path.join(serverDir,'risk-entry.js'),contents:await fs.readFile(path.join(root,'scripts/worker-entry.mjs'),'utf8')});
  runtime=new Miniflare({host:'127.0.0.1',port,name:config.name,modulesRoot:serverDir,modules,compatibilityDate:config.compatibility_date,compatibilityFlags:config.compatibility_flags,d1Databases:{DB:'teaching-risk'},d1Persist:path.join(dataDir,'d1'),bindings,assets:{directory:path.join(root,'dist/client'),routerConfig:{has_user_worker:true}}});
  const db=await runtime.getD1Database('DB');
  const migrations=[['0000_tricky_gertrude_yorkes.sql','user_account'],['0001_data_refresh.sql','source_run'],['0002_live_eeo_snapshot.sql','eeo_snapshot'],['0003_workbench_identity.sql','external_identity']];
  for(const [file,table] of migrations){
    if(await db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").bind(table).first())continue;
    const sql=await fs.readFile(path.join(root,'drizzle',file),'utf8');
    const statements=sql.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean).map(s=>db.prepare(s));
    await db.batch(statements);
  }
  await db.prepare("DELETE FROM workbench_session WHERE expires_at<=?").bind(new Date().toISOString()).run();
  await runtime.ready;
  let checking=false,failures=0;
  monitor=setInterval(async()=>{
    if(checking||closing)return;checking=true;
    try{
      let rss=process.memoryUsage().rss;
      if(process.platform==='linux'){
        const {stdout}=await exec('ps',['-eo','pid=,ppid=,rss='],{timeout:5000,maxBuffer:262144});
        const rows=stdout.trim().split('\n').map(line=>line.trim().split(/\s+/).map(Number));const ids=new Set([process.pid]);
        for(let depth=0;depth<10;depth++)for(const [pid,parent]of rows)if(ids.has(parent))ids.add(pid);
        rss=rows.filter(([pid])=>ids.has(pid)).reduce((n,row)=>n+row[2]*1024,0);
      }
      failures=0;if(rss>512*1024*1024){console.error('Runtime memory budget exceeded; stopping owned runtime');await close(1);}
    }catch{if(++failures>=3){console.error('Runtime monitoring failed repeatedly');await close(1);}}finally{checking=false;}
  },10000);
  console.log(`Server ready at 127.0.0.1:${port}; persistent DB outside release; no browser, collector or watchers`);
}catch{console.error('Server startup failed; check configuration, schema, port and permissions');await close(1);}
