import {openSqlite,migrate} from './node-sqlite.mjs';
export function openStore(root) { const db=openSqlite(root); migrate(db,root); return db; }
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
