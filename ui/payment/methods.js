import { button } from '../buttons/index.js';
import { select } from '../selectors/index.js';
import { field } from '../inputs/index.js';
import { readOnlyReceipt } from '../receipt/index.js';

export const numberValue = (value) => {
  const number = Number(String(value ?? '').replace(/\s+/g, '').replace(',', '.'));
  return Number.isFinite(number) ? number : 0;
};

const moneyInputText = (value) => {
  const number = Math.max(0, numberValue(value));
  if (!number) return '';
  const rounded = Math.round(number * 100) / 100;
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(rounded).replaceAll('\u00a0', ' ');
};

const moneyDisplay = (value) => `${moneyInputText(value) || '0'} ₽`;

// A suggested amount in a row without a chosen source is not a payment.
export function selectedPaymentRows(rows = []) {
  return rows.filter(row => String(row?.source || ''));
}
export function paymentAllocationRemainder(total, rows = []) {
  const cents = value => Math.max(0, Math.round(numberValue(value) * 100));
  return Math.max(0, cents(total) - selectedPaymentRows(rows).reduce((sum, row) => sum + cents(row.amount), 0)) / 100;
}
export function nextPaymentAllocation(total, rows = []) {
  const selected = selectedPaymentRows(rows);
  const remainder = paymentAllocationRemainder(total, selected);
  return { needed: !selected.length || (selected.every(row => numberValue(row.amount) > 0) && remainder > 0), suggested: remainder > 0 ? remainder : null };
}


function sourceKey(type, id) {
  return `${type}:${String(id || '')}`;
}

function personalAccountAvailable(personalAccount = null) {
  if (!personalAccount || typeof personalAccount !== 'object') return 0;
  const balance = Math.max(0, numberValue(personalAccount.balance));
  const explicit = personalAccount.availableAmount == null ? balance : Math.max(0, numberValue(personalAccount.availableAmount));
  return Math.min(balance, explicit);
}

function paymentSourceOptions(wallets = [], deposits = [], personalAccount = null) {
  const accountAvailable = personalAccountAvailable(personalAccount);
  return [
    { value: '', label: 'Источник оплаты' },
    ...(Array.isArray(wallets) ? wallets : []).map((wallet) => ({
      value: sourceKey('wallet', wallet?.id),
      label: String(wallet?.name || 'Кошелёк'),
    })),
    ...(Array.isArray(deposits) ? deposits : []).map((deposit) => {
      const name = String(deposit?.programName || deposit?.name || 'Депозит');
      const amount = moneyDisplay(deposit?.balance);
      const split = `${name}: ${amount}`.length > 25;
      return {
        value: sourceKey('deposit', deposit?.depositId || deposit?.id),
        label: split ? `${name}:` : `${name}: ${amount}`,
        meta: split ? amount : '',
      };
    }),
    ...(accountAvailable > 0.009 ? [{
      value: sourceKey('personal-account', personalAccount?.personKey || 'account'),
      label: `Личный счёт · доступно ${moneyDisplay(accountAvailable)}`,
    }] : []),
  ];
}

function allocationRow(index, wallets, deposits, personalAccount, initial = {}) {
  const amount = initial?.amount == null ? '' : moneyInputText(initial.amount);
  const selected = initial?.depositId
    ? sourceKey('deposit', initial.depositId)
    : (initial?.personalAccount === true
      ? sourceKey('personal-account', personalAccount?.personKey || 'account')
      : (initial?.walletId ? sourceKey('wallet', initial.walletId) : ''));
  return `<div class="form-grid" data-payment-allocation-row="${index}">
    ${select({
      label: 'Источник оплаты',
      value: selected,
      options: paymentSourceOptions(wallets, deposits, personalAccount),
      data: `data-payment-allocation-source="${index}"`,
      aria: `Источник оплаты ${index + 1}`,
    })}
    ${field({
      label: 'Сумма',
      name: `paymentAllocationAmount${index}`,
      value: amount,
      type: 'text',
      inputmode: 'decimal',
      readonly: !selected,
      data: `data-payment-allocation-amount="${index}"`,
    })}
  </div>`;
}

