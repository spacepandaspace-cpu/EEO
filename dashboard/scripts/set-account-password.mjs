// Administrative recovery only; never accept passwords in arguments or files.
import { randomBytes,pbkdf2Sync } from 'node:crypto';
import path from 'node:path';
import { openSqlite,migrate } from './node-sqlite.mjs';
const job=process.argv[2];
if(process.argv.length!==3||!/^EEO\d{5,12}$/.test(job||'')||!process.env.DATA_DIR||!path.isAbsolute(process.env.DATA_DIR))
  throw new Error('Usage: DATA_DIR=<persistent directory> node scripts/set-account-password.mjs EEO04410');
if(!process.stdin.isTTY||!process.stdout.isTTY)throw new Error('Interactive terminal required; do not pipe or save passwords.');
async function hidden(prompt) {
  process.stdout.write(prompt);process.stdin.setRawMode(true);process.stdin.resume();
  return new Promise((resolve,reject)=>{
    let value='';
    const restore=()=>{process.stdin.off('data',handler);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');};
    const handler=chunk=>{
      for(const char of chunk.toString('utf8')){
        if(char==='\x03'){restore();reject(new Error('Cancelled'));return;}
        if(char==='\r'||char==='\n'){restore();resolve(value);return;}
        if(char==='\x7f'||char==='\b'){value=value.slice(0,-1);continue;}
        if(char>=' '&&value.length<129)value+=char;
      }
    };
    process.stdin.on('data',handler);
  });
}
const db=openSqlite();migrate(db,path.resolve(import.meta.dirname,'..'));
try {
  const user=db.prepare('SELECT u.id,u.role FROM user_account u JOIN external_identity e ON e.user_id=u.id WHERE e.job_number=? AND e.enabled=1 AND u.enabled=1').get(job);
  if(!user||(job==='EEO04410'?user.role!=='admin':user.role!=='consultant'))throw new Error('Provision an explicitly approved valid employee mapping first.');
  let password=await hidden('New independent password (input hidden): ');
  let confirmation=await hidden('Confirm (input hidden): ');
  if(password!==confirmation||password.length<12||password.length>128)throw new Error('Passwords must match and contain 12-128 characters.');
  const salt=randomBytes(16),hash=pbkdf2Sync(password,salt,160000,32,'sha256').toString('base64');
  password='';confirmation='';
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE user_account SET password_salt=?,password_hash=?,encrypted_password=NULL,password_iv=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(salt.toString('base64'),hash,user.id);
    db.prepare('DELETE FROM auth_session WHERE user_id=?').run(user.id);
    db.prepare("INSERT INTO audit_log(actor_name,action,object_type,object_id) VALUES('server-maintenance','set_independent_password','user_account',?)").run(String(user.id));
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  console.log('Password verification updated; existing password sessions revoked. No password was printed or saved.');
}finally{db.close();}
