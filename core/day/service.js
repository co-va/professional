// Commands for WorkPlan Day facts.
// Orchestrates persistence + occupancy contracts. Does not own UI or TimeGrid.
import { replaceDayRows } from './data.js';
import { getDay, getDays } from './read.js';
import { createDayValue, dayDate, dayIdentity } from './rules.js';
import { createTimeRange, getWorkingTimeUsageConflicts, isValidRange, releaseWorkingTimeSoftUsages } from '../time/index.js';

export function getDayRemovalConflicts(workplaceId, date) {
  const key = dayDate(date);
  const targetId = String(workplaceId || '');
  if (!key || !targetId) return [];
  return getWorkingTimeUsageConflicts({ operation: 'remove', date: key, workplaceId: targetId });
}

export function saveDays(days) {
  const requested = Array.isArray(days) ? days.map((day) => ({ ...day })) : [];
  const current = getDays();
  const requestedIds = new Set(requested.map(dayIdentity));
  const blocked = current
    .filter((day) => !requestedIds.has(dayIdentity(day)))
    .map((day) => ({ day, conflicts: getDayRemovalConflicts(day?.workplaceId, day?.date) }))
    .filter((entry) => entry.conflicts.length > 0);

  const next = [...requested];
  for (const entry of blocked) {
    if (!next.some((day) => dayIdentity(day) === dayIdentity(entry.day))) next.push({ ...entry.day });
  }

  if (Array.isArray(days) && blocked.length) days.splice(0, days.length, ...next.map((day) => ({ ...day })));
  const nextIds = new Set(next.map(dayIdentity));
  const removed = current.filter((day) => !nextIds.has(dayIdentity(day)));
  replaceDayRows(next);
  removed.forEach((day) => releaseWorkingTimeSoftUsages({
    operation: 'remove',
    date: dayDate(day?.date),
    workplaceId: String(day?.workplaceId || ''),
  }));

  return blocked.length
    ? { ok: false, reason: 'usage-conflict', blocked }
    : { ok: true, reason: '', blocked: [] };
}

export function createDay(options = {}) {
  return createDayValue(options);
}

export function updateDayTime(days, workplaceId, date, from, to) {
  const list = Array.isArray(days) ? days : [];
  const day = getDay(list, workplaceId, date);
  if (!day || !isValidRange(from, to)) return null;
  const range = createTimeRange(from, to);
  day.from = range.from;
  day.to = range.to;
  return day;
}

export function removeDay(days, workplaceId, date) {
  if (!Array.isArray(days) || getDayRemovalConflicts(workplaceId, date).length) return false;
  const key = dayDate(date);
  const before = days.length;
  for (let index = days.length - 1; index >= 0; index -= 1) {
    if (String(days[index]?.workplaceId || '') === String(workplaceId || '') && dayDate(days[index]?.date) === key) days.splice(index, 1);
  }
  return days.length !== before;
}
