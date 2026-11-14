import { getDayTime, getDays, getDaysForDate } from './read.js';
import { getWorkplaces } from '../workplace-time.js';

const WORKPLACE_FALLBACK_COLOR = '#212529';

function dateValue(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  return String(value || '').slice(0, 10);
}

function workplaceMap(workplaces = []) {
  return new Map((Array.isArray(workplaces) ? workplaces : []).map((workplace) => [String(workplace?.key || ''), workplace]));
}

export function getActiveDayWorkplaces(date, workplaces = getWorkplaces()) {
  const key = dateValue(date);
  const catalog = workplaceMap(workplaces);
  return getDaysForDate(getDays(), key).map((day) => {
    const workplaceId = String(day?.workplaceId || '');
    const time = getDayTime(day, workplaces);
    if (!workplaceId || !time) return null;
    const workplace = catalog.get(workplaceId) || null;
    return {
      workplaceId,
      name: workplace?.name || 'Рабочее пространство',
      indicatorColor: workplace?.indicatorColor || workplace?.color || WORKPLACE_FALLBACK_COLOR,
      from: time.from,
      to: time.to,
    };
  }).filter(Boolean);
}

export function getAvailableDayWorkplaces(date, workplaces = getWorkplaces()) {
  const active = new Set(getActiveDayWorkplaces(date, workplaces).map((item) => item.workplaceId));
  return (Array.isArray(workplaces) ? workplaces : []).filter((workplace) => {
    const key = String(workplace?.key || '');
    return key && !active.has(key);
  });
}
