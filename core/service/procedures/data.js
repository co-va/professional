import { queueOperationalDataset } from '../../../core/business-persistence.js';

let proceduresState = [];
let historyState = [];

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function readRawProcedures() {
  return clone(proceduresState);
}

function readHistory() {
  return clone(historyState);
}

function writeProcedures(value) {
  proceduresState = Array.isArray(value) ? clone(value) : [];
  void queueOperationalDataset('procedures', proceduresState);
}

function writeHistory(value) {
  historyState = Array.isArray(value) ? clone(value) : [];
  void queueOperationalDataset('procedureHistory', historyState);
}

export function hydrateProceduresFromServer({ procedures = [], procedureHistory = [] } = {}) {
  proceduresState = Array.isArray(procedures) ? clone(procedures) : [];
  historyState = Array.isArray(procedureHistory) ? clone(procedureHistory) : [];
  return { procedures: clone(proceduresState), procedureHistory: clone(historyState) };
}

export function getProcedures() {
  return readRawProcedures().filter((item) => !item.deletedAt);
}

export function saveProcedure(item) {
  const values = readRawProcedures();
  const exists = values.some((value) => value.id === item.id);
  writeProcedures(exists ? values.map((value) => value.id === item.id ? item : value) : [...values, item]);
  return item;
}

export function pushProcedureHistory(record, action) {
  const history = readHistory();
  history.push({ ...record, historyAction: action, historyAt: new Date().toISOString() });
  writeHistory(history);
}

export function deleteProcedure(id) {
  const values = readRawProcedures();
  const found = values.find((item) => item.id === id && !item.deletedAt);
  if (!found) return false;
  pushProcedureHistory(found, 'deleted');
  writeProcedures(values.map((item) => item.id === id ? { ...item, deletedAt: new Date().toISOString() } : item));
  return true;
}


export function reorderProcedures(ids = []) {
  const order = (Array.isArray(ids) ? ids : []).map((value) => String(value || '')).filter(Boolean);
  const values = readRawProcedures();
  const active = values.filter((item) => !item.deletedAt);
  if (order.length !== active.length || new Set(order).size !== active.length) return false;
  const byId = new Map(active.map((item) => [String(item.id || ''), item]));
  if (order.some((id) => !byId.has(id))) return false;
  const deleted = values.filter((item) => item.deletedAt);
  writeProcedures([...order.map((id) => byId.get(id)), ...deleted]);
  return true;
}
