import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { refreshUsage } from './eeo-refresh-model.mjs';
import { paymentAiCredits } from './ai-credit-rules.mjs';
import { applyConsultantIdentities } from './consultant-identities.mjs';
import { openStore } from './local-eeo-store.mjs';

const root = path.resolve(import.meta.dirname,'..');
const captureDir = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Usage: node scripts/prepare-eeo-refresh.mjs <eeo_sync_directory>');
const snapshotPath = path.join(root,'app/data/snapshot.json');
if((await fs.stat(snapshotPath)).size>8*1024*1024) throw new Error('历史快照超过8MB预算，请人工归档后再采集');
if((await fs.stat(path.join(captureDir,'school-details.jsonl'))).size>2*1024*1024) throw new Error('汇总采集超过2MB预算');
const original = await fs.readFile(snapshotPath,'utf8');
const snapshot = JSON.parse(original);
const manifest = JSON.parse(await fs.readFile(path.join(captureDir,'manifest.json'),'utf8'));
const details = [];
for await (const line of createInterface({input:createReadStream(path.join(captureDir,'school-details.jsonl')),crlfDelay:Infinity})) {
  if (Buffer.byteLength(line)>65536 || details.length>=200) throw new Error('Aggregate capture exceeds line/customer budget');
  if (line.trim()) details.push(JSON.parse(line));
}
const creditsText = await fs.readFile(path.join(root,'../data/customer_credit_estimate_2026-09-21.tsv'),'utf8');
const [header,...lines] = creditsText.trim().split(/\r?\n/);
const keys = header.replace(/^\uFEFF/,'').split('\t'), uidIndex = keys.indexOf('uid'), creditIndex = keys.indexOf('knownCreditsIn');
const credits = new Map(lines.map(line=>{const cells=line.split('\t');return [cells[uidIndex],Number(cells[creditIndex])];}));
const paymentFile=path.join(root,'../data/customer_master_audit_2026-09-21.tsv');
if((await fs.stat(paymentFile)).size>2*1024*1024) throw new Error('历史CRM明细超过2MB预算');
const [paymentHeader,...paymentRows]=(await fs.readFile(paymentFile,'utf8')).trim().split(/\r?\n/);
const paymentKeys=paymentHeader.replace(/^\uFEFF/,'').split('\t');
const paymentCredits=new Map(paymentRows.map(line=>{
  const cells=line.split('\t');
  const raw=cells[paymentKeys.indexOf('paymentDetails')]||'[]';
  const json=raw.startsWith('"')&&raw.endsWith('"')?raw.slice(1,-1).replaceAll('""','"'):raw;
  const orders=JSON.parse(json);
  if(!Array.isArray(orders)||orders.length>200) throw new Error('订单数据超过预算或格式无效');
  return [cells[paymentKeys.indexOf('uid')],paymentAiCredits(orders)];
}));
const store=openStore(root);
try {
  const latest=store.prepare("SELECT json FROM eeo_snapshot WHERE key='overview'").get();
  if(latest)Object.assign(snapshot,JSON.parse(latest.json),{customerDaily:snapshot.customerDaily,customerAliases:snapshot.customerAliases});
  const orders=store.prepare('SELECT uid,amount_cents FROM crm_payment_event WHERE active=1 AND uid IS NOT NULL').all();
  if(orders.length)for(const customer of snapshot.customers){
    const paid=orders.filter(row=>row.uid===customer.uid).map(row=>({amount:row.amount_cents/100}));
    paymentCredits.set(customer.uid,paymentAiCredits(paid));
    credits.set(customer.uid,customer.theoreticalNet+customer.postLaunchLessons*50);
  }
}finally{store.close();}
const candidate = refreshUsage(snapshot,details,manifest,credits,{weekly:process.argv.includes('--weekly'),paymentCredits});
for(const customer of candidate.customers)delete customer.usageDataPending;
applyConsultantIdentities(candidate);
const out = path.join(root,'../diagnostics',`eeo-refresh-${manifest.range.to}`);
await fs.mkdir(out,{recursive:true});
const snapshotText = `${JSON.stringify(candidate,null,2)}\n`;
await fs.writeFile(path.join(out,'snapshot-candidate.json'),snapshotText);
const high = candidate.customers.filter(c=>c.holidayLessons>=40).sort((a,b)=>b.holidayLessons-a.holidayLessons);
const low = candidate.customers.filter(c=>c.paid&&c.holidayLessons<=10).sort((a,b)=>b.paymentTotal-a.paymentTotal);
const safeCell = value => String(value??'').replace(/[\r\n\t]/g,' ');
const fields = ['uid','customerName','consultant','paid','paymentTotal','paymentDate','holidayLessons','previousHolidayWeekLessons','holidayActiveDays','holidayGrowthPct','last7Lessons','last14Lessons','lessonsAfterPayment','lastUsage','holidayFollowup','followupAction'];
// Operational followups live in the system; do not generate separate customer lists.
void fields;
const growth = candidate.usageFocus.previousTotal ? (candidate.usageFocus.holidayTotal/candidate.usageFocus.previousTotal-1)*100 : null;
const top = high[0];
const excludingTop = top ? {holiday:candidate.usageFocus.holidayTotal-top.holidayLessons,previous:candidate.usageFocus.previousTotal-top.previousHolidayWeekLessons} : null;
const table = customers => '| 客户 / UID | 顾问 | 已充值金额 | 十一消耗 | 前周消耗 | 跟进方向 |\n|---|---|---:|---:|---:|---|\n'+customers.map(c=>`| ${safeCell(c.customerName).replaceAll('|','/')} / ${c.uid} | ${c.consultant} | ${c.paid?'¥'+c.paymentTotal:'未付费'} | ${c.holidayLessons} | ${c.previousHolidayWeekLessons} | ${c.followupAction} |`).join('\n');
const report = `# 十一客户使用与跟进（${manifest.range.to}更新）\n\nEEOS：92个在册客户全部成功采集，9月1日–10月8日的日汇总均完整，合并历史后每个UID都与累计计数对账。CRM无新订单，订单、金额、日期和顾问归属保持不变。\n\n十一10月1–7日共${candidate.usageFocus.holidayTotal}节，前周9月24–30日${candidate.usageFocus.previousTotal}节，变化${growth?.toFixed(1)}%；${candidate.usageFocus.holidayActiveCount}个客户产生消耗。10月8日为未结束当天，不纳入两组完整周比较。\n\n最高消耗客户${top?.customerName}为${top?.holidayLessons}节，占假期消耗${top?(top.holidayLessons/candidate.usageFocus.holidayTotal*100).toFixed(1):'—'}%。剔除该客户后，其余客户${excludingTop?.holiday}节，对比前周${excludingTop?.previous}节，变化${excludingTop?.previous?((excludingTop.holiday/excludingTop.previous-1)*100).toFixed(1):'—'}%。假期是否“普遍高峰”需结合这个集中度判断。\n\n本次工作筛选阈值：假期≥40节列为高消耗需求跟进；已充值且假期≤10节列为低消耗排查。这是可调整的跟进阈值，不是客户价值定论。\n\n## 高消耗需求跟进（${high.length}个）\n\n${table(high)}\n\n## 已充值低消耗排查（${low.length}个）\n\n${table(low)}\n\n低消耗仅是观察结果，原因尚未确认。先确认假期是否排课，再检查开关/接入、启用人员、额度到账与使用流程；不直接认定流失或产品效果问题。\n\n风险分类与逐日已查看数据没有在本次汇总接口中完整返回；新日期以空缺显示，不以0补齐。理论额度仅根据已知入账与每节50额度推算，不是平台真实余额。机构列表38个是monitorStatus=0筛选结果，不是全平台总数。\n`;
if(process.argv.includes('--report')) await fs.writeFile(path.join(out,'十一使用与跟进.md'),report);
const validation = {captureDir,capturedAt:manifest.capturedAt,dataAsOf:manifest.range.to,customerCount:details.length,failureCount:manifest.failureCount,
  baseSnapshotHash:createHash('sha256').update(original).digest('hex'),candidateHash:createHash('sha256').update(snapshotText).digest('hex'),
  crmUnchanged:snapshot.customers.every(old=>{const c=candidate.customers.find(c=>c.uid===old.uid);return ['customerName','consultant','paid','paymentCount','paymentTotal','paymentDate','claim','claimDate','trial'].every(key=>c[key]===old[key]);}),
  oldTotal:snapshot.customers.reduce((n,c)=>n+c.analyzedLessons,0),newTotal:candidate.baselines.totalLessons,...candidate.usageFocus};
if (!validation.crmUnchanged) throw new Error('CRM fields changed; refuse publication');
await fs.writeFile(path.join(out,'validation.json'),JSON.stringify(validation,null,2)+'\n');
console.log(JSON.stringify({out,validation}));
