import fs from 'node:fs/promises';
import path from 'node:path';
import { runtimeBindings } from './runtime-bindings.mjs';
import { getDatabase, closeDatabase, migrate } from './node-sqlite.mjs';
const root=path.resolve(import.meta.dirname,'..');
process.chdir(root);
const local=process.argv.includes('--local');
const port=Number(process.env.PORT||(local?5173:3002));
if(local)process.env.DATA_DIR ||= path.join(root,'../runtime-data');
const dataDir=process.env.DATA_DIR;
if(!dataDir||!path.isAbsolute(dataDir)||path.resolve(dataDir)===root||path.resolve(dataDir).startsWith(root+path.sep))throw new Error('DATA_DIR must be absolute and outside the release directory');
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid PORT');
if(!local&&process.env.AUTH_MODE!=='workbench')throw new Error('Production server requires AUTH_MODE=workbench');
runtimeBindings();
await fs.mkdir(dataDir,{recursive:true});
const lock=path.join(dataDir,'server.lock');
let locked=false,server,monitor,closing=false;
async function close(code=0) {
 if(closing)return;closing=true;clearInterval(monitor);
 const deadline=setTimeout(()=>process.exit(code||1),5000);deadline.unref();
 try {
  if(server){server.closeIdleConnections();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}
  closeDatabase();
 }finally{if(locked)await fs.unlink(lock).catch(()=>{});clearTimeout(deadline);if(process.connected)process.disconnect();process.exitCode=code;}
}
process.once('SIGTERM',()=>void close());process.once('SIGINT',()=>void close());
process.on('message',message=>{if(message==='shutdown')void close();if(message==='memory'&&process.connected)process.send({type:'memory',rss:process.memoryUsage().rss});});
process.once('disconnect',()=>void close());
try {
 try{const pid=Number(await fs.readFile(lock,'utf8'));if(!Number.isSafeInteger(pid)||pid<=0)throw new Error('Invalid server lock');try{process.kill(pid,0);throw new Error('Server already running');}catch(error){if(error.code!=='ESRCH')throw error;}await fs.unlink(lock);}catch(error){if(error.code!=='ENOENT')throw error;}
 await fs.writeFile(lock,String(process.pid),{flag:'wx'});locked=true;
 await fs.access(path.join(root,'dist/server/index.js'));
 const entries=await fs.readdir(path.join(root,'dist/client'),{recursive:true});
 if(!entries.some(name=>name.endsWith('.js'))||!entries.some(name=>name.endsWith('.css')))throw new Error('Incomplete browser build');
 const db=getDatabase();migrate(db.native,root);
 db.native.prepare('DELETE FROM workbench_session WHERE expires_at<=?').run(new Date().toISOString());
 const {startProdServer}=await import('vinext/server/prod-server');
 ({server}=await startProdServer({port,host:'127.0.0.1',outDir:path.join(root,'dist')}));
 server.prependListener('request',request=>{
  const url=new URL(request.url||'/','http://127.0.0.1');
  if(request.method==='GET'&&url.searchParams.has('sso_token')&&!url.pathname.startsWith('/api/'))request.url='/api/auth/workbench'+url.search;
 });
 server.requestTimeout=20_000;server.headersTimeout=15_000;server.keepAliveTimeout=5000;
 monitor=setInterval(()=>{if(process.memoryUsage().rss>512*1024*1024){console.error('Node memory budget exceeded; stopping service');void close(1);}},5000);monitor.unref();
 console.log(`Node server ready at 127.0.0.1:${port}; native SQLite; no browser or watcher`);
}catch(error){console.error(`Startup failed: ${error.code||error.message}`);await close(1);}
