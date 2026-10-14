import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { memorySample } from './process-budget.mjs';
import { openStore } from './local-eeo-store.mjs';
import { reportFailure } from './eeo-sync-client.mjs';
const root=path.resolve(import.meta.dirname,'..');
const login=process.argv.includes('--login');
const inspect=process.argv.includes('--inspect-schema');
const dry=process.argv.includes('--dry-run');
const taskBudgetMB=login?1100:800, chromeBudgetMB=login?900:600;
const lock=path.join(root,'.eeo-weekly.lock');
let locked=false, child, runId, db;
let failureReason='';
const memoryEvidence={samples:0,taskPeakMB:0,chromePeakMB:0,minFreeMB:null};
const day=(value,offset=0)=>new Date(Date.parse(`${value}T00:00:00Z`)+offset*86400000).toISOString().slice(0,10);
const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',dateStyle:'short'}).format(new Date());
const abort=new AbortController();
const resultFile=path.join(root,'.eeo-weekly-result.json');
async function step(script,args=[],extra={}) {
  if(abort.signal.aborted) throw new Error('采集因内存预算或退出请求已取消');
  await new Promise((resolve,reject)=>{
    child=spawn(process.execPath,['--max-old-space-size=192','--experimental-strip-types',path.join(root,'scripts',script),...args],{cwd:root,env:{...process.env,...extra},stdio:'inherit',windowsHide:!login,signal:abort.signal});
    child.once('error',reject);
    child.once('exit',code=>code===0?resolve():reject(new Error(`${script} 未成功完成，保留有效快照；请查看系统“数据更新”记录。`)));
  });
  child=undefined;
}
let checking=false, monitorFailures=0;
const monitor=setInterval(async()=>{
  if(checking || !child) return;
  checking=true;
  try {
    const usage=await memorySample(process.pid);
    monitorFailures=0;
    const chromeMB=usage.processes.filter(p=>/\\chrome\.exe/i.test(p.command)).reduce((sum,p)=>sum+p.privateMB,0);
    memoryEvidence.samples++;
    memoryEvidence.taskPeakMB=Math.max(memoryEvidence.taskPeakMB,usage.totalMB);
    memoryEvidence.chromePeakMB=Math.max(memoryEvidence.chromePeakMB,Math.round(chromeMB));
    memoryEvidence.minFreeMB=Math.min(memoryEvidence.minFreeMB??usage.freeMB,usage.freeMB);
    if(usage.totalMB>taskBudgetMB || chromeMB>chromeBudgetMB || usage.freeMB<512){failureReason=`内存保护：任务${usage.totalMB}MB/预算${taskBudgetMB}MB，Chrome${Math.round(chromeMB)}MB/预算${chromeBudgetMB}MB，可用${usage.freeMB}MB。未覆盖快照。`;console.error(JSON.stringify({memoryLimit:true,chromeMB,...usage}));abort.abort();}
  }catch{if(++monitorFailures>=3){failureReason='连续三次内存检测失败，安全停止采集；有效快照不变。';console.error(failureReason);abort.abort();}}finally{checking=false;}
},5000);
process.once('SIGINT',()=>abort.abort());process.once('SIGTERM',()=>abort.abort());
const deadline=setTimeout(()=>{failureReason='任务超过总时限，已取消；有效快照不变。';abort.abort();},login?25*60_000:15*60_000);
try {
  const snapshot=JSON.parse(await fs.readFile(path.join(root,'app/data/snapshot.json'),'utf8'));
  const last=snapshot.sourceMetadata?.eeo?.dataAsOf || snapshot.asOf.slice(0,10);
  const from=process.env.EEO_CAPTURE_FROM || day(last,-14),to=today;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(from) || !Number.isFinite(Date.parse(from)) || from>to) throw new Error('补采起始日期无效');
  if(Date.parse(to)-Date.parse(from)>90*86400000) throw new Error('距离上次更新超过90天，请先人工分段补采');
  const plan={from,to,customers:snapshot.customers.length,nodeHeapMB:192,totalPrivateBudgetMB:taskBudgetMB,chromeBudgetMB,minFreeStartMB:1280,headless:!login,publish:!login&&!inspect,weekly:'周一10:00 Asia/Shanghai'};
  if(dry){console.log(JSON.stringify(plan));}
  else {
    try {const pid=Number(await fs.readFile(lock,'utf8'));try{process.kill(pid,0);throw new Error(`每周任务已运行 PID ${pid}`);}catch(error){if(error.code!=='ESRCH') throw error;}await fs.unlink(lock);}catch(error){if(error.code!=='ENOENT') throw error;}
    await fs.writeFile(lock,String(process.pid),{flag:'wx'});locked=true;
    db=openStore(root);
    if(!login && !inspect){const result=db.prepare("INSERT INTO source_run(source,trigger,status,summary_json) VALUES('eeo','scheduled','running',?)").run(JSON.stringify(plan));runId=Number(result.lastInsertRowid);}
    await fs.rm(resultFile,{force:true});
    const usage=await memorySample();
    if(usage.freeMB<1280) throw new Error(`整机可用内存${usage.freeMB}MB不足1280MB，本次跳过，不启动Chrome`);
    await step('eeo-browser-collector.mjs',[],{EEO_SUPERVISED:'1',EEO_PERSISTENT_SESSION:'1',EEO_UNATTENDED:login?'0':'1',EEO_LOGIN_ONLY:login?'1':'0',EEO_SCHEMA_ONLY:inspect?'1':'0',EEO_SCHEMA_UID:process.env.EEO_SCHEMA_UID||'41121342',EEO_CAPTURE_FROM:inspect?'2026-09-01':from,EEO_CAPTURE_TO:to,EEO_RESULT_FILE:resultFile});
    if(!login && !inspect){
      const result=JSON.parse(await fs.readFile(resultFile,'utf8'));
      if(result.failureCount!==0) throw new Error('采集不完整，禁止发布');
      await step('prepare-eeo-refresh.mjs',[result.outputDir,'--weekly']);
      await step('publish-eeo-refresh.mjs',[path.join(root,'../diagnostics',`eeo-refresh-${to}`)],{EEO_SCHEDULED:'1',EEO_RUN_ID:String(runId)});
      console.log('每周EEO汇总已发布到本地数据库；系统重新载入即可，无需构建或重启。');
      await step('sync-eeo-online.mjs');
    }
    await fs.rm(resultFile,{force:true});
  }
}catch(error){
  const result=await fs.readFile(resultFile,'utf8').then(JSON.parse).catch(()=>null);
  if(failureReason || result?.error) error.message=failureReason || result.error;
  console.error(error.message);
  if(db && runId) db.prepare("UPDATE source_run SET status='failed',error_message=?,finished_at=CURRENT_TIMESTAMP WHERE id=? AND status='running'").run(error.message.slice(0,500),runId);
  process.exitCode=1;
  if(!login&&!inspect&&!dry) await reportFailure(/LOGIN_REQUIRED|登录.*失效/.test(error.message)?'LOGIN_REQUIRED':'LOCAL_FAILED').catch(()=>console.error('线上失败状态未送达；请检查本地任务结果，线上保留旧数据。'));
}finally{
  clearInterval(monitor);clearTimeout(deadline);
  if(db && runId){
    try {
      const row=db.prepare('SELECT summary_json FROM source_run WHERE id=?').get(runId);
      if(row) db.prepare('UPDATE source_run SET summary_json=? WHERE id=?').run(JSON.stringify({...JSON.parse(row.summary_json||'{}'),memoryEvidence}),runId);
    } catch { console.error('内存观测记录未写入，采集结果以批次状态为准。'); }
  }
  db?.close();
  if(locked) await fs.rm(resultFile,{force:true});
  if(locked) await fs.unlink(lock).catch(()=>{});
}
