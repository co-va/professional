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

export function hydrateProductsFromServer({ products = [], productHistory = [] } = {}) {
  productsState = Array.isArray(products) ? clone(products) : [];
  historyState = Array.isArray(productHistory) ? clone(productHistory) : [];
  return { products: clone(productsState), productHistory: clone(historyState) };
}

// Inventory is the only source for stocked sale products. The legacy Service
// catalog is retained for compatibility; new sale products remain Inventory-backed.
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
    // Appearance belongs to the Service overlay; Stock remains the only
    // authority for name, quantity, purchase and calculated sale price.
    photo: String(linked?.photo || item.photo || ''),
    photoPosition: String(linked?.photoPosition || '50% 50%'),
    cardAppearance: linked?.cardAppearance && typeof linked.cardAppearance === 'object'
      ? clone(linked.cardAppearance) : {},
    groupValues: linked?.groupValues && typeof linked.groupValues === 'object' && !Array.isArray(linked.groupValues) ? clone(linked.groupValues) : {},
    workplaces: Array.isArray(linked?.workplaces) ? clone(linked.workplaces) : [],
    inventoryOwned: true,
    // Display-only Stock facts for the readonly Cost block of Service's Q.
    // Stock remains authoritative; editing the Service overlay never writes them.
    stockPurchasePrice: item.basePrice == null && item.referencePrice == null
      ? null : purchase,
    stockMarkupValue: item.saleMarkupValue == null ? null : Number(item.saleMarkupValue),
    stockMarkupMode: item.saleMarkupMode || 'percent',
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

// Per-item appearance writes only Service-owned presentation metadata.
// A linked Inventory item is never copied into auxiliary-state/products.
export async function commitProductCardAppearance(entityId, { appearance = {}, photo = '', photoPosition = '50% 50%' } = {}) {
  const id = String(entityId || '');
  const product = getProducts().find(item => String(item.id) === id);
  if (!product) throw new Error('Товар больше не доступен.');
  const stockId = String(product.inventoryItemId || '');
  const previous = stockId ? null : readRawProducts().find(item => String(item.id) === id && !item.deletedAt);
  const presentation = {
    cardAppearance: clone(appearance && typeof appearance === 'object' && !Array.isArray(appearance) ? appearance : {}),
    photo: String(photo || ''),
    photoPosition: String(photoPosition || '50% 50%'),
    updatedAt: new Date().toISOString(),
  };
  await commitServiceCollection({
    read: readRawProducts,
    persist: values => queueAuxiliaryDataset('products', values),
    hydrate: values => { productsState = clone(values); },
    mutate: values => {
      const index = values.findIndex(item => !item.deletedAt && (stockId
        ? String(item.inventoryItemId || '') === stockId
        : String(item.id) === id));
      if (index < 0) {
        if (!stockId) throw new Error('Товар больше не доступен.');
        return [...values, { id: 'inventory:' + stockId, inventoryItemId: stockId, ...presentation }];
      }
      return values.map((item, i) => {
        if (i !== index) return item;
        if (!stockId) return { ...item, ...presentation };
        // Discard only inert Stock replicas created by the old appearance
        // writer, keeping Service price, grouping, workplaces and ordering.
        const { name, manufacturer, unit, quantity, pricePerUnit, cost,
          inventoryOwned, stockPurchasePrice, stockMarkupValue,
          stockMarkupMode, calculatedSalePrice, ...overlay } = item;
        return { ...overlay, ...presentation };
      });
    },
  });
  if (previous) await commitProductHistory(previous);
}

