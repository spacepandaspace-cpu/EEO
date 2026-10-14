import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const key = Symbol.for('teaching-risk.node-sqlite');
export function databaseFile(root = process.cwd()) {
  return path.join(process.env.DATA_DIR || path.join(root, '../runtime-data'), 'teaching-risk.sqlite');
}
export function openSqlite(root = process.cwd()) {
  const file = databaseFile(root);
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const db = new DatabaseSync(file);
  db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA cache_size=-4096;');
  return db;
}
function normalize(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return Number(value);
  return value;
}
class Prepared {
  constructor(database, sql, values = []) { this.database=database; this.sql=sql; this.values=values; }
  bind(...values) { return new Prepared(this.database, this.sql, values.map(normalize)); }
  statement() { return this.database.native.prepare(this.sql); }
  execute() {
    const result=this.statement().run(...this.values);
    return {success:true, results:[], meta:{changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid)}};
  }
  async run() { return this.execute(); }
  async first(column) { const row=this.statement().get(...this.values); return row ? (column ? row[column] : row) : null; }
  async all() { return {success:true,results:this.statement().all(...this.values),meta:{}}; }
  async raw() { const s=this.statement(); s.setReturnArrays(true); return s.all(...this.values); }
}
export class SqliteDatabase {
  constructor(native) { this.native=native; }
  prepare(sql) { return new Prepared(this,sql); }
  async batch(statements) {
    this.native.exec('BEGIN IMMEDIATE');
    try { const rows=statements.map(statement=>statement.execute()); this.native.exec('COMMIT'); return rows; }
    catch(error) { this.native.exec('ROLLBACK'); throw error; }
  }
  async exec(sql) { this.native.exec(sql); return {count:0,duration:0}; }
}
export function getDatabase() {
  if (!globalThis[key]) globalThis[key]=new SqliteDatabase(openSqlite());
  return globalThis[key];
}
export function closeDatabase() { if(globalThis[key]) {globalThis[key].native.close(); delete globalThis[key];} }
export function migrate(native,root) {
  native.exec('CREATE TABLE IF NOT EXISTS node_schema_migration(name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  const migrations=[['0000_tricky_gertrude_yorkes.sql','user_account'],['0001_data_refresh.sql','source_run'],['0002_live_eeo_snapshot.sql','eeo_snapshot'],['0003_workbench_identity.sql','external_identity']];
  for(const [file,table] of migrations) {
    if(native.prepare('SELECT 1 FROM node_schema_migration WHERE name=?').get(file))continue;
    const present=native.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
    native.exec('BEGIN IMMEDIATE');
    try {
      if(!present)native.exec(fs.readFileSync(path.join(root,'drizzle',file),'utf8').replaceAll('--> statement-breakpoint',''));
      native.prepare('INSERT INTO node_schema_migration(name) VALUES(?)').run(file);
      native.exec('COMMIT');
    }catch(error){native.exec('ROLLBACK');throw error;}
  }
}
