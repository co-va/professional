function numberValue(value, fallback = 0) {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function dateOnly(value = '') {
  const text = String(value ?? '').trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  const date = value instanceof Date ? value : new Date(text);
  if (!Number.isFinite(date?.getTime?.())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dateMs(value = '') {
  const key = dateOnly(value);
  if (!key) return NaN;
  const [year, month, day] = key.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function addMonths(value, count) {
  const key = dateOnly(value);
  if (!key) return '';
  const [year, month, day] = key.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + Number(count || 0), 1));
  const maxDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, maxDay));
  return dateOnly(target);
}

function addYears(value, count) {
  const key = dateOnly(value);
  if (!key) return '';
  const [year, month, day] = key.split('-').map(Number);
  const targetYear = year + Number(count || 0);
  const maxDay = new Date(Date.UTC(targetYear, month, 0)).getUTCDate();
  return dateOnly(new Date(Date.UTC(targetYear, month - 1, Math.min(day, maxDay))));
}

function percentage(value) {
  return Math.max(0, Math.min(100, numberValue(value, 0)));
}

export function normalizeInvestmentTerms(entity = {}) {
  const source = entity?.investmentTerms && typeof entity.investmentTerms === 'object'
    ? entity.investmentTerms
    : {};
  const role = ['self', 'raise', 'external'].includes(source.role) ? source.role : 'raise';
  return {
    role,
    investmentType: ['own-business', 'business-project', 'equity', 'property', 'securities', 'other'].includes(source.investmentType)
      ? source.investmentType
      : (role === 'self' ? 'own-business' : 'business-project'),
    participationModel: ['self', 'returnable', 'equity', 'profit-share', 'revenue-share', 'fixed-return', 'joint', 'other'].includes(source.participationModel)
      ? source.participationModel
      : (role === 'self' ? 'self' : 'returnable'),
    objectName: String(source.objectName || ''),
    termMode: ['none', 'date', 'duration'].includes(source.termMode) ? source.termMode : 'none',
    endDate: dateOnly(source.endDate),
    durationValue: Math.max(1, Math.floor(numberValue(source.durationValue, 1))),
    durationUnit: ['months', 'years'].includes(source.durationUnit) ? source.durationUnit : 'months',
    targetAmount: Math.max(0, numberValue(source.targetAmount, 0)),
    sharePercent: percentage(source.sharePercent),
    returnPercent: percentage(source.returnPercent),
    participantAccountId: String(source.participantAccountId || ''),
    participantName: String(source.participantName || ''),
    participantStatus: ['pending', 'accepted', 'declined'].includes(source.participantStatus)
      ? source.participantStatus
      : (source.participantAccountId ? 'pending' : ''),
    participantRespondedAt: String(source.participantRespondedAt || ''),
  };
}

export function investmentTermEndDate(entity = {}, startDate = '') {
  const terms = normalizeInvestmentTerms(entity);
  if (terms.termMode === 'date') return terms.endDate;
  if (terms.termMode !== 'duration' || !startDate) return '';
  return terms.durationUnit === 'years'
    ? addYears(startDate, terms.durationValue)
    : addMonths(startDate, terms.durationValue);
}

function activeMovements(movements = [], asOfDate = '') {
  const asOf = dateOnly(asOfDate);
  return (Array.isArray(movements) ? movements : [])
    .filter((item) => item?.operationStatus !== 'cancelled' && item?.economicType !== 'REVERSAL')
    .filter((item) => !asOf || dateOnly(item?.occurredAt || '') <= asOf)
    .slice()
    .sort((a, b) => String(a?.occurredAt || '').localeCompare(String(b?.occurredAt || '')));
}

function activeEvents(entity = {}, asOfDate = '') {
  const asOf = dateOnly(asOfDate);
  return (Array.isArray(entity?.investmentEvents) ? entity.investmentEvents : [])
    .filter((item) => item && item.deletedAt == null)
    .filter((item) => !asOf || dateOnly(item?.occurredDate || item?.occurredAt || '') <= asOf)
    .map((item) => ({
      ...item,
      type: String(item?.type || ''),
      amount: Math.max(0, numberValue(item?.amount, 0)),
      occurredDate: dateOnly(item?.occurredDate || item?.occurredAt || ''),
    }))
    .filter((item) => item.occurredDate)
    .sort((a, b) => a.occurredDate.localeCompare(b.occurredDate));
}

