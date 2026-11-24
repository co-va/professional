import { getTimeGridRangeState } from './grid.js';
import { minutesToTime, timeToMinutes } from './math.js';

function naturalCandidateMinutes(grid) {
  const start = timeToMinutes(grid?.plan?.from);
  const end = timeToMinutes(grid?.plan?.to);
  if (start == null || end == null || end <= start) return [];

  const values = new Set();
  for (let minute = Math.ceil(start / 60) * 60; minute < end; minute += 60) values.add(minute);

  (Array.isArray(grid?.usages) ? grid.usages : []).forEach((usage) => {
    const usageEnd = timeToMinutes(usage?.to);
    if (usageEnd != null && usageEnd > start && usageEnd < end) values.add(usageEnd);
  });

  return [...values].sort((left, right) => left - right);
}

export function buildNaturalBookingTimeRows(grid, duration, { notBefore = '', excludeId = '' } = {}) {
  const minutes = Math.max(0, Number(duration) || 0);
  const minimum = timeToMinutes(notBefore);
  if (minutes <= 0) return [];

  return naturalCandidateMinutes(grid)
    .filter((minute) => minimum == null || minute >= minimum)
    .map((minute) => {
      const from = minutesToTime(minute);
      const to = minutesToTime(minute + minutes);
      const availability = from && to
        ? getTimeGridRangeState(grid, { from, to, excludeId })
        : { ok: false, reason: 'outside-working-time' };
      return {
        from: from || '',
        to: to || '',
        value: from || '',
        label: from || '',
        available: Boolean(availability.ok),
        occupied: availability.reason === 'occupied',
        disabled: !availability.ok,
        state: availability.ok ? 'free' : availability.reason === 'occupied' ? 'occupied' : 'unavailable',
        emphasized: true,
      };
    })
    .filter((row) => row.value);
}
