// Inventory grouping is controlled by the ordered list of independent
// criteria, never by their labels or hard-coded Category/Type levels.
// Products can omit any criterion: the next assigned value is placed at
// the next visible level. Every item is included exactly once.
const name = value => String(value ?? '').trim();
const compare = (left, right) => name(left).localeCompare(name(right), 'ru', {
  numeric: true, sensitivity: 'base',
});

export function stockGroupValue(item, criterion) {
  if (criterion?.legacyField) return name(item?.[criterion.legacyField]);
  const id = name(item?.criteriaValues?.[criterion?.id]);
  return criterion?.values?.find(entry => entry.id === id)?.name || '';
}

export function stockGroupPath(item, criteria = []) {
  return criteria.flatMap(group => {
    const value = stockGroupValue(item, group);
    if (!value) return [];
    const valueId = group.legacyField ? value : name(item?.criteriaValues?.[group.id]);
    return [{ group, value, valueId }];
  });
}

// The caller excludes the screen's root criterion (e.g. Manufacturer).
export function stockGroupTree(items = [], criteria = []) {
  const root = { items: [], direct: [], children: new Map(), key: '' };
  for (const item of items) {
    root.items.push(item);
    let parent = root;
    for (const { group, value, valueId } of stockGroupPath(item, criteria)) {
      const id = name(group.id);
      const segment = JSON.stringify([id, valueId]);
      let node = parent.children.get(segment);
      if (!node) {
        node = {
          group, value, valueId, key: parent.key + '/' + segment,
          items: [], direct: [], children: new Map(),
        };
        parent.children.set(segment, node);
      }
      node.items.push(item);
      parent = node;
    }
    parent.direct.push(item);
  }
  return root;
}

export function sortedStockChildren(parent, criteria = []) {
  const order = new Map(criteria.map((group, index) => [group.id, index]));
  return [...parent.children.values()].sort((a, b) => {
    const groupRank = (order.get(a.group.id) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(b.group.id) ?? Number.MAX_SAFE_INTEGER);
    if (groupRank) return groupRank;
    const values = a.group.values || [];
    const orderA = values.findIndex(value => value.id === a.valueId || value.name === a.value);
    const orderB = values.findIndex(value => value.id === b.valueId || value.name === b.value);
    return (orderA < 0 ? Number.MAX_SAFE_INTEGER : orderA) -
      (orderB < 0 ? Number.MAX_SAFE_INTEGER : orderB) || compare(a.value, b.value);
  });
}
