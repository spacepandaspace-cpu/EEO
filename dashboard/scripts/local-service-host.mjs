import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {memorySample} from './process-budget.mjs';

// A persistent parent for run-dev. Terminal-owned starts retain their existing
// parent-exit protection; this launcher owns the local service independently.
const root=path.resolve(import.meta.dirname,'..');
const lock=path.join(root,'.local-service-host.lock');
if(fs.existsSync(lock)){
 const pid=Number(fs.readFileSync(lock,'utf8'));
 if(!Number.isSafeInteger(pid)||pid<=0)throw new Error('Invalid local service host lock');
 try{process.kill(pid,0);throw new Error('Local service host already running');}
 catch(error){if(error.code!=='ESRCH')throw error;}
 fs.unlinkSync(lock);
}
fs.writeFileSync(lock,String(process.pid),{flag:'wx'});
process.once('exit',()=>{try{if(fs.readFileSync(lock,'utf8').trim()===String(process.pid))fs.unlinkSync(lock);}catch{}});
let child, stopping=false, restarts=0, retryTimer;
function start(){
 child=spawn(process.execPath,['--max-old-space-size=256','scripts/run-server.mjs','--local'],{
  cwd:root,env:{...process.env,AUTH_MODE:'local'},stdio:'inherit',windowsHide:true,
 });
 console.log(`Local service host PID ${process.pid}; runtime PID ${child.pid}; recovery ${restarts}/2`);
 child.once('error',()=>{console.error('Local runtime could not start; inspect startup log.');stopping=true;process.exitCode=1;});
 child.once('exit',async(code,signal)=>{
  if(stopping||code===0){process.exitCode=code??1;return;}
  if(restarts>=2){console.error('Local runtime exited repeatedly; recovery limit reached. Existing data preserved.');process.exitCode=1;return;}
  try{
   const usage=await memorySample(process.pid);
   if(usage.freeMB<1280||usage.totalMB>512){console.error(`Recovery stopped: free memory ${usage.freeMB}MB, owned processes ${usage.totalMB}MB. Existing data preserved.`);process.exitCode=1;return;}
  }catch{console.error('Recovery stopped: memory check unavailable.');process.exitCode=1;return;}
  if(stopping)return;
  restarts++;
  console.error(`Local runtime exited (${code??signal}); one bounded recovery in 10 seconds, ${restarts}/2.`);
  retryTimer=setTimeout(start,10000);
 });
}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{stopping=true;clearTimeout(retryTimer);child?.kill(signal);});
start();
