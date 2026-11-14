function parsedDate(value = '') {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return { year, month, day };
}

export function financeLocalDateValue(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const safe = Number.isFinite(date.getTime()) ? date : new Date();
  const shifted = new Date(safe.getTime() - safe.getTimezoneOffset() * 60000);
  return shifted.toISOString().slice(0, 10);
}

export function financeOccurredAtForDate(dateValue, reference = new Date()) {
  const day = parsedDate(dateValue);
  if (!day) return '';
  const source = reference instanceof Date ? reference : new Date(reference);
  const clock = Number.isFinite(source.getTime()) ? source : new Date();
  return new Date(
    day.year,
    day.month - 1,
    day.day,
    clock.getHours(),
    clock.getMinutes(),
    clock.getSeconds(),
    clock.getMilliseconds(),
  ).toISOString();
}

export function financeDateRange(from, to) {
  const startDay = parsedDate(from);
  const endDay = parsedDate(to);
  if (!startDay || !endDay) return null;
  const start = new Date(startDay.year, startDay.month - 1, startDay.day, 0, 0, 0, 0);
  const end = new Date(endDay.year, endDay.month - 1, endDay.day, 23, 59, 59, 999);
  if (start > end) return null;
  return { from: start.toISOString(), to: end.toISOString() };
}
