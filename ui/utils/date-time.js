function validDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = String(value ?? '').trim();
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function shortDate(value, fallback = '') {
  const text = String(value ?? '').trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}.${iso[2]}.${iso[1].slice(-2)}`;
  const date = validDate(value);
  if (!date) return fallback;
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getFullYear()).slice(-2)}`;
}

export function shortTime(value, fallback = '') {
  const text = String(value ?? '').trim();
  const clock = text.match(/^(\d{2}):(\d{2})/);
  if (clock) return `${clock[1]}:${clock[2]}`;
  const date = validDate(value);
  if (!date) return fallback;
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function shortDateTime(value, fallback = '') {
  const date = shortDate(value, '');
  const time = shortTime(value, '');
  return date ? [date, time].filter(Boolean).join(' ') : fallback;
}

export function shortDateTimeParts(value) {
  return { date: shortDate(value, ''), time: shortTime(value, '') };
}
