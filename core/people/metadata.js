import { shortDate } from '../../ui/ui.js';
import { getSettlementTotalsForRecords, getRecordPaymentState, calculateSettlementTotals } from '../finance/index.js';
import { getActiveDDSMovements } from '../finance/read.js';
import { getRecords } from '../record/index.js';
import { getIdentityMemberKeys, getAllPeople } from './data.js';
import { getMembers } from '../uei.js';
import { getRecordRows, getRecordEventRows } from '../record/data.js';
import { projectRecordLifecycle } from '../record/state.js';

const personKey = (value) => String(value || '');

function personRecords(key) {
  const identityKeys = new Set(getIdentityMemberKeys(key).map(personKey).filter(Boolean));
  if (!identityKeys.size) return [];
  return getRecords().filter((record) => record?.status !== 'cancelled' && identityKeys.has(personKey(record?.person?.key)));
}

export function getPersonMetadata(key) {
  const records = personRecords(key);
  const fact = getSettlementTotalsForRecords(records.map((record) => record?.id));
  const dated = records
    .filter((record) => record?.date)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  return {
    recordCount: records.length,
    paidTotal: Math.max(0, Number(fact.factTotal) || 0),
    lastVisit: dated[0]?.date || '',
    firstVisit: dated.length > 1 ? dated.at(-1)?.date || '' : '',
  };
}

export function formatPersonVisitDate(value) {
  return shortDate(value, '—');
}

/** A list needs only appointment dates, not payment projections or full
 * histories for every contact. Read each canonical snapshot once. */
export function buildPersonVisitIndex({ finance = false } = {}) {
  const movementsByRecord = new Map();
  if (finance) for (const movement of getActiveDDSMovements()) {
    if (movement?.source?.type !== 'record') continue;
    const id = String(movement.source.id || '');
    if (!movementsByRecord.has(id)) movementsByRecord.set(id, []);
    movementsByRecord.get(id).push(movement);
  }
  const people = getAllPeople();
  const known = new Set(people.map(person => String(person.key)));
  const events = new Map();
  for (const event of getRecordEventRows()) {
    const key = String(event.recordId || '');
    if (!events.has(key)) events.set(key, []);
    events.get(key).push(event);
  }
  const byPerson = new Map();
  for (const row of getRecordRows()) {
    const key = String(row?.person?.key || '');
    const date = String(row?.date || '');
    if (!row?.id || !key || !date) continue;
    const lifecycle = projectRecordLifecycle(row, events.get(String(row.id)) || []);
    if (lifecycle.status === 'cancelled') continue;
    const item = byPerson.get(key) || { count: 0, first: '', last: '', visitCount:0, paidTotal:0, debt:0 };
    item.count++;
    if (lifecycle.attendance === 'arrived') item.visitCount++;
    if (finance) {
      const movements = movementsByRecord.get(String(row.id)) || [];
      item.paidTotal += calculateSettlementTotals(null, movements).factTotal;
      if (lifecycle.attendance === 'arrived') {
        const state = getRecordPaymentState(lifecycle, { movements });
        item.debt += Math.max(0, Number(state.remaining) || 0);
      }
    }
    if (!item.first || date < item.first) item.first = date;
    if (!item.last || date > item.last) item.last = date;
    byPerson.set(key, item);
  }
  const index = new Map();
  for (const person of people) {
    const key = String(person.key);
    const linked = person.uei ? [...new Set(getMembers(person.uei).map(member => {
      const value = String(member || '');
      return value.startsWith('person:') ? value.slice(7) : value.includes(':') ? '' : value;
    }).filter(value => known.has(value)))] : [];
    const keys = linked.length ? linked : [key];
    let count = 0, first = '', last = '', visitCount = 0, paidTotal = 0, debt = 0;
    for (const id of keys) {
      const item = byPerson.get(id);
      if (!item) continue;
      count += item.count;
      visitCount += item.visitCount;
      paidTotal += item.paidTotal;
      debt += item.debt;
      if (!first || item.first < first) first = item.first;
      if (!last || item.last > last) last = item.last;
    }
    index.set(key, { firstVisit: count > 1 ? first : '', lastVisit: last, visitCount, paidTotal:finance ? Math.max(0,Math.round(paidTotal*100)/100) : null, debt:finance ? Math.round(debt*100)/100 : null });
  }
  return index;
}
