import { flushBusinessPersistence, isBusinessServerReady, queueAuxiliaryDataset } from '../../core/business-persistence.js';

let tagsState = [];

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizeTag(tag = {}) {
  return {
    id: String(tag.id || ''),
    name: String(tag.name || ''),
    color: String(tag.color || '#3B302B'),
    createdAt: String(tag.createdAt || ''),
    updatedAt: String(tag.updatedAt || ''),
  };
}

export function hydrateTagsFromServer(value = []) {
  tagsState = Array.isArray(value) ? value.map(normalizeTag) : [];
  return clone(tagsState);
}

export function getTags() {
  return clone(tagsState)
    .map(normalizeTag)
    .filter((tag) => tag.id && tag.name);
}

export function saveTags(tags = []) {
  tagsState = (Array.isArray(tags) ? tags : []).map(normalizeTag);
  void queueAuxiliaryDataset('tags', tagsState);
}

// ACK-first path for editor actions. Do not change the legacy saveTags
// contract used elsewhere in the existing application.
export async function commitTags(tags = []) {
  if (!isBusinessServerReady()) throw new Error('Нет соединения с сервером. Ярлык не сохранён.');
  await flushBusinessPersistence();
  const next = (Array.isArray(tags) ? tags : []).map(normalizeTag);
  const result = await queueAuxiliaryDataset('tags', next);
  if (result?.ok === false) throw result.error || new Error('Не удалось сохранить ярлык.');
  tagsState = next;
  return getTags();
}

export function createTag({ name, color }) {
  const now = new Date().toISOString();
  return normalizeTag({
    id: crypto.randomUUID(),
    name,
    color,
    createdAt: now,
    updatedAt: now,
  });
}
