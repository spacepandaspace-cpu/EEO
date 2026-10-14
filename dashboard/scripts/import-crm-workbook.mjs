import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseCrmWorkbook} from '../lib/crm-import.ts';
import {applyCrmPayments} from '../lib/crm-snapshot.ts';
import {openStore,writeSnapshot} from './local-eeo-store.mjs';

const root=path.resolve(import.meta.dirname,'..');
const input=process.argv[2];
if(!input)throw new Error('Usage: node --experimental-strip-types scripts/import-crm-workbook.mjs <xlsx> [--publish]');
if((await fs.stat(input)).size>10*1024*1024)throw new Error('CRM文件超过10MB预算');
const bytes=await fs.readFile(input);
const hash=createHash('sha256').update(bytes).digest('hex');
const snapshotPath=path.join(root,'app/data/snapshot.json');
const original=await fs.readFile(snapshotPath,'utf8');
const snapshot=JSON.parse(original);
const db=openStore(root);
try {
 const overview=db.prepare("SELECT json FROM eeo_snapshot WHERE key='overview'").get();
 if(overview)Object.assign(snapshot,JSON.parse(overview.json),{customerDaily:snapshot.customerDaily,customerAliases:snapshot.customerAliases});
 // Explicit user confirmation on 2026-10-12; never infer other customers by similarity.
 const newUid='80972368', newName='1/宁波莱沅教育竹老师';
 const preview=parseCrmWorkbook(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),snapshot);
 if(preview.rows.some(row=>row.customerName===newName)&&!snapshot.customers.some(c=>c.uid===newUid)){
  const schools=JSON.parse(await fs.readFile(path.join(root,'../data/eeo_sync_20261012T020440Z/schools.json'),'utf8'));
  const school=schools.find(row=>row.uid===newUid);assert(school,'已确认UID缺少EEO来源');
  snapshot.customers.push({uid:newUid,customerName:newName,eeoAccountName:school.schoolName,eeoAccountNameStatus:'用户确认CRM关联',consultant:'王一诺',consultantJobNumber:'EEO04467',trial:false,claim:false,claimDate:'',paid:false,paymentCount:0,paymentTotal:0,purchasedAiCredits:0,bonusAiCredits:0,paidAiCredits:0,used:school.analyzedLessonCount>0,analyzedLessons:school.analyzedLessonCount,postLaunchLessons:school.analyzedLessonCount,lastUsage:new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',dateStyle:'short'}).format(new Date(Number(school.lastActiveAt)*1000)),last7Lessons:0,last14Lessons:0,maxRolling7Lessons:0,declinePct:0,theoreticalNet:-school.analyzedLessonCount*50,theoreticalLessons:-school.analyzedLessonCount,paymentDate:'',lessonsAfterPayment:0,reasons:[],score:0,priority:'重点跟进',usageDataPending:true});
  snapshot.customerAliases.push({uid:newUid,alias:newName,source:'crm_payment'});
  snapshot.consultants=[...new Set([...snapshot.consultants,'王一诺'])];
  snapshot.baselines={...snapshot.baselines,customerCount:snapshot.customers.length,historicalUsedCount:snapshot.baselines.historicalUsedCount+Number(school.analyzedLessonCount>0),postLaunchUsedCount:snapshot.baselines.postLaunchUsedCount+Number(school.analyzedLessonCount>0),totalLessons:snapshot.baselines.totalLessons+school.analyzedLessonCount,postLaunchLessons:snapshot.baselines.postLaunchLessons+school.analyzedLessonCount};
 }
 const parsed=parseCrmWorkbook(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),snapshot);
 const importedAt=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'medium',hour12:false}).format(new Date());
 const updated=applyCrmPayments(snapshot,parsed,importedAt);
 if(path.basename(input)==='AI额度售卖情况_2026-10-12.xlsx'){assert.equal(parsed.rows.length,12);assert.equal(parsed.amountCents,11200000);}
 assert.equal(parsed.unmappedCount,0);
 const summary={orders:parsed.rows.length,rowCount:parsed.rows.length,amount:parsed.amountCents/100,gmvYuan:parsed.amountCents/100,matchedCount:parsed.matchedCount,unmappedCount:parsed.unmappedCount,paidCustomers:updated.baselines.paidCount,customers:updated.customers.length,corrections:parsed.corrections,warnings:parsed.warnings,analysisRefreshPending:false,eeoPreserved:true,usagePending:updated.customers.filter(c=>c.usageDataPending).map(c=>c.uid)};
 console.log(JSON.stringify(summary));
 if(process.argv.includes('--publish')){
  const existing=db.prepare("SELECT id FROM source_run WHERE source='crm' AND file_hash=? AND status IN ('success','success_with_warnings')").get(hash);
  if(existing){console.log(JSON.stringify({duplicate:true,runId:existing.id}));}
  else{
   const backup=path.join(root,'backups',`snapshot-before-crm-${Date.now()}.json`);await fs.mkdir(path.dirname(backup),{recursive:true});await fs.writeFile(backup,original);
   const temp=snapshotPath+`.${process.pid}.tmp`;let replaced=false;
   try{
    db.exec('BEGIN IMMEDIATE');
    const result=db.prepare("INSERT INTO source_run(source,trigger,status,data_as_of,row_count,file_name,file_hash,summary_json,finished_at) VALUES('crm','upload','success_with_warnings',?,?,?,?,?,CURRENT_TIMESTAMP)").run(importedAt,parsed.rows.length,path.basename(input),hash,JSON.stringify(summary));const runId=Number(result.lastInsertRowid);
    db.prepare('UPDATE crm_payment_event SET active=0 WHERE active=1').run();
    const put=db.prepare(`INSERT INTO crm_payment_event(source_record_key,uid,customer_name,consultant_name,order_no,paid_date,amount_cents,mapping_status,source_run_id,source_row,raw_json,active,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,1,CURRENT_TIMESTAMP) ON CONFLICT(source_record_key) DO UPDATE SET uid=excluded.uid,customer_name=excluded.customer_name,consultant_name=excluded.consultant_name,order_no=excluded.order_no,paid_date=excluded.paid_date,amount_cents=excluded.amount_cents,mapping_status=excluded.mapping_status,source_run_id=excluded.source_run_id,source_row=excluded.source_row,raw_json=excluded.raw_json,active=1,updated_at=CURRENT_TIMESTAMP`);
    for(const row of parsed.rows)put.run(row.sourceRecordKey,row.uid,row.customerName,row.consultantName,row.orderNo,row.paidDate,row.amountCents,row.mappingStatus,runId,row.sourceRow,row.rawJson);
    writeSnapshot(db,updated);
    await fs.writeFile(temp,JSON.stringify(updated,null,2)+'\n');await fs.rename(temp,snapshotPath);replaced=true;db.exec('COMMIT');
    console.log(JSON.stringify({published:true,runId,...summary}));
   }catch(error){try{db.exec('ROLLBACK');}catch{}if(replaced){await fs.copyFile(backup,temp);await fs.rename(temp,snapshotPath);}throw error;}finally{await fs.rm(temp,{force:true});}
  }
 }
}finally{db.close();}
