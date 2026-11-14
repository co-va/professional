function dateOnly(value = '') {
  const text = String(value ?? '').trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const date = value instanceof Date ? value : new Date(text);
  if (!Number.isFinite(date?.getTime?.())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function utcDate(value = '') {
  const key = dateOnly(value);
  if (!key) return null;
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isFinite(date.getTime()) ? date : null;
}

function dateKey(date) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return '';
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function addDays(value, count) {
  const date = utcDate(value);
  if (!date) return '';
  date.setUTCDate(date.getUTCDate() + Number(count || 0));
  return dateKey(date);
}

function daysBetween(from, to) {
  const a = utcDate(from);
  const b = utcDate(to);
  if (!a || !b) return 0;
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000));
}

function daysInYear(year) {
  return (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 366 : 365;
}

function daysInMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function addMonths(value, count) {
  const date = utcDate(value);
  if (!date) return '';
  const day = date.getUTCDate();
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + Number(count || 0), 1));
  const maxDay = daysInMonth(target.getUTCFullYear(), target.getUTCMonth());
  target.setUTCDate(Math.min(day, maxDay));
  return dateKey(target);
}

function addYears(value, count) {
  const date = utcDate(value);
  if (!date) return '';
  const year = date.getUTCFullYear() + Number(count || 0);
  const month = date.getUTCMonth();
  const day = Math.min(date.getUTCDate(), daysInMonth(year, month));
  return dateKey(new Date(Date.UTC(year, month, day)));
}

function numberValue(value, fallback = 0) {
  const number = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(number) ? number : fallback;
}

function moneyValue(value) {
  return Math.max(0, numberValue(value, 0));
}

export function normalizeLoanTerms(entity = {}) {
  const source = entity?.loanTerms && typeof entity.loanTerms === 'object' ? entity.loanTerms : {};
  const interestRate = Math.max(0, Math.min(100, numberValue(source.interestRate, 0)));
  const durationValue = Math.max(1, Math.floor(numberValue(source.durationValue, 1)));
  return {
    lenderName: String(source.lenderName || ''),
    termMode: ['none', 'date', 'duration'].includes(source.termMode) ? source.termMode : 'none',
    endDate: dateOnly(source.endDate),
    durationValue,
    durationUnit: ['months', 'years'].includes(source.durationUnit) ? source.durationUnit : 'months',
    interestRate,
    ratePeriod: ['monthly', 'annual'].includes(source.ratePeriod) ? source.ratePeriod : 'annual',
    repaymentMode: ['free', 'end', 'monthly'].includes(source.repaymentMode) ? source.repaymentMode : 'free',
    monthlyMode: ['equal-payment', 'equal-principal', 'interest-only'].includes(source.monthlyMode)
      ? source.monthlyMode
      : 'equal-payment',
    firstPaymentDate: dateOnly(source.firstPaymentDate),
  };
}

export function loanStartDate(movements = []) {
  const received = (Array.isArray(movements) ? movements : [])
    .filter((item) => String(item?.economicType || '') === 'LOAN_RECEIVED')
    .map((item) => dateOnly(item?.occurredAt || ''))
    .filter(Boolean)
    .sort();
  return received[0] || '';
}

export function loanTermEndDate(entity = {}, startDate = '') {
  const terms = normalizeLoanTerms(entity);
  if (terms.termMode === 'date') return terms.endDate;
  if (terms.termMode !== 'duration' || !startDate) return '';
  return terms.durationUnit === 'years'
    ? addYears(startDate, terms.durationValue)
    : addMonths(startDate, terms.durationValue);
}

