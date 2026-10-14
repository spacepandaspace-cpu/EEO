import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const snapshotPath = path.join(root, "app", "data", "snapshot.json");
const capturePath = process.argv[2] && path.resolve(process.argv[2]);
if (!capturePath) throw new Error("Usage: node scripts/import-eeo-manual-capture.mjs <capture.json>");

if ((await fs.stat(capturePath)).size > 2 * 1024 * 1024) throw new Error("EEO导入超过2MB，请分批处理；快照未修改。");
const capture = JSON.parse(await fs.readFile(capturePath, "utf8"));
const rows = Array.isArray(capture.details) ? capture.details : [];
const snapshotBeforeImport = JSON.parse(await fs.readFile(snapshotPath, "utf8"));
const expected = new Set(snapshotBeforeImport.customers.map((row) => row.uid));
const matched = rows.filter((row) => expected.has(String(row.uid)));
if (new Set(matched.map(row => String(row.uid))).size !== matched.length) throw new Error("EEO UID重复，快照未修改。");
for (const row of matched) {
  const value = Number(row.overview?.analyzedLessonCount);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("EEO监测汇总无效，快照未修改。");
  if (row.analysisTrend && (!Array.isArray(row.analysisTrend) || row.analysisTrend.length > 365 || row.analysisTrend.some(day => !/^\d{4}-\d{2}-\d{2}$/.test(day.date) || !Number.isSafeInteger(day.lessonCount) || day.lessonCount < 0))) throw new Error("EEO日汇总无效，快照未修改。");
}
if (!matched.length) throw new Error("EEO抓取结果没有匹配到看板客户，未写入快照。");
if (capture.failureCount !== 0 || matched.length !== expected.size) throw new Error(`EEO抓取有 ${capture.failureCount} 个失败机构，未写入快照。`);

const snapshot = snapshotBeforeImport;
const details = new Map(matched.map((row) => [String(row.uid), row]));
const dateFromUnix = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(numeric * 1000));
};

for (const customer of snapshot.customers) {
  const detail = details.get(customer.uid);
  if (!detail) continue;
  const overview = detail.overview ?? {};
  const trend = Array.isArray(detail.analysisTrend) ? detail.analysisTrend : [];
  const countedTrend = trend.filter((row) => row.lessonCount !== undefined);
  customer.analyzedLessons = Number(overview.analyzedLessonCount ?? customer.analyzedLessons);
  customer.used = customer.analyzedLessons > 0;
  customer.lastUsage = dateFromUnix(detail.header?.lastActiveAt) || customer.lastUsage;
  customer.postLaunchLessons = countedTrend.filter((row) => row.date >= "2026-08-18").reduce((sum, row) => sum + Number(row.lessonCount || 0), 0);
}

const capturedAt = String(capture.capturedAt || new Date().toISOString());
const capturedLocal = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", dateStyle: "short", timeStyle: "medium", hour12: false }).format(new Date(capturedAt)).replace(" ", " ");
snapshot.asOf = capturedLocal;
snapshot.sourceMetadata = {
  ...(snapshot.sourceMetadata ?? {}),
  eeo: { dataAsOf: capture.dataAsOf, capturedAt, matchedCustomers: matched.length, platformInstitutionCount: capture.platformInstitutionCount },
  crm: { dataAsOf: snapshot.sourceMetadata?.crm?.dataAsOf ?? "2026-09-21 10:00", status: "unchanged_from_previous_snapshot" },
};
const backupPath = path.join(root, "backups", `snapshot-${Date.now()}.json`);
await fs.mkdir(path.dirname(backupPath), {recursive:true});
await fs.copyFile(snapshotPath, backupPath);
const tempPath = `${snapshotPath}.${process.pid}.tmp`;
try { await fs.writeFile(tempPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8"); await fs.rename(tempPath, snapshotPath); }
finally { await fs.rm(tempPath, {force:true}); }
console.log(JSON.stringify({ updated: snapshotPath, matchedCustomers: matched.length, dataAsOf: capture.dataAsOf, capturedAt, crm: snapshot.sourceMetadata.crm }, null, 2));
