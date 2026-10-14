import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {parseCrmWorkbook} from '../lib/crm-import.ts';
import {applyCrmPayments} from '../lib/crm-snapshot.ts';
const snapshot=JSON.parse(await fs.readFile('app/data/snapshot.json','utf8'));
snapshot.customerAliases.push({uid:'80972368',alias:'1/宁波莱沅教育竹老师',source:'crm_payment'});
const file=await fs.readFile(process.argv[2]);
const bytes=file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength);
const result=parseCrmWorkbook(bytes,snapshot),again=parseCrmWorkbook(bytes,snapshot);
assert.equal(result.rows.length,12);assert.equal(result.amountCents,11200000);assert.equal(result.unmappedCount,0);
assert.equal(result.rows.filter(r=>r.customerName==='文星教育').length,1);
assert.equal(result.rows.filter(r=>r.customerName.includes('济南新希望')).length,1);
assert.equal(result.rows.find(r=>r.customerName.includes('济南新希望')).amountCents,2000000);
const asi=result.rows.filter(r=>r.customerName==='ASI_');assert.equal(asi.length,1);assert.equal(asi[0].amountCents,500000);assert.equal(asi[0].paidDate,'2026-09-01');
assert.deepEqual(result.rows.map(r=>r.sourceRecordKey),again.rows.map(r=>r.sourceRecordKey));
assert.equal(new Set(result.rows.map(r=>r.sourceRecordKey)).size,12);
assert.throws(()=>applyCrmPayments(snapshot,{...result,unmappedCount:1},snapshot.asOf),/未关联UID/);
const copy=structuredClone(snapshot);const pending=copy.customers.find(c=>c.uid==='80972368');
if(pending){
 const daily=JSON.stringify(copy.customerDaily),eeo=JSON.stringify(copy.sourceMetadata.eeo);
 const updated=applyCrmPayments(copy,result,copy.asOf);
 assert.equal(updated.baselines.paidCount,12);assert.equal(updated.baselines.paidAmount,112000);
 assert.equal(JSON.stringify(updated.customerDaily),daily);assert.equal(JSON.stringify(updated.sourceMetadata.eeo),eeo);
 assert.equal(updated.customers.find(c=>c.uid==='33131770').paidAiCredits,750000);
 assert(!updated.customers.find(c=>c.uid==='80972368').reasons.some(r=>/未使用|低消耗|未启用/.test(r)));
}
console.log('CRM真实文件对账、无效订单排除、ASI净额合并、稳定去重键及未知UID拒绝检查通过。');
