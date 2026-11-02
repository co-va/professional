import { queueAuxiliaryDataset } from '../../../core/business-persistence.js';

let productsState = [];
let historyState = [];

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
