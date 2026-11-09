// Settlement projects amount due, paid/refunded totals and outstanding amount for a concrete source.
// Pure arithmetic lives in rules.js; money persistence lives in Finance data/service.
// Canonical Settlement snapshots live in Finance. Record receives finance only as a read projection.
import { getStoredSettlement } from './data.js';
import { getActiveDDSMovements, getActiveDDSMovementsForSource } from './read.js';
import { personalPricePercentSource, resolvePersonPriceCondition } from '../loyalty/price-condition.js';
import { getAllPeople, getPersonPriceCondition } from '../people/data.js';
import {
  calculateSettlementTotals,
  calculateSettlementItemTotals,
  calculateSettlement,
  calculateSettlementPaymentState,
  clampFinancialPercent,
  financialNumber,
  normalizeStoredSettlement,
  recordSettlementItems,
} from './rules.js';

function currentPerson(person = null) {
  const key = String(person?.key || person?.id || '').trim();
  if (!key) return person || {};
  return getAllPeople().find((item) => String(item?.key || item?.id || '').trim() === key) || person || {};
}

function recordPersonalPricePercent(person = null) {
  return clampFinancialPercent(personalPricePercentSource(currentPerson(person))?.percent || 0);
}

function settlementItemsWithConditions(items = [], { programPercent = 0, personalPercent = 0, seedPersonal = false } = {}) {
  const lockedPercent = clampFinancialPercent(programPercent);
  const suggestedPercent = clampFinancialPercent(personalPercent);
  return (Array.isArray(items) ? items : []).map((item) => {
    if (lockedPercent > 0) {
      return {
        ...item,
        pricePercent: lockedPercent,
        correctionMode: 'none',
        correctionPercent: '',
        correctionMoney: '',
      };
    }
    if (seedPersonal && suggestedPercent > 0) {
      return {
        ...item,
        pricePercent: 0,
        correctionMode: 'percent',
        correctionPercent: suggestedPercent,
        correctionMoney: '',
      };
    }
    return { ...item, pricePercent: 0 };
  });
}

function settlementWithCurrentConditions(settlement = null, { programPercent = 0, personalPercent = 0 } = {}) {
  if (!settlement) return null;
  const currentProgramPercent = clampFinancialPercent(programPercent);
  const previousProgramPercent = clampFinancialPercent(settlement?.pricePercent ?? 0);
  const items = settlementItemsWithConditions(settlement.items, {
    programPercent: currentProgramPercent,
    personalPercent,
    seedPersonal: currentProgramPercent <= 0 && previousProgramPercent > 0,
  });
  return calculateSettlement(items, { pricePercent: currentProgramPercent });
}

export function resolveRecordSettlement(record = null, { pricePercent = null } = {}) {
  const condition = recordSettlementPriceCondition(record);
  const programPercent = pricePercent == null
    ? condition.percent
    : clampFinancialPercent(pricePercent);
  const personalPercent = recordPersonalPricePercent(record?.person);
  if (record?.id) {
    const owned = normalizeStoredSettlement(getStoredSettlement('record', record.id));
    if (owned) {
      // A paid Settlement is historical. Before payment, only the explicitly selected
      // program owns the locked program discount. Without one, an explicitly saved
      // correction remains the payment fact and personal discount is only the initial suggestion.
      const movements = getActiveDDSMovementsForSource('record', record.id);
      return movements.length
        ? owned
        : settlementWithCurrentConditions(owned, { programPercent, personalPercent });
    }
  }
  const items = settlementItemsWithConditions(recordSettlementItems(record), {
    programPercent,
    personalPercent,
    seedPersonal: programPercent <= 0 && personalPercent > 0,
  });
  return calculateSettlement(items, { pricePercent: programPercent });
}

export function getRecordSettlement(record = null, { pricePercent = null } = {}) {
  const settlement = resolveRecordSettlement(record, { pricePercent });
  if (!record?.id) return calculateSettlementTotals(settlement, []);
  return calculateSettlementTotals(settlement, getActiveDDSMovementsForSource('record', record.id));
}

export function getRecordPaymentState(record = null, { pricePercent = null } = {}) {
  const settlement = resolveRecordSettlement(record, { pricePercent });
  const movements = record?.id ? getActiveDDSMovementsForSource('record', record.id) : [];
  const state = calculateSettlementPaymentState(settlement, movements);
  const date = String(record?.date || '').slice(0, 10);
  const to = String(record?.to || record?.from || '').slice(0, 5);
  const end = date && /^\d{2}:\d{2}$/.test(to) ? new Date(`${date}T${to}:00`) : null;
  const ended = Boolean(end && Number.isFinite(end.getTime()) && Date.now() >= end.getTime());
  const zeroPrice = Number(settlement?.serviceTotal || 0) > 0.009 && Number(settlement?.planTotal || 0) <= 0.009;
  const settledByPriceRules = zeroPrice
    && (record?.completed === true || ended || state.hasPayments)
    && record?.attendance !== 'no-show';
  return settledByPriceRules ? {
    ...state,
    fullyPaid: true,
    partiallyPaid: false,
    remaining: 0,
    settledByPriceRules: true,
  } : {
    ...state,
    settledByPriceRules: false,
  };
}

