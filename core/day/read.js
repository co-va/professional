// Read model for WorkPlan Day facts.
// Reads persisted rows and exposes neutral queries. No mutation belongs here.
import { getDayRows } from './data.js';
import { dayDate, resolveDayTime } from './rules.js';

export function getDays() {
  return getDayRows();
}

export function getDay(days, workplaceId, date) {
  const key = dayDate(date);
  return (Array.isArray(days) ? days : []).find((item) => String(item?.workplaceId || '') === String(workplaceId || '') && dayDate(item?.date) === key) || null;
}

export function getDaysForDate(days, date) {
  const key = dayDate(date);
  return (Array.isArray(days) ? days : []).filter((item) => dayDate(item?.date) === key);
}

export function getDayTime(day, workplaces = []) {
  return resolveDayTime(day, workplaces);
}
