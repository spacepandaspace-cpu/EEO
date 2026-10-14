import fs from 'node:fs';
import path from 'node:path';
import {openSqlite,migrate} from './node-sqlite.mjs';
const dir=process.env.DATA_DIR;
const input=process.argv[2];
if(!dir||!path.isAbsolute(dir)||!input)throw new Error('Usage: DATA_DIR=<persistent directory> node scripts/provision-workbench-users.mjs <explicitly-approved-mapping.json>');
if(fs.statSync(input).size>65536)throw new Error('Mapping exceeds budget');
const rows=JSON.parse(fs.readFileSync(input,'utf8'));
if(!Array.isArray(rows)||rows.length>300)throw new Error('Invalid mapping');
const db=openSqlite(); migrate(db,path.resolve(import.meta.dirname,'..'));
try {
 db.exec('BEGIN IMMEDIATE');
 const jobs=new Set();
 for(const row of rows){
  if(!/^EEO\d{5,12}$/.test(row.jobNumber)||jobs.has(row.jobNumber)||!['admin','consultant'].includes(row.role)||typeof row.username!=='string'||!row.username.trim()||row.username.length>100|| (row.role==='consultant'&&(!row.consultantName||row.consultantName.length>100)))throw new Error('Mapping must explicitly assign job number, local role and consultant scope');
  jobs.add(row.jobNumber);
  if((row.jobNumber==='EEO04410')!==(row.role==='admin'))throw new Error('Only EEO04410 may have the dashboard administrator role');
  let userId=row.userId;
  if(userId){const user=db.prepare('SELECT role,consultant_name FROM user_account WHERE id=?').get(userId);if(!user||user.role!==row.role||user.consultant_name!==(row.consultantName||null))throw new Error('Existing business user mismatch; no implicit role or ownership changes');}
  else {
   const existing=db.prepare('SELECT user_id FROM external_identity WHERE job_number=?').get(row.jobNumber);
   if(existing){const user=db.prepare('SELECT role,consultant_name FROM user_account WHERE id=?').get(existing.user_id);if(user.role!==row.role||user.consultant_name!==(row.consultantName||null))throw new Error('Existing mapping mismatch');userId=existing.user_id;}
   else userId=Number(db.prepare("INSERT INTO user_account(username,role,consultant_name,password_salt,password_hash) VALUES(?,?,?,'','')").run(row.username,row.role,row.consultantName||null).lastInsertRowid);
  }
  db.prepare('INSERT INTO external_identity(job_number,user_id) VALUES(?,?) ON CONFLICT(job_number) DO NOTHING').run(row.jobNumber,userId);
  const mapping=db.prepare('SELECT user_id FROM external_identity WHERE job_number=?').get(row.jobNumber);
  if(mapping.user_id!==userId)throw new Error('Mapping conflict');
  if(row.enabled!==undefined){
    if(![0,1].includes(row.enabled))throw new Error('Explicit enabled must be 0 or 1');
    db.prepare('UPDATE external_identity SET enabled=? WHERE job_number=?').run(row.enabled,row.jobNumber);
    db.prepare('UPDATE user_account SET enabled=? WHERE id=?').run(row.enabled,userId);
    db.prepare('DELETE FROM auth_session WHERE user_id=?').run(userId);
    db.prepare('DELETE FROM workbench_session WHERE user_id=?').run(userId);
  }
 }
 db.exec('COMMIT');console.log(`Explicit business mappings applied: ${rows.length}; no workbench password stored.`);
}catch(error){db.exec('ROLLBACK');throw error;}finally{db.close();}
