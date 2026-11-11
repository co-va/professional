import { flushBusinessPersistence, isBusinessServerReady } from '../business-persistence.js';

// A targeted change against the latest domain-owned data, not an entire Q form
// save. The existing dataset queue and Core API remain the only persistence path.
export async function persistServiceWorkplacePrice({
  entityId = '',
  workplaceId = '',
  workplaceName = '',
  cost = null,
  readEntity,
  writeEntity,
  beforeWrite = () => {},
} = {}) {
  const id = String(entityId || '');
  const key = String(workplaceId || '');
  if (!id) return null; // A new service is created with its first Q Save.
  if (!key) throw new Error('Не выбрано рабочее пространство.');
  if (!isBusinessServerReady()) throw new Error('Сервер недоступен. Цена не сохранена.');
  const current = readEntity?.(id);
  if (!current || current.deletedAt) throw new Error('Услуга или товар больше не найдены.');

  const workplaces = Array.isArray(current.workplaces) ? current.workplaces : [];
  const index = workplaces.findIndex((item) => String(item?.workplaceId || item?.key || item?.id || '') === key);
  const previous = index >= 0 ? workplaces[index] : { workplaceId: key, name: workplaceName };
  const assignment = { ...previous, workplaceId: key };
  if (cost === null) delete assignment.cost;
  else assignment.cost = { ...cost };
  const nextWorkplaces = [...workplaces];
  if (index >= 0) nextWorkplaces[index] = assignment;
  else nextWorkplaces.push(assignment);

  const next = { ...current, workplaces: nextWorkplaces, updatedAt: new Date().toISOString() };
  beforeWrite(current);
  writeEntity(next);
  await flushBusinessPersistence();
  return next;
}
