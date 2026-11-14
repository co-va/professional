// Read-only Service projection: one Record scan and one canonical Finance scan per opened card.
import { getRecordRows, getRecordRowsForProcedure, getRecordEventRows } from '../record/data.js';
import { getActiveDDSMovements } from '../finance/read.js';
import { calculateSettlementItemTotals } from '../finance/rules.js';
const key = value => String(value ?? '');
const blank = () => ({ count: 0, minutes: 0, revenue: 0 });
export function serviceItemStatistics(type, entity = {}) {
  const sourceType = type === 'product' ? 'product' : 'procedure';
  const sourceId = key(entity.id);
  if (!sourceId) return { ...blank(), byWorkplace: new Map() };
  const candidates = sourceType === 'procedure' ? getRecordRowsForProcedure(sourceId) : getRecordRows();
  const cancelled = new Set(getRecordEventRows().filter(e => e?.type === 'cancelled').map(e => key(e.recordId)));
  const byWorkplace = new Map();
  const workplaceByRecord = new Map();
  let count = 0, minutes = 0;
  for (const record of candidates) {
    const recordId = key(record?.id);
    if (!recordId || cancelled.has(recordId)) continue;
    const entries = sourceType === 'product' ? record?.products : record?.procedures;
    const item = (Array.isArray(entries) ? entries : []).find(entry => key(entry?.id) === sourceId);
    if (!item) continue;
    const spent = sourceType === 'procedure' ? Math.max(0, Number(item.duration ?? entity.duration ?? 0) || 0) : 0;
    count += 1; minutes += spent;
    const workplaceId = key(record?.workplaceId);
    workplaceByRecord.set(recordId, workplaceId);
    const group = byWorkplace.get(workplaceId) || blank();
    group.count += 1; group.minutes += spent;
    byWorkplace.set(workplaceId, group);
  }
  const movements = getActiveDDSMovements();
  const byWorkplaceMovements = new Map();
  for (const movement of movements) {
    if (movement?.source?.type !== 'record') continue;
    const workplaceId = workplaceByRecord.get(key(movement?.source?.id));
    if (workplaceId === undefined) continue;
    const selected = byWorkplaceMovements.get(workplaceId) || [];
    selected.push(movement);
    byWorkplaceMovements.set(workplaceId, selected);
  }
  for (const [id, group] of byWorkplace) {
    group.revenue = calculateSettlementItemTotals(byWorkplaceMovements.get(id) || [], sourceType, sourceId).factTotal;
  }
  return { count, minutes, revenue: calculateSettlementItemTotals(movements, sourceType, sourceId).factTotal, byWorkplace };
}
export function serviceSpentText(value = 0) {
  const minutes = Math.max(0, Number(value) || 0), hours = Math.floor(minutes / 60), rest = minutes % 60;
  if (!hours) return `${rest} мин`;
  return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
}
// Trigger only once the overview is already rendered; existing state owners deduplicate requests.
export async function loadServiceStatistics() {
  const [{ loadBusinessState }, { loadFinanceState }] = await Promise.all([
    import('../runtime/business-state.js'), import('../runtime/auxiliary-state.js'),
  ]);
  await Promise.all([loadBusinessState(), loadFinanceState()]);
}

export function scheduleServiceStatistics(layer, type, id, onReady) {
  void loadServiceStatistics().then(() => {
    const expected = type + ':' + id;
    const run = () => {
      if (layer.isConnected && layer.dataset.serviceOverview === expected) onReady();
    };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 500 });
    else setTimeout(run, 0);
  }).catch((error) => {
    if (layer.isConnected) console.error('Service statistics unavailable', error);
  });
}
