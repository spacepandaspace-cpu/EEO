import { ADMIN_JOB_NUMBER, validIdentity } from './identity-policy';
// Names are presentation data. Missing employee identity never grants access.
export function canAccessCustomer(
  user: { role: string; jobNumber?: string | null },
  customer: { consultantJobNumber?: string | null },
) {
  if (!validIdentity(user)) return false;
  if (user.role === 'admin') return user.jobNumber === ADMIN_JOB_NUMBER;
  return user.role === 'consultant' &&
    typeof user.jobNumber === 'string' && /^EEO\d{5,12}$/.test(user.jobNumber) &&
    customer.consultantJobNumber === user.jobNumber;
}
