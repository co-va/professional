import { inventoryStockBalanceInThresholdUnits } from './completeness.js';

// One compound filter for canonical InventoryItem fields. No custom visual
// controls: the Stock section renders this model via shared Select/Field.
export const EMPTY_STOCK_FILTERS = Object.freeze({
  type: '', category: '', location: '', unit: '', usage: '',
  supplier: '', availability: '', price: '', tare: '',
  name: '', sku: '', barcode: '', position: '', minStock: '',
  targetStock: '', packageQuantity: '', grossWeight: '', tareWeight: '',
});
export const emptyStockFilters = () => ({ ...EMPTY_STOCK_FILTERS });
export const hasStockFilters = filters =>
  Object.keys(EMPTY_STOCK_FILTERS).some(key => String(filters?.[key] ?? '').trim() !== '');

const norm = value => String(value ?? '').trim().toLocaleLowerCase('ru-RU');
const numberMatches = (value, criterion) =>
  !String(criterion ?? '').trim() || (value != null
    && value !== '' && Number(value) === Number(String(criterion).replace(',', '.')));
const supplierNames = item => [
  item.supplier, item.primarySupplier,
  ...(Array.isArray(item.supplierOffers)
    ? item.supplierOffers.map(offer => offer.supplier) : []),
].filter(Boolean).map(String);
const usageCode = item => item.canConsume !== false && item.canSell === true ? 'both'
  : item.canConsume !== false ? 'consume' : item.canSell === true ? 'sale' : 'track';

export function matchesStockFilters(item = {}, filters = {}) {
  if (filters.type && norm(item.productType || item.category) !== norm(filters.type)) return false;
  if (filters.category && norm(item.category) !== norm(filters.category)) return false;
  if (filters.location && norm(item.location) !== norm(filters.location)) return false;
  if (filters.unit && norm(item.unit) !== norm(filters.unit)) return false;
  if (filters.usage && usageCode(item) !== filters.usage) return false;
  if (filters.supplier && !supplierNames(item).some(x => norm(x) === norm(filters.supplier))) return false;
  if (filters.name && !norm(item.name).includes(norm(filters.name))) return false;
  if (filters.sku && !norm(item.sku).includes(norm(filters.sku))) return false;
  if (filters.barcode && !norm(item.barcode).includes(norm(filters.barcode))) return false;
  if (filters.price) {
    const known = [item.basePrice, item.referencePrice, item.lastPurchasePrice]
      .some(x => x != null && x !== '' && Number.isFinite(Number(x)));
    if ((filters.price === 'known') !== known) return false;
  }
  if (filters.tare) {
    const known = item.tareWeight != null && item.tareWeight !== ''
      && Number.isFinite(Number(item.tareWeight));
    if ((filters.tare === 'known') !== known) return false;
  }
  if (filters.availability) {
    const balance = Number(item.balance) || 0;
    if (filters.availability === 'zero' && balance > 0) return false;
    if (filters.availability === 'positive' && balance <= 0) return false;
    if (filters.availability === 'minimum' || filters.availability === 'target') {
      const threshold = filters.availability === 'minimum' ? item.minStock : item.targetStock;
      const actual = inventoryStockBalanceInThresholdUnits(item);
      if (threshold == null || threshold === '' || actual == null
        || actual > Number(threshold) + 1e-9) return false;
    }
  }
  return [
    ['position', item.position], ['minStock', item.minStock],
    ['targetStock', item.targetStock], ['packageQuantity', item.packageQuantity],
    ['grossWeight', item.grossWeight], ['tareWeight', item.tareWeight],
  ].every(([key, value]) => numberMatches(value, filters[key]));
}

export function stockFilterOptions(items = [], extract = item => '') {
  const options = new Set();
  for (const item of items) {
    const value = extract(item);
    for (const option of Array.isArray(value) ? value : [value]) {
      if (option != null && String(option).trim()) options.add(String(option).trim());
    }
  }
  return [...options].sort((a, b) => a.localeCompare(b, 'ru', {
    sensitivity: 'base', numeric: true,
  }));
}
export const stockSupplierNames = supplierNames;
