import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {databaseFile} from './node-sqlite.mjs';
const root=path.resolve(import.meta.dirname,'..'),source=databaseFile(root);
if(!fs.existsSync(source))throw new Error('SQLite database not initialized');
const dir=path.join(path.dirname(source),'backups');fs.mkdirSync(dir,{recursive:true});
const file=path.join(dir,`teaching-risk-${Date.now()}.sqlite`);
const db=new DatabaseSync(source);try{db.exec(`VACUUM INTO '${file.replaceAll("'","''")}'`);}finally{db.close();}
console.log(JSON.stringify({file,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}));