function amountOf(item = {}) {
  return Math.max(0, numberValue(item?.amount ?? item?.total, 0));
}

function movementDate(item = {}) {
  return dateOnly(item?.occurredAt || item?.date || '');
}

function xnpv(rate, cashflows) {
  const start = dateMs(cashflows[0]?.date);
  if (!Number.isFinite(start) || rate <= -1) return NaN;
  return cashflows.reduce((sum, flow) => {
    const time = dateMs(flow.date);
    if (!Number.isFinite(time)) return sum;
    const years = (time - start) / (365 * 86400000);
    return sum + flow.amount / ((1 + rate) ** years);
  }, 0);
}

export function investmentXirr(cashflows = []) {
  const values = (Array.isArray(cashflows) ? cashflows : [])
    .map((item) => ({ date: dateOnly(item?.date), amount: numberValue(item?.amount, 0) }))
    .filter((item) => item.date && Math.abs(item.amount) > 1e-12)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (values.length < 2 || !values.some((item) => item.amount < 0) || !values.some((item) => item.amount > 0)) return null;

  let low = -0.999999;
  let high = 1;
  let lowValue = xnpv(low, values);
  let highValue = xnpv(high, values);
  if (!Number.isFinite(lowValue) || !Number.isFinite(highValue)) return null;

  for (let i = 0; i < 80 && Math.sign(lowValue) === Math.sign(highValue); i += 1) {
    high *= 2;
    highValue = xnpv(high, values);
    if (!Number.isFinite(highValue)) return null;
  }
  if (Math.sign(lowValue) === Math.sign(highValue)) return null;

  for (let i = 0; i < 160; i += 1) {
    const mid = (low + high) / 2;
    const value = xnpv(mid, values);
    if (!Number.isFinite(value)) return null;
    if (Math.abs(value) < 1e-10) return mid;
    if (Math.sign(value) === Math.sign(lowValue)) {
      low = mid;
      lowValue = value;
    } else {
      high = mid;
      highValue = value;
    }
  }
  return (low + high) / 2;
}

function firstMovementDate(movements = []) {
  return movements.map(movementDate).filter(Boolean).sort()[0] || '';
}

function latestValuation(events = []) {
  const values = events.filter((event) => event.type === 'valuation');
  return values.length ? values.at(-1).amount : null;
}

function paybackDate(cashflows = []) {
  let cumulative = 0;
  let wasNegative = false;
  for (const flow of cashflows.slice().sort((a, b) => a.date.localeCompare(b.date))) {
    cumulative += flow.amount;
    if (cumulative < 0) wasNegative = true;
    if (wasNegative && cumulative >= 0) return flow.date;
  }
  return '';
}

