import path from 'node:path';
import {openSqlite,migrate} from './node-sqlite.mjs';
const root=path.resolve(import.meta.dirname,'..');
const db=openSqlite(root);try{migrate(db,root);console.log('SQLite schema ready');}finally{db.close();}
