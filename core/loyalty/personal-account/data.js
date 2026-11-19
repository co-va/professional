import { apiRequest } from '../../auth.js';

let accounts = [];

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value ?? '').trim();
}

function money(value) {
  const number = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(number) ? Math.round(Math.max(0, number) * 100) / 100 : 0;
}

async function payload(response, fallback) {
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value?.message || fallback);
  return value;
}

function normalizeAccount(value = {}) {
  const account = clone(value) || {};
  account.personKey = text(account.personKey);
  account.balance = money(account.balance);
  account.debtTotal = money(account.debtTotal);
  account.spendLimitPercent = Math.max(0, Math.min(100, Number(account.spendLimitPercent ?? 100) || 0));
  account.visibleToEndUser = account.visibleToEndUser !== false;
  account.movements = list(account.movements).map((item) => ({
    ...clone(item),
    amount: money(item?.amount),
    balanceAfter: money(item?.balanceAfter),
    direction: text(item?.direction).toUpperCase(),
  }));
  account.debts = list(account.debts).map((item) => ({
    ...clone(item),
    originalAmount: money(item?.originalAmount),
    outstandingAmount: money(item?.outstandingAmount),
  }));
  return account;
}

function upsertAccount(value) {
  const account = normalizeAccount(value);
  if (!account.personKey) return account;
  const index = accounts.findIndex((item) => item.personKey === account.personKey);
  if (index >= 0) accounts[index] = account;
  else accounts.push(account);
  return clone(account);
}

export function getPersonalAccounts() {
  return accounts.map((item) => clone(item));
}

export function getCachedPersonalAccount(personKey = '') {
  const key = text(personKey);
  const account = accounts.find((item) => item.personKey === key) || null;
  return clone(account);
}

export async function loadPersonalAccounts() {
  const values = await payload(await apiRequest('/loyalty/personal-accounts'), 'Не удалось загрузить Личные счета');
  accounts = list(values).map(normalizeAccount).filter((item) => item.personKey);
  return getPersonalAccounts();
}

export async function loadPersonalAccount(personKey = '') {
  const key = text(personKey);
  if (!key) return null;
  const value = await payload(
    await apiRequest(`/loyalty/personal-accounts/person/${encodeURIComponent(key)}`),
    'Не удалось загрузить Личный счёт',
  );
  return upsertAccount(value);
}

export async function updatePersonalAccountSettings(personKey = '', settings = {}) {
  const key = text(personKey);
  if (!key) return null;
  const value = await payload(
    await apiRequest(`/loyalty/personal-accounts/person/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify({
        spendLimitPercent: settings?.spendLimitPercent,
        visibleToEndUser: settings?.visibleToEndUser,
      }),
    }),
    'Не удалось сохранить настройки Личного счёта',
  );
  return upsertAccount(value);
}

export async function fundPersonalAccount(personKey = '', input = {}) {
  const key = text(personKey);
  if (!key || !input?.occurredAt) return null;
  const value = await payload(
    await apiRequest(`/loyalty/personal-accounts/person/${encodeURIComponent(key)}/fund`, {
      method: 'POST',
      body: JSON.stringify({
        amount: money(input.amount),
        walletId: text(input.walletId),
        walletName: text(input.walletName),
        note: text(input.note),
        method: text(input.method),
        provider: text(input.provider),
        providerPaymentId: text(input.providerPaymentId),
        occurredAt: input.occurredAt instanceof Date ? input.occurredAt.toISOString() : input.occurredAt,
      }),
    }),
    'Не удалось пополнить Личный счёт',
  );
  return upsertAccount(value);
}

export async function withdrawPersonalAccount(personKey = '', input = {}) {
  const key = text(personKey);
  if (!key || !input?.occurredAt) return null;
  const value = await payload(
    await apiRequest(`/loyalty/personal-accounts/person/${encodeURIComponent(key)}/withdraw`, {
      method: 'POST',
      body: JSON.stringify({
        amount: money(input.amount),
        walletId: text(input.walletId),
        walletName: text(input.walletName),
        reason: text(input.reason),
        method: text(input.method),
        provider: text(input.provider),
        providerPaymentId: text(input.providerPaymentId),
        occurredAt: input.occurredAt instanceof Date ? input.occurredAt.toISOString() : input.occurredAt,
      }),
    }),
    'Не удалось вернуть деньги с Личного счёта',
  );
  return upsertAccount(value);
}

export async function payFromPersonalAccount(personKey = '', input = {}) {
  const key = text(personKey);
  if (!key || !input?.occurredAt) return null;
  const value = await payload(
    await apiRequest(`/loyalty/personal-accounts/person/${encodeURIComponent(key)}/pay`, {
      method: 'POST',
      body: JSON.stringify({
        source: input.source,
        person: input.person,
        workplace: text(input.workplace),
        settlement: input.settlement,
        amount: money(input.amount),
        occurredAt: input.occurredAt instanceof Date ? input.occurredAt.toISOString() : input.occurredAt,
      }),
    }),
    'Не удалось списать Личный счёт',
  );
  if (value?.account) upsertAccount(value.account);
  return clone(value);
}

export async function finalizePersonalAccountDebt(personKey = '', input = {}) {
  const key = text(personKey);
  if (!key) return null;
  const value = await payload(
    await apiRequest(`/loyalty/personal-accounts/person/${encodeURIComponent(key)}/finalize-debt`, {
      method: 'POST',
      body: JSON.stringify({ source: input.source, occurredAt: input.occurredAt }),
    }),
    'Не удалось зафиксировать задолженность',
  );
  if (value?.account) upsertAccount(value.account);
  else if (value?.personKey) upsertAccount(value);
  return clone(value);
}

export async function settlePersonalAccountDebt(debtId = '', input = {}) {
  const id = text(debtId);
  if (!id || !input?.occurredAt) return null;
  const value = await payload(
    await apiRequest(`/loyalty/personal-accounts/debts/${encodeURIComponent(id)}/settle`, {
      method: 'POST',
      body: JSON.stringify({
        amount: money(input.amount),
        walletId: text(input.walletId),
        walletName: text(input.walletName),
        note: text(input.note),
        method: text(input.method),
        provider: text(input.provider),
        providerPaymentId: text(input.providerPaymentId),
        occurredAt: input.occurredAt instanceof Date ? input.occurredAt.toISOString() : input.occurredAt,
      }),
    }),
    'Не удалось погасить задолженность',
  );
  return upsertAccount(value);
}

export async function refundPersonalAccountPayment(operationId = '', input = {}) {
  const id = text(operationId);
  if (!id || !input?.occurredAt) return null;
  const value = await payload(
    await apiRequest(`/loyalty/personal-accounts/payment/${encodeURIComponent(id)}/refund`, {
      method: 'POST',
      body: JSON.stringify({
        amount: input.amount == null ? null : money(input.amount),
        reason: text(input.reason),
        occurredAt: input.occurredAt instanceof Date ? input.occurredAt.toISOString() : input.occurredAt,
      }),
    }),
    'Не удалось вернуть оплату на Личный счёт',
  );
  return upsertAccount(value);
}
