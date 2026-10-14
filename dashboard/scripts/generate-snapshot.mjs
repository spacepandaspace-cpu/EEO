import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyConsultantIdentities } from './consultant-identities.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const dataRoot = path.resolve(root, "..", "data");

function readTsv(name) {
  const text = fs.readFileSync(path.join(dataRoot, name), "utf8").replace(/^\uFEFF/, "").trim();
  const [headerLine, ...lines] = text.split(/\r?\n/);
  const headers = headerLine.split("\t");
  return lines.filter(Boolean).map((line) => {
    const values = line.split("\t");
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

const asBool = (value) => String(value).toLowerCase() === "true";
const asNum = (value) => Number(value || 0);

const master = readTsv("customer_master_audit_2026-09-21.tsv");
const credits = readTsv("customer_credit_estimate_2026-09-21.tsv");
const decline = readTsv("usage_decline_diagnostic_2026-09-21.tsv");
const daily = readTsv("backend_daily_metrics_2026-09-21.tsv");
const paidRows = readTsv("paid_uid_mapping_review_2026-09-21.tsv");

const creditByUid = new Map(credits.map((row) => [row.uid, row]));
const declineByUid = new Map(decline.map((row) => [row.uid, row]));
const paidByUid = new Map(paidRows.map((row) => [row.proposedUid, row]));

const customers = master.map((row) => {
  const credit = creditByUid.get(row.uid) ?? {};
  const usage = declineByUid.get(row.uid) ?? {};
  const payment = paidByUid.get(row.uid) ?? {};
  const used = asBool(row.used);
  const paid = asBool(row.paid);
  const claim = asBool(row.claim);
  const postLaunchLessons = asNum(credit.postLaunchLessons);
  const last14Lessons = asNum(usage.last14Lessons);
  const last7Lessons = asNum(usage.last7Lessons);
  const maxRolling7Lessons = asNum(usage.maxRolling7Lessons);
  const declinePct = asNum(usage.declineFromPrevious28Pct);
  const theoreticalNet = asNum(credit.theoreticalKnownNet);
  const reasons = [];

  if (paid && asNum(payment.lessonsOnOrAfterPayment) === 0) reasons.push("付费未启用");
  if (paid && asNum(payment.lessonsOnOrAfterPayment) > 0 && last14Lessons === 0) reasons.push("付费后停用");
  if (maxRolling7Lessons >= 40 && last14Lessons === 0) reasons.push("大量使用后归零");
  if (declinePct >= 50 && last7Lessons < asNum(usage.previous28WeeklyAvg)) reasons.push("近期使用骤降");
  if (!paid && postLaunchLessons >= 40) reasons.push("高使用未付费");
  if (claim && !used) reasons.push("领额未使用");
  if (used && last14Lessons === 0) reasons.push("14天沉默");
  if (theoreticalNet < 0) reasons.push("额度来源不完整");

  let score = 0;
  if (paid) score += 10;
  if (asNum(row.paymentTotal) >= 10000) score += 5;
  score += maxRolling7Lessons >= 1000 ? 10 : maxRolling7Lessons >= 200 ? 7 : maxRolling7Lessons >= 40 ? 4 : used ? 2 : 0;
  score += maxRolling7Lessons >= 40 && last14Lessons === 0 ? 35 : declinePct >= 50 ? 30 : used && last14Lessons === 0 ? 15 : 0;
  score += !paid && postLaunchLessons >= 200 ? 30 : !paid && postLaunchLessons >= 40 ? 25 : !paid && postLaunchLessons > 0 ? 15 : claim && !used ? 10 : 0;
  const forced = paid && (asNum(payment.lessonsOnOrAfterPayment) === 0 || last14Lessons === 0);
  const priority = forced || score >= 60 ? "立即关注" : score >= 40 ? "重点跟进" : score >= 20 ? "持续观察" : "常规";

  return {
    uid: row.uid,
    eeoAccountName: row.eeoAccountName,
    eeoAccountNameStatus: row.eeoAccountNameStatus,
    customerName: row.customerName,
    consultant: row.consultant,
    trial: asBool(row.trial),
    claim,
    claimDate: row.claimDate,
    paid,
    paymentCount: asNum(row.paymentCount),
    paymentTotal: asNum(row.paymentTotal),
    used,
    analyzedLessons: asNum(row.analyzedLessons),
    postLaunchLessons,
    lastUsage: row.lastUsage,
    last7Lessons,
    last14Lessons,
    maxRolling7Lessons,
    declinePct,
    theoreticalNet,
    theoreticalLessons: Math.floor(theoreticalNet / 50),
    paymentDate: payment.paidDate ?? "",
    lessonsAfterPayment: asNum(payment.lessonsOnOrAfterPayment),
    reasons,
    score: Math.min(score, 100),
    priority,
  };
}).sort((a, b) => b.score - a.score || a.customerName.localeCompare(b.customerName, "zh-CN"));

const dailyMap = new Map();
for (const row of daily) {
  const current = dailyMap.get(row.date) ?? { date: row.date, lessons: 0, risk: 0, low: 0, medium: 0, high: 0, reviewed: 0, falsePositive: 0 };
  current.lessons += asNum(row.analyzedLessons);
  current.risk += asNum(row.riskLessons);
  current.low += asNum(row.lowRiskLessons);
  current.medium += asNum(row.mediumRiskLessons);
  current.high += asNum(row.highRiskLessons);
  current.reviewed += asNum(row.reviewedRiskLessons);
  current.falsePositive += asNum(row.falsePositiveLessons);
  dailyMap.set(row.date, current);
}

const dailyAggregate = [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date));
const customerDaily = daily.map((row) => ({
  uid: row.uid,
  date: row.date,
  lessons: asNum(row.analyzedLessons),
  low: asNum(row.lowRiskLessons),
  medium: asNum(row.mediumRiskLessons),
  high: asNum(row.highRiskLessons),
  reviewed: asNum(row.reviewedRiskLessons),
  falsePositive: asNum(row.falsePositiveLessons),
}));
const consultants = [...new Set(customers.map((row) => row.consultant))].sort((a, b) => a.localeCompare(b, "zh-CN"));
const customerAliases = [];
const aliasKeys = new Set();
const pushAlias = (uid, alias, source) => {
  const cleaned = String(alias ?? "").trim();
  if (!cleaned) return;
  const key = `${uid}\u0000${cleaned.toLocaleLowerCase("zh-CN")}`;
  if (aliasKeys.has(key)) return;
  aliasKeys.add(key);
  customerAliases.push({ uid, alias: cleaned, source });
};
for (const customer of customers) {
  pushAlias(customer.uid, customer.customerName, "customer_master");
  pushAlias(customer.uid, customer.eeoAccountName, "eeo_account");
}
for (const payment of paidRows) {
  pushAlias(payment.proposedUid, payment.paidCustomer, "crm_payment");
  pushAlias(payment.proposedUid, payment.customerLabelFromSource, "crm_payment");
}
const paidActivatedCount = customers.filter((row) => row.paid && row.used).length;
const postPaymentContinuedUsageCount = customers.filter((row) => row.paid && row.lessonsAfterPayment > 0).length;
const metricDefinitions = [
  {
    code: "activated_customer_payment_rate",
    label: "已激活客户付费率",
    category: "conversion",
    definition: "历史任意时段至少有1节成功监测课节的已激活客户中，已经发生真实付费的客户比例。",
    formula: "历史已激活且已付费UID ÷ 历史已激活UID",
    numerator: paidActivatedCount,
    denominator: customers.filter((row) => row.used).length,
    source: "客户主数据、付费事件、EEOS后台",
  },
  {
    code: "post_payment_continued_usage_rate",
    label: "付费后继续使用率",
    category: "retention",
    definition: "全部付费客户中，在付款日当天或以后继续产生成功监测课节的比例。该指标观察付费后的留存，不属于转化率。",
    formula: "付费后继续使用UID ÷ 全部付费UID",
    numerator: postPaymentContinuedUsageCount,
    denominator: customers.filter((row) => row.paid).length,
    source: "付费事件、EEOS后台",
  },
];

const snapshot = {
  version: "0.0.1",
  asOf: "2026-09-21 10:00",
  customers,
  dailyAggregate,
  customerDaily,
  consultants,
  customerAliases,
  metricDefinitions,
  baselines: {
    customerCount: 92,
    trialCount: 57,
    claimCount: 47,
    historicalUsedCount: 40,
    postLaunchUsedCount: 30,
    paidCount: 11,
    paidAmount: 111000,
    totalLessons: 137953,
    postLaunchLessons: 47805,
    riskLessons: 3605,
    lowRiskLessons: 2865,
    mediumRiskLessons: 653,
    highRiskLessons: 87,
    reviewedLessons: 833,
    falsePositiveLessons: 193,
  },
};

const outputDir = path.join(root, "app", "data");
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, "snapshot.json"), `${JSON.stringify(applyConsultantIdentities(snapshot), null, 2)}\n`, "utf8");
console.log(`Generated snapshot: ${customers.length} customers, ${dailyAggregate.length} dates.`);
