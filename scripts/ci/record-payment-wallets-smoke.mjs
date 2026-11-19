import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const stripImports = (source) => source
  .replace(/^import\s+[\s\S]*?\sfrom\s+['"][^'"]+['"];\s*/gm, '')
  .replace(/^export\s+/gm, '');

const walletSource = read('core/finance/cash/data.js');
const auxiliarySource = read('core/runtime/auxiliary-state.js');
const paymentSource = read('core/payment/record-payment.js');
const financeSource = read('core/finance/finance.js');

const writes = [];
const listeners = new Map();
const fakeWindow = { addEventListener(name, callback) {
  const callbacks = listeners.get(name) || [];
  callbacks.push(callback);
  listeners.set(name, callbacks);
} };
const logout = () => (listeners.get('professional:auth-logout') || []).forEach((callback) => callback());
const wallets = new Function('window', 'getWalletDDSMovements', 'queueAuxiliaryDataset',
  stripImports(walletSource) + '\nreturn { getWallets, hydrateWalletsFromServer, saveWallet };')(
    fakeWindow, () => [], (...args) => writes.push(args),
  );

const actual = [
  { id: 'cash', name: 'Наличные', system: true },
  { id: 'cashless', name: 'Безналичные', system: true },
  { id: 'existing-a', name: 'Карта', photo: 'photo-a', cardAppearance: { test: true } },
  { id: 'existing-b', name: 'Расчётный счёт' },
];
const requests = [];
let remote = { wallets: actual, investments: [], loans: [] };
let rejectRequest = false;
const auxiliary = new Function('apiRequest', 'getWallets', 'hydrateCashEntitiesFromServer',
  'hydrateFinanceFromServer', 'hydrateWalletsFromServer', 'hydrateProductsFromServer',
  'hydrateTagsFromServer', 'hydrateCardAppearanceTemplates', 'window',
  stripImports(auxiliarySource) + '\nreturn { loadWalletCatalog, loadAuxiliaryState };')(
    async (path) => {
      requests.push(path);
      if (rejectRequest) throw new Error('Network unavailable');
      return { ok: true, json: async () => remote };
    },
    wallets.getWallets, () => {}, () => {}, wallets.hydrateWalletsFromServer,
    () => {}, () => {}, () => {}, fakeWindow,
  );

assert.deepEqual(wallets.getWallets(), [], 'Cold Journal must begin without hydrated wallet data');
const [loaded, concurrent] = await Promise.all([
  auxiliary.loadWalletCatalog(),
  auxiliary.loadWalletCatalog(),
]);
assert.deepEqual(loaded, actual, 'Payment must receive every existing wallet and original ID');
assert.deepEqual(concurrent, actual);
assert.deepEqual(requests, ['/auxiliary-state/finance'], 'Concurrent entries share one authoritative request');
assert.deepEqual(writes, [], 'Reading wallets must never overwrite the server catalog');

logout();
assert.deepEqual(wallets.getWallets(), [], 'Logout must clear the previous tenant wallet cache');
remote = { investments: [] };
await assert.rejects(auxiliary.loadWalletCatalog(), /не вернул список кошельков/);
assert.deepEqual(wallets.getWallets(), []);
assert.deepEqual(writes, []);
remote = { wallets: actual, investments: [], loans: [] };
assert.deepEqual(await auxiliary.loadWalletCatalog(), actual, 'A malformed response must not poison retries');

logout();
rejectRequest = true;
await assert.rejects(auxiliary.loadWalletCatalog(), /Network unavailable/);
assert.deepEqual(wallets.getWallets(), []);
rejectRequest = false;
assert.deepEqual(await auxiliary.loadWalletCatalog(), actual, 'Network failure must allow a new request');

logout();
remote = { wallets: [], investments: [], loans: [] };
const defaults = await auxiliary.loadWalletCatalog();
assert.deepEqual(defaults.map((item) => item.id), ['cash', 'cashless'],
  'A confirmed empty catalog exposes the existing virtual defaults; not new invented wallet IDs');
assert.deepEqual(writes, [], 'Default read must not persist anything');

const entry = paymentSource.slice(paymentSource.indexOf('async function openPaymentEntry('), paymentSource.indexOf('async function openPaymentCorrection('));
const correction = paymentSource.slice(paymentSource.indexOf('async function openPaymentCorrection('), paymentSource.indexOf('async function openPaymentRefund('));
const refund = paymentSource.slice(paymentSource.indexOf('async function openPaymentRefund('), paymentSource.indexOf('function openPaymentDeletion('));
for (const [name, code] of [['entry', entry], ['correction', correction], ['refund', refund]]) {
  assert.ok(code.length > 0, name + ' must exist');
  assert.match(code, /loadWalletCatalog\(\)/, name + ' must load actual wallets');
  assert.doesNotMatch(code, /getWallets\(\)/, name + ' must never read a cold wallet cache');
}
assert.match(entry, /\[wallets\]\s*=\s*await Promise\.all\(/);
assert.match(entry, /paymentMethods\(\{ wallets, deposits, personalAccount, total,/);
assert.match(correction, /\[wallets, deposits\]\s*=\s*await Promise\.all\(/);
assert.match(correction, /paymentMethods\(\{ wallets, deposits, total:/);
assert.match(refund, /wallets = await loadWalletCatalog\(\)/);
assert.match(financeSource, /Promise\.all\(\[loadFinanceState\(\), loadWalletCatalog\(\)\]\)/);
console.log('PASS: cold Journal payment, existing wallet identities, concurrent loading, malformed response, retry, logout, no writes, correction and refund');
