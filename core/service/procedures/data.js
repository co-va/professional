import { queueOperationalDataset } from '../../../core/business-persistence.js';

let proceduresState = [];
let proceduresSnapshotReady = false;

// Readiness belongs to the existing procedures data owner, not to Record or Journal.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('professional:auth-logout', () => {
    proceduresState = [];
    proceduresSnapshotReady = false;
  });
}

export function hasCurrentProceduresSnapshot() {
  return proceduresSnapshotReady;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function readRawProcedures() {
  return clone(proceduresState);
}

function writeProcedures(value) {
  proceduresState = Array.isArray(value) ? clone(value) : [];
  proceduresSnapshotReady = true;
  void queueOperationalDataset('procedures', proceduresState);
}

export function hydrateCurrentProceduresFromServer(procedures = []) {
  proceduresState = Array.isArray(procedures) ? clone(procedures) : [];
  proceduresSnapshotReady = true;
  return clone(proceduresState);
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

export function deleteProcedure(id) {
  const values = readRawProcedures();
  const found = values.find((item) => item.id === id && !item.deletedAt);
  if (!found) return false;
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

// Reset all local overrides in one domain-owned write when a shared card
// template is applied. No per-entity queue/serialization storm.
export function resetProcedureCardAppearances() {
  const values = readRawProcedures();
  let changed = 0;
  const updated = values.map((item) => {
    if (item.deletedAt || !item.cardAppearance || !Object.keys(item.cardAppearance).length) return item;
    changed += 1;
    return { ...item, cardAppearance: {}, updatedAt: new Date().toISOString() };
  });
  if (changed) writeProcedures(updated);
  return changed;
}
