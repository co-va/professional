import { shortDate } from '../../ui/ui.js';
import { getSettlementTotalsForRecords } from '../finance/index.js';
import { getRecords } from '../record/index.js';
import { getIdentityMemberKeys } from './data.js';

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
  };
}

export function formatPersonVisitDate(value) {
  return shortDate(value, '—');
}
