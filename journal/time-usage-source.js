import { getEventsForDay } from '../core/event/index.js';
import { getRecordsForDay } from '../core/record/index.js';
import { shiftTimeDateKey, timeToMinutes } from '../core/time/index.js';



function crossesMidnight(item = null) {
  const from = timeToMinutes(item?.from);
  const to = timeToMinutes(item?.to);
  return from != null && to != null && to < from;
}

export function getJournalTimeUsages({ date, workplaceId } = {}) {
  const day = String(date || '').slice(0, 10);
  const workplace = String(workplaceId || '');
  const previousDay = shiftTimeDateKey(day, -1);
  const records = [
    ...getRecordsForDay(day, workplace),
    ...(previousDay ? getRecordsForDay(previousDay, workplace).filter(crossesMidnight) : []),
  ].filter((record) => record?.status !== 'cancelled').map((record) => ({
    ...record, type: 'record', sourceId: String(record?.id || ''), from: String(record?.from || ''), to: String(record?.to || ''),
  }));
  const events = [
    ...getEventsForDay(day, workplace),
    ...(previousDay ? getEventsForDay(previousDay, workplace).filter(crossesMidnight) : []),
  ].map((item) => ({
    ...item, type: 'event', sourceId: String(item?.id || ''), from: String(item?.from || ''), to: String(item?.to || ''),
  }));
  return [...records, ...events];
}
