import { getWalletDDSMovements } from '../read.js';
import { queueAuxiliaryDataset } from '../../business-persistence.js';

const SYSTEM_WALLETS = [
  { id: 'cash', name: 'Наличные', photo: '', system: true },
  { id: 'cashless', name: 'Безналичные', photo: '', system: true },
];
let walletsState = [];

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function readRaw() {
  return clone(walletsState);
}

function write(value) {
  walletsState = Array.isArray(value) ? clone(value) : [];
  void queueAuxiliaryDataset('wallets', walletsState);
}

export function hydrateWalletsFromServer(value = []) {
  walletsState = Array.isArray(value) ? clone(value) : [];
  return clone(walletsState);
}

export function getWallets() {
  const stored = readRaw();
  if (!stored.length) {
    write(SYSTEM_WALLETS);
    return SYSTEM_WALLETS.map((wallet) => ({ ...wallet }));
  }
  const ids = new Set(stored.map((wallet) => String(wallet?.id || '')));
  const withSystem = [
    ...SYSTEM_WALLETS.filter((wallet) => !ids.has(wallet.id)),
    ...stored,
  ];
  if (withSystem.length !== stored.length) write(withSystem);
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
