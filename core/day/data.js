// WorkPlan Day persistence gateway.
// Storage only: no schedule rules, time calculations, occupancy or UI decisions.
import { queueOperationalDataset } from '../business-persistence.js';

let dayRowsState = [];

function clone(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

export function hydrateDaysFromServer(rows = []) {
  dayRowsState = (Array.isArray(rows) ? rows : []).map((row) => clone(row));
  return dayRowsState.map((row) => clone(row));
}

export function getDayRows() {
  return dayRowsState.map((row) => clone(row));
}

export function replaceDayRows(rows = []) {
  dayRowsState = (Array.isArray(rows) ? rows : []).map((row) => clone(row));
  void queueOperationalDataset('days', dayRowsState);
  return dayRowsState.map((row) => clone(row));
}
