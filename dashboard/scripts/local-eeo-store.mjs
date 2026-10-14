import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
export function openStore(root) {
  const dir = path.join(root,'.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
  for (const file of fs.readdirSync(dir).filter(file=>file.endsWith('.sqlite')&&file!=='metadata.sqlite')) {
    const db = new DatabaseSync(path.join(dir,file));
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE name='source_run'").get()) {
      db.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS eeo_snapshot (key TEXT PRIMARY KEY, json TEXT NOT NULL)');
      return db;
    }
    db.close();
  }
  throw new Error('本地业务数据库未初始化');
}
export function writeSnapshot(db, snapshot) {
  const {customerDaily, customerAliases, ...rest} = snapshot;
  void customerAliases;
  const overview = JSON.stringify({...rest,customerDaily:[],customerAliases:[]});
  if (Buffer.byteLength(overview)>250_000) throw new Error('汇总超过250KB预算');
  const put = db.prepare('INSERT OR REPLACE INTO eeo_snapshot (key,json) VALUES (?,?)');
  put.run('overview',overview);
  for (const customer of snapshot.customers) {
    const rows = JSON.stringify(customerDaily.filter(row=>row.uid===customer.uid).slice(-365));
    if (Buffer.byteLength(rows)>100_000) throw new Error('单个客户日汇总超过100KB');
    put.run(`daily:${customer.uid}`,rows);
  }
}
