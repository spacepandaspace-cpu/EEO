import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {memorySample} from './process-budget.mjs';
const root=path.resolve(import.meta.dirname,'..');
const pid=Number(await fs.readFile(path.join(root,'.dev-server.lock'),'utf8'));
const checks=[];
for(const [route,expected] of [['/',200],['/api/health',200],['/api/auth/status',200],['/api/eeo-sync',401]]){
 const response=await fetch(`http://127.0.0.1:5173${route}`,{signal:AbortSignal.timeout(10000),redirect:'manual'});
 await response.arrayBuffer();checks.push({route,status:response.status,passed:response.status===expected});
}
const duplicate=spawnSync(process.execPath,['--max-old-space-size=256','scripts/run-framework.mjs','dev'],{cwd:root,encoding:'utf8',timeout:15000,maxBuffer:4096});
const duplicateRejected=duplicate.status!==0&&/拒绝重复启动|拒绝启动第二个/.test(duplicate.stdout+duplicate.stderr);
const samples=[];
for(let i=0;i<4;i++){samples.push({at:new Date().toISOString(),...await memorySample(pid)});console.log(JSON.stringify(samples.at(-1)));if(i<3)await new Promise(resolve=>setTimeout(resolve,20000));}
const report={pid,checks,duplicateRejected,elapsedSeconds:(Date.parse(samples.at(-1).at)-Date.parse(samples[0].at))/1000,samples};
await fs.writeFile(path.join(root,'../diagnostics/联动部署改造_本地内存验收_2026-10-09.json'),JSON.stringify(report,null,2));
if(checks.some(check=>!check.passed)||!duplicateRejected)throw new Error('Runtime check failed');
