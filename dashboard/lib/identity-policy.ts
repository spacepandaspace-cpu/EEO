export const ADMIN_JOB_NUMBER = 'EEO04410';
// Missing or inconsistent employee mapping never grants business permissions.
export function validIdentity(user: { role: string; jobNumber?: string | null }) {
  if (!user.jobNumber || !/^EEO\d{5,12}$/.test(user.jobNumber)) return false;
  if (user.jobNumber === ADMIN_JOB_NUMBER) return user.role === 'admin';
  return user.role === 'consultant';
}
