// An item rank is always its 1-based ordinal position in the manufacturer.
// Multi-row edits describe FINAL destinations and must be applied together:
// N independent PUTs would shift one another and undo earlier selections.
const name = value => String(value ?? '').trim();
const collator = new Intl.Collator('ru', { numeric:true, sensitivity:'base' });

// Blank item rank is the last positive ordinal for this manufacturer.
export function inventoryEndPosition(items = [], manufacturer = '', excludeItemId = '') {
  const company = items.filter(item => name(item.manufacturer) === name(manufacturer));
  const excludingExisting = company.some(item => name(item.itemId) === name(excludeItemId));
  const next = company.length + (excludingExisting ? 0 : 1);
  return Number.isSafeInteger(next) && next > 0 && next <= 2147483647 ? next : 0;
}

// One reorder request moves the selected rows to the tail. Existing rows
// retain their relative order; the result never introduces an empty rank.
export function planInventoryMoveToEnd(allItems = [], manufacturer = '', itemIds = []) {
  if (!Array.isArray(allItems) || !Array.isArray(itemIds) || !itemIds.length) return null;
  const company = allItems.filter(item => name(item.manufacturer) === name(manufacturer));
  if (!company.length || company.length > 10000) return null;
  const ids = itemIds.map(name);
  if (ids.some(id => !id) || new Set(ids).size !== ids.length) return null;
  const current = [...company].sort((a,b) => {
    const rank = item => Number(item.position) > 0
      ? Number(item.position) : Number.MAX_SAFE_INTEGER;
    return rank(a) - rank(b)
      || collator.compare(name(a.name),name(b.name))
      || name(a.itemId).localeCompare(name(b.itemId));
  });
  const byId = new Map(current.map(item => [name(item.itemId), item]));
  if (ids.some(id => !byId.has(id))) return null;
  const chosen = new Set(ids);
  return {manufacturer:name(manufacturer),
    itemIds:[...current.filter(item=>!chosen.has(name(item.itemId))),
      ...current.filter(item=>chosen.has(name(item.itemId)))].map(item=>name(item.itemId))};
}

export function planInventoryPositionReorder(allItems = [], assignments = []) {
  if (!Array.isArray(allItems) || !Array.isArray(assignments) || !assignments.length) return null;
  const manufacturer = name(assignments[0].manufacturer);
  if (assignments.some(entry => name(entry.manufacturer) !== manufacturer)) return null;
  const company = allItems.filter(item => name(item.manufacturer) === manufacturer);
  if (!company.length || company.length > 10000) return null;
  const current = [...company].sort((a,b) => {
    const rank = item => Number(item.position) > 0
      ? Number(item.position) : Number.MAX_SAFE_INTEGER;
    return rank(a) - rank(b)
      || collator.compare(name(a.name),name(b.name))
      || name(a.itemId).localeCompare(name(b.itemId));
  });
  const byId = new Map(current.map(item => [name(item.itemId), item]));
  const chosen = new Set();
  const ordered = new Array(current.length).fill(null);
  for (const {itemId, value} of assignments) {
    const id = name(itemId);
    const item = byId.get(id);
    const rank = Number(value);
    if (!item || chosen.has(id) || !Number.isSafeInteger(rank)
      || rank < 1 || rank > current.length || ordered[rank-1]) return null;
    chosen.add(id);
    ordered[rank-1] = item;
  }
  const remaining = current.filter(item => !chosen.has(name(item.itemId)));
  let index = 0;
  for (let i = 0; i < ordered.length; i++) {
    if (!ordered[i]) ordered[i] = remaining[index++];
  }
  return {manufacturer,itemIds:ordered.map(item=>name(item.itemId))};
}
