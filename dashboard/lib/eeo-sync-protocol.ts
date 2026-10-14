import { z } from 'zod';

// Only customer-level operational summaries cross the network. Strict schemas
// reject credentials, classroom/teacher/course objects and accidental raw responses.
const text = z.string().max(600);
const uid = z.string().regex(/^\d{1,20}$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const number = z.number().finite();
const count = number.int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const optionalFields = (names: string, schema: z.ZodTypeAny) => Object.fromEntries(names.split(' ').map(key => [key, schema.optional()]));
const customer = z.object({
  ...optionalFields('eeoAccountName eeoAccountNameStatus customerName consultant claimDate lastUsage paymentDate priority holidayFollowup followupAction', text),
  ...optionalFields('trial claim paid used usageDataPending', z.boolean()),
  ...optionalFields('paymentCount paymentTotal analyzedLessons postLaunchLessons last7Lessons last14Lessons maxRolling7Lessons lessonsAfterPayment score holidayLessons previousHolidayWeekLessons holidayActiveDays', count),
  ...optionalFields('declinePct theoreticalNet theoreticalLessons', number),
  ...optionalFields('holidayGrowthPct purchasedAiCredits bonusAiCredits paidAiCredits', number.nullable()),
  uid, customerName: text, consultant: text, paymentTotal: count, paymentCount: count,
  consultantJobNumber: z.string().regex(/^EEO\d{5,12}$/).nullable().optional(),
  analyzedLessons: count, postLaunchLessons: count,
  reasons: z.array(text).max(30),
}).strict();
const dailyFields = { date, lessons: count, low: count.nullable(), medium: count.nullable(), high: count.nullable(), reviewed: count.nullable(), falsePositive: count.nullable() };
export const dailySchema = z.array(z.object({ ...dailyFields, uid, risk: count.optional() }).strict()).max(365);
export const overviewSchema = z.object({
  version: text, asOf: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
  customers: z.array(customer).min(1).max(200),
  dailyAggregate: z.array(z.object({ ...dailyFields, risk: count }).strict()).max(365),
  customerDaily: z.array(z.never()).max(0), customerAliases: z.array(z.never()).max(0),
  consultants: z.array(text).max(200),
  baselines: z.object({
    ...optionalFields('trialCount claimCount historicalUsedCount postLaunchUsedCount paidCount riskLessons', count),
    ...optionalFields('lowRiskLessons mediumRiskLessons highRiskLessons reviewedLessons falsePositiveLessons', count.nullable()),
    customerCount: count, paidAmount: count, totalLessons: count, postLaunchLessons: count,
  }).strict(),
  metricDefinitions: z.array(z.object({ code: text, label: text, category: text, definition: text, formula: text, numerator: count, denominator: count, source: text }).strict()).max(20),
  sourceMetadata: z.object({
    eeo: z.object({
      dataAsOf: date, capturedAt: z.string().datetime(), dailyReconciled: z.literal(true),
      ...optionalFields('matchedCustomers filteredInstitutionCount', count),
      listScope: text.optional(), dailyRange: z.object({from: date, to: date}).strict().optional(),
      riskBreakdownComplete: z.boolean().optional(), dailyStatusAvailableThrough: date.optional(),
      dailyFields: z.array(text).max(10).optional(), missingDailyFields: z.array(text).max(10).optional(),
    }).strict(),
    crm: z.object({ dataAsOf: text, status: text.optional(), checkedAt: text.optional() }).strict(),
  }).strict(),
  usageFocus: z.object({
    holidayFrom: date, holidayTo: date, previousFrom: date, previousTo: date, completeTo: date,
    periodLabel: text.optional(), description: text,
    ...optionalFields('highUsageThreshold lowPaidThreshold holidayTotal previousTotal highUsageCount paidLowUsageCount holidayActiveCount', count),
  }).strict().optional(),
}).strict();
export const manifestSchema = z.array(z.object({key: z.string().regex(/^(overview|daily:\d{1,20})$/), hash: z.string().regex(/^[a-f0-9]{64}$/)}).strict()).min(2).max(201);
export async function sha256(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function validateOverview(value: unknown) {
  const result = overviewSchema.parse(value);
  const ids = result.customers.map(c => c.uid);
  if (new Set(ids).size !== ids.length || result.baselines.customerCount !== ids.length ||
      result.baselines.totalLessons !== result.customers.reduce((n,c) => n+c.analyzedLessons,0) ||
      result.baselines.postLaunchLessons !== result.customers.reduce((n,c) => n+c.postLaunchLessons,0) ||
      result.baselines.paidAmount !== result.customers.reduce((n,c) => n+c.paymentTotal,0)) throw new Error('汇总校验不一致');
  return result;
}
export function assertFresh(incoming: ReturnType<typeof validateOverview>, current: {asOf: string; sourceMetadata?: {crm?: {dataAsOf?: string}}; customers: Array<{uid:string;paymentTotal:number;paymentCount:number}>}) {
  if (incoming.asOf < current.asOf) throw new Error('线上EEO数据更新，拒绝旧批次');
  const oldCrm = current.sourceMetadata?.crm?.dataAsOf || '';
  if (incoming.sourceMetadata.crm.dataAsOf < oldCrm) throw new Error('线上CRM数据更新，拒绝旧订单覆盖');
  const fingerprint = (customers: Array<{uid:string;paymentTotal:number;paymentCount:number}>) => JSON.stringify(customers.map(c => [c.uid,c.paymentTotal,c.paymentCount]).sort((a,b) => String(a[0]).localeCompare(String(b[0]))));
  if (incoming.sourceMetadata.crm.dataAsOf === oldCrm && fingerprint(incoming.customers) !== fingerprint(current.customers)) throw new Error('同一CRM日期的订单不一致，请先核对来源');
}
