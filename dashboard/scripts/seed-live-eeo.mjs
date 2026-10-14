import fs from 'node:fs/promises';
import path from 'node:path';
import {openStore,writeSnapshot} from './local-eeo-store.mjs';
const root=path.resolve(import.meta.dirname,'..');
const db=openStore(root);
try {
  if(!db.prepare("SELECT 1 FROM eeo_snapshot WHERE key='overview'").get()){
    const snapshot=JSON.parse(await fs.readFile(path.join(root,'app/data/snapshot.json'),'utf8'));
    db.exec('BEGIN IMMEDIATE');
    try{writeSnapshot(db,snapshot);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
    console.log('已将有效快照按客户拆分写入本地数据库，不新增采集批次。');
  }else console.log('已有实时快照，未覆盖。');
}finally{db.close();}
