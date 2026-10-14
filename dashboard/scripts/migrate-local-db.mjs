import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stateDir = path.join(root, ".wrangler", "state", "v3", "d1", "miniflare-D1DatabaseObject");
const migration = path.join(root, "drizzle", "0001_data_refresh.sql");

if (!fs.existsSync(stateDir)) {
  console.log("本地 D1 尚未初始化；会在首次启动后自动创建。");
  process.exit(0);
}

const databasePath = fs.readdirSync(stateDir)
  .filter((name) => name.endsWith(".sqlite") && name !== "metadata.sqlite")
  .map((name) => path.join(stateDir, name))
  .sort((left, right) => fs.statSync(right).size - fs.statSync(left).size)[0];

if (!databasePath) throw new Error("未找到本地 D1 业务数据库。");

const database = new DatabaseSync(databasePath);
database.exec('CREATE TABLE IF NOT EXISTS eeo_snapshot (key TEXT PRIMARY KEY, json TEXT NOT NULL)');
try {
  const hasSourceRun = database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'source_run'",
  ).get();

  if (hasSourceRun) {
    console.log("本地 D1 已是最新数据更新结构。");
  } else {
    const hasUserAccount = database.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'user_account'",
    ).get();
    if (!hasUserAccount) throw new Error("本地 D1 缺少基础表 user_account，无法安全应用增量迁移。");

    const sql = fs.readFileSync(migration, "utf8").replaceAll("--> statement-breakpoint", "");
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(sql);
      database.exec("COMMIT");
      console.log("已应用本地 D1 数据更新迁移：0001_data_refresh。");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
  // Local cookie sessions also join external_identity after the workbench update.
  // Apply the additive, idempotent schema even when source_run already exists.
  const identitySql = fs.readFileSync(path.join(root, "drizzle", "0003_workbench_identity.sql"), "utf8").replaceAll("--> statement-breakpoint", "");
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(identitySql);
    database.exec("COMMIT");
    console.log("本地身份与会话结构已核验：0003_workbench_identity（不修改账号或凭证）。");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
} finally {
  database.close();
}
