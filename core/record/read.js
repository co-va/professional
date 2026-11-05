import { hydrateRecordSettlement } from '../finance/index.js';
import { getRecordRow, getRecordRows, getRecordRowsForDay } from './data.js';
import { getRecordEvents } from './events.js';
import { projectRecordLifecycle } from './state.js';

function normalizeDate(value) {
  return String(value || '').slice(0, 10);
}

function normalizeId(value) {
  return String(value || '');
}

export function readRecord(row = null) {
  if (!row?.id) return null;
  const settled = hydrateRecordSettlement(row);
  return projectRecordLifecycle(settled, getRecordEvents(row.id));
}

export function getRecord(id) {
  return readRecord(getRecordRow(id));
}

export function getRecords() {
  return getRecordRows().map(readRecord).filter(Boolean);
}

export function getRecordsForDay(date, workplaceId = '') {
  const day = normalizeDate(date);
  const workplace = normalizeId(workplaceId);
  // Filter raw facts first, then project Finance/lifecycle only for this date.
  // The old getRecords() call projected the entire history on every Day read.
  return getRecordRowsForDay(day, workplace).map(readRecord).filter(Boolean);
}

export function getActiveRecordCountForDay(date, workplaceId = '') {
  return getRecordsForDay(date, workplaceId).filter((record) => record?.status !== 'cancelled').length;
}
