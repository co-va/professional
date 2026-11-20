// A positional edit is a permutation of numbered slots inside ONE
// manufacturer, not N independent writes. This planner is pure and never
// changes an inventory item or synthesizes a missing slot.
const name = value => String(value ?? '').trim();
const collator = new Intl.Collator('ru', {numeric:true, sensitivity:'base'});

export function planInventoryPositionReorder(allItems = [], assignments = []) {
  if (!Array.isArray(allItems) || !Array.isArray(assignments) || !assignments.length) return null;
  const manufacturer = name(assignments[0].manufacturer);
  if (assignments.some(entry=>name(entry.manufacturer)!==manufacturer)) return null;
  const company = allItems.filter(item=>name(item.manufacturer)===manufacturer);
  if (!company.length || company.length > 10000) return null;
  const numbered = company.filter(item=>Number(item.position)>0).sort((a,b)=>
    Number(a.position)-Number(b.position) || name(a.itemId).localeCompare(name(b.itemId)));
  const unnumbered = company.filter(item=>!(Number(item.position)>0)).sort((a,b)=>
    collator.compare(name(a.name),name(b.name)) || name(a.itemId).localeCompare(name(b.itemId)));
  const positions = numbered.map(item=>Number(item.position));
  if (positions.some((value,index)=>!Number.isSafeInteger(value)
    || index>0 && positions[index-1]===value)) return null;
  const slots = new Map(positions.map((position,index)=>[position,index]));
  const chosen = new Set();
  const targetSlots = new Set();
  const ordered = new Array(numbered.length).fill(null);
  for (const change of assignments) {
    const id = name(change.itemId);
    const item = company.find(row=>name(row.itemId)===id);
    const index = slots.get(Number(change.value));
    if (!item || !(Number(item.position)>0) || index===undefined
      || chosen.has(id) || targetSlots.has(index)) return null;
    chosen.add(id);
    targetSlots.add(index);
    ordered[index] = item;
  }
  let next = 0;
  const remaining = numbered.filter(item=>!chosen.has(name(item.itemId)));
  for (let index=0;index<ordered.length;index++) {
    if (!ordered[index]) ordered[index] = remaining[next++];
  }
  return { manufacturer, itemIds:[...ordered,...unnumbered].map(item=>name(item.itemId)) };
}


// Moving a chosen set to the end is a permutation, not a deletion of numbers.
// Core's existing reorder endpoint can persist this in one transaction when
// every item in that manufacturer already has a unique positive position.
export function planInventoryMoveToEnd(allItems = [], manufacturer = '', selectedIds = []) {
  if (!Array.isArray(allItems) || !Array.isArray(selectedIds) || !selectedIds.length) return null;
  const company = allItems.filter(item => name(item.manufacturer) === name(manufacturer));
  if (!company.length || company.length > 10000) return null;
  const ordered = [...company].sort((a, b) =>
    Number(a.position) - Number(b.position) || name(a.itemId).localeCompare(name(b.itemId)));
  if (ordered.some((item, index) => !Number.isSafeInteger(Number(item.position))
      || Number(item.position) <= 0
      || index > 0 && Number(item.position) === Number(ordered[index - 1].position))) return null;
  const chosen = new Set(selectedIds.map(name));
  if (chosen.size !== selectedIds.length || selectedIds.some(id =>
      !ordered.some(row => name(row.itemId) === name(id)))) return null;
  const remaining = ordered.filter(row => !chosen.has(name(row.itemId)));
  const moved = ordered.filter(row => chosen.has(name(row.itemId)));
  return { manufacturer: name(manufacturer),
    itemIds: [...remaining, ...moved].map(item => name(item.itemId)) };
}

// Assign a concrete end position before creating a product or when moving an
// existing product to the end. No blank/zero rank is ever submitted from UI.
export function inventoryEndPosition(allItems = [], manufacturer = '', itemId = '') {
  const company = allItems.filter(item => name(item.manufacturer) === name(manufacturer));
  const maximum = Math.max(0, ...company.map(item =>
    Number(item.position) > 0 ? Number(item.position) : 0));
  const existing = company.find(item => name(item.itemId) === name(itemId));
  return existing && Number(existing.position) > 0
    ? maximum
    : maximum + 1;
}
