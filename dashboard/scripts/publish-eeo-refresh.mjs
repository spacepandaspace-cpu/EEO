import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { openStore } from './local-eeo-store.mjs';
import { writeSnapshot } from './local-eeo-store.mjs';

const root = path.resolve(import.meta.dirname,'..');
if (!process.argv[2]) throw new Error('Usage: node scripts/publish-eeo-refresh.mjs <prepared_directory>');
const prepared = path.resolve(process.argv[2]);
const snapshotPath = path.join(root,'app/data/snapshot.json');
const validation = JSON.parse(await fs.readFile(path.join(prepared,'validation.json'),'utf8'));
const candidate = await fs.readFile(path.join(prepared,'snapshot-candidate.json'),'utf8');
const current = await fs.readFile(snapshotPath,'utf8');
const hash = value => createHash('sha256').update(value).digest('hex');
if (!validation.crmUnchanged || validation.failureCount !== 0 || validation.customerCount !== JSON.parse(current).customers.length) throw new Error('Prepared refresh is not validated');
if (hash(current)!==validation.baseSnapshotHash || hash(candidate)!==validation.candidateHash) throw new Error('Snapshot changed after preparation; refuse overwrite');
const database=openStore(root);
const backupPath = path.join(root,'backups',`snapshot-before-eeo-${Date.now()}.json`);
await fs.mkdir(path.dirname(backupPath),{recursive:true});
await fs.copyFile(snapshotPath,backupPath);
const temp = `${snapshotPath}.${process.pid}.tmp`;
let replaced = false;
let runId;
try {
  database.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE; CREATE TABLE IF NOT EXISTS eeo_snapshot (key TEXT PRIMARY KEY, json TEXT NOT NULL)');
  writeSnapshot(database,JSON.parse(candidate));
  const result = database.prepare(`INSERT INTO source_run
    (source,trigger,status,data_as_of,row_count,file_name,file_hash,summary_json,finished_at)
    VALUES ('eeo',?,'success_with_warnings',?,?,?,?,?,CURRENT_TIMESTAMP)`)
    .run(process.env.EEO_SCHEDULED === '1' ? 'scheduled' : 'manual',validation.dataAsOf,validation.customerCount,path.basename(validation.captureDir),validation.candidateHash,
      JSON.stringify({customerCount:validation.customerCount,dailyReconciled:true,crmUnchanged:true,
        holidayTotal:validation.holidayTotal,previousTotal:validation.previousTotal,
        highUsageCount:validation.highUsageCount,paidLowUsageCount:validation.paidLowUsageCount,
        message:'使用量及每日风险总数已完整更新；CRM无新订单保持不变。当前接口未提供逐日风险等级、已查看、误报，缺失值不按零展示。'}));
  runId = Number(result.lastInsertRowid);
  if(process.env.EEO_RUN_ID) {
    const scheduledId=Number(process.env.EEO_RUN_ID);
    const pending=database.prepare("SELECT 1 FROM source_run WHERE id=? AND source='eeo' AND trigger='scheduled' AND status='running'").get(scheduledId);
    if(!pending) throw new Error('定时批次状态不匹配，拒绝发布');
    database.prepare("UPDATE source_run SET status='success_with_warnings',data_as_of=?,row_count=?,file_name=?,file_hash=?,summary_json=(SELECT summary_json FROM source_run WHERE id=?),finished_at=CURRENT_TIMESTAMP WHERE id=?").run(validation.dataAsOf,validation.customerCount,path.basename(validation.captureDir),validation.candidateHash,runId,scheduledId);
    database.prepare('DELETE FROM source_run WHERE id=?').run(runId);
    runId=scheduledId;
  }
  await fs.writeFile(temp,candidate);
  await fs.rename(temp,snapshotPath);
  replaced = true;
  database.exec('COMMIT');
} catch (error) {
  try {database.exec('ROLLBACK');} catch {}
  if (replaced) {await fs.copyFile(backupPath,temp);await fs.rename(temp,snapshotPath);}
  throw error;
} finally {database.close();await fs.rm(temp,{force:true});}
await fs.writeFile(path.join(prepared,'publication.json'),JSON.stringify({runId,snapshotPath,backupPath,dataAsOf:validation.dataAsOf,crmUnchanged:true},null,2)+'\n');
console.log(JSON.stringify({runId,snapshotPath,backupPath,dataAsOf:validation.dataAsOf,crmUnchanged:true}));
