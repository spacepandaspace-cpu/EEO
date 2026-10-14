import 'server-only';
import { env } from '@/lib/node-runtime';
import source from '@/app/data/snapshot.json';
import type { DashboardSnapshot, CustomerDaily } from '@/app/dashboard-types';
export async function liveSnapshot(): Promise<DashboardSnapshot> {
  const row = await env.DB.prepare("SELECT json FROM eeo_snapshot WHERE key='overview'").first<{json:string}>();
  if (!row) return source as DashboardSnapshot;
  if (row.json.length > 250_000) throw new Error('本地数据超过内存预算，请检查更新批次');
  const snapshot=JSON.parse(row.json) as DashboardSnapshot;
  snapshot.customers=snapshot.customers.map(customer=>customer.reasons.includes('使用数据待补齐')?{...customer,usageDataPending:true}:customer);
  return snapshot;
}
export async function liveCustomerDaily(uid: string): Promise<CustomerDaily[]> {
  const row = await env.DB.prepare('SELECT json FROM eeo_snapshot WHERE key=?').bind(`daily:${uid}`).first<{json:string}>();
  if (!row) return (source as DashboardSnapshot).customerDaily.filter(row => row.uid === uid).slice(-365);
  if (row.json.length > 100_000) throw new Error('客户明细超过内存预算');
  return JSON.parse(row.json) as CustomerDaily[];
}
