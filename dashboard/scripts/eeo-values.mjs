// Missing aggregate fields are unknown, never zero. Accept only numeric values.
export function safeNumber(value) {
  if (value === null || value === undefined || typeof value === 'boolean'
    || (typeof value !== 'number' && typeof value !== 'string')
    || (typeof value === 'string' && value.trim() === '')) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

// EEOS' own count chart uses Number(row[valueKey] || 0): zero count
// properties are omitted in otherwise valid overview / dated trend objects.
// Apply this only to documented sparse count fields, never status metrics
// that the daily endpoint does not support (reviewed, grades, false positives).
export function sparseCount(source, keys) {
  for (const key of keys) {
    if (Object.hasOwn(source, key)) return safeNumber(source[key]);
  }
  return 0;
}