function totalReceipt(label, value) {
  return readOnlyReceipt({ totals: [{ label, value: moneyDisplay(value), strong: true }] });
}

function normalizeWalletAllocations(allocations = []) {
  return (Array.isArray(allocations) ? allocations : []).map((item) => ({
    walletId: String(item?.walletId || ''),
    walletName: String(item?.walletName || ''),
    amount: Math.max(0, numberValue(item?.amount)),
  })).filter((item) => item.walletId || item.amount > 0);
}

function normalizeDepositAllocations(allocations = []) {
  return (Array.isArray(allocations) ? allocations : []).map((item) => ({
    depositId: String(item?.depositId || item?.id || ''),
    name: String(item?.name || item?.programName || ''),
    balance: Math.max(0, numberValue(item?.balance)),
    amount: Math.max(0, numberValue(item?.amount)),
  })).filter((item) => item.depositId || item.amount > 0);
}

export function paymentAllocationState(allocations = [], total = 0, depositAllocations = [], personalAccountAllocation = null) {
  const wallets = normalizeWalletAllocations(allocations);
  const deposits = normalizeDepositAllocations(depositAllocations);
  const due = Math.max(0, numberValue(total));
  const cashReceived = wallets.reduce((sum, item) => sum + item.amount, 0);
  const depositReceived = deposits.reduce((sum, item) => sum + item.amount, 0);
  const personalAccountAmount = Math.max(0, numberValue(personalAccountAllocation?.amount));
  const personalAccountMaximum = Math.max(0, numberValue(personalAccountAllocation?.availableAmount));
  const personalAccountValid = personalAccountAmount <= 0.009
    || (personalAccountMaximum > 0.009 && personalAccountAmount <= personalAccountMaximum + 0.009);
  const depositValid = deposits.every((item) => item.depositId && item.amount > 0 && (!item.balance || item.amount <= item.balance + 0.009));
  const sourcesValid = wallets.every((item) => item.walletId && item.amount > 0) && depositValid && personalAccountValid;
  const nonCashReceived = depositReceived + personalAccountAmount;
  const nonCashOverflow = nonCashReceived > due + 0.009;
  const serviceFromCash = Math.min(cashReceived, Math.max(0, due - nonCashReceived));
  const applied = Math.min(due, nonCashReceived + serviceFromCash);
  const tips = Math.max(0, cashReceived - serviceFromCash);
  const remaining = Math.max(0, due - applied);
  const received = cashReceived + nonCashReceived;
  const valid = received > 0 && sourcesValid && !nonCashOverflow;
  return {
    allocations: wallets,
    depositAllocations: deposits.map(({ balance, ...item }) => item),
    personalAccountAmount,
    cashReceived,
    depositReceived,
    personalAccountReceived: personalAccountAmount,
    received,
    tips,
    applied,
    remaining,
    valid,
  };
}

export function paymentMethodsMarkup({
  wallets = [],
  deposits = [],
  personalAccount = null,
  total = 0,
  initialAllocations = [],
  initialDepositAllocations = [],
  initialPersonalAccountAmount = 0,
  showAction = true,
  showTotal = true,
} = {}) {
  const initial = [
    ...(Array.isArray(initialDepositAllocations) ? initialDepositAllocations.map((item) => ({ ...item, depositId: item?.depositId || item?.id })) : []),
    ...(Math.max(0, numberValue(initialPersonalAccountAmount)) > 0.009 ? [{ personalAccount: true, amount: initialPersonalAccountAmount }] : []),
    ...(Array.isArray(initialAllocations) ? initialAllocations : []),
  ];
  const rowCount = Math.max(1, initial.length);
  return `<div class="form-grid" data-payment-allocation-owner>
    ${showTotal ? `<div data-payment-remaining>${totalReceipt('К оплате', total)}</div>` : ''}
    <div class="form-grid" data-payment-allocation-rows>
      ${Array.from({ length: rowCount }, (_, index) => allocationRow(index, wallets, deposits, personalAccount, initial[index] || { amount: total > 0 ? total : null })).join('')}
    </div>
    <div data-payment-tips-row hidden></div>
    ${showAction ? `<div class="modal-actions">${button('Сохранить', { data: 'data-payment-allocation-submit' })}</div>` : ''}
  </div>`;
}

