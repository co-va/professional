// Technical helpers for clock-time intervals.
// Time math owns no business entities and stores no application state.

export function normalizeTime(value, fallback = '00:00') {
  const match = String(value ?? '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return fallback;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

// Central calendar-day arithmetic for the Time domain.
export function shiftTimeDateKey(value, days = 0) {
  const match = String(value || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match || !Number.isInteger(days)) return '';
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
  date.setUTCDate(date.getUTCDate() + days);
  return date.getUTCFullYear() + '-' + String(date.getUTCMonth() + 1).padStart(2, '0')
    + '-' + String(date.getUTCDate()).padStart(2, '0');
}

export function timeToMinutes(value) {
  const normalized = normalizeTime(value, '');
  if (!normalized) return null;
  const [hours, minutes] = normalized.split(':').map(Number);
  return hours * 60 + minutes;
}

export function minutesToTime(value) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 24 * 60) return null;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function createTimeRange(from = '00:00', to = '00:00') {
  return Object.freeze({ from: normalizeTime(from), to: normalizeTime(to) });
}

export function minutesBetween(from, to) {
  const start = timeToMinutes(from);
  const end = timeToMinutes(to);
  if (start == null || end == null) return 0;
  return Math.max(0, end - start);
}

export function isValidRange(from, to) {
  const start = timeToMinutes(from);
  const end = timeToMinutes(to);
  return start != null && end != null && end > start;
}

export function containsRange(containerFrom, containerTo, from, to) {
  const containerStart = timeToMinutes(containerFrom);
  const containerEnd = timeToMinutes(containerTo);
  const start = timeToMinutes(from);
  const end = timeToMinutes(to);
  return [containerStart, containerEnd, start, end].every((value) => value != null)
    && containerStart <= start && end <= containerEnd && start < end;
}

export function rangesOverlap(fromA, toA, fromB, toB) {
  const a = timeToMinutes(fromA);
  const b = timeToMinutes(toA);
  const c = timeToMinutes(fromB);
  const d = timeToMinutes(toB);
  if ([a, b, c, d].some((value) => value == null) || b <= a || d <= c) return false;
  return a < d && c < b;
}

export function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function timeMinutes(value = '') {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function recordDurationHours(record = null) {
  const from = timeMinutes(record?.from);
  const to = timeMinutes(record?.to);
  if (from == null || to == null || to <= from) return 0;
  return (to - from) / 60;
}