export function getSettlementTotalsForRecords(recordIds = []) {
  const ids = new Set((Array.isArray(recordIds) ? recordIds : []).map((id) => String(id || '')).filter(Boolean));
  const movements = getActiveDDSMovements().filter((movement) => movement?.source?.type === 'record' && ids.has(String(movement?.source?.id || '')));
  return calculateSettlementTotals(null, movements);
}

export function getSettlementItemTotals(sourceTypeValue, sourceIdValue) {
  return calculateSettlementItemTotals(getActiveDDSMovements(), sourceTypeValue, sourceIdValue);
}

export function getSettlementItemTotalsForRecords(sourceTypeValue, sourceIdValue, recordIds = []) {
  const ids = new Set((Array.isArray(recordIds) ? recordIds : []).map((id) => String(id || '')).filter(Boolean));
  const movements = getActiveDDSMovements().filter((movement) => movement?.source?.type === 'record' && ids.has(String(movement?.source?.id || '')));
  return calculateSettlementItemTotals(movements, sourceTypeValue, sourceIdValue);
}

export function recordAmountDue(record = null) {
  return resolveRecordSettlement(record).planTotal;
}

export function recordSettlementPriceCondition(record = null) {
  const selected = record?.loyaltyProgram && typeof record.loyaltyProgram === 'object'
    ? record.loyaltyProgram
    : null;
  const selectedPercent = clampFinancialPercent(selected?.pricePercent || 0);
  const effective = getPersonPriceCondition(currentPerson(record?.person));
  if (selected && selectedPercent > 0) {
    // Selected deposits cannot keep applying a frozen 20% after their term
    // ends or the assignment is cancelled. This is re-evaluated against the
    // same canonical active-deposit source as the Person editor.
    if (String(selected.type || '') === 'deposit') {
      const assignmentId = String(selected.assignmentId || '').trim();
      const programId = String(selected.programId || '').trim();
      const matched = effective.sources.find((source) => source.type === 'program'
        && source.programType === 'deposit'
        && ((assignmentId && String(source.depositId || '') === assignmentId)
          || (programId && String(source.programId || '') === programId)));
      return resolvePersonPriceCondition(null, matched ? [matched] : []);
    }
    return resolvePersonPriceCondition(null, [{
      type: 'program',
      programType: String(selected?.type || ''),
      programId: String(selected?.programId || ''),
      assignmentId: String(selected?.assignmentId || ''),
      name: String(selected?.name || 'Программа'),
      percent: selectedPercent,
    }]);
  }

  // A person-scoped discount program is already assigned, and must apply to
  // unpaid records automatically. Do not require a SECOND program selection
  // on the Record. Never combine the automatic program with a manual percent.
  if (effective.conflict || effective.source?.type !== 'program') return resolvePersonPriceCondition(null, []);
  return resolvePersonPriceCondition(null, [effective.source]);
}

export function recordSettlementPricePercent(record = null) {
  return recordSettlementPriceCondition(record).percent;
}

export function normalizeRecordSettlement(value = null) {
  if (!value || typeof value !== 'object') return null;
  return {
    items: Array.isArray(value.items) ? value.items.map((item) => ({ ...item })) : [],
    serviceTotal: Math.max(0, financialNumber(value.serviceTotal)),
    pricePercent: value.pricePercent == null ? null : clampFinancialPercent(value.pricePercent),
    correctionTotal: Math.max(0, financialNumber(value.correctionTotal)),
    pricePercentTotal: Math.max(0, financialNumber(value.pricePercentTotal)),
    planTotal: Math.max(0, financialNumber(value.planTotal)),
    factIncome: Math.max(0, financialNumber(value.factIncome)),
    factExpense: Math.max(0, financialNumber(value.factExpense)),
    factTotal: financialNumber(value.factTotal),
  };
}

export function hydrateRecordSettlement(record = null) {
  if (!record?.id) return record;
  const condition = recordSettlementPriceCondition(record);
  const normalizedRecord = {
    ...record,
    procedures: Array.isArray(record.procedures) ? record.procedures : [],
    products: Array.isArray(record.products) ? record.products : [],
  };
  const projectedSettlement = getRecordSettlement(normalizedRecord, { pricePercent: condition.percent });
  return {
    ...normalizedRecord,
    priceCondition: condition,
    finance: normalizeRecordSettlement(projectedSettlement),
  };
}