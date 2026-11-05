// Persistence gateway for Record facts.
// Runtime reads are synchronous from an in-memory cache hydrated from the server.
import {
  queueRecordDelete,
  queueRecordEventUpsert,
  queueRecordEventsDelete,
  queueRecordUpsert,
} from '../business-persistence.js';

let recordRowsState = [];
let eventRowsState = [];

function clone(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function normalizeId(value) {
  return String(value || '');
}

export function hydrateRecordStateFromServer({ records = [], recordEvents = [] } = {}) {
  recordRowsState = (Array.isArray(records) ? records : []).map((row) => clone(row));
  eventRowsState = (Array.isArray(recordEvents) ? recordEvents : []).map((row) => clone(row));
  return { records: clone(recordRowsState), recordEvents: clone(eventRowsState) };
}

export function getRecordRows() {
  return clone(recordRowsState);
}

/**
 * Read only a specific day's raw Record facts before cloning them.
 * Date/workplace filtering belongs to the storage gateway; Finance and
 * lifecycle projections are applied by the existing Record read contract.
 */
export function getRecordRowsForDay(date, workplaceId = '') {
  const day = String(date || '').slice(0, 10);
  const workplace = normalizeId(workplaceId);
  return recordRowsState
    .filter((row) => row?.date === day
      && (!workplace || normalizeId(row?.workplaceId) === workplace))
    .map((row) => clone(row));
}

/** Inclusive ISO day range; an empty bound is unbounded. Clone only matches. */
export function getRecordRowsInRange({ from = '', to = '', workplaceId = '' } = {}) {
  const start = String(from || '').slice(0, 10);
  const end = String(to || '').slice(0, 10);
  const workplace = normalizeId(workplaceId);
  return recordRowsState.filter((row) => {
    const date = String(row?.date || '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(date)
      && (!start || date >= start)
      && (!end || date <= end)
      && (!workplace || normalizeId(row?.workplaceId) === workplace);
  }).map((row) => clone(row));
}

export function getRecordRow(id) {
  const recordId = normalizeId(id);
  const row = recordRowsState.find((item) => normalizeId(item?.id) === recordId) || null;
  return clone(row);
}

export function insertRecordRow(row = null) {
  if (!row?.id || getRecordRow(row.id)) return null;
  const stored = clone(row);
  recordRowsState.push(stored);
  void queueRecordUpsert(stored, recordRowsState.length - 1);
  return clone(stored);
}

export function patchRecordRow(id, patch = {}) {
  const recordId = normalizeId(id);
  const index = recordRowsState.findIndex((item) => normalizeId(item?.id) === recordId);
  if (index < 0) return null;
  recordRowsState[index] = { ...recordRowsState[index], ...clone(patch) };
  void queueRecordUpsert(recordRowsState[index], index);
  return clone(recordRowsState[index]);
}

export function deleteRecordRow(id) {
  const recordId = normalizeId(id);
  const index = recordRowsState.findIndex((item) => normalizeId(item?.id) === recordId);
  if (index < 0) return null;
  const [removed] = recordRowsState.splice(index, 1);
  void queueRecordDelete(recordId);
  return clone(removed);
}

export function getRecordEventRows(recordId = '') {
  const id = normalizeId(recordId);
  return eventRowsState
    .filter((row) => !id || normalizeId(row?.recordId) === id)
    .map((row) => clone(row));
}

export function insertRecordEventRow(row = null) {
  if (!row?.id || !row?.recordId) return null;
  if (eventRowsState.some((item) => normalizeId(item?.id) === normalizeId(row.id))) return null;
  const stored = clone(row);
  eventRowsState.push(stored);
  void queueRecordEventUpsert(stored, eventRowsState.length - 1);
  return clone(stored);
}

export function deleteRecordEventRows(recordId) {
  const id = normalizeId(recordId);
  if (!id) return 0;
  const next = eventRowsState.filter((row) => normalizeId(row?.recordId) !== id);
  const removed = eventRowsState.length - next.length;
  if (removed) {
    eventRowsState = next;
    void queueRecordEventsDelete(id);
  }
  return removed;
}
