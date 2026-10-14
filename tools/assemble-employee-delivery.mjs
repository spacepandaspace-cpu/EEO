import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const base=path.resolve(import.meta.dirname,'..');
const record=JSON.parse(await fs.readFile(path.join(base,'diagnostics/latest-server-delivery.json'),'utf8'));
const release=record.delivery;
if(!release.startsWith(path.join(base,'交付包')+path.sep))throw new Error('Invalid release path');
const previous=path.join(base,'交付包/正式上线交付_2026-10-09');
const destination=path.join(base,'交付包/正式上线交付_工号版_2026-10-09');
const code=path.join(destination,'代码与说明'),data=path.join(destination,'业务数据_单独交付');
await fs.mkdir(code,{recursive:true});await fs.mkdir(data,{recursive:true});
for(const file of ['runtime.tar.gz','source.tar.gz','MANIFEST.json'])await fs.copyFile(path.join(release,file),path.join(code,file));
for(const folder of ['deploy','scripts'])await fs.cp(path.join(previous,'代码与说明',folder),path.join(code,folder),{recursive:true});
await fs.copyFile(path.join(release,'initial-summary.json'),path.join(data,'initial-summary.json'));
await fs.copyFile(path.join(previous,'业务数据_单独交付/approved-mapping.json'),path.join(data,'approved-mapping.json'));
await fs.copyFile(path.join(base,'data/consultant-identities.json'),path.join(data,'consultant-identities.json'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const manifest=JSON.parse(await fs.readFile(path.join(release,'MANIFEST.json'),'utf8'));
const sha=manifest.artifacts.find(r=>r.file==='initial-summary.json').sha256;
let guide=await fs.readFile(path.join(previous,'代码与说明/开始部署.md'),'utf8');
guide=guide.replace(/本包交给服务器侧Codex执行。[^\r\n]+/,`本包交给服务器侧Codex执行。当前正式版本为 ${path.basename(release)}。本次根据负责人最新要求改为以EEO工号唯一识别销售/顾问，替代此前045358版及其他旧包。A方案30分钟JWT和既有授权规则继续执行；旧交付包完整保留用于历史追溯。代码、首次数据、MANIFEST必须整套使用本工号版。`)
 .replace('## 部署原交付包','## 部署当前工号版交付包')
 .replace('原运行包健康检查主要检查基础表。','本运行包健康检查覆盖基础表及登录关联表。')
 .replace('098fc3d9086af196e72f803b3b7416de125ae09207f3983d1bf15d7120fc9410',sha)
 .replace('该SHA256对应原确认版本的首次快照','该SHA256对应已补齐顾问工号的首次快照')
 .replace('三个原文件SHA256匹配','本版三个文件SHA256匹配');
guide+='\n\n## 本次工号改造与部署要求\n\n51名顾问、92个客户均已匹配工号；张鑫由负责人确认对应EEO04098，不对应EEO01227。姓名只展示，客户字段consultantJobNumber与会话jobNumber一致才允许顾问读取；客户列表、日明细和客户日志使用同一规则。缺工号拒绝顾问访问，管理员仍保留全量权限。身份映射不等于新增授权；approved-mapping.json仍仅授予EEO04410管理员，勿将consultant-identities.json当作账号授权清单批量导入。\n\n请先部署本版runtime，随后导入本版initial-summary.json；旧版严格同步协议不接受新增工号字段。若此前已经导入旧快照，使用本版脚本与新SHA重新导入即可，其数据日期和业务指标不变，仅补齐归属工号。不要从旧包取数据或脚本。\n\nconsultant-identities.json是采集电脑的私有身份映射，本机已放置于看板搭建/data/。服务器权限过滤直接读取客户已存工号，无需按姓名推断。后续更名保留同一工号；客户转交须明确更新归属工号，单改显示姓名不会转移权限。出现新姓名且缺工号时须核对后再补充。\n\n本机已验证类型检查、隔离构建、同名不同工号的权限隔离、无工号拒绝、客户实时日志归属、93块同步和幂等。真实Ubuntu部署、可信HTTPS、真实工作台登录及正式发布由服务器侧按上文验收执行并回传结果。\n';
await fs.writeFile(path.join(code,'开始部署.md'),guide);
await fs.writeFile(path.join(data,'授权与身份说明.md'),'# 授权与身份\n\napproved-mapping.json是授权清单，保留EEO04410唯一管理员。consultant-identities.json是51名销售/顾问身份对照，不能用于批量开通权限。92个客户已补齐归属工号，姓名用于展示。张鑫→EEO04098为负责人2026-10-09明确确认。身份与业务数据仅通过已授权安全渠道单独交付。\n');
for(const report of ['workbench-acceptance.json','eeo-online-sync-verification.json','server-runtime-acceptance.json','最终交付_首次导入验收_2026-10-09.json']){
 try{await fs.copyFile(path.join(base,'diagnostics',report),path.join(code,report));}catch(e){if(e.code!=='ENOENT')throw e;}
}
async function list(folder){const result=[];for(const e of await fs.readdir(folder,{withFileTypes:true})){const file=path.join(folder,e.name);if(e.isDirectory())result.push(...await list(file));else result.push(file);}return result;}
for(const [folder,name] of [[code,'DELIVERY-CHECKSUMS.json'],[data,'DATA-CHECKSUMS.json']]){
 const entries=[];for(const file of await list(folder)){if(path.basename(file)===name)continue;const bytes=await fs.readFile(file);entries.push({file:path.relative(folder,file).replaceAll('\\','/'),bytes:bytes.length,sha256:hash(bytes)});}
 await fs.writeFile(path.join(folder,name),JSON.stringify({canonicalRelease:path.basename(release),employeeIdentity:true,files:entries},null,2));
}
const archives=[];
for(const [folder,name] of [['代码与说明','教学风险监测_上线代码与说明_工号版_20261009.zip'],['业务数据_单独交付','教学风险监测_首次业务汇总_工号版_20261009.zip']]){
 const zip=path.join(destination,name);
 const quote=value=>"'"+value.replaceAll("'","''")+"'";
 const result=spawnSync('pwsh',['-NoProfile','-Command',`Compress-Archive -LiteralPath ${quote(path.join(destination,folder))} -DestinationPath ${quote(zip)} -Force`],{stdio:'inherit'});
 if(result.status!==0)throw new Error('Archive failed');const bytes=await fs.readFile(zip);archives.push({file:name,bytes:bytes.length,sha256:hash(bytes)});
}
await fs.writeFile(path.join(destination,'交付包校验.json'),JSON.stringify({canonicalRelease:path.basename(release),supersedes:'teaching-risk-20261009T045358',oldDeliveryPreserved:true,consultants:51,customers:92,unresolved:0,artifacts:archives},null,2));
console.log(JSON.stringify({destination,release,archives}));
