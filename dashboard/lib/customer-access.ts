// Names are presentation data. Missing employee identity never grants access.
export function canAccessCustomer(
  user: { role: string; jobNumber?: string | null },
  customer: { consultantJobNumber?: string | null },
) {
  if (user.role === 'admin') return true;
  return user.role === 'consultant' &&
    typeof user.jobNumber === 'string' && /^EEO\d{5,12}$/.test(user.jobNumber) &&
    customer.consultantJobNumber === user.jobNumber;
}