export function initPaymentMethodsAllocation(root, {
  wallets = [],
  deposits = [],
  personalAccount = null,
  total = 0,
  onPay = () => {},
  onChange = () => {},
} = {}) {
  if (!root) return null;
  const remainingNode = root.querySelector('[data-payment-remaining]');
  const tipsRow = root.querySelector('[data-payment-tips-row]');
  const submit = root.querySelector('[data-payment-allocation-submit]');
  const rowsHost = root.querySelector('[data-payment-allocation-rows]');
  const rows = () => [...root.querySelectorAll('[data-payment-allocation-row]')].map((part) => ({
    part,
    sourceInput: part.querySelector('input[data-payment-allocation-source]'),
    amountInput: part.querySelector('[data-payment-allocation-amount]'),
  }));
  let nextIndex = Math.max(-1, ...rows().map(({part}) => Number(part.dataset.paymentAllocationRow) || 0)) + 1;
  const rowValues = (excluding = null) => rows().filter(row => row.part !== excluding).map(({sourceInput,amountInput}) => ({
    source: String(sourceInput?.value || ''), amount: numberValue(amountInput?.value),
  }));
  const walletById = new Map((Array.isArray(wallets) ? wallets : []).map((item) => [String(item?.id || ''), item]));
  const depositById = new Map((Array.isArray(deposits) ? deposits : []).map((item) => [String(item?.depositId || item?.id || ''), item]));
  const personalKey = String(personalAccount?.personKey || 'account');
  const personalAvailable = personalAccountAvailable(personalAccount);

  function normalizedSources() {
    const walletAllocations = [];
    const depositAllocations = [];
    let personalAccountAmount = 0;
    for (const { sourceInput, amountInput } of rows()) {
      const value = String(sourceInput?.value || '');
      const amount = Math.max(0, numberValue(amountInput?.value));
      // The unselected trailing row is a suggestion, not a financial fact.
      if (!value) continue;
      const separator = value.indexOf(':');
      const type = separator >= 0 ? value.slice(0, separator) : '';
      const id = separator >= 0 ? value.slice(separator + 1) : '';
      if (type === 'wallet') {
        const wallet = walletById.get(id);
        walletAllocations.push({ walletId: wallet ? id : '', walletName: String(wallet?.name || ''), amount });
      } else if (type === 'deposit') {
        const deposit = depositById.get(id);
        depositAllocations.push({
          depositId: deposit ? id : '',
          name: String(deposit?.programName || deposit?.name || 'Депозит'),
          balance: Math.max(0, numberValue(deposit?.balance)),
          amount,
        });
      } else if (type === 'personal-account' && id === personalKey) {
        personalAccountAmount += amount;
      } else {
        walletAllocations.push({ walletId: '', walletName: '', amount });
      }
    }
    return { walletAllocations, depositAllocations, personalAccountAmount };
  }

  function state() {
    const values = normalizedSources();
    const current = paymentAllocationState(values.walletAllocations, total, values.depositAllocations, {
      amount: values.personalAccountAmount,
      availableAmount: personalAvailable,
    });
    const depositTotals = new Map();
    for (const item of values.depositAllocations) depositTotals.set(item.depositId, (depositTotals.get(item.depositId)||0)+Math.round(item.amount*100));
    if ([...depositTotals].some(([id,amount]) => !depositById.has(id)||amount>Math.round(Math.max(0,numberValue(depositById.get(id)?.balance))*100))) current.valid=false;
    return current;
  }

  function sourceMaximum(value, excluding = null) {
    let maximum = null;
    if (value.startsWith('deposit:')) {
      const deposit = depositById.get(value.slice('deposit:'.length));
      maximum = Math.max(0, numberValue(deposit?.balance));
    } else if (value === sourceKey('personal-account', personalKey)) {
      maximum = personalAvailable;
    }
    if (maximum == null) return null;
    // A source limit is shared by all its rows, not renewed per row.
    const allocated = selectedPaymentRows(rowValues(excluding))
      .filter(row => row.source === value).reduce((sum,row) => sum + Math.round(row.amount * 100),0);
    return Math.max(0, Math.round(maximum * 100) - allocated) / 100;
  }

  function clampSourceAmount(row) {
    const {part,sourceInput,amountInput} = row;
    const maximum = sourceMaximum(String(sourceInput?.value || ''), part);
    if (maximum == null || !amountInput) return;
    if (numberValue(amountInput.value) > maximum) amountInput.value = moneyInputText(maximum);
  }

  function appendEmptyRow(amount = null) {
    if (!rowsHost) return null;
    rowsHost.insertAdjacentHTML('beforeend', allocationRow(nextIndex++, wallets, deposits, personalAccount, { amount }));
    const row = rows().at(-1);
    if (row) bindRow(row);
    return row || null;
  }

  function syncRows() {
    const plan = nextPaymentAllocation(total, rowValues());
    const all = rows();
    const empty = all.filter(row => !String(row.sourceInput?.value || ''));
    // Keep at most one trailing placeholder. Never recreate selected fields:
    // typing, focus and manually entered amounts must survive an update.
    let pending = plan.needed ? empty.at(-1) : null;
    for (const row of empty) if (row !== pending) row.part.remove();
    if (plan.needed && !pending) pending = appendEmptyRow(plan.suggested);
    if (pending) {
      if (rowsHost && rowsHost.lastElementChild !== pending.part) rowsHost.appendChild(pending.part);
      if (pending.amountInput) {
        pending.amountInput.readOnly = true;
        pending.amountInput.value = plan.suggested == null ? '' : moneyInputText(plan.suggested);
      }
    }
  }

  function sync() {
    const current = state();
    syncRows();
    if (remainingNode) remainingNode.innerHTML = totalReceipt('К оплате', current.remaining);
    if (tipsRow) {
      tipsRow.hidden = current.tips <= 0.009;
      tipsRow.innerHTML = current.tips > 0.009 ? totalReceipt('Tips', current.tips) : '';
    }
    if (submit) submit.disabled = !current.valid;
    onChange?.(current);
    return current;
  }

  function bindRow(row) {
    const {part,sourceInput,amountInput} = row;
    if (part.dataset.paymentAllocationReady === 'true') return;
    part.dataset.paymentAllocationReady = 'true';
    sourceInput?.addEventListener('change', () => {
      const value = String(sourceInput.value || '');
      if (amountInput) {
        amountInput.readOnly = !value;
        const remaining = paymentAllocationRemainder(total,rowValues(part));
        const maximum = sourceMaximum(value,part);
        // Initial wallet selection pulls the unpaid amount. A limited source
        // pulls only the available balance; the next row receives the rest.
        amountInput.value = value ? moneyInputText(maximum == null ? remaining : Math.min(remaining,maximum)) : '';
      }
      sync();
    });
    amountInput?.addEventListener('input', () => {
      clampSourceAmount(row);
      sync();
    });
    amountInput?.addEventListener('blur', () => {
      const value = numberValue(amountInput.value);
      amountInput.value = value > 0 ? moneyInputText(value) : '';
      sync();
    });
  }

  rows().forEach(bindRow);

  submit?.addEventListener('click', () => {
    const current = state();
    if (!current.valid) return;
    onPay?.({
      allocations: current.allocations,
      depositAllocations: current.depositAllocations,
      personalAccountAmount: current.personalAccountAmount,
      receivedAmount: current.received,
      cashReceivedAmount: current.cashReceived,
      depositReceivedAmount: current.depositReceived,
      personalAccountReceivedAmount: current.personalAccountReceived,
      appliedAmount: current.applied,
      tips: current.tips,
    });
  });
  const initial = sync();
  return { state, sync, initial };
}
