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
      duration: item?.duration == null ? null : minutes(item.duration),
      breakDuration: item?.breakDuration == null ? null : minutes(item.breakDuration),
      description: item?.description == null ? null : String(item.description),
      visibleInPublicBooking: item?.visibleInPublicBooking == null ? null : item.visibleInPublicBooking === true,
      groupBooking: item?.groupBooking ? {
        enabled: item.groupBooking.enabled === true,
        capacity: Math.max(2, Math.floor(Number(item.groupBooking.capacity) || 2)),
      } : null,
    }))
    .filter((item) => item.id)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function procedureEditorSignature({
  name = '', duration = 0, breakDuration = 0, cost = {}, description = '',
  groupEnabled = false, groupCapacity = 2, visibleInPublicBooking = true, workplaces = [],
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
    visibleInPublicBooking: visibleInPublicBooking !== false,
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


// Refresh the baseline only for the independently persisted assignment.
// Pending unrelated Q edits must remain dirty.
export function rebaseWorkplaceAssignmentSignature(signature, workplaceId, assignment = null) {
  const snapshot = JSON.parse(signature);
  const id = text(workplaceId);
  const before = Array.isArray(snapshot.workplaces) ? snapshot.workplaces : [];
  const others = before.filter((row) => row.id !== id);
  if (assignment) {
    const next = workplaceSnapshot([{ ...assignment, workplaceId: id }])[0];
    if (next) others.push(next);
  }
  snapshot.workplaces = others.sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify(snapshot);
}
