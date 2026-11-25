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

export function hydrateCurrentProceduresFromServer(procedures = []) {
  proceduresState = Array.isArray(procedures) ? clone(procedures) : [];
  proceduresSnapshotReady = true;
  return clone(proceduresState);
}

export function getProcedures() {
  return readRawProcedures().filter((item) => !item.deletedAt);
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

// Update only card fields, preserving concurrent Service price and group edits.
export async function commitProcedureCardAppearance(entityId, { appearance = {}, photo = '', photoPosition = '50% 50%' } = {}) {
  const id = String(entityId || '');
  await commitServiceCollection({
    read: readRawProcedures,
    persist: values => queueOperationalDataset('procedures', values),
    hydrate: hydrateCurrentProceduresFromServer,
    mutate: values => {
      if (!values.some(item => String(item.id) === id && !item.deletedAt))
        throw new Error('Услуга больше не доступна.');
      return values.map(item => String(item.id) === id
        ? { ...item, cardAppearance: clone(appearance && typeof appearance === 'object' && !Array.isArray(appearance) ? appearance : {}),
          photo: String(photo || ''), photoPosition: String(photoPosition || '50% 50%'),
          updatedAt: new Date().toISOString() }
        : item);
    },
  });
}

export async function resetProcedureCardAppearances() {
  let changed = 0;
  await commitServiceCollection({
    read: readRawProcedures,
    persist: values => queueOperationalDataset('procedures', values),
    hydrate: hydrateCurrentProceduresFromServer,
    mutate: values => values.map(item => {
      if (item.deletedAt || !item.cardAppearance || !Object.keys(item.cardAppearance).length) return item;
      changed += 1;
      return { ...item, cardAppearance: {}, updatedAt: new Date().toISOString() };
    }),
  });
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

// Consumables are attributes of the existing Procedure, not a second catalogue.
// Preserve concurrent edits to price, workplaces, description and other fields.
export async function commitProcedureConsumables(procedureId, consumables = [], groupNorms = undefined) {
  const id = String(procedureId || '');
  return commitServiceCollection({
    read: readRawProcedures,
    persist: values => queueOperationalDataset('procedures', values),
    hydrate: hydrateCurrentProceduresFromServer,
    mutate: values => {
      const found = values.find(item => String(item.id) === id && !item.deletedAt);
      if (!found) throw new Error('Услуга не найдена.');
      const saved = (Array.isArray(consumables) ? consumables : []).map(row => ({
        itemId: String(row.itemId),
        quantity: row.quantity == null ? null : Number(row.quantity),
        unit: String(row.unit || ''),
      }));
      return values.map(item => String(item.id) === id
        ? { ...item, consumables: saved,
          ...(groupNorms === undefined ? {} : { consumableGroupNorms: clone(groupNorms) }),
          updatedAt: new Date().toISOString() }
        : item);
    },
  });
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