function interestBetween(principal, from, to, terms) {
  let amount = Math.max(0, numberValue(principal, 0));
  const rate = Math.max(0, numberValue(terms?.interestRate, 0)) / 100;
  if (amount <= 0 || rate <= 0 || !from || !to || daysBetween(from, to) <= 0) return 0;

  let cursor = utcDate(from);
  const finish = utcDate(to);
  if (!cursor || !finish || cursor >= finish) return 0;
  let interest = 0;

  while (cursor < finish) {
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth();
    let boundary;
    let divisor;
    if (terms.ratePeriod === 'monthly') {
      boundary = new Date(Date.UTC(year, month + 1, 1));
      divisor = daysInMonth(year, month);
    } else {
      boundary = new Date(Date.UTC(year + 1, 0, 1));
      divisor = daysInYear(year);
    }
    const segmentEnd = boundary < finish ? boundary : finish;
    const days = Math.max(0, Math.round((segmentEnd.getTime() - cursor.getTime()) / 86400000));
    interest += amount * rate * days / divisor;
    cursor = segmentEnd;
  }
  return interest;
}

function sortedLoanEvents(movements = [], asOfDate = '') {
  const asOf = dateOnly(asOfDate);
  return (Array.isArray(movements) ? movements : [])
    .filter((item) => ['LOAN_RECEIVED', 'LOAN_REPAYMENT'].includes(String(item?.economicType || '')))
    .filter((item) => item?.operationStatus !== 'cancelled' && item?.economicType !== 'REVERSAL')
    .filter((item) => !asOf || dateOnly(item?.occurredAt || '') <= asOf)
    .slice()
    .sort((a, b) => String(a?.occurredAt || '').localeCompare(String(b?.occurredAt || '')));
}

export function calculateLoanState(entity = {}, movements = [], asOfDate = new Date()) {
  const terms = normalizeLoanTerms(entity);
  const events = sortedLoanEvents(movements, asOfDate);
  const asOf = dateOnly(asOfDate);
  let principal = 0;
  let accruedInterest = 0;
  let received = 0;
  let repaid = 0;
  let interestPaid = 0;
  let principalPaid = 0;
  let cursor = '';

  for (const event of events) {
    const eventDate = dateOnly(event?.occurredAt || '');
    if (!eventDate) continue;
    if (cursor && eventDate > cursor) {
      accruedInterest += interestBetween(principal, cursor, eventDate, terms);
    }
    const amount = moneyValue(event?.amount ?? event?.total);
    if (String(event?.economicType || '') === 'LOAN_RECEIVED') {
      principal += amount;
      received += amount;
    } else {
      repaid += amount;
      let remaining = amount;
      const toInterest = Math.min(accruedInterest, remaining);
      accruedInterest -= toInterest;
      interestPaid += toInterest;
      remaining -= toInterest;
      const toPrincipal = Math.min(principal, remaining);
      principal -= toPrincipal;
      principalPaid += toPrincipal;
    }
    cursor = eventDate;
  }

  if (cursor && asOf && asOf > cursor) {
    accruedInterest += interestBetween(principal, cursor, asOf, terms);
  }

  return {
    asOfDate: asOf,
    startDate: loanStartDate(events),
    endDate: loanTermEndDate(entity, loanStartDate(events)),
    received,
    repaid,
    principal,
    accruedInterest,
    interestPaid,
    principalPaid,
    totalDue: principal + accruedInterest,
  };
}

function futureMonthlyDates(firstDate, asOfDate, endDate = '', maxCount = 240) {
  let date = dateOnly(firstDate);
  const asOf = dateOnly(asOfDate);
  const end = dateOnly(endDate);
  if (!date) return [];
  while (date && asOf && date <= asOf) date = addMonths(date, 1);

  const result = [];
  for (let i = 0; i < maxCount && date; i += 1) {
    if (end && date >= end) {
      if (!result.length || result.at(-1) !== end) result.push(end);
      break;
    }
    result.push(date);
    date = addMonths(date, 1);
    if (!end && result.length >= 12) break;
  }
  return result;
}

function applyScheduledPayment(state, payment) {
  let remaining = Math.max(0, payment);
  const toInterest = Math.min(state.interest, remaining);
  state.interest -= toInterest;
  remaining -= toInterest;
  const toPrincipal = Math.min(state.principal, remaining);
  state.principal -= toPrincipal;
  remaining -= toPrincipal;
  return { interest: toInterest, principal: toPrincipal, excess: remaining };
}

