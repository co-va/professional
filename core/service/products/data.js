import { queueAuxiliaryDataset, isBusinessServerReady } from '../../../core/business-persistence.js';
import { commitServiceCollection, replaceServiceItem, changeServiceItemWorkplace } from '../workplace-assignment.js';

let productsState = [];
let historyState = [];

if (typeof window !== 'undefined') {
  window.addEventListener('professional:auth-logout', () => {
    productsState = [];
    historyState = [];
  });
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function readRawProducts() {
  return clone(productsState);
}

function readHistory() {
  return clone(historyState);
}

function writeProducts(value) {
  productsState = Array.isArray(value) ? clone(value) : [];
  void queueAuxiliaryDataset('products', productsState);
}

function writeHistory(value) {
  historyState = Array.isArray(value) ? clone(value) : [];
  void queueAuxiliaryDataset('productHistory', historyState);
}

export function hydrateProductsFromServer({ products = [], productHistory = [] } = {}) {
  productsState = Array.isArray(products) ? clone(products) : [];
  historyState = Array.isArray(productHistory) ? clone(productHistory) : [];
  return { products: clone(productsState), productHistory: clone(historyState) };
}

export function getProducts() {
  return readRawProducts().filter((item) => !item.deletedAt);
}

export function saveProduct(item) {
  const values = readRawProducts();
  const exists = values.some((value) => value.id === item.id);
  writeProducts(exists ? values.map((value) => value.id === item.id ? item : value) : [...values, item]);
  return item;
}

export function pushProductHistory(record, action) {
  const history = readHistory();
  history.push({ ...record, historyAction: action, historyAt: new Date().toISOString() });
  writeHistory(history);
}

export function deleteProduct(id) {
  const values = readRawProducts();
  const found = values.find((item) => item.id === id && !item.deletedAt);
  if (!found) return false;
  pushProductHistory(found, 'deleted');
  writeProducts(values.map((item) => item.id === id ? { ...item, deletedAt: new Date().toISOString() } : item));
  return true;
}

export function reorderProducts(ids = []) {
  const order = (Array.isArray(ids) ? ids : []).map((value) => String(value || '')).filter(Boolean);
  const values = readRawProducts();
  const active = values.filter((item) => !item.deletedAt);
  if (order.length !== active.length || new Set(order).size !== active.length) return false;
  const byId = new Map(active.map((item) => [String(item.id || ''), item]));
  if (order.some((id) => !byId.has(id))) return false;
  const deleted = values.filter((item) => item.deletedAt);
  writeProducts([...order.map((id) => byId.get(id)), ...deleted]);
  return true;
}

// Reset all local overrides in one domain-owned write when a shared card
// template is applied. No per-entity queue/serialization storm.

export async function commitReorderProducts(ids = []) {
  const order = (Array.isArray(ids) ? ids : []).map(id => String(id || '')).filter(Boolean);
  await commitServiceCollection({
    read: readRawProducts,
    persist: (values) => queueAuxiliaryDataset('products', values),
    hydrate: (values) => { productsState = clone(values); },
    mutate: (values) => {
      const active = values.filter(item => !item.deletedAt);
      const byId = new Map(active.map(item => [String(item.id || ''), item]));
      if (order.length !== active.length || new Set(order).size !== active.length
        || order.some(id => !byId.has(id))) throw new Error('Список изменился. Откройте раздел повторно.');
      if (order.every((id, i) => String(active[i].id) === id)) return values;
      const deleted = values.filter(item => item.deletedAt);
      return [...order.map(id => byId.get(id)), ...deleted];
    },
  });
}

export function resetProductCardAppearances() {
  const values = readRawProducts();
  let changed = 0;
  const updated = values.map((item) => {
    if (item.deletedAt || !item.cardAppearance || !Object.keys(item.cardAppearance).length) return item;
    changed += 1;
    return { ...item, cardAppearance: {}, updatedAt: new Date().toISOString() };
  });
  if (changed) writeProducts(updated);
  return changed;
}


async function commitProductHistory(previous, action = 'updated') {
  if (!previous) return;
  // The product operation already succeeded. A history failure must never
  // report the product itself as unsaved or leave its Q/X draft out of sync.
  if (!isBusinessServerReady()) return false;
  const next = [...readHistory(), {
    ...previous, historyAction: action, historyAt: new Date().toISOString(),
  }];
  try {
    const result = await queueAuxiliaryDataset('productHistory', next);
    if (result?.ok === false) throw result.error || new Error('Сервер отклонил историю.');
    historyState = clone(next);
  } catch (error) {
    // Existing persistence queue emits the canonical error notification.
    // Do not reject the acknowledged Product save for its independent history.
    return false;
  }
  return true;
}

export async function commitProduct(item) {
  const previous = readRawProducts().find((value) => value.id === item.id && !value.deletedAt);
  await commitServiceCollection({
    read: readRawProducts,
    persist: (values) => queueAuxiliaryDataset('products', values),
    hydrate: (values) => { productsState = clone(values); },
    mutate: (values) => replaceServiceItem(values, item),
  });
  await commitProductHistory(previous);
  return item;
}

export async function commitProductWorkplace(entityId, workplaceId, assignment) {
  const previous = readRawProducts().find((value) => String(value.id) === String(entityId) && !value.deletedAt);
  await commitServiceCollection({
    read: readRawProducts,
    persist: (values) => queueAuxiliaryDataset('products', values),
    hydrate: (values) => { productsState = clone(values); },
    mutate: (values) => changeServiceItemWorkplace(values, entityId, workplaceId, assignment),
  });
  await commitProductHistory(previous);
}

export async function commitDeleteProduct(id) {
  const key = String(id || '');
  const previous = readRawProducts().find((value) => String(value.id) === key && !value.deletedAt);
  if (!previous) throw new Error('Товар уже удалён.');
  await commitServiceCollection({
    read: readRawProducts,
    persist: (values) => queueAuxiliaryDataset('products', values),
    hydrate: (values) => { productsState = clone(values); },
    mutate: (values) => values.map((value) => String(value.id) === key
      ? { ...value, deletedAt: new Date().toISOString() } : value),
  });
  await commitProductHistory(previous, 'deleted');
}
