import { queueAuxiliaryDataset, isBusinessServerReady } from '../../../core/business-persistence.js';
import { commitServiceCollection, replaceServiceItem, changeServiceItemWorkplace, changeWorkplaceAssignment } from '../workplace-assignment.js';
import { getInventoryItems } from '../../inventory/data.js';

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

// Inventory is the only source for stocked sale products. The legacy Service
// catalog is retained read-only to preserve records made before this migration.
// Store the final retail price as a Service-only overlay keyed by the
// existing inventory identity. Inventory continues to own cost, markup,
// stock quantity, and its own calculated sale price.
function stockPriceOverride(linked) {
  const value = linked?.retailPriceOverride;
  return value !== '' && value != null && Number.isFinite(Number(value)) && Number(value) >= 0
    ? Number(value) : null;
}

export function inventorySaleProduct(item, linked = null) {
  const purchase = Number(item.basePrice ?? item.referencePrice ?? 0);
  const markup = Number(item.saleMarkupValue || 0);
  const calculatedPrice = item.salePrice == null
    ? item.saleMarkupMode === 'amount' ? purchase + markup : purchase * (1 + markup / 100)
    : Number(item.salePrice);
  const override = stockPriceOverride(linked);
  const unitPrice = override ?? calculatedPrice;
  return {
    id: 'inventory:' + item.itemId,
    inventoryItemId: item.itemId,
    name: item.name,
    manufacturer: item.manufacturer,
    unit: item.saleUnit || item.unit,
    quantity: item.saleQuantity == null ? null : Number(item.saleQuantity),
    // The catalog price is for the default sale quantity (e.g. 100 gloves).
    // The price per base sale unit is used only to calculate the final bill.
    pricePerUnit: Number.isFinite(unitPrice) ? unitPrice / (Number(item.saleQuantity) > 0 ? Number(item.saleQuantity) : 1) : 0,
    cost: { mode: 'amount', amount: Number.isFinite(unitPrice) ? Math.round(unitPrice * 100) / 100 : 0, free: false },
    about: String(linked?.about || ''),
    groupValues: linked?.groupValues && typeof linked.groupValues === 'object' && !Array.isArray(linked.groupValues) ? clone(linked.groupValues) : {},
    workplaces: Array.isArray(linked?.workplaces) ? clone(linked.workplaces) : [],
    inventoryOwned: true,
    calculatedSalePrice: Number.isFinite(calculatedPrice) ? Math.round(calculatedPrice * 100) / 100 : null,
    retailPriceOverride: override,
    servicePosition: linked?.servicePosition ?? null,
  };
}

