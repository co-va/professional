import { apiRequest } from '../../auth.js';
import { flushBusinessPersistence } from '../../business-persistence.js';
import { getWallets, hydrateWalletsFromServer } from './data.js';
import { getLedgerEntries } from '../read.js';

const text = (value) => String(value ?? '').trim();
const arr = (value) => Array.isArray(value) ? value : [];

// A wallet is recoverable only if a historical Finance operation contains its
// original wallet ID AND a recorded name. Missing photos/metadata need a backup.
export function missingWalletsFromFinanceHistory(wallets, finance) {
  const existing = new Set(arr(wallets).map((item) => text(item?.id)).filter(Boolean));
  const names = new Map();
  const record = (idValue, nameValue) => {
    const id = text(idValue);
    const name = text(nameValue);
    if (id && name && !existing.has(id) && id !== 'cash' && id !== 'cashless') {
      names.set(id, name);
    }
  };
  const operations = arr(finance?.operations)
    .slice().sort((a, b) => text(a?.occurredAt).localeCompare(text(b?.occurredAt)));
  for (const operation of operations) {
    const data = operation?.data && typeof operation.data === 'object' ? operation.data : {};
    record(data.walletId, data.walletName);
    record(data.fromWalletId, data.fromWalletName);
    record(data.toWalletId, data.toWalletName);
    for (const allocation of arr(data.allocations)) {
      record(allocation?.walletId, allocation?.walletName);
    }
    for (const allocation of arr(data.walletAllocations)) {
      record(allocation?.walletId, allocation?.walletName);
    }
  }
  const ledger = arr(finance?.ledger)
    .slice().sort((a, b) => text(a?.occurredAt).localeCompare(text(b?.occurredAt)));
  for (const entry of ledger) record(entry?.walletId, entry?.walletName);
  return [...names.entries()].map(([id, name]) => ({ id, name, photo: '', system: false }));
}

async function readResponse(response, fallback) {
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || fallback);
  return data;
}

let inFlight = null;

async function restoreWalletsFromFinanceHistory() {
  // On ordinary visits, avoid extra API reads and writes unless the loaded
  // Finance ledger actually references a wallet missing from the current UI.
  const present = new Set(getWallets().map((item) => text(item?.id)));
  const missing = getLedgerEntries().some((item) => {
    const id = text(item?.walletId);
    return id && id !== 'cash' && id !== 'cashless' && !present.has(id);
  });
  if (!missing) return { status: 'unchanged', recovered: [] };

  // Flush preceding client mutations before taking fresh server snapshots.
  await flushBusinessPersistence();
  const [auxiliary, finance] = await Promise.all([
    apiRequest('/auxiliary-state/finance').then((r) => readResponse(r, 'Не удалось загрузить исходные кошельки')),
    apiRequest('/finance').then((r) => readResponse(r, 'Не удалось загрузить историю операций')),
  ]);
  if (!Array.isArray(auxiliary?.wallets) || !Array.isArray(finance?.ledger)
    || !Array.isArray(finance?.operations)) {
    throw new Error('Сервер вернул неполные финансовые данные. Восстановление не выполнялось');
  }
  const candidates = missingWalletsFromFinanceHistory(auxiliary.wallets, finance);
  if (!candidates.length) {
    const storedIDs = new Set(auxiliary.wallets.map((item) => text(item?.id)));
    // A soft-deleted wallet is intentionally hidden from getWallets() but still
    // exists on the server; do not flag it as lost or resurrect it.
    const unknownID = finance.ledger.some((item) => {
      const id = text(item?.walletId);
      return id && id !== 'cash' && id !== 'cashless' && !storedIDs.has(id);
    });
    return { status: unknownID ? 'not-found' : 'unchanged', recovered: [] };
  }

  // Recheck the original list before any PUT, so a concurrent wallet edit
  // causes a safe abort rather than overwriting another device's changes.
  const latest = await apiRequest('/auxiliary-state/finance')
    .then((r) => readResponse(r, 'Не удалось перепроверить кошельки'));
  if (!Array.isArray(latest?.wallets)) {
    throw new Error('Не удалось проверить текущий список кошельков');
  }
  if (JSON.stringify(latest.wallets) !== JSON.stringify(auxiliary.wallets)) {
    return { status: 'changed', recovered: [] };
  }
  const latestIDs = new Set(latest.wallets.map((item) => text(item?.id)));
  const restored = candidates.filter((item) => !latestIDs.has(item.id));
  if (!restored.length) return { status: 'unchanged', recovered: [] };
  // The API accepts the complete catalog, so preserve every existing row,
  // including soft-deleted rows, unchanged; append only genuinely missing IDs.
  const next = [...latest.wallets, ...restored];
  const saved = await apiRequest('/auxiliary-state/wallets', {
    method: 'PUT',
    body: JSON.stringify({ value: next }),
  }).then((r) => readResponse(r, 'Не удалось восстановить кошельки'));
  if (!Array.isArray(saved?.wallets)) {
    throw new Error('Сервер не подтвердил сохранение кошельков');
  }
  const confirmed = new Set(saved.wallets.map((item) => text(item?.id)));
  if (restored.some((item) => !confirmed.has(item.id))) {
    throw new Error('Часть кошельков не подтвердилась после сохранения');
  }
  hydrateWalletsFromServer(saved.wallets);
  return { status: 'restored', recovered: restored.map(({ id, name }) => ({ id, name })) };
}

// Only one recovery attempt runs per mounted application; all repeated visits
// await it. Failed attempts can retry after a subsequent Finance opening.
export function recoverMissingWalletsFromFinanceHistory() {
  if (!inFlight) {
    inFlight = restoreWalletsFromFinanceHistory().catch((error) => {
      inFlight = null;
      throw error;
    });
  }
  return inFlight;
}
