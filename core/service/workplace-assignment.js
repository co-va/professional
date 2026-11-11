import { flushBusinessPersistence, isBusinessServerReady } from '../business-persistence.js';

// Persist exactly one complete workplace assignment. The server owner remains
// the existing operational/auxiliary dataset; unrelated Q draft fields never
// replace the stored entity.
export async function persistServiceWorkplaceAssignment({
  entityId = '',
  workplaceId = '',
  assignment = null,
  readEntity,
  writeEntity,
  beforeWrite = () => {},
} = {}) {
  const id = String(entityId || '');
  const key = String(workplaceId || '');
  if (!id) return null; // A new Procedure/Product is persisted by its first Q Save.
  if (!key) throw new Error('Не выбрано рабочее пространство.');
  if (!isBusinessServerReady()) throw new Error('Сервер недоступен. Изменения не сохранены.');
  const current = readEntity?.(id);
  if (!current || current.deletedAt) throw new Error('Услуга или товар больше не найдены.');

  const workplaces = Array.isArray(current.workplaces) ? current.workplaces : [];
  const target = (row) => String(row?.workplaceId ?? row?.key ?? row?.id ?? '') === key;
  const index = workplaces.findIndex(target);
  const nextWorkplaces = workplaces.filter((row) => !target(row));
  if (assignment !== null) {
    const previous = index >= 0 ? workplaces[index] : {};
    nextWorkplaces.splice(index >= 0 ? Math.min(index, nextWorkplaces.length) : nextWorkplaces.length, 0, {
      ...previous,
      ...assignment,
      workplaceId: key,
    });
  }

  const next = { ...current, workplaces: nextWorkplaces, updatedAt: new Date().toISOString() };
  beforeWrite(current);
  writeEntity(next);
  await flushBusinessPersistence();
  return next;
}
