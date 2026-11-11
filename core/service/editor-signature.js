// Shared editor snapshots: one price/workplace definition, no duplicate dirty rules.
const text = (value) => String(value ?? '').trim();
const minutes = (value) => Math.max(0, Number(value) || 0);

export function costSnapshot(cost = {}) {
  const mode = ['amount', 'from', 'from-to'].includes(cost?.mode) ? cost.mode : 'amount';
  if (cost?.free === true) return { mode, free: true };
  if (mode === 'from-to') return { mode, free: false, from: text(cost.from), to: text(cost.to) };
  if (mode === 'from') return { mode, free: false, from: text(cost.from !== '' && cost.from != null ? cost.from : cost.amount) };
  return { mode, free: false, amount: text(cost.amount !== '' && cost.amount != null ? cost.amount : cost.from) };
}

function workplaceSnapshot(workplaces = []) {
  return (Array.isArray(workplaces) ? workplaces : [])
    .map((item) => ({
      id: text(item?.workplaceId || item?.id || item?.key),
      cost: item?.cost ? costSnapshot(item.cost) : null,
    }))
    .filter((item) => item.id)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function procedureEditorSignature({
  name = '', duration = 0, breakDuration = 0, cost = {}, description = '',
  groupEnabled = false, groupCapacity = 2, workplaces = [],
} = {}) {
  const enabled = groupEnabled === true;
  const assignments = workplaceSnapshot(workplaces);
  return JSON.stringify({
    name: text(name),
    duration: minutes(duration),
    breakDuration: minutes(breakDuration),
    cost: costSnapshot(cost),
    description: text(description),
    groupEnabled: enabled,
    groupCapacity: enabled ? Math.max(2, Math.floor(Number(groupCapacity) || 2)) : null,
    workplaces: assignments,
  });
}

export function productEditorSignature({
  name = '', cost = {}, description = '', workplaces = [],
} = {}) {
  return JSON.stringify({
    name: text(name),
    cost: costSnapshot(cost),
    description: text(description),
    workplaces: workplaceSnapshot(workplaces),
  });
}


// Only the workplace's price has been persisted. Preserve the baseline for
// all unrelated fields and pending changes in the enclosing Q editor.
export function rebaseWorkplacePriceSignature(signature, workplaceId, cost) {
  const snapshot = JSON.parse(signature);
  const id = String(workplaceId || '');
  const assignments = Array.isArray(snapshot.workplaces) ? snapshot.workplaces : [];
  const row = assignments.find((entry) => entry.id === id);
  if (row) row.cost = cost === null ? null : costSnapshot(cost);
  else assignments.push({ id, cost: cost === null ? null : costSnapshot(cost) });
  snapshot.workplaces = assignments.sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify(snapshot);
}
