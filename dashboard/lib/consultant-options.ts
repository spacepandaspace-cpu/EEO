import type { Customer } from '../app/dashboard-types';

export function consultantOptions(customers: Customer[]) {
  const options = new Map<string, string>();
  for (const customer of customers) {
    const job = customer.consultantJobNumber;
    if (job) options.set(job, `${customer.consultant} · ${job}`);
    else options.set('unassigned', '工号待确认');
  }
  return [...options].map(([value, label]) => ({ value, label }));
}
