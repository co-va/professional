import { inventoryStockBalanceInThresholdUnits } from './completeness.js';

// One compound filter for canonical InventoryItem fields. No custom visual
// controls: the Stock section renders this model via shared Select/Field.
export const EMPTY_STOCK_FILTERS = Object.freeze({
  type: '', category: '', group: '', unit: '', usage: '',
  supplier: '', availability: '', price: '', tare: '',
  name: '', sku: '', barcode: '', position: '', minStock: '',
  targetStock: '', packageQuantity: '', grossWeight: '',
});
export const emptyStockFilters = () => ({ ...EMPTY_STOCK_FILTERS });
export const hasStockFilters = filters =>
  Object.keys(EMPTY_STOCK_FILTERS).some(key => String(filters?.[key] ?? '').trim() !== '');

export const STOCK_FILLED = '__filled__';
export const STOCK_EMPTY = '__empty__';
const norm = value => String(value ?? '').trim().toLocaleLowerCase('ru-RU');
const hasValue = value => value != null && String(value).trim() !== '';
const isPresence = value => value === STOCK_FILLED || value === STOCK_EMPTY;
const matchesPresence = (value, criterion) => !criterion
  || (criterion === STOCK_FILLED && hasValue(value))
  || (criterion === STOCK_EMPTY && !hasValue(value));
const matchesChoice = (value, criterion) => !criterion
  || (isPresence(criterion) ? matchesPresence(value, criterion) : norm(value) === norm(criterion));
const supplierNames = item => [
  item.supplier, item.primarySupplier,
  ...(Array.isArray(item.supplierOffers)
    ? item.supplierOffers.map(offer => offer.supplier) : []),
].filter(Boolean).map(String);
const usageCode = item => item.canConsume !== false && item.canSell === true ? 'both'
  : item.canConsume !== false ? 'consume' : item.canSell === true ? 'sale' : 'track';

export function matchesStockFilters(item = {}, filters = {}, classificationGroups = []) {
  if (filters.group) {
    const byId = new Map(classificationGroups.map(group => [String(group.groupId), group]));
    let id = String(item.classificationGroupId || '');
    const seen = new Set();
    let belongs = false;
    while (id && !seen.has(id)) {
      if (id === String(filters.group)) { belongs = true; break; }
      seen.add(id);
      id = String(byId.get(id)?.parentGroupId || '');
    }
    if (!belongs) return false;
  }
  const typeValue = isPresence(filters.type) ? item.productType : item.productType || item.category;
  if (!matchesChoice(typeValue, filters.type)) return false;
  if (!matchesChoice(item.category, filters.category)) return false;
  if (!matchesChoice(item.unit, filters.unit)) return false;
  if (filters.usage && usageCode(item) !== filters.usage) return false;
  const suppliers = supplierNames(item);
  if (isPresence(filters.supplier)) {
    if (!matchesPresence(suppliers.length ? suppliers.join(', ') : '', filters.supplier)) return false;
  } else if (filters.supplier && !suppliers.some(x => norm(x) === norm(filters.supplier))) return false;
  if (!matchesPresence(item.name, filters.name)) return false;
  if (!matchesPresence(item.sku, filters.sku)) return false;
  if (!matchesPresence(item.barcode, filters.barcode)) return false;
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
  const position = Number.isSafeInteger(Number(item.position)) && Number(item.position) > 0
    ? item.position : null;
  return [
    ['position', position], ['minStock', item.minStock],
    ['targetStock', item.targetStock], ['packageQuantity', item.packageQuantity],
    ['grossWeight', item.grossWeight],
  ].every(([key, value]) => matchesPresence(value, filters[key]));
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
