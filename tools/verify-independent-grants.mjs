import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {spawnSync} from 'node:child_process';
const base=path.resolve(import.meta.dirname,'..');
const release=path.join(base,'交付包/teaching-risk-20261009T064724/runtime');
const mapping=path.join(base,'交付包/独立腾讯云上线_2026-10-10/业务数据与授权_单独交付/approved-mapping.json');
const state=path.join(base,'diagnostics',`independent-grants-${Date.now()}`);
const folder=path.join(state,'d1/miniflare-D1DatabaseObject');
await fs.mkdir(folder,{recursive:true});
const file=path.join(folder,'isolated.sqlite');
let db=new DatabaseSync(file);
try {
 for(const sqlFile of ['0000_tricky_gertrude_yorkes.sql','0001_data_refresh.sql','0002_live_eeo_snapshot.sql','0003_workbench_identity.sql']) {
  const text=await fs.readFile(path.join(release,'drizzle',sqlFile),'utf8');
  for(const sql of text.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))db.exec(sql);
 }
}finally{db.close();}
for(let i=0;i<2;i++){
 const result=spawnSync(process.execPath,[path.join(release,'scripts/provision-workbench-users.mjs'),mapping],{env:{...process.env,DATA_DIR:state},encoding:'utf8'});
 assert.equal(result.status,0,'Approved employee mapping import failed');
}
db=new DatabaseSync(file);
try {
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM external_identity').get().n,52);
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM user_account WHERE role='consultant'").get().n,51);
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM user_account WHERE role='admin'").get().n,1);
 assert.equal(db.prepare("SELECT e.job_number AS job FROM external_identity e JOIN user_account u ON u.id=e.user_id WHERE u.role='admin'").get().job,'EEO04410');
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM user_account WHERE password_salt<>'' OR password_hash<>''").get().n,0);
 const report={isolatedDatabase:true,totalGrants:52,consultantGrants:51,adminGrants:1,administrator:'EEO04410',repeatImportIdempotent:true,passwordsNotCopied:true,productionModified:false};
 await fs.writeFile(path.join(base,'diagnostics/独立部署工号授权验收_2026-10-10.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));
}finally{db.close();}
