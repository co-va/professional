import { createTimeRange, isValidRange, minutesBetween } from './time/index.js';
import { getDay, getDayTime, getDays, getDaysForDate, hasScheduleConflict } from './day/index.js';

const WORKPLACE_FALLBACK_COLOR = '#212529';
let workplaceSource = () => [];

export function configureWorkplaceSource(source) {
  workplaceSource = typeof source === 'function' ? source : () => [];
}

export function getWorkplaces() {
  const values = workplaceSource();
  return Array.isArray(values) ? values : [];
}

export function getWorkplace(workplaces, workplaceId) {
  return (Array.isArray(workplaces) ? workplaces : []).find((workplace) => String(workplace?.key || '') === String(workplaceId || '')) || null;
}

export function getWorkingDays() {
  return getDays();
}

export function getWorkplaceWorkingDates(workplaceId) {
  const id = String(workplaceId || '');
  return getDays()
    .filter((day) => String(day?.workplaceId || '') === id && day?.date)
    .map((day) => String(day.date))
    .sort();
}

export function getWorkingDay(workingDays, workplaceId, date) {
  return getDay(workingDays, workplaceId, date);
}

function monthPrefix(month) {
  return `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}-`;
}

function monthDays(workingDays, month) {
  const prefix = monthPrefix(month);
  return (Array.isArray(workingDays) ? workingDays : []).filter((item) => String(item?.date || '').startsWith(prefix));
}

function statsForDays(days, workplaces) {
  const dates = new Set();
  let totalMinutes = 0;
  for (const day of Array.isArray(days) ? days : []) {
    if (day?.date) dates.add(String(day.date));
    const time = getDayTime(day, workplaces);
    if (time) totalMinutes += minutesBetween(time.from, time.to);
  }
  return {
    days: dates.size,
    hours: Math.floor(totalMinutes / 60),
    minutes: totalMinutes % 60,
    totalMinutes,
  };
}

export function getWorkingDates(workingDays, workplaceId, month) {
  return monthDays(workingDays, month)
    .filter((item) => String(item?.workplaceId || '') === String(workplaceId || ''))
    .map((item) => item.date)
    .filter(Boolean);
}

export function getAllWorkingDates(workingDays, month) {
  return [...new Set(monthDays(workingDays, month).map((item) => String(item?.date || '')).filter(Boolean))];
}

export function getWorkplaceMonthStats(workingDays, workplaces, workplaceId, month) {
  return statsForDays(monthDays(workingDays, month).filter((item) => String(item?.workplaceId || '') === String(workplaceId || '')), workplaces);
}

export function getAllWorkplacesMonthStats(workingDays, workplaces, month) {
  return statsForDays(monthDays(workingDays, month), workplaces);
}

export function getWorkplaceMonthStatsMap(workingDays, workplaces, month) {
  return Object.fromEntries((Array.isArray(workplaces) ? workplaces : []).map((workplace) => [
    String(workplace?.key || ''),
    getWorkplaceMonthStats(workingDays, workplaces, workplace?.key, month),
  ]).filter(([key]) => key));
}

export function getWorkingDayIndicators(workingDays, workplaces, date, { excludeWorkplaceId = '' } = {}) {
  const catalog = new Map((Array.isArray(workplaces) ? workplaces : []).map((workplace) => [String(workplace?.key || ''), workplace]));
  const seen = new Set();
  const result = [];
  for (const day of getDaysForDate(workingDays, date)) {
    const workplaceId = String(day?.workplaceId || '');
    if (!workplaceId || workplaceId === String(excludeWorkplaceId || '') || seen.has(workplaceId)) continue;
    seen.add(workplaceId);
    const workplace = catalog.get(workplaceId);
    const color = String(workplace?.indicatorColor || workplace?.color || WORKPLACE_FALLBACK_COLOR).trim() || WORKPLACE_FALLBACK_COLOR;
    result.push({ color, label: workplace?.name || 'Рабочее место', workplaceId });
  }
  return result;
}

export function getWorkingDayTotalMinutes(workingDays, workplaces, date) {
  return getDaysForDate(workingDays, date).reduce((total, day) => {
    const time = getDayTime(day, workplaces);
    return total + (time ? minutesBetween(time.from, time.to) : 0);
  }, 0);
}

export function resolveWorkplaceTime(workplaces, workplaceId) {
  const workplace = getWorkplace(workplaces, workplaceId);
  if (!workplace?.from || !workplace?.to || !isValidRange(workplace.from, workplace.to)) return null;
  return createTimeRange(workplace.from, workplace.to);
}

export function resolveWorkingDayTime(workplaces, workingDay) {
  if (!workingDay?.workplaceId || !workingDay?.date) return null;
  return getDayTime(workingDay, workplaces);
}

export function canScheduleWork(days, { workplaceId, date, from, to, excludeWorkplaceId = '', excludeDate = '' } = {}) {
  return !hasScheduleConflict(days, { workplaceId, date, from, to, excludeWorkplaceId, excludeDate });
}

export function getOtherWorkDays(days, date, workplaceId) {
  return getDaysForDate(days, date).filter((day) => String(day?.workplaceId || '') !== String(workplaceId || ''));
}
