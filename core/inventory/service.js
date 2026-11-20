import { apiRequest, getAuthToken } from '../auth.js';
import { applyInventorySnapshot, applyInventoryPositionChanges, getInventoryItem, getInventoryItems, getInventoryCriteria, getInventorySnapshot, removeArchivedInventoryItems, setInventoryCriteriaCatalog } from './data.js';
import { inventoryEndPosition } from './position-reorder-plan.js';

const SERVER_ORDER_UNAVAILABLE = 'Сервер склада ещё не обновлён. Порядок не сохранён.';
// Navigation can reuse an already confirmed stock read briefly. Mutation
// verification and stocktake always request the server explicitly.
const INVENTORY_NAVIGATION_FRESH_MS = 12000;
let lastStockToken = '';
let lastStockReadAt = 0;
let stockRead = null;
let stockRevision = 0;
if (typeof window !== 'undefined') window.addEventListener('professional:auth-logout', () => {
  lastStockToken = '';
  lastStockReadAt = 0;
  stockRead = null;
  stockRevision++;
});
const rememberSnapshot = token => {
  lastStockToken = token;
  lastStockReadAt = Date.now();
};
// Supplier catalog and pricing updates use their own Core owner, but must
// invalidate cached stock totals/prices without forcing an immediate reload.
export function invalidateInventoryNavigationCache() {
  stockRevision++;
  lastStockReadAt = 0;
  stockRead = null;
}

function snapshotItem(payload, itemId) {
  return Array.isArray(payload?.items)
    ? payload.items.find(item => String(item?.itemId || '') === String(itemId || ''))
    : null;
}

async function inventoryRequest(path = '', options = {}) {
  const { verifySnapshot, ...requestOptions } = options;
  const token = getAuthToken();
  const requestRevision = stockRevision;
  const changing = !['GET','HEAD'].includes(String(requestOptions.method || 'GET').toUpperCase());
  const response = await apiRequest(`/inventory${path}`, requestOptions);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (path === '/items/reorder' && response.status === 404) {
      throw new Error(SERVER_ORDER_UNAVAILABLE);
    }
    const message = Array.isArray(payload?.message)
      ? payload.message.join('; ')
      : typeof payload?.message === 'string' ? payload.message.trim() : '';
    throw new Error(message || `Не удалось сохранить склад (HTTP ${response.status})`);
  }
  // Never apply a read that started before a successful warehouse mutation,
  // or a response belonging to another login.
  if (getAuthToken() !== token) return getInventorySnapshot();
  if (!changing && requestRevision !== stockRevision) return getInventorySnapshot();
  // The older server accepts arbitrary item fields but silently ignores position.
  verifySnapshot?.(payload);
  if (changing) stockRevision++;
  const next = applyInventorySnapshot(payload);
  rememberSnapshot(token);
  return next;
}

export async function loadInventory({ preferRecent = false } = {}) {
  const token = getAuthToken();
  if (preferRecent && token === lastStockToken && lastStockReadAt
      && Date.now() - lastStockReadAt < INVENTORY_NAVIGATION_FRESH_MS)
    return getInventorySnapshot();
  if (stockRead?.token === token) return stockRead.promise;
  const promise = inventoryRequest();
  const inFlight = { token, promise };
  stockRead = inFlight;
  try { return await promise; }
  finally { if (stockRead === inFlight) stockRead = null; }
}

