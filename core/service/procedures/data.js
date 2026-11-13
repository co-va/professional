import { queueOperationalDataset } from '../../../core/business-persistence.js';
import { commitServiceCollection, replaceServiceItem, changeServiceItemWorkplace } from '../workplace-assignment.js';

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

export async function commitReorderProcedures(ids = []) {
  const order = (Array.isArray(ids) ? ids : []).map(id => String(id || '')).filter(Boolean);
  await commitServiceCollection({
    read: readRawProcedures,
    persist: (values) => queueOperationalDataset('procedures', values),
    hydrate: hydrateCurrentProceduresFromServer,
    mutate: (values) => {
      const active = values.filter(item => !item.deletedAt);
      const byId = new Map(active.map(item => [String(item.id || ''), item]));
      if (order.length !== active.length || new Set(order).size !== active.length
        || order.some(id => !byId.has(id))) throw new Error('Список изменился. Откройте раздел повторно.');
      if (order.every((id, i) => String(active[i].id) === id)) return values;
      const deleted = values.filter(item => item.deletedAt);
      return [...order.map(id => byId.get(id)), ...deleted];
    },
  });
}

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


// Committed write: the canonical owner is hydrated only after server ACK.
export async function commitProcedure(item) {
  await commitServiceCollection({
    read: readRawProcedures,
    persist: (values) => queueOperationalDataset('procedures', values),
    hydrate: hydrateCurrentProceduresFromServer,
    mutate: (values) => replaceServiceItem(values, item),
  });
  return item;
}

export async function commitProcedureWorkplace(entityId, workplaceId, assignment) {
  await commitServiceCollection({
    read: readRawProcedures,
    persist: (values) => queueOperationalDataset('procedures', values),
    hydrate: hydrateCurrentProceduresFromServer,
    mutate: (values) => changeServiceItemWorkplace(values, entityId, workplaceId, assignment),
  });
}


// Journal's batch assignment uses the same ACK-first dataset owner as Service.
export async function commitProcedureBatch(mutate) {
  return commitServiceCollection({
    read: readRawProcedures,
    persist: (values) => queueOperationalDataset('procedures', values),
    hydrate: hydrateCurrentProceduresFromServer,
    mutate,
  });
}


// Soft delete of the canonical procedure after server ACK only.
export async function commitDeleteProcedure(id) {
  const target = String(id || '');
  if (!getProcedures().some((item) => String(item.id) === target)) throw new Error('Услуга уже удалена.');
  await commitServiceCollection({
    read: readRawProcedures,
    persist: (values) => queueOperationalDataset('procedures', values),
    hydrate: hydrateCurrentProceduresFromServer,
    mutate: (values) => values.map((item) =>
      String(item.id) === target ? { ...item, deletedAt: new Date().toISOString() } : item),
  });
}
