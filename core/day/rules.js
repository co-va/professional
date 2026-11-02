// Pure WorkPlan Day rules.
// No persistence, UI, Record/Break ownership or side effects belong here.
import { createTimeRange, isValidRange, minutesBetween, minutesToTime, rangesOverlap, timeToMinutes } from '../time/index.js';

export function dayDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  return String(value || '').slice(0, 10);
}

export function dayIdentity(day) {
  return `${String(day?.workplaceId || '')}::${dayDate(day?.date)}`;
}

export function createDayValue({ date, workplaceId, from, to } = {}) {
  if (!date || !workplaceId || !isValidRange(from, to)) return null;
  const range = createTimeRange(from, to);
  return { date: dayDate(date), workplaceId: String(workplaceId), from: range.from, to: range.to };
}

export function resolveDayTime(day, workplaces = []) {
  if (!day) return null;
  if (day.from && day.to && isValidRange(day.from, day.to)) return createTimeRange(day.from, day.to);
  const workplace = (Array.isArray(workplaces) ? workplaces : []).find((item) => String(item?.key || '') === String(day.workplaceId || ''));
  if (!workplace?.from || !workplace?.to || !isValidRange(workplace.from, workplace.to)) return null;
  return createTimeRange(workplace.from, workplace.to);
}

export function getScheduleConflictsForDays(days, { workplaceId, date, from, to, excludeWorkplaceId = '', excludeDate = '' } = {}) {
  if (!isValidRange(from, to)) return [];
  const key = dayDate(date);
  return (Array.isArray(days) ? days : []).filter((day) => dayDate(day?.date) === key).filter((day) => {
    if (String(day?.workplaceId || '') === String(workplaceId || '')) return false;
    if (excludeWorkplaceId && String(day?.workplaceId || '') === String(excludeWorkplaceId) && dayDate(day?.date) === dayDate(excludeDate || date)) return false;
    return day?.from && day?.to && rangesOverlap(from, to, day.from, day.to);
  });
}

export function hasScheduleConflictForDays(days, options = {}) {
  return getScheduleConflictsForDays(days, options).length > 0;
}

export function getDayDraftScheduleConflicts(entries = []) {
  const values = (Array.isArray(entries) ? entries : []).map((entry, index) => ({ ...entry, index }));
  const conflicts = [];
  for (let left = 0; left < values.length; left += 1) {
    const a = values[left];
    if (!isValidRange(a?.from, a?.to)) continue;
    for (let right = left + 1; right < values.length; right += 1) {
      const b = values[right];
      if (!isValidRange(b?.from, b?.to) || !rangesOverlap(a.from, a.to, b.from, b.to)) continue;
      conflicts.push({
        leftIndex: a.index,
        rightIndex: b.index,
        from: a.from > b.from ? a.from : b.from,
        to: a.to < b.to ? a.to : b.to,
      });
    }
  }
  return conflicts;
}

export function findSuggestedDayInterval(days, { workplaceId, date, baseFrom, baseTo } = {}) {
  if (!isValidRange(baseFrom, baseTo)) return null;
  const baseStart = timeToMinutes(baseFrom);
  const baseEnd = timeToMinutes(baseTo);
  const duration = baseEnd - baseStart;
  if (!hasScheduleConflictForDays(days, { workplaceId, date, from: baseFrom, to: baseTo })) return createTimeRange(baseFrom, baseTo);

  const occupied = (Array.isArray(days) ? days : [])
    .filter((day) => dayDate(day?.date) === dayDate(date))
    .filter((day) => String(day?.workplaceId || '') !== String(workplaceId || '') && day?.from && day?.to)
    .map((day) => ({ from: timeToMinutes(day.from), to: timeToMinutes(day.to) }))
    .filter((item) => item.from != null && item.to != null && item.to > item.from)
    .sort((a, b) => a.from - b.from);

  let cursor = baseStart;
  for (const item of occupied) {
    const candidateEnd = cursor + duration;
    if (candidateEnd <= item.from && candidateEnd <= baseEnd) return createTimeRange(minutesToTime(cursor), minutesToTime(candidateEnd));
    cursor = Math.max(cursor, item.to);
    if (cursor + duration > baseEnd) break;
  }
  if (cursor + duration <= baseEnd) return createTimeRange(minutesToTime(cursor), minutesToTime(cursor + duration));
  return null;
}

export function totalDayMinutes(days = [], workplaces = []) {
  return (Array.isArray(days) ? days : []).reduce((total, day) => {
    const time = resolveDayTime(day, workplaces);
    return total + (time ? minutesBetween(time.from, time.to) : 0);
  }, 0);
}