function simulateEqualPayment(principal, initialInterest, dates, asOf, terms, payment) {
  const state = { principal, interest: initialInterest };
  let cursor = asOf;
  for (const date of dates) {
    state.interest += interestBetween(state.principal, cursor, date, terms);
    applyScheduledPayment(state, payment);
    cursor = date;
  }
  return state.principal + state.interest;
}

function equalPaymentAmount(principal, initialInterest, dates, asOf, terms) {
  if (!dates.length) return 0;
  let low = 0;
  let high = Math.max(1, principal + initialInterest);
  for (let i = 0; i < 80 && simulateEqualPayment(principal, initialInterest, dates, asOf, terms, high) > 1e-10; i += 1) {
    high *= 2;
  }
  for (let i = 0; i < 100; i += 1) {
    const mid = (low + high) / 2;
    if (simulateEqualPayment(principal, initialInterest, dates, asOf, terms, mid) > 1e-10) low = mid;
    else high = mid;
  }
  return high;
}

export function buildLoanSchedule(entity = {}, movements = [], asOfDate = new Date()) {
  const terms = normalizeLoanTerms(entity);
  const state = calculateLoanState(entity, movements, asOfDate);
  if (state.principal <= 0 && state.accruedInterest <= 0) return [];
  const asOf = state.asOfDate;
  if (!asOf || terms.repaymentMode === 'free') return [];

  if (terms.repaymentMode === 'end') {
    if (!state.endDate || state.endDate <= asOf) return [];
    const futureInterest = interestBetween(state.principal, asOf, state.endDate, terms);
    return [{
      date: state.endDate,
      principal: state.principal,
      interest: state.accruedInterest + futureInterest,
      total: state.principal + state.accruedInterest + futureInterest,
    }];
  }

  if (terms.repaymentMode !== 'monthly') return [];
  const defaultFirst = state.startDate ? addMonths(state.startDate, 1) : '';
  const firstPaymentDate = terms.firstPaymentDate || defaultFirst;
  if (!firstPaymentDate) return [];

  if (!state.endDate && terms.monthlyMode !== 'interest-only') return [];
  const dates = futureMonthlyDates(firstPaymentDate, asOf, state.endDate);
  if (!dates.length) return [];

  const schedule = [];
  const work = { principal: state.principal, interest: state.accruedInterest };
  let cursor = asOf;

  if (terms.monthlyMode === 'equal-payment') {
    const payment = equalPaymentAmount(work.principal, work.interest, dates, asOf, terms);
    dates.forEach((date, index) => {
      work.interest += interestBetween(work.principal, cursor, date, terms);
      const dueBefore = work.principal + work.interest;
      const amount = index === dates.length - 1 ? dueBefore : Math.min(payment, dueBefore);
      const applied = applyScheduledPayment(work, amount);
      schedule.push({ date, principal: applied.principal, interest: applied.interest, total: amount });
      cursor = date;
    });
    return schedule;
  }

  const principalPart = terms.monthlyMode === 'equal-principal' && dates.length
    ? work.principal / dates.length
    : 0;

  dates.forEach((date, index) => {
    work.interest += interestBetween(work.principal, cursor, date, terms);
    const final = Boolean(state.endDate) && index === dates.length - 1;
    let amount;
    if (terms.monthlyMode === 'interest-only') {
      amount = work.interest + (final ? work.principal : 0);
    } else {
      amount = work.interest + (final ? work.principal : Math.min(principalPart, work.principal));
    }
    const applied = applyScheduledPayment(work, amount);
    schedule.push({ date, principal: applied.principal, interest: applied.interest, total: amount });
    cursor = date;
  });
  return schedule;
}

export const loanDateMath = {
  addDays,
  addMonths,
  addYears,
  daysBetween,
  interestBetween,
};
