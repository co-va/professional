import { flushBusinessPersistence, isBusinessServerReady } from '../business-persistence.js';

// One immutable transformation for Service workplace membership. All entry
// points, including Journal and Service, operate on this same assignment shape.
export function changeWorkplaceAssignment(item, workplaceId, assignment = null) {
  const key = String(workplaceId || '').trim();
  if (!key) throw new Error('Рабочее пространство не выбрано.');
  const original = Array.isArray(item?.workplaces) ? item.workplaces : [];
  const matches = (row) => String(row?.workplaceId || row?.key || row?.id || '') === key;
  const previous = original.find(matches);
  const next = original.filter((row) => !matches(row));
  if (assignment !== null) {
    const index = original.findIndex(matches);
    next.splice(index >= 0 ? Math.min(index, next.length) : next.length, 0, {
      ...(previous || {}), ...assignment, workplaceId: key,
    });
  }
  return { ...item, workplaces: next, updatedAt: new Date().toISOString() };
}

// The only ACK-first collection commit used for Service Q edits and individual
// workplace edits. No change reaches the in-memory owner before server ACK.
// Reconcile a concurrent domain-owner change instead of overwriting its state.
export async function commitServiceCollection({ read, persist, hydrate, mutate }) {
  if (!isBusinessServerReady()) throw new Error('Нет соединения с сервером. Изменения не сохранены.');
  await flushBusinessPersistence();
  const before = read();
  const updated = mutate(before);
  if (JSON.stringify(updated) === JSON.stringify(before)) return before;
  const ack = await persist(updated);
  if (ack?.ok === false) throw ack.error || new Error('Сервер отклонил сохранение.');
  const current = read();
  if (JSON.stringify(current) === JSON.stringify(updated)) return current;
  if (JSON.stringify(current) !== JSON.stringify(before)) {
    const reconciled = mutate(current);
    const retry = await persist(reconciled);
    if (retry?.ok === false) throw retry.error || new Error('Сервер отклонил сохранение.');
    hydrate(reconciled);
    return reconciled;
  }
  hydrate(updated);
  return updated;
}

export function replaceServiceItem(items = [], value = {}) {
  const list = Array.isArray(items) ? items : [];
  const index = list.findIndex((item) => item.id === value.id);
  return index < 0 ? [...list, value] : list.map((item, i) => i === index ? value : item);
}

export function changeServiceItemWorkplace(items, entityId, workplaceId, assignment) {
  const id = String(entityId || '');
  const entity = (Array.isArray(items) ? items : []).find((item) => String(item.id) === id && !item.deletedAt);
  if (!entity) throw new Error('Услуга или товар не найдены.');
  return replaceServiceItem(items, changeWorkplaceAssignment(entity, workplaceId, assignment));
}
