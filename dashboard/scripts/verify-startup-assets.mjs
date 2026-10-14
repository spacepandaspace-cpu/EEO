import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {memorySample} from './process-budget.mjs';
const root=path.resolve(import.meta.dirname,'..');
const reportName=process.argv[2]||'页面脚本缺失修复验收_2026-10-09.json';
if(!/^[^/\\]+\.json$/.test(reportName))throw new Error('Report must be a JSON filename');
const base='http://127.0.0.1:5173';
const pid=Number(await fs.readFile(path.join(root,'.dev-server.lock'),'utf8'));
const checks=[];
async function check(route,expected=200){
 const response=await fetch(base+route,{signal:AbortSignal.timeout(10000),redirect:'manual'});
 const body=await response.text();
 checks.push({route,status:response.status,bytes:Buffer.byteLength(body),passed:response.status===expected&&(expected!==200||body.length>0)});
 return body;
}
const html=await check('/');
const assets=[...new Set([...html.matchAll(/(?:src|href)="([^"?#]+\.(?:js|css))"/g)].map(match=>match[1]))];
if(!assets.length)throw new Error('No browser assets referenced');
for(const route of assets)await check(route);
for(const [route,status]of [['/api/health',200],['/api/auth/status',200],['/api/dashboard',401],['/api/eeo-sync',401]])await check(route,status);
const duplicate=spawnSync(process.execPath,['--max-old-space-size=256','scripts/run-framework.mjs','dev'],{cwd:root,encoding:'utf8',timeout:15000,maxBuffer:4096});
const duplicateRejected=duplicate.status!==0&&/拒绝重复启动|拒绝启动第二个/.test(duplicate.stdout+duplicate.stderr);
const build=spawnSync(process.execPath,['scripts/run-framework.mjs','build'],{cwd:root,encoding:'utf8',timeout:15000,maxBuffer:4096});
const liveBuildRejected=build.status!==0&&/请先停止再构建/.test(build.stdout+build.stderr);
const samples=[];
for(let i=0;i<4;i++){
 samples.push({at:new Date().toISOString(),...await memorySample(pid)});
 console.log(JSON.stringify(samples.at(-1)));
 if(i<3)await new Promise(resolve=>setTimeout(resolve,20000));
}
const report={pid,checks,duplicateRejected,liveBuildRejected,watchers:0,automaticBrowser:false,elapsedSeconds:(Date.parse(samples.at(-1).at)-Date.parse(samples[0].at))/1000,samples};
await fs.writeFile(path.join(root,'../diagnostics',reportName),JSON.stringify(report,null,2));
if(checks.some(check=>!check.passed)||!duplicateRejected||!liveBuildRejected)throw new Error('Startup asset verification failed');
console.log('Asset, API, single-server and live-build checks passed.');
