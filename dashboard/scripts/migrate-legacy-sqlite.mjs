import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {databaseFile,migrate} from './node-sqlite.mjs';
const root=path.resolve(import.meta.dirname,'..');
const source=process.argv[2];const target=databaseFile(root);
if(!source||!path.isAbsolute(source)||!fs.existsSync(source))throw new Error('Provide explicit absolute path of the old SQLite business database');
if(fs.existsSync(target)||fs.existsSync(path.join(path.dirname(target),'server.lock')))throw new Error('Target exists or service is running; stop and back up before migration');
fs.mkdirSync(path.dirname(target),{recursive:true});
const old=new DatabaseSync(source,{readOnly:true});
try {
 if(!old.prepare("SELECT 1 FROM sqlite_master WHERE name='user_account'").get())throw new Error('Not a business database');
 old.exec(`VACUUM INTO '${target.replaceAll("'","''")}'`);
}finally{old.close();}
const db=new DatabaseSync(target);try{migrate(db,root);const integrity=db.prepare('PRAGMA integrity_check').get();if(Object.values(integrity)[0]!=='ok')throw new Error('SQLite integrity check failed');console.log('Database copied and verified; original retained');}finally{db.close();}
