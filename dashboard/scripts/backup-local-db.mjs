import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stateDir = path.join(root, ".wrangler", "state", "v3", "d1", "miniflare-D1DatabaseObject");
const backupDir = path.join(root, "backups", "daily");
const retentionDays = 30;

if (!fs.existsSync(stateDir)) throw new Error("本地数据库尚未初始化");
const source = fs.readdirSync(stateDir)
  .filter((name) => name.endsWith(".sqlite") && name !== "metadata.sqlite")
  .map((name) => path.join(stateDir, name))
  .sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0];
if (!source) throw new Error("未找到本地业务数据库");

fs.mkdirSync(backupDir, { recursive: true });
const now = new Date();
const stamp = now.toISOString().replaceAll(":", "").replaceAll("-", "").replace("T", "_").slice(0, 15);
const backupPath = path.join(backupDir, `dashboard_${stamp}.db`);
const escaped = backupPath.replaceAll("'", "''");

const database = new DatabaseSync(source);
try {
  database.exec("PRAGMA wal_checkpoint(FULL)");
  database.exec(`VACUUM INTO '${escaped}'`);
} finally {
  database.close();
}

const bytes = fs.readFileSync(backupPath);
const manifest = {
  version: "0.0.1",
  createdAt: now.toISOString(),
  databaseFile: path.basename(backupPath),
  bytes: bytes.byteLength,
  sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  retentionDays,
};
fs.writeFileSync(backupPath.replace(/\.db$/, ".manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
for (const name of fs.readdirSync(backupDir)) {
  if (!/^dashboard_\d{8}_\d{6}\.(db|manifest\.json)$/.test(name)) continue;
  const target = path.resolve(backupDir, name);
  if (!target.startsWith(`${path.resolve(backupDir)}${path.sep}`)) continue;
  if (fs.statSync(target).mtimeMs < cutoff) fs.unlinkSync(target);
}

console.log(`Backup created: ${path.relative(root, backupPath)}`);
