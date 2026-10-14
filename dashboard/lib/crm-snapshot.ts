import type { DashboardSnapshot, Customer } from "../app/dashboard-types.ts";
import type { CrmWorkbookResult } from "./crm-import.ts";

/** Cumulative CRM export replaces payment facts; EEO usage rows stay intact. */
export function applyCrmPayments(snapshot: DashboardSnapshot, parsed: CrmWorkbookResult, importedAt: string): DashboardSnapshot {
  if (parsed.unmappedCount) throw new Error("有效订单存在未关联UID，保留旧数据；请先补齐客户关联");
  const byUid = new Map<string, typeof parsed.rows>();
  for (const row of parsed.rows) { const list = byUid.get(row.uid!) ?? []; list.push(row); byUid.set(row.uid!, list); }
  const customers = snapshot.customers.map(old => {
    const orders = byUid.get(old.uid) ?? [];
    const paymentTotal = orders.reduce((sum, row) => sum + row.amountCents, 0) / 100;
    const purchased = orders.reduce((sum, row) => sum + row.amountCents, 0);
    const bonus = orders.reduce((sum, row) => sum + row.amountCents * (row.amountCents >= 1_000_000 ? 1 : 0.5), 0);
    const paymentDate = orders.map(row => row.paidDate).sort()[0] ?? "";
    const pending = old.usageDataPending;
    const lessonsAfterPayment = pending ? 0 : snapshot.customerDaily.filter(row => row.uid === old.uid && row.date >= paymentDate).reduce((sum, row) => sum + row.lessons, 0);
    const theoreticalNet = old.theoreticalNet + purchased + bonus - (old.paidAiCredits ?? 0);
    const reasons = old.reasons.filter(reason => !/^(付费未启用|付费后停用|已充值：|高使用未付费|额度来源不完整)/.test(reason));
    const paid = orders.length > 0;
    const focus = pending ? "" : (old.holidayLessons ?? 0) >= 40 ? "高消耗需求跟进" : paid && (old.holidayLessons ?? 0) <= 10 ? "充值低消耗排查" : "";
    if (pending) { if (!reasons.includes("使用数据待补齐")) reasons.push("使用数据待补齐"); }
    else if (paid) {
      if ((old.holidayLessons ?? 0) <= 10) reasons.push(`已充值：近7天${old.holidayLessons ? "低消耗" : "未使用"}`);
      if (!lessonsAfterPayment) reasons.push("付费未启用"); else if (!old.last14Lessons) reasons.push("付费后停用");
    } else if (old.postLaunchLessons >= 40) reasons.push("高使用未付费");
    if (theoreticalNet < 0) reasons.push("额度来源不完整");
    const score = Math.max(0, Math.min(100, old.score - (old.paid ? 10 : 0) + (paid ? 10 : 0) - (!old.paid && old.postLaunchLessons >= 200 ? 30 : !old.paid && old.postLaunchLessons >= 40 ? 25 : 0)));
    const forced = !pending && paid && (!lessonsAfterPayment || (old.holidayLessons ?? 0) <= 10 || !old.last14Lessons);
    return {...old, paid, paymentCount:orders.length, paymentTotal, paymentDate, purchasedAiCredits:purchased, bonusAiCredits:bonus, paidAiCredits:purchased+bonus, theoreticalNet, theoreticalLessons:Math.floor(theoreticalNet/50), lessonsAfterPayment, reasons, score,
      priority:pending ? "重点跟进" : forced || score >= 60 ? "立即关注" : focus || score >= 40 ? "重点跟进" : score >= 20 ? "持续观察" : "常规",
      holidayFollowup:focus,followupAction:pending ? "新付费客户：补齐EEOS逐日使用数据后评估启用与消耗，不把缺失数据当作零使用。" : focus === "充值低消耗排查" ? "确认近期排课、监测接入、额度到账及使用障碍。" : old.followupAction} satisfies Customer;
  });
  const paidCount = customers.filter(row => row.paid).length;
  const baselines = {...snapshot.baselines, customerCount:customers.length, paidCount, paidAmount:parsed.amountCents/100};
  const metricDefinitions = snapshot.metricDefinitions.map(metric => metric.code === "activated_customer_payment_rate" ? {...metric,numerator:customers.filter(c=>c.paid&&c.used).length,denominator:baselines.historicalUsedCount} : {...metric,numerator:customers.filter(c=>c.paid&&!c.usageDataPending&&c.lessonsAfterPayment>0).length,denominator:paidCount});
  return {...snapshot,customers,baselines,metricDefinitions,
    usageFocus:snapshot.usageFocus ? {...snapshot.usageFocus,paidLowUsageCount:customers.filter(c=>!c.usageDataPending&&c.paid&&(c.holidayLessons??0)<=10).length} : undefined,
    asOf:importedAt,sourceMetadata:{...snapshot.sourceMetadata,crm:{dataAsOf:importedAt,status:"success"}}};
}