// A dedicated staging Core operation repairs historical gaps/blank ranks.
// Do not call the old "clear" endpoint for this: older deployed servers
// deliberately persisted 0 and would damage the order again.
export async function repairInventoryPositions() {
  const token = getAuthToken();
  const response = await apiRequest('/inventory/items/positions/repair', {
    method: 'POST', body: JSON.stringify({}), timeoutMs: 130000,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(response.status === 404
    ? 'Сервер склада пока не поддерживает восстановление порядковых номеров.'
    : typeof payload.message === 'string' ? payload.message
      : 'Не удалось восстановить номера (HTTP ' + response.status + ').');
  if (!Array.isArray(payload.repairedManufacturers) || !Array.isArray(payload.positions)
    || payload.positions.some(row => !row?.itemId ||
      !Number.isSafeInteger(row.position) || row.position < 1))
    throw new Error('Сервер не подтвердил исправление порядка.');
  if (getAuthToken() !== token) return getInventorySnapshot();
  invalidateInventoryNavigationCache();
  return loadInventory();
}

export async function createInventoryItem(value = {}) {
  // Any frontend creation route must assign a real position at the end.
  // A deliberate positive insertion position is retained.
  let position=value.position;
  if (position == null || position === '' || Number(position) === 0) {
    await loadInventory({preferRecent:true});
    position=inventoryEndPosition(getInventoryItems(),String(value.manufacturer || ''));
  }
  if (!Number.isSafeInteger(Number(position)) || Number(position)<1
    || Number(position)>2147483647)
    throw new Error('Невозможно назначить положительный порядковый номер.');
  const previousIds = new Set(getInventoryItems().map(item => String(item.itemId)));
  return inventoryRequest('/items', {
    method: 'POST',
    body: JSON.stringify({...value,position:Number(position)}),
    verifySnapshot:payload=>{
      if (!Array.isArray(payload?.items))
        throw new Error('Сервер не подтвердил создание товара.');
      // A normal create may receive its itemId from Core. Verify the actual
      // new row instead of treating an unknown ID as successful confirmation.
      const created = value.itemId
        ? snapshotItem(payload,value.itemId)
        : payload.items.find(item => !previousIds.has(String(item.itemId))
            && String(item.name || '') === String(value.name || '')
            && String(item.manufacturer || '') === String(value.manufacturer || ''));
      if (!created || !Number.isSafeInteger(Number(created.position))
        || Number(created.position) < 1)
        throw new Error('Сервер не подтвердил новый товар с порядковым номером.');
    },
  });
}

export async function updateInventoryItem(itemId, value = {}) {
  // A deletion is an ID operation, never a generic item update that returns
  // and reparses the entire warehouse.
  if (value?.archived === true) return archiveSelectedInventoryItems([itemId]);
  const previous = getInventoryItem(itemId);
  // Never forward a historical clear-to-zero from any caller. Empty means
  // move to the last positive rank, including legacy unnumbered records.
  if (Object.prototype.hasOwnProperty.call(value,'position') &&
    (value.position == null || value.position === '' || Number(value.position) === 0)) {
    value = { ...value, position:inventoryEndPosition(getInventoryItems(),
      String(value.manufacturer ?? previous?.manufacturer ?? ''),itemId) };
  }
  const expected = Number(value?.position);
  const positionChanged = Object.prototype.hasOwnProperty.call(value, 'position')
    && Number.isSafeInteger(expected)
    && expected !== (Number(previous?.position) || 0);
  return inventoryRequest(`/items/${encodeURIComponent(String(itemId || ''))}`, {
    method: 'PUT',
    // A bounded wait prevents a stalled Core position write from freezing Q.
    // Core's position transaction has a 60s timeout plus up to 10s lock wait.
    ...(Object.prototype.hasOwnProperty.call(value, 'position') ? { timeoutMs: 75000 } : {}),
    // A stale phone or browser tab cannot overwrite a more recent slot number.
    body: JSON.stringify(Object.prototype.hasOwnProperty.call(value, 'position')
      ? { ...value, expectedPosition: Number(previous?.position) || 0 } : value),
    verifySnapshot: payload => {
      const saved = snapshotItem(payload, itemId);
      if (!saved) throw new Error('Сервер не подтвердил сохранение товара.');
      if (positionChanged && Number(saved.position) !== expected)
        throw new Error('Номер не сохранился. ' + SERVER_ORDER_UNAVAILABLE);
      // A successful HTTP status alone is insufficient: older API versions
      // sometimes acknowledged classification edits without persisting them.
      const fields = ['name','catalogName','manufacturer','category','productType','sku','barcode'];
      for (const key of fields) {
        if (Object.prototype.hasOwnProperty.call(value,key)
            && String(saved[key] ?? '') !== String(value[key] ?? ''))
          throw new Error('Не сохранилось поле «' + ({
            name:'Наименование',catalogName:'Полное наименование',
            manufacturer:'Производитель',category:'Категория',productType:'Тип',
            sku:'Артикул',barcode:'Штрихкод',
          }[key] || key) + '». Обновите склад и повторите.');
      }
      if (value.criteriaValues) {
        for (const [id, requested] of Object.entries(value.criteriaValues)) {
          if (String(saved.criteriaValues?.[id] ?? '') !== String(requested ?? ''))
            throw new Error('Не сохранилось значение группы. Обновите склад и повторите.');
        }
      }
    },
  });
}

export async function reorderInventoryItems(manufacturer, itemIds) {
  const previousPositions = itemIds.map(id => Number(getInventoryItem(id)?.position) || 0);
  return inventoryRequest('/items/reorder', {
    method: 'POST',
    body: JSON.stringify({ manufacturer, itemIds, previousPositions }),
    verifySnapshot: payload => {
      if (!Array.isArray(payload?.items)) throw new Error(SERVER_ORDER_UNAVAILABLE);
      // Every item must have a real, contiguous position in this company.
      // A reorder that still returns a legacy blank/zero is NOT complete.
      const group = payload.items.filter(item =>
        String(item.manufacturer || '').trim() === String(manufacturer || '').trim());
      const sorted = [...group].sort((a, b) => {
        const rank = item => Number(item.position) > 0 ? Number(item.position) : Number.MAX_SAFE_INTEGER;
        return rank(a) - rank(b)
          || String(a.name || '').localeCompare(String(b.name || ''), 'ru', { numeric: true, sensitivity: 'base' })
          || String(a.itemId || '').localeCompare(String(b.itemId || ''));
      });
      if (sorted.length !== itemIds.length || sorted.some((item, index) =>
        item.itemId !== itemIds[index] || Number(item.position) !== index + 1))
        throw new Error('Сервер не подтвердил порядковые номера 1…N. Обновите склад.');
    },
  });
}

// All item validations remain on Core. One request/ack for a group of
// field changes; the caller performs one canonical read after the batch.
export async function updateInventoryItemsBatch(updates = []) {
  if (!Array.isArray(updates) || !updates.length || updates.length > 100)
    throw new Error('Выберите от 1 до 100 позиций для изменения.');
  const response = await apiRequest('/inventory/items/bulk-update', {
    method: 'POST',
    body: JSON.stringify({ updates }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = Array.isArray(payload?.message) ? payload.message.join('; ')
      : typeof payload?.message === 'string' ? payload.message.trim() : '';
    throw new Error(reason || 'Не удалось изменить выбранные позиции.');
  }
  const expected = updates.map(row => String(row.itemId));
  if (!Array.isArray(payload?.updatedItemIds) ||
      payload.updatedItemIds.length !== expected.length ||
      expected.some(id => !payload.updatedItemIds.includes(id)))
    throw new Error('Core не подтвердил изменения выбранных позиций.');
  stockRevision++;
  lastStockReadAt = 0;
  stockRead = null;
  return expected;
}

// Compatibility entry point: "clear" now means move selected products to
// the end, with positive 1..N ranks. The compact response confirms the order.
export async function clearInventoryItemPositions(itemIds = []) {
  const ids = [...new Set((Array.isArray(itemIds) ? itemIds : []).map(String))];
  if (!ids.length || ids.length > 10000)
    throw new Error('Выберите от 1 до 10000 позиций для очистки.');
  const items = ids.map(id => getInventoryItem(id));
  if (items.some(item => !item)) throw new Error('Список изменился. Обновите остатки.');
  const input = items.map(item => ({
    itemId: item.itemId, expectedPosition: Number(item.position) || 0,
  }));
  const response = await apiRequest('/inventory/items/positions/clear', {
    method: 'POST', body: JSON.stringify({ items: input }), timeoutMs: 60000,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = Array.isArray(payload.message) ? payload.message.join('; ')
      : typeof payload.message === 'string' ? payload.message.trim() : '';
    throw new Error(message || (response.status === 404
      ? 'Сервер ещё не поддерживает очистку с пересчётом номеров.'
      : 'Не удалось очистить номера (HTTP ' + response.status + ').'));
  }
  const confirmed = Array.isArray(payload?.clearedItemIds)
    ? payload.clearedItemIds.map(String) : [];
  const positions = Array.isArray(payload?.positions) ? payload.positions : [];
  const byId = new Map(positions.map(row => [String(row.itemId), row.position]));
  if (confirmed.length !== ids.length || ids.some(id => !confirmed.includes(id))
    || !positions.length || positions.some(row => !row?.itemId
      || !Number.isSafeInteger(row.position) || row.position < 1)
    || ids.some(id => !(byId.get(id) > 0))) {
    invalidateInventoryNavigationCache();
    throw new Error('Сервер не подтвердил новый порядок. Обновите остатки.');
  }
  invalidateInventoryNavigationCache();
  applyInventoryPositionChanges(positions);
  return ids;
}

export async function archiveSelectedInventoryItems(itemIds) {
  const ids = [...new Set(Array.isArray(itemIds) ? itemIds.map(String) : [])];
  if (!ids.length || ids.length > 500) throw new Error('Выберите от 1 до 500 товаров.');
  // One compact request, one compact response; no GET /inventory after deletion.
  const response = await apiRequest('/inventory/items/archive-selection', {
    method: 'POST',
    body: JSON.stringify({ itemIds: ids }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = Array.isArray(payload?.message) ? payload.message.join('; ')
      : typeof payload?.message === 'string' ? payload.message.trim() : '';
    throw new Error(message || 'Не удалось удалить выбранные позиции.');
  }
  if (!Array.isArray(payload?.archivedItemIds) ||
      payload.archivedItemIds.length !== ids.length ||
      ids.some(id => !payload.archivedItemIds.includes(id)))
    throw new Error('Сервер не подтвердил удаление выбранных позиций.');
  // An archive also renumbers its manufacturer(s). Refuse a legacy
  // response that gives no rank confirmation: old Core left gaps on removal.
  if (!Array.isArray(payload?.positions) || payload.positions.some(row =>
    !row || !row.itemId || !Number.isSafeInteger(row.position) || row.position < 1)) {
    invalidateInventoryNavigationCache();
    await loadInventory();
    throw new Error('Сервер не подтвердил непрерывную нумерацию после удаления.');
  }
  stockRevision++;
  removeArchivedInventoryItems(ids);
  applyInventoryPositionChanges(payload.positions);
  rememberSnapshot(getAuthToken());
  return getInventorySnapshot();
}

export async function createInventoryMovement(value = {}) {
  return inventoryRequest('/movements', {
    method: 'POST',
    body: JSON.stringify(value),
  });
}

export async function correctInventoryMovement(movementId, value = {}) {
  return inventoryRequest(`/movements/${encodeURIComponent(String(movementId || ''))}/correct`, {
    method: 'POST',
    body: JSON.stringify(value),
  });
}

// Purchase orders have no browser-side shadow store: Core returns the
// persisted order snapshot after every accepted mutation.
const purchaseOrderPath = (orderId) => `/orders/${encodeURIComponent(String(orderId || ''))}`;

function requireOrderResponse(payload) {
  if (!Array.isArray(payload?.orders)) {
    throw new Error('Сервер ещё не поддерживает закупочные заказы. Заказ не сохранён.');
  }
  return payload.orders;
}

function verifyOrderState(payload, orderId, statuses = []) {
  const order = requireOrderResponse(payload).find(item =>
    String(item?.orderId || '') === String(orderId || ''));
  if (!order || statuses.length && !statuses.includes(order.status)) {
    throw new Error('Сервер не подтвердил состояние закупочного заказа.');
  }
  return order;
}

export async function createInventoryPurchaseOrder(value) {
  const previousIds = new Set((getInventorySnapshot()?.orders || []).map(order => order.orderId));
  return inventoryRequest('/orders', {
    method: 'POST', body: JSON.stringify(value),
    verifySnapshot: payload => {
      if (!requireOrderResponse(payload).some(order => !previousIds.has(order.orderId))) {
        throw new Error('Сервер не подтвердил создание заказа.');
      }
    },
  });
}


function verifyPurchaseOrderLines(payload, orderId, requested) {
  const saved = verifyOrderState(payload, orderId, ['formed']);
  const expected = Array.isArray(requested?.lines) ? requested.lines : [];
  const actual = Array.isArray(saved.lines) ? saved.lines : [];
  if (expected.length !== actual.length) {
    throw new Error('Сервер сохранил неполный состав заказа.');
  }
  const persisted = new Map(actual.map(line => [String(line.itemId), line]));
  for (const line of expected) {
    const row = persisted.get(String(line.itemId));
    const expectedPrice = Number(line.packPrice);
    const actualPrice = Number(row?.packPrice);
    if (!row || Number(row.packages) !== Number(line.packages)
      || line.packPrice != null && (!Number.isFinite(actualPrice)
        || Math.abs(actualPrice - expectedPrice) > 0.011)) {
      throw new Error('Сервер не подтвердил количество или цену позиции заказа.');
    }
  }
}
export async function updateInventoryPurchaseOrder(orderId, value) {
  return inventoryRequest(purchaseOrderPath(orderId), {
    method: 'PUT', body: JSON.stringify(value),
    verifySnapshot: payload => verifyPurchaseOrderLines(payload, orderId, value),
  });
}

export async function deleteInventoryPurchaseOrder(orderId) {
  return inventoryRequest(purchaseOrderPath(orderId), {
    method: 'DELETE',
    verifySnapshot: payload => {
      if (requireOrderResponse(payload).some(order => order.orderId === orderId)) {
        throw new Error('Сервер не подтвердил удаление заказа.');
      }
    },
  });
}

export async function payInventoryPurchaseOrder(orderId, value) {
  return inventoryRequest(`${purchaseOrderPath(orderId)}/pay`, {
    method: 'POST', body: JSON.stringify(value),
    verifySnapshot: payload => {
      const order = verifyOrderState(payload, orderId, ['paid', 'received']);
      if (!order.financeOperationId) throw new Error('Сервер не подтвердил финансовую операцию.');
    },
  });
}

export async function receiveInventoryPurchaseOrder(orderId, receivedAt, allocations, rejections = []) {
  // The purchase receipt always uses explicit location allocations.
  // The former unscoped path must not remain available through Professional.
  if (!Array.isArray(allocations) || !Array.isArray(rejections)) {
    throw new Error('Для получения заказа обязательно распределение по складам.');
  }
  return inventoryRequest(`${purchaseOrderPath(orderId)}/receive`, {
    method: 'POST', body: JSON.stringify({ receivedAt, allocations, rejections }),
    verifySnapshot: payload => {
      const order = verifyOrderState(payload, orderId, ['received']);
      if (!order.receiptMovementId && !rejections.length) throw new Error('Сервер не подтвердил приход.');
      if (rejections.length) {
        const claims = Array.isArray(payload?.supplierClaims) ? payload.supplierClaims : [];
        for (const line of rejections) if (!claims.some(claim =>
          claim.orderId === orderId && claim.itemId === line.itemId && Number(claim.packages) === Number(line.packages)))
          throw new Error('Сервер не подтвердил возврат неверной позиции.');
      }
    },
  });
}

export function returnInventoryPurchaseOrderToSupplier(orderId, value) {
  return inventoryRequest(`${purchaseOrderPath(orderId)}/supplier-returns`, {
    method: 'POST', body: JSON.stringify(value),
    verifySnapshot: payload => {
      const movementId = 'inventory-supplier-return-' + value.returnId;
      if (!Array.isArray(payload?.movements) ||
          !payload.movements.some(movement => movement.movementId === movementId))
        throw new Error('Сервер не подтвердил возврат поставщику.');
    },
  });
}

export function refundInventorySupplierClaim(claimId, value) {
  return inventoryRequest('/supplier-claims/' + encodeURIComponent(claimId) + '/refund', {
    method: 'POST', body: JSON.stringify(value),
    verifySnapshot: payload => {
      if (!Array.isArray(payload?.supplierClaimSettlements) ||
          !payload.supplierClaimSettlements.some(row =>
            row.claimId === claimId && row.settlementId === value.settlementId))
        throw new Error('Сервер не подтвердил возврат денег.');
    },
  });
}

// Offers are persisted only by Core. A successful response refreshes the same inventory snapshot.
const itemOffersPath = (itemId) => `/items/${encodeURIComponent(String(itemId || ''))}/offers`;

export async function createInventorySupplierOffer(itemId, value = {}) {
  return inventoryRequest(itemOffersPath(itemId), { method: 'POST', body: JSON.stringify(value) });
}

export async function updateInventorySupplierOffer(itemId, offerId, value = {}) {
  return inventoryRequest(`${itemOffersPath(itemId)}/${encodeURIComponent(String(offerId || ''))}`, {
    method: 'PUT', body: JSON.stringify(value),
  });
}

export async function archiveInventorySupplierOffer(itemId, offerId) {
  return inventoryRequest(`${itemOffersPath(itemId)}/${encodeURIComponent(String(offerId || ''))}`, {
    method: 'DELETE',
  });
}

export async function setInventoryPrimarySupplierOffer(itemId, offerId = '') {
  return inventoryRequest(`/items/${encodeURIComponent(String(itemId || ''))}/primary-offer`, {
    method: 'PUT', body: JSON.stringify({ offerId: String(offerId || '') }),
  });
}


// Classification is a tenant-owned Core dictionary. Mutations return the
// dictionary, so refresh the canonical Inventory snapshot after every write.
async function inventoryGroupMutation(path, method, value = {}) {
  const response = await apiRequest('/inventory' + path, {
    method, body: JSON.stringify(value),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = Array.isArray(payload?.message) ? payload.message.join('; ')
      : typeof payload?.message === 'string' ? payload.message : '';
    throw new Error(reason || 'Не удалось изменить группы (HTTP ' + response.status + ')');
  }
  if (!Array.isArray(payload)) throw new Error('Сервер не подтвердил сохранение группы.');
  return loadInventory();
}

export function createInventoryClassificationGroup(value) {
  return inventoryGroupMutation('/classification-groups', 'POST', value);
}

export function updateInventoryClassificationGroup(groupId, value) {
  return inventoryGroupMutation('/classification-groups/' + encodeURIComponent(String(groupId)), 'PUT', value);
}

export function createInventoryStorageLocation(value) {
  return inventoryRequest('/storage-locations', { method: 'POST', body: JSON.stringify(value) });
}

export function updateInventoryStorageLocation(locationId, value) {
  return inventoryRequest('/storage-locations/' + encodeURIComponent(String(locationId)), {
    method: 'PUT', body: JSON.stringify(value),
  });
}

export function transferInventoryStock(value) {
  return inventoryRequest('/transfers', { method: 'POST', body: JSON.stringify(value) });
}

// Desired quantities are a separate planning operation; never create a physical movement.
export function updateInventoryStockTargets(itemId, value) {
  return inventoryRequest('/items/' + encodeURIComponent(String(itemId)) + '/targets', {
    method: 'PUT', body: JSON.stringify(value),
  });
}

async function criteriaRequest(path = '', method = 'GET', data = null) {
  const response = await apiRequest('/inventory/criteria' + path, {
    method,
    ...(data === null ? {} : { body: JSON.stringify(data) }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = Array.isArray(payload.message) ? payload.message.join('; ')
      : typeof payload.message === 'string' ? payload.message : '';
    throw new Error(message || 'Не удалось сохранить классификацию склада.');
  }
  if (!Array.isArray(payload)) throw new Error('Сервер не вернул справочник групп.');
  return setInventoryCriteriaCatalog(payload);
}
export const loadInventoryCriteria = () => criteriaRequest();
export const createInventoryCriterion = name => criteriaRequest('', 'POST', { name });
export const updateInventoryCriterion = (id, patch) => criteriaRequest('/' + encodeURIComponent(id), 'PUT', patch);
export const createInventoryCriterionValue = (id, name) =>
  criteriaRequest('/' + encodeURIComponent(id) + '/values', 'POST', { name });
export const updateInventoryCriterionValue = (id, valueId, patch) =>
  criteriaRequest('/' + encodeURIComponent(id) + '/values/' + encodeURIComponent(valueId), 'PUT', patch);


export const reorderInventoryCriterionValues = (groupId, valueIds) =>
  criteriaRequest('/' + encodeURIComponent(groupId) + '/values/order', 'PUT', { valueIds });

async function criteriaRecoveryRequest(action, body) {
  const response = await apiRequest('/inventory/criteria/recovery/' + action, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = Array.isArray(data.message) ? data.message.join('; ')
      : typeof data.message === 'string' ? data.message : '';
    throw new Error(reason || 'Не удалось сверить классификацию склада.');
  }
  return data;
}

export const previewInventoryCriteriaRecovery = rows =>
  criteriaRecoveryRequest('preview', { rows });
export const applyInventoryCriteriaRecovery = changes =>
  criteriaRecoveryRequest('apply', { changes });

/**
 * Remove a criterion value and release its assignments through the existing
 * per-item Core PATCH endpoint. Never delete any stock item or movement.
 * No new backend endpoint, migration or shared UI dependency.
 *
 * This is intentionally serial and retryable. Since Core does not expose a
 * transactional detach-and-archive operation, failures must be reported:
 * successful earlier detaches cannot be rolled back by the browser.
 */
export async function removeInventoryCriterionValueAndAssignments(group, value) {
  if (!group?.id || !value?.id) throw new Error('Значение не найдено.');
  await Promise.all([loadInventory(), loadInventoryCriteria()]);
  const liveGroup = (getInventoryCriteria() || []).find(entry => entry.id === group.id);
  const liveValue = liveGroup?.values?.find(entry => entry.id === value.id);
  if (!liveValue || liveValue.name !== value.name) {
    throw new Error('Значение изменилось. Обновите список и повторите удаление.');
  }
  const field = liveGroup.legacyField;
  const assigned = item => field
    ? String(item?.[field] ?? '').trim() === liveValue.name
    : String(item?.criteriaValues?.[liveGroup.id] ?? '') === liveValue.id;
  const affected = getInventoryItems().filter(assigned).map(item => item.itemId);
  let released = 0;
  for (const itemId of affected) {
    const item = getInventoryItem(itemId);
    if (!item || !assigned(item)) continue;
    try {
      await updateInventoryItem(itemId, field
        ? { [field]: '' }
        : { criteriaValues: { [liveGroup.id]: '' } });
      released++;
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Ошибка сохранения.';
      throw new Error('Снято назначений: ' + released + ' из ' + affected.length +
        '. Удаление не завершено; повторите действие. ' + detail);
    }
  }
  // Recheck the canonical Core snapshot before archiving the dictionary value.
  await loadInventory();
  if (getInventoryItems().some(assigned)) {
    throw new Error('Часть назначений ещё используется. Обновите список и повторите удаление.');
  }
  try {
    const groups = await updateInventoryCriterionValue(liveGroup.id,liveValue.id,{archived:true});
    return { groups, released };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Ошибка сохранения.';
    throw new Error('Назначения сняты (' + released +
      '), но значение ещё не удалено. Повторите действие. ' + detail);
  }
}
