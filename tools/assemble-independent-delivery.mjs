import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const base=path.resolve(import.meta.dirname,'..');
const previous=path.join(base,'交付包/正式上线交付_工号版_2026-10-09');
const destination=path.join(base,'交付包/独立腾讯云上线_2026-10-10');
const code=path.join(destination,'代码与部署说明'),data=path.join(destination,'业务数据与授权_单独交付');
await fs.mkdir(code,{recursive:true});await fs.mkdir(data,{recursive:true});
for(const file of ['runtime.tar.gz','source.tar.gz','MANIFEST.json'])await fs.copyFile(path.join(previous,'代码与说明',file),path.join(code,file));
for(const folder of ['scripts','deploy'])await fs.cp(path.join(previous,'代码与说明',folder),path.join(code,folder),{recursive:true});
await fs.copyFile(path.join(base,'独立腾讯云部署与工作台免登_2026-10-10.md'),path.join(code,'开始部署.md'));
for(const file of ['initial-summary.json','consultant-identities.json'])await fs.copyFile(path.join(previous,'业务数据_单独交付',file),path.join(data,file));
const administrators=JSON.parse(await fs.readFile(path.join(previous,'业务数据_单独交付/approved-mapping.json'),'utf8'));
const identities=JSON.parse(await fs.readFile(path.join(data,'consultant-identities.json'),'utf8'));
if(administrators.length!==1||administrators[0].jobNumber!=='EEO04410'||identities.length!==51)throw new Error('Approved identities differ');
const mapping=[...administrators,...identities.map(row=>({jobNumber:row.jobNumber,username:row.consultantName,role:'consultant',consultantName:row.consultantName}))];
if(new Set(mapping.map(row=>row.jobNumber)).size!==52)throw new Error('Duplicate employee identity');
await fs.writeFile(path.join(data,'approved-mapping.json'),JSON.stringify(mapping,null,2)+'\n');
await fs.writeFile(path.join(data,'授权说明.md'),'# 独立部署授权\n\n依据负责人2026-10-10明确要求，已核对的51名顾问允许从工作台免登访问，权限为本人客户只读；EEO04410仍为唯一管理员。52个授权按工号唯一匹配；张鑫对应EEO04098。此授权清单覆盖此前仅管理员首发清单，不包含其他工作台人员。\n');
await fs.writeFile(path.join(code,'deploy/env.template'),`# Replace every placeholder using confirmed server/workbench settings. Never commit real secrets.\nAUTH_MODE=workbench\nWORKBENCH_REVOKE_MODE=ttl\nWORKBENCH_SECRET=REPLACE_WITH_APP_DEDICATED_RANDOM_SECRET\nWORKBENCH_LOGIN_URL=https://REPLACE_WORKBENCH_HOST/REPLACE_LOGIN_PATH\nWORKBENCH_LOGOUT_URL=https://REPLACE_WORKBENCH_HOST/REPLACE_LOGOUT_PATH\nEEO_SYNC_TOKEN=REPLACE_WITH_NEW_INDEPENDENT_SYNC_SECRET\nEEO_SYNC_URL=https://REPLACE_NEW_DASHBOARD_HOST\nDATA_DIR=/var/lib/teaching-risk\nPORT=3002\n`);
await fs.writeFile(path.join(code,'deploy/nginx.template.conf'),`# TEMPLATE ONLY: replace host and certificate paths, include within existing nginx http context.\nlog_format teaching_risk_safe '$remote_addr [$time_local] $request_method $uri $status $body_bytes_sent';\nserver {\n    listen 443 ssl;\n    server_name REPLACE_NEW_DASHBOARD_HOST;\n    ssl_certificate /REPLACE/FULLCHAIN.pem;\n    ssl_certificate_key /REPLACE/PRIVKEY.pem;\n    client_max_body_size 12m;\n    access_log /var/log/nginx/teaching-risk.access.log teaching_risk_safe;\n    # Query strings may contain SSO credentials; suppress routine error logging for this vhost.\n    error_log /var/log/nginx/teaching-risk.error.log crit;\n    add_header Referrer-Policy no-referrer always;\n    location / {\n        proxy_pass http://127.0.0.1:3002;\n        proxy_set_header Host $host;\n        proxy_set_header X-Forwarded-Proto https;\n        proxy_set_header Authorization $http_authorization;\n        proxy_set_header X-User "";\n        proxy_set_header X-Role "";\n        proxy_set_header X-Job-Number "";\n    }\n}\n`);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const oldManifest=JSON.parse(await fs.readFile(path.join(code,'MANIFEST.json'),'utf8'));
for(const item of oldManifest.artifacts){const file=path.join(item.file==='initial-summary.json'?data:code,item.file);if(hash(await fs.readFile(file))!==item.sha256)throw new Error('Archive/data changed unexpectedly');}
async function files(dir){const result=[];for(const e of await fs.readdir(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())result.push(...await files(f));else result.push(f);}return result;}
for(const folder of [code,data]){const entries=[];for(const f of await files(folder)){if(path.basename(f)==='CHECKSUMS.json')continue;const bytes=await fs.readFile(f);entries.push({file:path.relative(folder,f).replaceAll('\\','/'),bytes:bytes.length,sha256:hash(bytes)});}await fs.writeFile(path.join(folder,'CHECKSUMS.json'),JSON.stringify({reusedValidatedRelease:'teaching-risk-20261009T064724',files:entries},null,2));}
const artifacts=[];for(const [folder,name] of [['代码与部署说明','独立腾讯云_代码与部署说明_20261010.zip'],['业务数据与授权_单独交付','独立腾讯云_业务数据与授权_20261010.zip']]){
 const zip=path.join(destination,name);const quote=s=>"'"+s.replaceAll("'","''")+"'";
 const result=spawnSync('pwsh',['-NoProfile','-Command',`Compress-Archive -LiteralPath ${quote(path.join(destination,folder))} -DestinationPath ${quote(zip)} -Force`],{stdio:'inherit'});
 if(result.status!==0)throw new Error('Archive failed');const bytes=await fs.readFile(zip);artifacts.push({file:name,bytes:bytes.length,sha256:hash(bytes)});
}
await fs.writeFile(path.join(destination,'交付说明与校验.json'),JSON.stringify({decisionDate:'2026-10-10',deploymentOwner:'project_owner_tencent_cloud',ssoProvider:'colleague_workbench',administratorJobNumber:'EEO04410',consultantGrants:51,totalGrants:52,serverDetailsPending:true,serverDeployed:false,localSyncDestinationUnchanged:true,artifacts},null,2));
console.log(JSON.stringify({destination,consultantGrants:51,totalGrants:52,serverDeployed:false,artifacts}));
