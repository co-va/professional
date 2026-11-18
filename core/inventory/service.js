import { apiRequest } from '../auth.js';
import { applyInventorySnapshot, getInventoryItem, getInventorySnapshot } from './data.js';

const SERVER_ORDER_UNAVAILABLE = 'Сервер склада ещё не обновлён. Порядок не сохранён.';

function snapshotItem(payload, itemId) {
  return Array.isArray(payload?.items)
    ? payload.items.find(item => String(item?.itemId || '') === String(itemId || ''))
    : null;
}

async function inventoryRequest(path = '', options = {}) {
  const { verifySnapshot, ...requestOptions } = options;
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
  // The older server accepts arbitrary item fields but silently ignores position.
  // Verify the actual server snapshot before treating a number edit as saved.
  verifySnapshot?.(payload);
  return applyInventorySnapshot(payload);
}

export async function loadInventory() {
  return inventoryRequest();
}

export async function createInventoryItem(value = {}) {
  return inventoryRequest('/items', {
    method: 'POST',
    body: JSON.stringify(value),
  });
}

export async function updateInventoryItem(itemId, value = {}) {
  const previous = getInventoryItem(itemId);
  const expected = Number(value?.position);
  const positionChanged = Object.prototype.hasOwnProperty.call(value, 'position')
    && Number.isSafeInteger(expected)
    && expected !== (Number(previous?.position) || 0);
  return inventoryRequest(`/items/${encodeURIComponent(String(itemId || ''))}`, {
    method: 'PUT',
    // A stale phone or browser tab cannot overwrite a more recent slot number.
    body: JSON.stringify(Object.prototype.hasOwnProperty.call(value, 'position')
      ? { ...value, expectedPosition: Number(previous?.position) || 0 } : value),
    verifySnapshot: positionChanged ? payload => {
      const saved = snapshotItem(payload, itemId);
      if (!saved || !Object.prototype.hasOwnProperty.call(saved, 'position')
        || Number(saved.position) !== expected) {
        throw new Error('Номер не сохранился. ' + SERVER_ORDER_UNAVAILABLE);
      }
    } : undefined,
  });
}

export async function reorderInventoryItems(manufacturer, itemIds) {
  const previousPositions = itemIds.map(id => Number(getInventoryItem(id)?.position) || 0);
  return inventoryRequest('/items/reorder', {
    method: 'POST',
    body: JSON.stringify({ manufacturer, itemIds, previousPositions }),
    verifySnapshot: payload => {
      if (!Array.isArray(payload?.items)) throw new Error(SERVER_ORDER_UNAVAILABLE);
      // Confirm the physical user-defined order, including partial numbering;
      // zeros remain unassigned instead of getting invented sequential ranks.
      const group = payload.items.filter(item =>
        String(item.manufacturer || '').trim() === String(manufacturer || '').trim());
      const sorted = [...group].sort((a, b) => {
        const rank = item => Number(item.position) > 0 ? Number(item.position) : Number.MAX_SAFE_INTEGER;
        return rank(a) - rank(b)
          || String(a.name || '').localeCompare(String(b.name || ''), 'ru', { numeric: true, sensitivity: 'base' })
          || String(a.itemId || '').localeCompare(String(b.itemId || ''));
      });
      if (sorted.length !== itemIds.length || sorted.some((item, index) => item.itemId !== itemIds[index]))
        throw new Error('Сервер вернул другой порядок. Обновите склад.');
    },
  });
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

export async function receiveInventoryPurchaseOrder(orderId, receivedAt) {
  return inventoryRequest(`${purchaseOrderPath(orderId)}/receive`, {
    method: 'POST', body: JSON.stringify({ receivedAt }),
    verifySnapshot: payload => {
      const order = verifyOrderState(payload, orderId, ['received']);
      if (!order.receiptMovementId) throw new Error('Сервер не подтвердил приход.');
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
