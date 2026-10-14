import "server-only";
import type { Customer, CustomerDaily, DashboardSnapshot, DailyAggregate } from "@/app/dashboard-types";
import { getAuthenticatedUser } from "@/lib/local-auth";
import { liveSnapshot, liveCustomerDaily } from "@/lib/live-snapshot";
import { canAccessCustomer } from "@/lib/customer-access";


function aggregateDaily(rows: CustomerDaily[]): DailyAggregate[] {
  const dates = new Map<string, DailyAggregate>();
  for (const row of rows) {
    const current = dates.get(row.date) ?? { date: row.date, lessons: 0, risk: 0, low: 0, medium: 0, high: 0, reviewed: 0, falsePositive: 0 };
    current.lessons += row.lessons;
    current.low = current.low === null || row.low === null ? null : current.low + row.low;
    current.medium = current.medium === null || row.medium === null ? null : current.medium + row.medium;
    current.high = current.high === null || row.high === null ? null : current.high + row.high;
    current.risk += row.risk ?? (row.low ?? 0) + (row.medium ?? 0) + (row.high ?? 0);
    current.reviewed = current.reviewed === null || row.reviewed === null ? null : current.reviewed + row.reviewed;
    current.falsePositive = current.falsePositive === null || row.falsePositive === null ? null : current.falsePositive + row.falsePositive;
    dates.set(row.date, current);
  }
  return [...dates.values()].sort((left, right) => left.date.localeCompare(right.date));
}

function baselines(customers: Customer[], rows: CustomerDaily[]) {
  const totals = aggregateDaily(rows).reduce((sum, row) => ({
    lessons: sum.lessons + row.lessons,
    risk: sum.risk + row.risk,
    low: sum.low + (row.low ?? 0),
    medium: sum.medium + (row.medium ?? 0),
    high: sum.high + (row.high ?? 0),
    reviewed: sum.reviewed + (row.reviewed ?? 0),
    falsePositive: sum.falsePositive + (row.falsePositive ?? 0),
  }), { lessons: 0, risk: 0, low: 0, medium: 0, high: 0, reviewed: 0, falsePositive: 0 });
  return {
    customerCount: customers.length,
    trialCount: customers.filter((row) => row.trial).length,
    claimCount: customers.filter((row) => row.claim).length,
    historicalUsedCount: customers.filter((row) => row.used).length,
    postLaunchUsedCount: customers.filter((row) => row.postLaunchLessons > 0).length,
    paidCount: customers.filter((row) => row.paid).length,
    paidAmount: customers.reduce((sum, row) => sum + row.paymentTotal, 0),
    totalLessons: customers.reduce((sum, row) => sum + row.analyzedLessons, 0),
    postLaunchLessons: customers.reduce((sum, row) => sum + row.postLaunchLessons, 0),
    riskLessons: totals.risk,
    lowRiskLessons: rows.some(row => row.low === null) ? null : totals.low,
    mediumRiskLessons: rows.some(row => row.medium === null) ? null : totals.medium,
    highRiskLessons: rows.some(row => row.high === null) ? null : totals.high,
    reviewedLessons: rows.some(row => row.reviewed === null) ? null : totals.reviewed,
    falsePositiveLessons: rows.some(row => row.falsePositive === null) ? null : totals.falsePositive,
  };
}

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  const snapshot = await liveSnapshot();
  const uid = new URL(request.url).searchParams.get("uid");
  if (uid) {
    const customer = snapshot.customers.find((row) => row.uid === uid);
    if (!customer || !canAccessCustomer(user, customer)) return Response.json({ error: "无权查看该客户" }, { status: 403 });
    return Response.json({ customerDaily: await liveCustomerDaily(uid) }, { headers: { "Cache-Control": "no-store, private" } });
  }
  if (user.role === "admin") return Response.json({
    version: snapshot.version, asOf: snapshot.asOf, customers: snapshot.customers,
    dailyAggregate: snapshot.dailyAggregate.slice(-365), customerDaily: [],
    consultants: snapshot.consultants, baselines: snapshot.baselines,
    metricDefinitions: snapshot.metricDefinitions, customerAliases: [],
    usageFocus: snapshot.usageFocus,
  }, { headers: { "Cache-Control": "no-store, private" } });

  const customers = snapshot.customers.filter((row) => canAccessCustomer(user, row));
  const customerDaily: CustomerDaily[] = [];
  for (const customer of customers) customerDaily.push(...await liveCustomerDaily(customer.uid));
  const filtered: DashboardSnapshot = {
    version: snapshot.version,
    asOf: snapshot.asOf,
    customers,
    customerDaily: [],
    dailyAggregate: aggregateDaily(customerDaily),
    consultants: user.consultantName ? [user.consultantName] : [],
    metricDefinitions: snapshot.metricDefinitions,
    customerAliases: [],
    baselines: baselines(customers, customerDaily),
    usageFocus: snapshot.usageFocus ? {
      ...snapshot.usageFocus,
      holidayTotal: customers.reduce((sum,c) => sum + (c.holidayLessons ?? 0), 0),
      previousTotal: customers.reduce((sum,c) => sum + (c.previousHolidayWeekLessons ?? 0), 0),
      holidayActiveCount: customers.filter(c => (c.holidayLessons ?? 0) > 0).length,
      highUsageCount: customers.filter(c => (c.holidayLessons ?? 0) >= snapshot.usageFocus!.highUsageThreshold).length,
      paidLowUsageCount: customers.filter(c => c.paid && (c.holidayLessons ?? 0) <= snapshot.usageFocus!.lowPaidThreshold).length,
    } : undefined,
  };
  return Response.json(filtered, { headers: { "Cache-Control": "no-store, private" } });
}