export function calculateInvestmentState(entity = {}, movements = [], asOfDate = new Date()) {
  const terms = normalizeInvestmentTerms(entity);
  const asOf = dateOnly(asOfDate);
  const rows = activeMovements(movements, asOf);
  const events = activeEvents(entity, asOf);
  const startDate = firstMovementDate(rows);
  const endDate = investmentTermEndDate(entity, startDate);

  let contributed = 0;
  let returnedCapital = 0;
  let income = 0;
  let expenses = 0;
  let received = 0;
  let capitalReturned = 0;
  let incomePaid = 0;

  const investorCashflows = [];
  const realizedCashflows = [];

  for (const movement of rows) {
    const type = String(movement?.economicType || '');
    const amount = amountOf(movement);
    const date = movementDate(movement);
    if (!date || amount <= 0) continue;

    if (type === 'INVESTMENT_CONTRIBUTION') {
      contributed += amount;
      investorCashflows.push({ date, amount: -amount });
      realizedCashflows.push({ date, amount: -amount });
    } else if (type === 'INVESTMENT_CAPITAL_RETURN') {
      returnedCapital += amount;
      investorCashflows.push({ date, amount });
      realizedCashflows.push({ date, amount });
    } else if (type === 'INVESTMENT_INCOME') {
      income += amount;
      investorCashflows.push({ date, amount });
      realizedCashflows.push({ date, amount });
    } else if (type === 'INVESTMENT_EXPENSE') {
      expenses += amount;
      investorCashflows.push({ date, amount: -amount });
      realizedCashflows.push({ date, amount: -amount });
    } else if (type === 'INVESTMENT_RECEIVED') {
      if (terms.role === 'raise') received += amount;
      else {
        contributed += amount;
        investorCashflows.push({ date, amount: -amount });
        realizedCashflows.push({ date, amount: -amount });
      }
    } else if (type === 'INVESTMENT_RETURN') {
      if (terms.role === 'raise') capitalReturned += amount;
      else {
        returnedCapital += amount;
        investorCashflows.push({ date, amount });
        realizedCashflows.push({ date, amount });
      }
    } else if (type === 'INVESTMENT_INCOME_PAYMENT') {
      if (terms.role === 'raise') incomePaid += amount;
      else {
        income += amount;
        investorCashflows.push({ date, amount });
        realizedCashflows.push({ date, amount });
      }
    }
  }

  let savings = 0;
  let reinvested = 0;
  let projectProfit = 0;
  let projectRevenue = 0;
  for (const event of events) {
    if (event.type === 'saving') {
      savings += event.amount;
      if (terms.role !== 'raise') {
        realizedCashflows.push({ date: event.occurredDate, amount: event.amount });
      }
    } else if (event.type === 'reinvestment') {
      reinvested += event.amount;
    } else if (event.type === 'project-profit') {
      projectProfit += event.amount;
    } else if (event.type === 'project-revenue') {
      projectRevenue += event.amount;
    }
  }

  const explicitValuation = latestValuation(events);
  const capitalBase = Math.max(0, contributed + reinvested - returnedCapital);
  const projectValue = explicitValuation == null ? null : explicitValuation;
  const equityPositionValue = terms.role === 'external'
    && terms.participationModel === 'equity'
    && terms.sharePercent > 0
    && projectValue != null
    ? projectValue * terms.sharePercent / 100
    : null;
  const currentValue = terms.role === 'external'
    ? (equityPositionValue == null ? capitalBase : equityPositionValue)
    : (projectValue == null ? capitalBase : projectValue);
  const realizedInflows = returnedCapital + income + savings;
  const capitalOutflows = contributed + expenses;
  const realizedResult = realizedInflows - capitalOutflows;
  const result = terms.role === 'raise'
    ? incomePaid * -1
    : realizedInflows + currentValue - capitalOutflows;
  const roi = terms.role === 'raise' || capitalOutflows <= 0
    ? null
    : result / capitalOutflows * 100;
  const paybackRatio = terms.role === 'raise' || capitalOutflows <= 0
    ? null
    : realizedInflows / capitalOutflows * 100;

  const terminalCashflows = investorCashflows.slice();
  if (terms.role !== 'raise' && currentValue > 0 && asOf) {
    terminalCashflows.push({ date: asOf, amount: currentValue });
  }
  const xirr = terms.role === 'raise' ? null : investmentXirr(terminalCashflows);
  const shareValue = terms.sharePercent > 0 && projectValue != null
    ? projectValue * terms.sharePercent / 100
    : null;
  const incomeBase = terms.role === 'raise' ? received : contributed;
  const entitledIncome = terms.participationModel === 'profit-share'
    ? projectProfit * terms.returnPercent / 100
    : terms.participationModel === 'revenue-share'
      ? projectRevenue * terms.returnPercent / 100
      : terms.participationModel === 'fixed-return'
        ? incomeBase * terms.returnPercent / 100
        : 0;
  const actualContractIncome = terms.role === 'raise' ? incomePaid : income;
  const incomeDue = Math.max(0, entitledIncome - actualContractIncome);

  return {
    role: terms.role,
    asOfDate: asOf,
    startDate,
    endDate,
    contributed,
    returnedCapital,
    income,
    expenses,
    savings,
    reinvested,
    projectProfit,
    projectRevenue,
    entitledIncome,
    incomeDue,
    capitalBase,
    currentValue,
    projectValue,
    explicitValuation: projectValue != null,
    realizedResult,
    result,
    roi,
    annualizedReturn: xirr == null ? null : xirr * 100,
    paybackRatio,
    paybackDate: terms.role === 'raise' ? '' : paybackDate(realizedCashflows),
    received,
    capitalReturned,
    incomePaid,
    remainingObligation: Math.max(0, received - capitalReturned),
    shareValue,
  };
}

export function investmentRoleLabel(role = '') {
  return ({
    self: 'В своё дело',
    raise: 'Привлекаю инвестора',
    external: 'Я инвестор',
  })[String(role || '')] || 'Инвестиция';
}
