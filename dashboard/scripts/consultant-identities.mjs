import fs from 'node:fs';
import path from 'node:path';

// Private mapping stays beside collector data, never in the compiled application.
export function applyConsultantIdentities(snapshot) {
  const file = path.resolve(import.meta.dirname, '../../data/consultant-identities.json');
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  const names = new Map();
  const jobs = new Set();
  for (const row of rows) {
    if (!row.consultantName || !/^EEO\d{5,12}$/.test(row.jobNumber) || names.has(row.consultantName) || jobs.has(row.jobNumber)) {
      throw new Error('顾问身份映射缺失、重复或工号无效');
    }
    names.set(row.consultantName, row.jobNumber);
    jobs.add(row.jobNumber);
  }
  for (const customer of snapshot.customers) {
    // Existing identity survives a display-name change. Transfers must explicitly change the job number.
    if (customer.consultantJobNumber != null && !/^EEO\d{5,12}$/.test(customer.consultantJobNumber)) throw new Error('客户顾问工号无效');
    customer.consultantJobNumber ??= names.get(customer.consultant) ?? null;
  }
  return snapshot;
}
