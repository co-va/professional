import { formatSignedMoney } from '../../ui/utils/values.js';
import { shortDateTimeParts } from '../../ui/ui.js';
import { readOnlyReceipt } from '../../ui/receipt/index.js';
import { getFinanceOperation } from './data.js';
import { getLedgerEntries } from './read.js';

function formatMoney(value = 0, { signed = false } = {}) {
  return formatSignedMoney(value, signed);
}

function walletText(item) {
  return item?.walletName || item?.walletId || '';
}
function personText(item) {
  return [item?.person?.name, item?.person?.surname].filter(Boolean).join(' ').trim();
}
function operationTotal(entries = []) {
  const rows = Array.isArray(entries) ? entries : [];
  const declared = Math.max(0, Number(rows[0]?.operationTotal) || 0);
  if (declared > 0) return declared;
  if (rows[0]?.operationKind === 'transfer') {
    return Math.max(0, ...rows.map((item) => Math.max(0, Number(item?.amount) || 0)));
  }
  return rows.reduce((sum, item) => sum + Math.max(0, Number(item?.amount) || 0), 0);
}
function operationReceiptItems(entries = []) {
  const rows = Array.isArray(entries) ? entries : [];
  const first = rows[0] || {};
  const items = [];

  const articles = [...new Set(rows.map((item) => String(item?.articleName || '')).filter(Boolean))];
  if (articles.length && first?.operationKind !== 'transfer') {
    items.push({ label: `Статья · ${articles.join(', ')}`, value: '' });
  }

  const person = personText(first);
  const uei = String(first?.person?.uei || '').trim();
  if (uei) items.push({ label: uei, value: '' });
  if (person) items.push({ label: person, value: '' });
  if (first?.workplace) items.push({ label: first.workplace, value: '' });

  const wallets = [...new Set(rows.map((item) => walletText(item)).filter(Boolean))];
  if (first?.operationKind === 'transfer') {
    const from = rows.find((item) => item?.direction === 'OUT');
    const to = rows.find((item) => item?.direction === 'IN');
    if (walletText(from)) items.push({ label: `Из кошелька · ${walletText(from)}`, value: '' });
    if (walletText(to)) items.push({ label: `В кошелёк · ${walletText(to)}`, value: '' });
  } else if (wallets.length === 1) {
    items.push({ label: wallets[0], value: '' });
  } else if (wallets.length > 1) {
    items.push({ label: wallets.join(' + '), value: '' });
  }

  if (first?.counterparty) items.push({ label: first.counterparty, value: '' });
  if (first?.note) items.push({ label: first.note, value: '' });

  const lines = first?.operationKind === 'transfer'
    ? []
    : rows
      .filter((item) => String(item?.lineName || '').trim())
      .map((item) => ({
        label: String(item.lineName),
        value: formatMoney(Math.max(0, Number(item?.amount) || 0)),
      }));

  items.push(...lines);
  return { items, lineCount: lines.length };
}

function paymentGroups(rows, data) {
  const first = rows[0] || {};
  const person = first.person || data.person || {};
  const when = shortDateTimeParts(first.occurredAt || '');
  const quote = data.sourceQuote || {};
  const settlement = data.settlement || {};
  const items = Array.isArray(settlement.items) && settlement.items.length ? settlement.items : (first.settlementItems || []);
  const identity = [
    { label: 'Рабочее пространство', value: first.workplace || data.workplaceName || data.workplace || '' },
    { label: 'Дата и время оплаты', value: [when.date, when.time].filter(Boolean).join(' · ') },
    { label: 'Код', value: person.uei || '' },
    { label: 'Клиент', value: [person.name, person.surname].filter(Boolean).join(' ') },
  ].filter(row => row.value);
  const breakdown = items.map(item => {
    const amount = item.planAmount ?? item.price;
    return { label: String(item.name || 'Услуга'), value: amount != null && Number.isFinite(Number(amount)) ? formatMoney(Number(amount)) : '—' };
  });
  if (!breakdown.length) {
    const subject = String(quote.subject || data.subject || first.sourceDetails || '').trim();
    breakdown.push({ label: subject || 'Состав услуг не сохранён', value: '' });
  }
  if (settlement.serviceTotal != null && settlement.planTotal != null && Number(settlement.serviceTotal) > Number(settlement.planTotal)) {
    breakdown.push({ label: 'Стоимость до скидки', value: formatMoney(settlement.serviceTotal) }, { label: 'Скидка', value: formatMoney(Number(settlement.serviceTotal) - Number(settlement.planTotal)) });
  }
  if (settlement.planTotal != null) breakdown.push({ label: 'К оплате по счёту', value: formatMoney(settlement.planTotal), strong: true });
  const tips = data.tips != null ? Math.max(0, Number(data.tips) || 0) : rows.filter(item => item.economicType === 'TIPS').reduce((sum,item) => sum + Math.max(0, Number(item.amount)||0),0);
  const payment = [];
  if (data.serviceAmount != null) payment.push({ label: 'Оплачено за услуги', value: formatMoney(data.serviceAmount) });
  if (tips > 0) payment.push({ label: 'Чаевые', value: formatMoney(tips) });
  const allocations = Array.isArray(data.allocations) && data.allocations.length ? data.allocations : (first.allocations || []);
  if (allocations.length) allocations.filter(item => Number(item.amount)>0).forEach(item => payment.push({ label: item.walletName || item.walletId || 'Кошелёк', value: formatMoney(item.amount) }));
  else {
    const wallets = new Map();
    for (const item of rows) {
      const label = walletText(item);
      if (label) wallets.set(label, (wallets.get(label)||0) + Math.max(0, Number(item.amount)||0));
    }
    for (const [label,amount] of wallets) payment.push({ label, value: formatMoney(amount) });
  }
  for (const item of (Array.isArray(data.depositAllocations) ? data.depositAllocations : [])) {
    if (Number(item.amount)>0) payment.push({ label: item.name || 'Депозит', value: formatMoney(item.amount) });
  }
  if (Number(data.personalAccountAmount)>0) payment.push({ label: 'Личный счёт', value: formatMoney(data.personalAccountAmount) });
  payment.push({ label: 'Итого оплачено', value: formatMoney(data.total ?? operationTotal(rows)), strong: true });
  return [identity,breakdown,payment].filter(group => group.length);
}

// Use the historical operation snapshot, not the current price list or record.
export function financeReceipt(operationId, title, { entries = [], wallet = null } = {}) {
  const id = String(operationId || '');
  const all = getLedgerEntries().filter(item => String(item.operationId || '') === id);
  const rows = all.length ? all : entries;
  const first = rows[0] || {};
  const data = getFinanceOperation(id)?.data || {};
  const when = shortDateTimeParts(first.occurredAt || '');
  const groups = first.operationKind === 'payment' ? paymentGroups(rows,data) : [];
  const walletTotal = wallet ? [{ label: 'Движение по кошельку · ' + wallet.name, value: formatMoney(wallet.total), strong: true }] : [];
  if (groups.length) return readOnlyReceipt({ groups, totals: walletTotal });
  const details = operationReceiptItems(rows).items;
  if (data.financeEntityName) details.push({ label: 'Наименование', value: data.financeEntityName });
  return readOnlyReceipt({ date: when.date || '—', time: when.time || '—', items: details, totals: [{label:'Итого',value:formatMoney(operationTotal(rows)),strong:true},...walletTotal] });
}
