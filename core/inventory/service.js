import { apiRequest } from '../auth.js';
import { applyInventorySnapshot, getInventoryItem } from './data.js';

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
    body: JSON.stringify(value),
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
  return inventoryRequest('/items/reorder', {
    method: 'POST',
    body: JSON.stringify({ manufacturer, itemIds }),
    verifySnapshot: payload => {
      if (!Array.isArray(payload?.items) || !itemIds.every((id, index) => {
        const item = snapshotItem(payload, id);
        return item && Number(item.position) === index + 1
          && String(item.manufacturer || '').trim() === String(manufacturer || '').trim();
      })) throw new Error(SERVER_ORDER_UNAVAILABLE);
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
