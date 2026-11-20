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