export function getProducts() {
  const raw = readRawProducts();
  const overlays = new Map(raw.filter(item => !item.deletedAt && item.inventoryItemId)
    .map(item => [String(item.inventoryItemId), item]));
  const stock = getInventoryItems().filter(item => item.canSell === true)
    .map(item => inventorySaleProduct(item, overlays.get(String(item.itemId))));
  // A linked stock item is visible in Service ONLY while Inventory marks it
  // «Продажа». Price overlays and legacy linked rows never become phantom
  // catalogue products when the sale flag is switched off.
  const legacy = raw.filter(item => !item.deletedAt && !item.inventoryItemId && item.kind !== 'service-catalog-config');
  // Service owns its own catalogue order, independent of Stock ordering.
  // Entries without a saved position (including newly marketed stock items)
  // follow in their original order. Sorting never writes to Inventory.
  const combined = [...stock, ...legacy];
  return combined.sort((left, right) => {
    const a = Number(left.servicePosition);
    const b = Number(right.servicePosition);
    const posA = Number.isSafeInteger(a) && a > 0 ? a : Number.MAX_SAFE_INTEGER;
    const posB = Number.isSafeInteger(b) && b > 0 ? b : Number.MAX_SAFE_INTEGER;
    return posA - posB;
  });
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
  const order = (Array.isArray(ids) ? ids : []).map(id => String(id || ''));
  const current = getProducts();
  const valid = new Set(current.map(item => String(item.id)));
  if (order.length !== valid.size || new Set(order).size !== valid.size
      || order.some(id => !valid.has(id))) {
    throw new Error('Список изменился. Откройте раздел повторно.');
  }
  // A single ACK-first Service write stores positions for both linked Stock
  // items and legacy Service products; no mutations or reorders in Inventory.
  await commitServiceCollection({
    read: readRawProducts,
    persist: values => queueAuxiliaryDataset('products', values),
    hydrate: values => { productsState = clone(values); },
    mutate: values => {
      const positions = new Map(order.map((id, index) => [id, index + 1]));
      const updated = values.map(item => {
        if (item.deletedAt) return item;
        const id = item.inventoryItemId ? 'inventory:' + item.inventoryItemId : String(item.id);
        return positions.has(id) ? { ...item, servicePosition: positions.get(id) } : item;
      });
      const covered = new Set(updated.filter(item => !item.deletedAt)
        .map(item => item.inventoryItemId ? 'inventory:' + item.inventoryItemId : String(item.id)));
      for (const item of current) {
        const id = String(item.id);
        if (!item.inventoryOwned || covered.has(id)) continue;
        updated.push({
          id, inventoryItemId: item.inventoryItemId,
          servicePosition: positions.get(id),
        });
      }
      return updated;
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

// An ACK-first write to Service's existing auxiliary products dataset.
// A stocked item is not duplicated: its inventoryItemId remains the single
// stable reference and only the price override is persisted here.
// Service-only group definitions for BOTH catalogues live in one explicit
// metadata entry of the existing tenant-scoped Service products dataset.
// They are never inventory items, products, records, or public catalogue rows.
const SERVICE_GROUP_CONFIG_ID = '__service:catalog-groups__';
const serviceKinds = new Set(['procedures', 'products']);

export function getServiceGroupLevels(kind) {
  if (!serviceKinds.has(kind)) return [];
  const config = readRawProducts().find(item => item.id === SERVICE_GROUP_CONFIG_ID
    && item.kind === 'service-catalog-config' && !item.deletedAt);
  return Array.isArray(config?.levels?.[kind]) ? clone(config.levels[kind]) : [];
}

export async function commitServiceGroupLevels(kind, entries = []) {
  if (!serviceKinds.has(kind)) throw new Error('Неизвестный раздел Сервиса.');
  const levels = Array.isArray(entries) ? entries : [];
  const ids = new Set();
  const normalized = levels.map((entry, index) => {
    const id = String(entry.id || '').trim();
    const name = String(entry.name || '').trim();
    if (!id || !name || ids.has(id)) throw new Error('Укажите уникальное название группы.');
    ids.add(id);
    const valueIds = new Set();
    const values = (Array.isArray(entry.values) ? entry.values : []).map(value => {
      const valueId = String(value.id || '').trim();
      const valueName = String(value.name || '').trim();
      if (!valueId || !valueName || valueIds.has(valueId)) throw new Error('Укажите уникальное значение группы.');
      valueIds.add(valueId);
      return { id: valueId, name: valueName };
    });
    return { id, name, values, position: index + 1 };
  });
  await commitServiceCollection({
    read: readRawProducts,
    persist: values => queueAuxiliaryDataset('products', values),
    hydrate: values => { productsState = clone(values); },
    mutate: values => {
      const old = values.find(item => item.id === SERVICE_GROUP_CONFIG_ID
        && item.kind === 'service-catalog-config');
      const config = {
        id: SERVICE_GROUP_CONFIG_ID, kind: 'service-catalog-config',
        levels: { ...(old?.levels || {}), [kind]: normalized },
      };
      return old ? values.map(item => item === old ? config : item)
        : [...values, config];
    },
  });
  return getServiceGroupLevels(kind);
}

// A stocked Service product is edited without touching its Stock owner.
// Save the final retail price, future-facing description and group placement
// in ONE ACK-first mutation so partial form edits cannot overwrite each other.
export async function commitInventoryProductPresentation(itemId, { price, about = '', groupValues = {} } = {}) {
  const id = String(itemId || '').trim();
  const raw = price == null ? '' : String(price).trim().replace(',', '.');
  const value = Number(raw);
  if (!id || !raw || !Number.isFinite(value) || value < 0
      || !/^\d+(?:\.\d{1,2})?$/.test(raw)) {
    throw new Error('Укажите корректную цену продажи в рублях.');
  }
  const description = String(about || '').trim();
  if (description.length > 5000) throw new Error('Описание слишком длинное.');
  const normalizedGroups = Object.fromEntries(Object.entries(groupValues || {})
    .filter(([key, selected]) => String(key).trim() && String(selected || '').trim())
    .map(([key, selected]) => [String(key), String(selected)]));
  if (!getInventoryItems().some(item => String(item.itemId) === id && item.canSell === true)) {
    throw new Error('Товар больше не находится в продаже.');
  }
  await commitServiceCollection({
    read: readRawProducts,
    persist: values => queueAuxiliaryDataset('products', values),
    hydrate: values => { productsState = clone(values); },
    mutate: values => {
      const index = values.findIndex(item => !item.deletedAt
        && String(item.inventoryItemId || '') === id);
      const update = { retailPriceOverride: value, about: description, groupValues: normalizedGroups };
      if (index < 0) return [...values, {
        id: 'inventory:' + id, inventoryItemId: id, ...update,
      }];
      return values.map((item, i) => i === index ? { ...item, ...update } : item);
    },
  });
}

export async function commitInventoryRetailPrice(itemId, price) {
  const id = String(itemId || '').trim();
  const raw = price == null ? '' : String(price).trim().replace(',', '.');
  const value = Number(raw);
  if (!id || !raw || !Number.isFinite(value) || value < 0
      || !/^\d+(?:\.\d{1,2})?$/.test(raw)) {
    throw new Error('Укажите корректную цену продажи в рублях.');
  }
  if (!getInventoryItems().some(item => String(item.itemId) === id && item.canSell === true)) {
    throw new Error('Товар больше не находится в продаже.');
  }
  await commitServiceCollection({
    read: readRawProducts,
    persist: values => queueAuxiliaryDataset('products', values),
    hydrate: values => { productsState = clone(values); },
    mutate: values => {
      const index = values.findIndex(item => !item.deletedAt
        && String(item.inventoryItemId || '') === id);
      if (index < 0) return [...values, {
        id: 'inventory:' + id,
        inventoryItemId: id,
        retailPriceOverride: value,
      }];
      return values.map((item, i) => i === index
        ? { ...item, retailPriceOverride: value } : item);
    },
  });
}

// Stock identity and quantity remain in Inventory. Service owns only the
// per-workplace sale assignments alongside its retail price overlay.
// The shared assignment transformer is the same one used by Procedures.
export async function commitInventoryProductWorkplace(itemId, workplaceId, assignment) {
  const id = String(itemId || '').trim();
  if (!getInventoryItems().some(item => String(item.itemId) === id && item.canSell === true)) {
    throw new Error('Товар больше не находится в продаже.');
  }
  await commitServiceCollection({
    read: readRawProducts,
    persist: values => queueAuxiliaryDataset('products', values),
    hydrate: values => { productsState = clone(values); },
    mutate: values => {
      const index = values.findIndex(item => !item.deletedAt
        && String(item.inventoryItemId || '') === id);
      if (index < 0) {
        const base = { id: 'inventory:' + id, inventoryItemId: id, workplaces: [] };
        return [...values, changeWorkplaceAssignment(base, workplaceId, assignment)];
      }
      return values.map((item, i) => i === index
        ? changeWorkplaceAssignment(item, workplaceId, assignment) : item);
    },
  });
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
