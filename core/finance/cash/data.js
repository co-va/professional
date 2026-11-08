import { getWalletDDSMovements } from '../read.js';
import { queueAuxiliaryDataset } from '../../business-persistence.js';

const SYSTEM_WALLETS = [
  { id: 'cash', name: 'Наличные', photo: '', system: true },
  { id: 'cashless', name: 'Безналичные', photo: '', system: true },
];
let walletsState = [];
let walletsHydrated = false;

// A cold/partial read must never create a persisted replacement for an
// existing tenant wallet catalog. The server is the source of truth.
if (typeof window !== 'undefined') {
  window.addEventListener('professional:auth-logout', () => {
    walletsState = [];
    walletsHydrated = false;
  });
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function readRaw() {
  return clone(walletsState);
}

function write(value) {
  if (!walletsHydrated) throw new Error('Кошельки ещё не загружены с сервера');
  if (!Array.isArray(value)) throw new Error('Некорректные данные кошельков');
  walletsState = clone(value);
  void queueAuxiliaryDataset('wallets', walletsState);
}

export function hydrateWalletsFromServer(value = []) {
  if (!Array.isArray(value)) throw new Error('Сервер вернул некорректный список кошельков');
  walletsState = clone(value);
  walletsHydrated = true;
  return clone(walletsState);
}

export function getWallets() {
  if (!walletsHydrated) return [];
  const stored = readRaw();
  const ids = new Set(stored.map((wallet) => String(wallet?.id || '')));
  // System wallets are virtual defaults until the user explicitly saves a
  // wallet change; merely viewing Finance, Loyalty or Person must never write.
  const withSystem = [
    ...SYSTEM_WALLETS.filter((wallet) => !ids.has(wallet.id)),
    ...stored,
  ];
  return withSystem.filter((wallet) => !wallet.deletedAt).map((wallet) => ({ ...wallet }));
}

export function getWalletHistory(id) {
  return getWalletDDSMovements(id);
}

export function getWalletBalance(id) {
  return getWalletHistory(id).reduce((sum, movement) => {
    const value = Number(movement?.total);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
}

export function getWalletTotalBalance() {
  return getWallets().reduce((sum, wallet) => sum + getWalletBalance(wallet.id), 0);
}

export function saveWallet(wallet) {
  const values = getWallets();
  const exists = values.some((item) => item.id === wallet.id);
  write(exists ? values.map((item) => item.id === wallet.id ? wallet : item) : [...values, wallet]);
  return wallet;
}

export function updateWallet(id, patch) {
  const values = getWallets();
  const current = values.find((item) => item.id === id);
  if (!current) return null;
  const updated = { ...current, ...patch, id: current.id, system: Boolean(current.system), updatedAt: new Date().toISOString() };
  write(values.map((item) => item.id === id ? updated : item));
  return updated;
}

export function deleteWallet(id) {
  const values = getWallets();
  const current = values.find((item) => item.id === id);
  if (!current || current.system || Math.abs(getWalletBalance(id)) > 0.009) return false;
  const deletedAt = new Date().toISOString();
  write(values.map((item) => item.id === id ? { ...item, deletedAt, updatedAt: deletedAt } : item));
  return true;
}

export function deleteWalletPermanently(id) {
  const values = readRaw();
  const current = values.find((item) => item.id === id);
  if (!current || current.system) return false;
  write(values.filter((item) => item.id !== id));
  return true;
}