// The shared template replaces individual appearances with ONE ACK-first
// dataset mutation; unrelated prices, stock links and history remain intact.
export async function resetProductCardAppearances() {
  let changed = 0;
  await commitServiceCollection({
    read: readRawProducts,
    persist: values => queueAuxiliaryDataset('products', values),
    hydrate: values => { productsState = clone(values); },
    mutate: values => values.map(item => {
      if (item.deletedAt || !item.cardAppearance || !Object.keys(item.cardAppearance).length) return item;
      changed += 1;
      return { ...item, cardAppearance: {}, updatedAt: new Date().toISOString() };
    }),
  });
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

// One combined Service group directory. Definitions stay separated by usage
// (Services/Products) in the SAME existing config row, never separate menus.
// Global ordering controls the mixed V2 directory; per-kind ordering controls
// the group selectors inside Service cards.
const serviceGroupKey = (kind, id) => kind + ':' + id;

function serviceGroupConfig(values = readRawProducts()) {
  return values.find(item => item.id === SERVICE_GROUP_CONFIG_ID
    && item.kind === 'service-catalog-config' && !item.deletedAt) || null;
}

export function getServiceGroupEntries() {
  const config = serviceGroupConfig();
  const entries = [...serviceKinds].flatMap(kind =>
    (Array.isArray(config?.levels?.[kind]) ? config.levels[kind] : []).map(group => ({
      ...clone(group), kind, key: serviceGroupKey(kind, group.id),
    })));
  const order = new Map((Array.isArray(config?.order) ? config.order : [])
    .map((key, index) => [String(key), index]));
  return entries.map((group, index) => ({ group, index }))
    .sort((a, b) => (order.get(a.group.key) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(b.group.key) ?? Number.MAX_SAFE_INTEGER) || a.index - b.index)
    .map(row => row.group);
}

export async function commitServiceGroupOrder(keys = []) {
  const existing = getServiceGroupEntries();
  const expected = new Set(existing.map(entry => entry.key));
  const nextKeys = (Array.isArray(keys) ? keys : []).map(String);
  if (nextKeys.length !== expected.size || new Set(nextKeys).size !== expected.size
      || nextKeys.some(key => !expected.has(key))) {
    throw new Error('Список групп изменился. Откройте его повторно.');
  }
  const rank = new Map(nextKeys.map((key, index) => [key, index]));
  await commitServiceCollection({
    read: readRawProducts,
    persist: values => queueAuxiliaryDataset('products', values),
    hydrate: values => { productsState = clone(values); },
    mutate: values => values.map(row => {
      if (row.id !== SERVICE_GROUP_CONFIG_ID || row.kind !== 'service-catalog-config') return row;
      const levels = Object.fromEntries([...serviceKinds].map(kind => [kind,
        (row.levels?.[kind] || []).slice()
          .sort((a, b) => (rank.get(serviceGroupKey(kind, a.id)) ?? Number.MAX_SAFE_INTEGER) -
            (rank.get(serviceGroupKey(kind, b.id)) ?? Number.MAX_SAFE_INTEGER))
          .map((entry, index) => ({ ...entry, position: index + 1 })),
      ]));
      return { ...row, levels: { ...row.levels, ...levels }, order: nextKeys };
    }),
  });
  return getServiceGroupEntries();
}

export async function commitServiceGroupLevels(kind, entries = []) {
  if (!serviceKinds.has(kind)) throw new Error('Неизвестный раздел Сервиса.');
  const levels = Array.isArray(entries) ? entries : [];
  const ids = new Set();
  const names = new Set();
  const normalized = levels.map((entry, index) => {
    const id = String(entry.id || '').trim();
    const name = String(entry.name || '').trim();
    const nameKey = name.toLocaleLowerCase('ru-RU');
    if (!id || !name || name.length > 80 || ids.has(id) || names.has(nameKey))
      throw new Error('Группы должны иметь разные названия до 80 символов.');
    ids.add(id);
    names.add(nameKey);
    const valueIds = new Set();
    const valueNames = new Set();
    const values = (Array.isArray(entry.values) ? entry.values : []).map(value => {
      const valueId = String(value.id || '').trim();
      const valueName = String(value.name || '').trim();
      const valueKey = valueName.toLocaleLowerCase('ru-RU');
      if (!valueId || !valueName || valueName.length > 80
          || valueIds.has(valueId) || valueNames.has(valueKey))
        throw new Error('Значения одной группы должны иметь разные названия.');
      valueIds.add(valueId);
      valueNames.add(valueKey);
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
      const nextLevels = { ...(old?.levels || {}), [kind]: normalized };
      const allKeys = [...serviceKinds].flatMap(section =>
        (nextLevels[section] || []).map(group => serviceGroupKey(section, group.id)));
      const order = [
        ...(Array.isArray(old?.order) ? old.order : [])
          .filter(key => allKeys.includes(key)),
        ...allKeys.filter(key => !(old?.order || []).includes(key)),
      ];
      const config = {
        id: SERVICE_GROUP_CONFIG_ID, kind: 'service-catalog-config',
        ...old, levels: nextLevels, order,
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
