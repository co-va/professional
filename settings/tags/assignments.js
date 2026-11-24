// Read-only projection of existing domain-owned tag assignments.
// No separate tag-membership database or mirror is introduced here.
const text = (value) => String(value ?? '').trim();
const list = (value) => Array.isArray(value) ? value : [];

function includesTag(values, tag) {
  return list(values).some((value) => {
    const candidate = value && typeof value === 'object'
      ? text(value.id ?? value.tagId)
      : text(value);
    return candidate === text(tag.id) || (candidate && candidate === text(tag.name));
  });
}

export function replaceAssignmentTag(values, fromTag, toId = '') {
  const raw = list(values);
  if (!raw.some((value) => {
    const id = value && typeof value === 'object' ? text(value.id ?? value.tagId) : text(value);
    return id === text(fromTag.id) || (id && id === text(fromTag.name));
  })) throw new Error('Ярлык уже снят с этой позиции.');

  const remaining = raw.filter((value) => {
    const id = value && typeof value === 'object' ? text(value.id ?? value.tagId) : text(value);
    return id !== text(fromTag.id) && id !== text(fromTag.name);
  });
  const target = text(toId);
  if (target && !remaining.some((value) => {
    const id = value && typeof value === 'object' ? text(value.id ?? value.tagId) : text(value);
    return id === target;
  })) remaining.push(target);
  return remaining;
}

const definitions = [
  {
    source: 'people', kind: 'Человек', id: (item) => item.key || item.id,
    label: (item) => [item.name, item.surname].filter(Boolean).join(' ') || 'Без имени',
  },
  { source: 'products', kind: 'Товар', id: (item) => item.id, label: (item) => item.name || 'Товар' },
  { source: 'procedures', kind: 'Услуга', id: (item) => item.id, label: (item) => item.name || 'Услуга' },
  { source: 'workplaces', kind: 'Рабочее пространство', id: (item) => item.key || item.id, label: (item) => item.name || 'Рабочее пространство' },
  { source: 'records', kind: 'Запись', id: (item) => item.id, label: (item) => [item.date, item.from].filter(Boolean).join(' ') || 'Запись' },
  { source: 'events', kind: 'Событие', id: (item) => item.id, label: (item) => item.title || 'Событие' },
  { source: 'notes', kind: 'Заметка', id: (item) => item.id, label: (item) => item.title || 'Заметка' },
];

// One assignment means one existing entity with this tag, irrespective of
// how many times the same tag ID appears in its legacy tags array.
export function tagAssignments(tag = {}, sources = {}) {
  if (!text(tag.id)) return [];
  const results = [];
  for (const definition of definitions) {
    for (const item of list(sources[definition.source])) {
      if (!item || item.deletedAt || !includesTag(item.tags, tag)) continue;
      const id = text(definition.id(item));
      if (!id) continue;
      results.push({
        key: `${definition.source}:${id}`,
        source: definition.source,
        id,
        kind: definition.kind,
        title: text(definition.label(item)),
      });
    }
  }
  return results.sort((a, b) => a.title.localeCompare(b.title, 'ru', { sensitivity: 'base', numeric: true }));
}
